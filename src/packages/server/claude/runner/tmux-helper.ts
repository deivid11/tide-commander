/**
 * tmux-based process persistence for CLI agent processes.
 *
 * When TIDE_USE_TMUX=1 (or "true"), agent CLI processes are spawned inside
 * tmux sessions so that stdin/stdout survive server restarts.  The tmux
 * server keeps the process alive; we reconnect by tailing a per-agent log
 * file rather than relying on Node.js pipe file descriptors.
 *
 * Default: OFF — the existing pipe-based behaviour is unchanged.
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import { createLogger } from '../../utils/logger.js';
import { isTmuxModeEnabled } from '../../services/system-prompt-service.js';

const log = createLogger('Tmux');

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Returns true when the user opted in (via Settings) AND tmux is available. */
export function isTmuxEnabled(): boolean {
  if (!isTmuxModeEnabled()) {
    return false;
  }
  return isTmuxInstalled();
}

/** Warn once at startup if the setting is on but tmux is missing. */
let warnedMissing = false;
export function checkTmuxAvailability(): void {
  if (!isTmuxModeEnabled()) {
    return;
  }
  if (!isTmuxInstalled() && !warnedMissing) {
    warnedMissing = true;
    log.error('Tmux mode is enabled in settings but tmux is not installed — falling back to pipe-based mode');
  }
}

/** Canonical tmux session name for an agent. */
export function tmuxSessionName(agentId: string): string {
  return `tc-${agentId}`;
}

