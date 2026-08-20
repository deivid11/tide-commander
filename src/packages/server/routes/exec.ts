/**
 * Exec Routes
 * REST API endpoints for executing commands with streaming output
 *
 * Agents can execute long-running commands via HTTP POST requests.
 * Output is streamed to clients via WebSocket in real-time.
 */

import { Router, Request, Response } from 'express';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { agentService, secretsService } from '../services/index.js';
import { createLogger, generateId, getCommanderBaseUrl } from '../utils/index.js';
import { findBashToolUseForExec } from '../services/bash-toolcall-registry.js';
import { killProcessTree } from '../services/process-tree-kill.js';
import type { ServerMessage } from '../../shared/types.js';
import { TerminalRenderer } from '../../shared/terminal-render.js';

const log = createLogger('Exec');

const router = Router();

// Store for broadcasting via WebSocket
let broadcastFn: ((message: ServerMessage) => void) | null = null;

// Track running tasks
interface RunningTask {
  id: string;
  agentId: string;
  command: string;
  process: ChildProcess;
  output: string[];
  startedAt: number;
  cwd: string;
  pty: boolean;
  /** tool_use id of the Bash call that issued the curl (when the server could pair it). */
  toolUseId?: string;
}

const runningTasks = new Map<string, RunningTask>();

// ============================================================================
// Tail-resistant execution
// ============================================================================
// Agents routinely append `| tail -25` to exec commands to keep the output in
// THEIR context small. But the pipe buffers everything: the streamed live view
// (exec_task_output → the terminal's exec card) shows NOTHING until the inner
// command finishes, so the user watches an empty card for minutes. The fix:
// detect a trailing tail filter, execute the command WITHOUT it (the live
// stream then carries the real output), and apply the tail semantics here to
// the HTTP response only — the agent still receives exactly the truncated
// output it asked for.

export interface TailSpec {
  lines?: number;
  bytes?: number;
}

// Trailing-filter shapes recognized (and nothing after them):
//   ... | tail -25    ... | tail -n 25    ... | tail -n -25    ... | tail -c 3000
// `tail -n +25` (skip-first semantics), `tail -f`, `tail FILE` and anything
// followed by more text (closing quotes, further pipes, comments) do NOT match
// — those run untouched. The greedy prefix makes the LAST pipe win.
const TRAILING_TAIL_RE = /^([\s\S]*\S)\s*\|\s*tail\s+(?:-n\s*-?(\d+)|-c\s*-?(\d+)|-(\d+))\s*$/;

/**
 * Split a trailing `| tail …` filter off a shell command. Returns the inner
 * command plus the parsed spec, or null when the command doesn't confidently
 * end with one.
 */
export function splitTrailingTailFilter(command: string): { command: string; tail: TailSpec } | null {
  const m = TRAILING_TAIL_RE.exec(command);
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return null;
  if (m[2] !== undefined) return { command: inner, tail: { lines: Number(m[2]) } };
  if (m[3] !== undefined) return { command: inner, tail: { bytes: Number(m[3]) } };
  return { command: inner, tail: { lines: Number(m[4]) } };
}

/** Apply tail semantics to collected output (`-c` counted in chars, close enough for agent consumption). */
export function applyTailFilter(output: string, tail: TailSpec): string {
  if (tail.bytes !== undefined && tail.bytes >= 0) {
    return output.length > tail.bytes ? output.slice(-tail.bytes) : output;
  }
  const lines = tail.lines ?? 0;
  if (lines <= 0) return output;
  const endsWithNewline = output.endsWith('\n');
  const body = endsWithNewline ? output.slice(0, -1) : output;
  const parts = body.split('\n');
  if (parts.length <= lines) return output;
  return parts.slice(-lines).join('\n') + (endsWithNewline ? '\n' : '');
}

// ============================================================================
// PTY execution
// ============================================================================
// Piped children detect "not a TTY" and switch to CI-style output: no live
// progress, block-buffered stdio — the user's exec card shows nothing for
// minutes. Wrapping the command with util-linux `script -qefc` gives it a real
// pseudo-terminal: CLIs render their interactive progress and flush per write.
// The raw PTY stream (redraws, ANSI) is broadcast to clients — the exec card
// replays it through the shared TerminalRenderer — and the agent's HTTP
// response gets the clean rendered text.

