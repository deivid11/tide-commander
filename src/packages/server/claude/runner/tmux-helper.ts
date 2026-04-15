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

  let fullCmd: string;
  if (options.initialStdin) {
    const initialStdinFile = path.join(os.tmpdir(), `tc-initial-${options.agentId}.tmp`);
    fs.writeFileSync(initialStdinFile, options.initialStdin + '\n');

    if (options.closeStdinAfterPrompt) {
      // Pipe the prompt then close stdin (EOF).  For one-shot backends
      // like opencode that need EOF to start processing.
      fullCmd = `cat '${initialStdinFile}' | ${executable} ${escapedArgs} > '${logFile}' 2> '${stderrFile}'`;
    } else {
      // Pipe the prompt then keep stdin open via the tmux pane pty.
      // The second `cat` reads from the pane so sendToTmux() still works.
      fullCmd = `(cat '${initialStdinFile}'; cat) | ${executable} ${escapedArgs} > '${logFile}' 2> '${stderrFile}'`;
    }
  } else {
    fullCmd = `${executable} ${escapedArgs} > '${logFile}' 2> '${stderrFile}'`;
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
    // to avoid shell escaping issues with send-keys
    const tmpFile = path.join(os.tmpdir(), `tc-stdin-${agentId}.tmp`);
    fs.writeFileSync(tmpFile, text + '\n');
    execSync(
      `tmux load-buffer -b tc-input ${tmpFile} && tmux paste-buffer -b tc-input -t ${sessionName} -d`,
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
 * Uses `fs.watchFile` (polling) for reliability with pipe-pane output.
 */
export function createFileTailer(
  logFile: string,
  onLine: (line: string) => void,
): TmuxFileTailer {
  let offset = 0;
  let watching = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  function readNewData(): void {
    try {
      const stat = fs.statSync(logFile);
      if (stat.size <= offset) return;

      const fd = fs.openSync(logFile, 'r');
      const buf = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = stat.size;

      const text = buf.toString('utf8');
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          onLine(line);
        }
      }
    } catch {
      // file may not exist yet or be temporarily unavailable
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
    },
    getOffset() {
      return offset;
    },
    setOffset(newOffset: number) {
      offset = newOffset;
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