/** Canonical log-file path for an agent's stdout. */
export function tmuxLogPath(agentId: string): string {
  return path.join(os.tmpdir(), `tc-agent-${agentId}.log`);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

export interface TmuxSpawnResult {
  /** The ChildProcess for the `tmux new-session` invocation (short-lived). */
  launcherProcess: ChildProcess;
  /** The tmux session name. */
  sessionName: string;
  /** Path to the stdout log file. */
  logFile: string;
}

/**
 * Spawn a CLI executable inside a tmux session.
 *
 * Stdout is redirected to a log file **inside the shell command** so we get
 * clean, raw JSON output (no terminal escape codes or line wrapping).
 * Stdin still comes from the tmux pane (via send-keys / paste-buffer).
 *
 * Returns a short-lived ChildProcess (the tmux launcher), the session name,
 * and the log file path.
 */
export function spawnInTmux(
  executable: string,
  args: string[],
  options: {
    agentId: string;
    cwd: string;
    env: Record<string, string | undefined>;
    /** If provided, this text is piped into the process's stdin immediately at
     *  startup (before tmux send-keys becomes available).  Subsequent input can
     *  still be sent via sendToTmux(). */
    initialStdin?: string;
    /** If true, stdin is closed (EOF) after delivering initialStdin.
     *  Use for backends that read a single prompt then process it (e.g. opencode).
     *  When false (default), stdin stays open for follow-up sendToTmux() calls. */
    closeStdinAfterPrompt?: boolean;
  },
): TmuxSpawnResult {
  const sessionName = tmuxSessionName(options.agentId);
  const logFile = tmuxLogPath(options.agentId);
  const stderrFile = `${logFile}.stderr`;

  // Ensure the log file exists (truncate if leftover from a previous run)
  fs.writeFileSync(logFile, '');
  fs.writeFileSync(stderrFile, '');

  // Kill any stale session with the same name (ignore errors)
  try {
    execSync(`tmux kill-session -t ${sessionName} 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // no existing session — that's fine
  }

  // Build the full command string for tmux to run.
  // Redirect stdout to the log file so we get clean JSON (no ANSI escapes).
  // Stderr goes to its own file for debugging.
  // Stdin remains connected to the tmux pane for send-keys input.
  const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');

  // `stty raw -echo` puts the pane PTY into raw mode before any reader runs.
  // Why: the second `cat` in `(cat <file>; cat) | claude …` reads from the
  // pane PTY, which is in canonical mode by default. Linux's n_tty driver
  // truncates any line longer than ~4096 bytes (N_TTY_BUF_SIZE) in canonical
  // mode, silently corrupting long stream-json messages and killing the CLI
  // with "Error parsing streaming input line: Unterminated string". Raw mode
  // disables the line-discipline buffer so bytes flow through unchanged.
  const sttyPrefix = 'stty raw -echo 2>/dev/null; ';

  let fullCmd: string;
  if (options.initialStdin) {
    const initialStdinFile = path.join(os.tmpdir(), `tc-initial-${options.agentId}.tmp`);
    fs.writeFileSync(initialStdinFile, options.initialStdin + '\n');

    if (options.closeStdinAfterPrompt) {
      // Pipe the prompt then close stdin (EOF).  For one-shot backends
      // like opencode that need EOF to start processing.
      fullCmd = `${sttyPrefix}cat '${initialStdinFile}' | ${executable} ${escapedArgs} > '${logFile}' 2> '${stderrFile}'`;
    } else {
      // Pipe the prompt then keep stdin open via the tmux pane pty.
      // The second `cat` reads from the pane so sendToTmux() still works.
      fullCmd = `${sttyPrefix}(cat '${initialStdinFile}'; cat) | ${executable} ${escapedArgs} > '${logFile}' 2> '${stderrFile}'`;
    }
  } else {
    fullCmd = `${sttyPrefix}${executable} ${escapedArgs} > '${logFile}' 2> '${stderrFile}'`;
  }

  // Spawn the tmux session
  const launcherProcess = spawn(
    'tmux',
    [
      'new-session',
      '-d',               // detached
      '-s', sessionName,  // session name
      '-x', '200',        // width
      '-y', '50',         // height
      '--', 'sh', '-c', fullCmd,
    ],
    {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  launcherProcess.unref();

  log.log(`Spawned tmux session ${sessionName}: ${executable} ${escapedArgs} (stdout -> ${logFile})`);

  return { launcherProcess, sessionName, logFile };
}

// ---------------------------------------------------------------------------
// Sending input
// ---------------------------------------------------------------------------

/**
 * Send text to a tmux session's active pane via `send-keys`.
 * Returns true on success.
 */
export function sendToTmux(agentId: string, text: string): boolean {
  const sessionName = tmuxSessionName(agentId);
  try {
    // Write the text to a temp file and use load-buffer + paste-buffer
    // to avoid shell escaping issues with send-keys.
    // Per-agent buffer name avoids cross-agent races on concurrent sends.
    // `-r` preserves LF (without it tmux translates LF→CR; the receiving
    // pane is in raw mode now so a CR would not be re-translated to LF and
    // claude's stream-json line terminator would be wrong).
    const tmpFile = path.join(os.tmpdir(), `tc-stdin-${agentId}.tmp`);
    const bufferName = `tc-input-${agentId}`;
    fs.writeFileSync(tmpFile, text + '\n');
    execSync(
      `tmux load-buffer -b ${bufferName} ${tmpFile} && tmux paste-buffer -b ${bufferName} -t ${sessionName} -r -d`,
      { stdio: 'ignore', timeout: 5000 },
    );
    fs.unlinkSync(tmpFile);
    return true;
  } catch (err) {
    log.error(`Failed to send input to tmux session ${sessionName}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/** Check whether a tmux session exists. */
export function hasTmuxSession(agentId: string): boolean {
  const sessionName = tmuxSessionName(agentId);
  try {
    execSync(`tmux has-session -t ${sessionName} 2>/dev/null`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session and clean up its log files. */
export function killTmuxSession(agentId: string): void {
  const sessionName = tmuxSessionName(agentId);
  const logFile = tmuxLogPath(agentId);
  const stderrFile = `${logFile}.stderr`;

  try {
    execSync(`tmux kill-session -t ${sessionName} 2>/dev/null`, { stdio: 'ignore' });
    log.log(`Killed tmux session ${sessionName}`);
  } catch {
    // already gone
  }

  for (const f of [logFile, stderrFile]) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

/** Send SIGINT to the process inside a tmux session. */
export function interruptTmuxSession(agentId: string): boolean {
  const sessionName = tmuxSessionName(agentId);
  try {
    execSync(`tmux send-keys -t ${sessionName} C-c`, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// File-tailing stdout reader
// ---------------------------------------------------------------------------

export interface TmuxFileTailer {
  /** Start tailing. Calls `onLine` for each complete line. */
  start(): void;
  /** Stop tailing and clean up watchers. */
  stop(): void;
  /** Current byte offset (for recovery). */
  getOffset(): number;
  /** Set the byte offset (for resuming after reconnect). */
  setOffset(offset: number): void;
}

/**
 * Create a file tailer that reads new lines appended to a log file.
 * Uses polling (`setInterval` + `fs.statSync`) for reliability with pipe-pane
 * output. Keeps a partial-line buffer across polls so long JSON events that
 * span multiple ticks (common with codex — single lines can be >20KB) are
 * delivered to `onLine` as complete lines, never mid-line fragments.
 */
export function createFileTailer(
  logFile: string,
  onLine: (line: string) => void,
): TmuxFileTailer {
  let offset = 0;
  let watching = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  // Buffer for bytes that arrive before the terminating '\n'. Flushed to
  // `onLine` only when a newline is seen. `StringDecoder` handles multibyte
  // UTF-8 sequences that straddle a chunk boundary.
  const decoder = new StringDecoder('utf8');
  let partialLine = '';

  function readNewData(): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(logFile);
    } catch {
      return; // file may not exist yet or be temporarily unavailable
    }

    // Truncation recovery: if the file shrank (rotated, truncated, or the
    // agent was restarted into a fresh log), reset to the start so we don't
    // stall forever waiting for size to grow past a stale offset.
    if (stat.size < offset) {
      offset = 0;
      partialLine = '';
    }
    if (stat.size <= offset) return;

    let fd: number;
    try {
      fd = fs.openSync(logFile, 'r');
    } catch {
      return;
    }
    const buf = Buffer.alloc(stat.size - offset);
    try {
      fs.readSync(fd, buf, 0, buf.length, offset);
    } catch {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      return;
    }
    try { fs.closeSync(fd); } catch { /* ignore */ }
    offset = stat.size;

    const text = decoder.write(buf);
    if (!text) return;

    const combined = partialLine + text;
    const lines = combined.split('\n');
    partialLine = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim()) {
        onLine(line);
      }
    }
  }

  return {
    start() {
      if (watching) return;
      watching = true;
      // Initial read for anything already in the file
      readNewData();
      // Poll every 100ms for new data
      pollInterval = setInterval(readNewData, 100);
    },
    stop() {
      watching = false;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      // Flush any bytes left in the decoder; drop the trailing partial line
      // (it will be re-read if the tailer is restarted from a saved offset).
      decoder.end();
      partialLine = '';
    },
    getOffset() {
      return offset;
    },
    setOffset(newOffset: number) {
      offset = newOffset;
      // Offset was repositioned externally — drop any buffered bytes that
      // belong to the old position so we don't concatenate them onto the new
      // starting point.
      partialLine = '';
    },
  };
}

/**
 * Get the PID of the process running inside a tmux session's active pane.
 * Returns undefined if the session doesn't exist or the PID can't be determined.
 */
export function getTmuxPanePid(agentId: string): number | undefined {
  const sessionName = tmuxSessionName(agentId);
  try {
    const output = execSync(
      `tmux list-panes -t ${sessionName} -F '#{pane_pid}'`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const pid = parseInt(output.split('\n')[0], 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns true when the expected CLI binary is alive somewhere in the pane's
 * descendant process tree. Catches the "zombie tmux" case where the CLI died
 * (e.g. claude crashed on a malformed stream-json line) but the wrapping
 * `(cat;cat) | claude` shell pipeline keeps the session alive — in that case
 * `hasTmuxSession` returns true but the agent is silently broken.
 *
 * Returns true on probe failure to avoid false-positive restarts.
 */
export function isTmuxPaneCommandAlive(agentId: string, expectedCommand: string): boolean {
  const panePid = getTmuxPanePid(agentId);
  if (!panePid) return false;
  let psOutput: string;
  try {
    psOutput = execSync(
      'ps -e -o pid=,ppid=,comm=',
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return true;
  }
  const procs = new Map<number, { ppid: number; comm: string }>();
  for (const line of psOutput.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    procs.set(parseInt(m[1], 10), { ppid: parseInt(m[2], 10), comm: m[3].trim() });
  }
  const target = expectedCommand.trim();
  // BFS through descendants of panePid
  const queue: number[] = [panePid];
  const visited = new Set<number>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const info = procs.get(cur);
    if (info && info.comm === target) return true;
    for (const [pid, p] of procs) {
      if (p.ppid === cur && !visited.has(pid)) queue.push(pid);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function isTmuxInstalled(): boolean {
  try {
    execSync('which tmux', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