let ptySupportCache: boolean | null = null;

function isPtySupported(): boolean {
  if (ptySupportCache === null) {
    try {
      ptySupportCache = spawnSync('script', ['--version'], { timeout: 3000 }).status === 0;
    } catch {
      ptySupportCache = false;
    }
    if (!ptySupportCache) {
      log.warn('[Exec] util-linux `script` unavailable — exec runs without PTY (no live progress from TTY-aware CLIs)');
    }
  }
  return ptySupportCache;
}

// Pagers hang under a PTY (git log → less waits for a keypress); neutralize
// them. COLUMNS/LINES hint a sane size since the PTY has no real window.
const PTY_ENV_OVERRIDES = {
  TERM: 'xterm-256color',
  COLUMNS: '120',
  LINES: '40',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  SHELL: '/bin/bash', // script(1) runs the command via $SHELL — pin bash semantics
};

/**
 * Set the broadcast function for sending output to all clients
 */
export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

/**
 * Get all running tasks for an agent
 */
export function getRunningTasks(agentId: string): RunningTask[] {
  return Array.from(runningTasks.values()).filter(t => t.agentId === agentId);
}

/** Bounded output tail for the connection snapshot (the client card keeps
 * ~500 lines; PTY renderers rebuild fine from a partial stream). */
const SNAPSHOT_OUTPUT_TAIL_BYTES = 256 * 1024;

// Recently-COMPLETED tasks, kept for the connection snapshot. A short exec
// (a 10s curl) is over before a page reload or an agent-switch finishes, so
// a client that connects after the run would never see exec_task_started and
// its terminal row could never attach the card — even though the row parses
// fine. Bounded: completed entries keep a small tail only, and the buffer is
// pruned by count and age.
interface CompletedTaskRecord {
  id: string; agentId: string; command: string; cwd: string; pty: boolean;
  startedAt: number; toolUseId?: string; outputTail: string;
  exitCode: number | null; completedAt: number;
}
const completedTasks: CompletedTaskRecord[] = [];
// Bounded hard: the whole list rides in EVERY connection snapshot, and phones
// reconnect often — 40 × 32 KB worst-case ≈ 1.3 MB, typical ≪ that.
const COMPLETED_KEEP_MAX = 40;
const COMPLETED_KEEP_MS = 60 * 60_000;
const COMPLETED_OUTPUT_TAIL_BYTES = 32 * 1024;

/** Test hook. */
export function _resetCompletedExecTasks(): void {
  completedTasks.length = 0;
}

function rememberCompletedTask(t: RunningTask, exitCode: number | null, completedAt: number): void {
  const joined = t.output.join('');
  completedTasks.push({
    id: t.id,
    agentId: t.agentId,
    command: t.command,
    cwd: t.cwd,
    pty: t.pty,
    startedAt: t.startedAt,
    toolUseId: t.toolUseId,
    outputTail: joined.length > COMPLETED_OUTPUT_TAIL_BYTES ? joined.slice(-COMPLETED_OUTPUT_TAIL_BYTES) : joined,
    exitCode,
    completedAt,
  });
  const cutoff = completedAt - COMPLETED_KEEP_MS;
  while (completedTasks.length > COMPLETED_KEEP_MAX || (completedTasks.length > 0 && completedTasks[0].completedAt < cutoff)) {
    completedTasks.shift();
  }
}

export interface ExecTaskSnapshotEntry {
  taskId: string; agentId: string; agentName: string; command: string; cwd: string;
  pty?: boolean; startedAt: number; toolUseId?: string; outputTail: string;
  /** Absent = running (older servers never sent a status). */
  status?: 'running' | 'completed' | 'failed';
  exitCode?: number | null;
  completedAt?: number;
}

/**
 * Snapshot of every running exec task PLUS recently-completed ones, for the
 * WS initial state. Without the running half, a page that loads/reconnects
 * MID-task never sees exec_task_started and the live card cannot exist
 * ("sometimes the streamed command doesn't render"); without the completed
 * half, the card of any exec that FINISHED before the client connected can
 * never render at all.
 */
export function getRunningTasksSnapshot(): ExecTaskSnapshotEntry[] {
  const cutoff = Date.now() - COMPLETED_KEEP_MS;
  const running = Array.from(runningTasks.values()).map((t) => {
    const joined = t.output.join('');
    return {
      taskId: t.id,
      agentId: t.agentId,
      agentName: agentService.getAgent(t.agentId)?.name ?? t.agentId,
      command: t.command,
      cwd: t.cwd,
      pty: t.pty,
      startedAt: t.startedAt,
      toolUseId: t.toolUseId,
      outputTail: joined.length > SNAPSHOT_OUTPUT_TAIL_BYTES ? joined.slice(-SNAPSHOT_OUTPUT_TAIL_BYTES) : joined,
      status: 'running' as const,
    };
  });
  const completed = completedTasks
    .filter((t) => t.completedAt >= cutoff)
    .map((t) => ({
      taskId: t.id,
      agentId: t.agentId,
      agentName: agentService.getAgent(t.agentId)?.name ?? t.agentId,
      command: t.command,
      cwd: t.cwd,
      pty: t.pty,
      startedAt: t.startedAt,
      toolUseId: t.toolUseId,
      outputTail: t.outputTail,
      // Same semantics as the exec_task_completed broadcast: a null exit code
      // means the process didn't run to completion (killed/crashed).
      status: t.exitCode !== null ? ('completed' as const) : ('failed' as const),
      exitCode: t.exitCode,
      completedAt: t.completedAt,
    }));
  return [...running, ...completed];
}

/**
 * Kill a running task by ID. Under PTY mode the direct child is script(1),
 * which puts the ACTUAL command in a separate session/process group (setsid to
 * grab the pty) — so signalling only script's group leaves the command tree
 * alive and script waiting, and the card stays "running". killProcessTree
 * walks /proc to signal every descendant's group + pid (captured before they
 * reparent), then SIGKILLs survivors. See process-tree-kill.ts.
 */
export function killTask(taskId: string): boolean {
  const task = runningTasks.get(taskId);
  if (!task) return false;
  const pid = task.process.pid;
  try {
    if (pid) {
      killProcessTree(pid, { escalateMs: 3000, stillTracked: () => runningTasks.has(taskId) });
    } else {
      task.process.kill('SIGTERM');
    }
    return true;
  } catch (err) {
    log.error(`Failed to kill task ${taskId}:`, err);
    return false;
  }
}

/**
 * POST /api/exec - Execute a command with streaming output
 *
 * Body:
 * - agentId: string (required) - The ID of the agent executing the command
 * - command: string (required) - The command to execute
 * - cwd: string (optional) - Working directory (defaults to agent's cwd)
 * - tail: number (optional) - Return only the last N lines in the HTTP
 *   response. The live WS stream (and the user's exec card) always carries the
 *   FULL output — this only trims what lands in the agent's context.
 * - pty: boolean (optional, default true) - Run the command under a
 *   pseudo-terminal so TTY-aware CLIs emit live progress. Pass false for the
 *   legacy piped execution (separate stderr, no progress rendering).
 *
 * This endpoint executes the command and streams output via WebSocket.
 * Returns the final output and exit code when the command completes.
 *
 * Tail-resistance: a command ENDING in `| tail -N` / `| tail -n N` /
 * `| tail -c N` is executed without that filter (so the stream shows real
 * progress instead of buffering silently) and the tail is applied to the
 * response instead — same output for the agent, live visibility for the user.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { agentId, command, cwd, tail, pty } = req.body;

    // Validate required fields
    if (!agentId || !command) {
      log.error(`[Exec] Missing required fields. Body: ${JSON.stringify(req.body)}`);
      res.status(400).json({
        error: 'Missing required fields: agentId, command',
        received: req.body
      });
      return;
    }

    log.log(`[Exec] Received exec request for agent ${agentId}`);
    log.log(`[Exec] Command: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`);
    if (cwd) {
      log.log(`[Exec] CWD: ${cwd}`);
    }

    // Get agent info
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent not found: ${agentId}` });
      return;
    }

    // Use provided cwd or agent's cwd
    const workingDir = cwd || agent.cwd;

    // Replace secret placeholders in command (e.g., {{API_KEY}} -> actual value)
    const processedCommand = secretsService.replaceSecrets(command);

    // Tail-resistance: strip a trailing `| tail …` so the live stream carries
    // the real output; remember the spec to apply to the response instead.
    const stripped = splitTrailingTailFilter(processedCommand);
    const executedCommand = stripped ? stripped.command : processedCommand;
    // An explicit `tail` body param wins over a parsed pipe filter.
    const explicitTailLines = Number.isFinite(Number(tail)) && Number(tail) > 0
      ? Math.min(Math.floor(Number(tail)), 10000)
      : undefined;
    const responseTail: TailSpec | undefined = explicitTailLines !== undefined
      ? { lines: explicitTailLines }
      : stripped?.tail;
    if (stripped) {
      log.log(`[Exec] Trailing tail filter stripped for live streaming (task response keeps tail semantics: ${JSON.stringify(stripped.tail)})`);
    }

    // PTY by default (opt out with "pty": false) whenever `script` exists.
    const usePty = pty !== false && isPtySupported();

    // Generate task ID
    const taskId = generateId();

    // Which Bash tool call (terminal row) issued this curl? Lets the client
    // attach the live card by tool_use id instead of re-parsing the curl body
    // or guessing by time. Undefined when unknown (non-agent callers, exotic
    // flows) — the client then falls back to its heuristics.
    const toolUseId = findBashToolUseForExec(agentId, command);

    // Log original command (not processed, to avoid leaking secrets in logs)
    log.log(`[${agent.name}] Executing: ${command} (task: ${taskId}${usePty ? ', pty' : ''})`);

    // Broadcast task started
    if (broadcastFn) {
      broadcastFn({
        type: 'exec_task_started',
        payload: {
          taskId,
          agentId,
          agentName: agent.name,
          command,
          cwd: workingDir,
          pty: usePty,
          // Server clock: the terminal matches this task to the agent's curl
          // row by time when the body can't be parsed — the row's timestamp is
          // server-stamped too, so both sides must be in the same domain
          // (client Date.now() on a phone/other PC is skewed).
          startedAt: Date.now(),
          ...(toolUseId ? { toolUseId } : {}),
        },
      } as ServerMessage);
    }

    // Spawn the process with secrets replaced (and any trailing tail stripped).
    // PTY mode wraps with script(1) so the child sees a real terminal; args are
    // passed directly to spawn — no extra shell-escaping layer.
    // detached: own process group, so killTask can TERM/KILL the whole tree.
    const childProcess = usePty
      ? spawn('script', ['-qefc', executedCommand, '/dev/null'], {
          cwd: workingDir,
          env: { ...process.env, ...PTY_ENV_OVERRIDES },
          shell: false,
          detached: true,
        })
      : spawn('bash', ['-c', executedCommand], {
          cwd: workingDir,
          env: { ...process.env },
          shell: false,
          detached: true,
        });

    // Track the task
    const task: RunningTask = {
      id: taskId,
      agentId,
      command,
      process: childProcess,
      output: [],
      startedAt: Date.now(),
      cwd: workingDir,
      pty: usePty,
      toolUseId,
    };
    runningTasks.set(taskId, task);

    // Collect output. In PTY mode the raw stream (redraws, ANSI) goes to the
    // renderer — the agent gets the clean rendered text, never the raw noise.
    let pipedOutput = '';
    const renderer = usePty ? new TerminalRenderer() : null;
    let exitCode: number | null = null;

    // Stream stdout (in PTY mode this carries stderr too — one merged stream)
    childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (renderer) renderer.write(text);
      else pipedOutput += text;
      task.output.push(text);

      // Broadcast output chunk
      if (broadcastFn) {
        broadcastFn({
          type: 'exec_task_output',
          payload: {
            taskId,
            agentId,
            output: text,
          },
        } as ServerMessage);
      }
    });

    // Stream stderr (pipe mode only — a PTY merges it into stdout)
    childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (renderer) renderer.write(text);
      else pipedOutput += text;
      task.output.push(text);

      // Broadcast output chunk (stderr too)
      if (broadcastFn) {
        broadcastFn({
          type: 'exec_task_output',
          payload: {
            taskId,
            agentId,
            output: text,
            isError: !renderer,
          },
        } as ServerMessage);
      }
    });

    // Wait for process to complete
    await new Promise<void>((resolve) => {
      childProcess.on('close', (code) => {
        exitCode = code;
        resolve();
      });

      childProcess.on('error', (err) => {
        log.error(`[${agent.name}] Process error:`, err);
        if (renderer) renderer.write(`\nError: ${err.message}`);
        else pipedOutput += `\nError: ${err.message}`;
        resolve();
      });
    });

    // Clean up task tracking — but remember the finished task so clients that
    // connect after the run still get it in the snapshot (card on late open).
    const completedAt = Date.now();
    const finishedTask = runningTasks.get(taskId);
    if (finishedTask) rememberCompletedTask(finishedTask, exitCode, completedAt);
    runningTasks.delete(taskId);

    // Broadcast task completed
    // success means the task ran to completion (not killed/crashed)
    if (broadcastFn) {
      broadcastFn({
        type: 'exec_task_completed',
        payload: {
          taskId,
          agentId,
          exitCode,
          success: exitCode !== null,
          completedAt,
        },
      } as ServerMessage);
    }

    log.log(`[${agent.name}] Command completed with exit code ${exitCode}`);

    // Return final result to the caller (curl)
    // Always success: true since the API call worked (command was executed).
    // Agents should check exitCode to determine if the command itself passed.
    // PTY runs return the RENDERED terminal text (progress bars collapsed to
    // their final state, ANSI stripped) — never the raw redraw stream. With a
    // tail in play (explicit param or stripped pipe filter) only the truncated
    // output reaches the agent — the full stream already went to the terminal.
    const rendered = renderer?.getText();
    const fullOutput = renderer ? (rendered ? `${rendered}\n` : '') : pipedOutput;
    const responseOutput = responseTail ? applyTailFilter(fullOutput, responseTail) : fullOutput;
    res.status(200).json({
      success: true,
      taskId,
      exitCode,
      output: responseOutput,
      duration: Date.now() - task.startedAt,
      ...(responseOutput.length !== fullOutput.length
        ? { tailApplied: true, fullOutputBytes: Buffer.byteLength(fullOutput, 'utf8') }
        : {}),
    });
  } catch (err: any) {
    log.error('Failed to execute command:', err);
    log.error('Error details:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      syscall: err.syscall,
    });
    res.status(500).json({
      error: err.message,
      details: {
        code: err.code,
        syscall: err.syscall,
      }
    });
  }
});

/**
 * GET /api/exec/tasks/:agentId - List running tasks for an agent
 */
router.get('/tasks/:agentId', (req: Request, res: Response) => {
  const agentId = req.params.agentId as string;
  const tasks = getRunningTasks(agentId).map(t => ({
    id: t.id,
    command: t.command,
    startedAt: t.startedAt,
    outputLines: t.output.length,
    toolUseId: t.toolUseId,
  }));
  res.json({ tasks });
});

/**
 * DELETE /api/exec/tasks/:taskId - Kill a running task
 */
router.delete('/tasks/:taskId', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const killed = killTask(taskId);
  if (killed) {
    res.json({ success: true, message: `Task ${taskId} killed` });
  } else {
    res.status(404).json({ error: `Task not found: ${taskId}` });
  }
});

/**
 * POST /api/exec/generate-curl - Generate properly escaped curl command for shell execution
 *
 * This endpoint generates a curl command with proper escaping for Codex agents
 * that need to execute it through shell (zsh, bash, etc.)
 */
router.post('/generate-curl', (req: Request, res: Response) => {
  const { agentId, command, cwd } = req.body;

  if (!agentId || !command) {
    res.status(400).json({
      error: 'Missing required fields: agentId, command'
    });
    return;
  }

  // Build the JSON payload
  const payload: Record<string, string> = {
    agentId,
    command,
  };
  if (cwd) {
    payload.cwd = cwd;
  }

  // Escape the JSON payload properly for shell execution
  // Use single quotes around JSON and escape any single quotes inside
  const jsonStr = JSON.stringify(payload);
  const escapedJson = jsonStr.replace(/'/g, "'\\''");

  // Generate curl command using $'...' syntax (ANSI-C quoting)
  // This is more reliable across different shells
  const curlCommand = `curl -s -X POST ${getCommanderBaseUrl()}/api/exec -H "Content-Type: application/json" -d '${escapedJson}'`;

  res.json({
    success: true,
    command: curlCommand,
    payload,
  });
});

export default router;
