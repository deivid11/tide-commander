/**
 * Agent Terminal Service
 *
 * Manages per-agent ttyd processes that attach to an interactive-TUI agent's
 * tmux session (`tc-int-<agentId>`), so the real `claude` TUI can be embedded in
 * the UI ("Classic TUI" view mode). This reuses the same ttyd + terminal-proxy
 * machinery as building terminals, but is keyed by agentId and isolated to its
 * own port range and `agent-<agentId>` proxy path.
 *
 * The ttyd is a viewer only — it attaches to the session the InteractiveClaude-
 * Runner owns; stopping the ttyd never kills the tmux session.
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createServer } from 'net';
import { createLogger } from '../utils/index.js';
import {
  interactiveTmuxSessionName,
  hasInteractiveTmuxSession,
} from '../claude/runner/tmux-helper.js';

const log = createLogger('AgentTerminal');

interface AgentTerminalInstance {
  pid: number;
  port: number;
  process: ChildProcess;
  tmuxSession: string;
}

// agentId -> running ttyd instance
const instances = new Map<string, AgentTerminalInstance>();

// Dedicated port range, above the building-terminal range (7681-7780) so the
// two never collide.
const BASE_PORT = 7781;
const MAX_PORT = 7880;

const DRACULA_THEME =
  'theme={"background":"#1a1a2e","foreground":"#f8f8f2","cursor":"#f8f8f2","cursorAccent":"#1a1a2e","selectionBackground":"#44475a","black":"#21222c","red":"#ff5555","green":"#50fa7b","yellow":"#f1fa8c","blue":"#bd93f9","magenta":"#ff79c6","cyan":"#8be9fd","white":"#f8f8f2","brightBlack":"#6272a4","brightRed":"#ff6e6e","brightGreen":"#69ff94","brightYellow":"#ffffa5","brightBlue":"#d6acff","brightMagenta":"#ff92df","brightCyan":"#a4ffff","brightWhite":"#ffffff"}';

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const usedPorts = new Set<number>();
    for (const inst of instances.values()) usedPorts.add(inst.port);

    const tryPort = (port: number) => {
      if (port > MAX_PORT) {
        reject(new Error('No free ports available for agent terminals'));
        return;
      }
      if (usedPorts.has(port)) {
        tryPort(port + 1);
        return;
      }
      const server = createServer();
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(port));
      });
      server.on('error', () => tryPort(port + 1));
    };
    tryPort(BASE_PORT);
  });
}

/**
 * Kill any stray ttyd bound to this agent's proxy base-path. Guards against
 * duplicates leaked by an earlier crash/race (the trailing space pins the match
 * to the exact agentId, so `agent-ab` can't match `agent-abcd`).
 */
function killStrayTtyd(agentId: string): void {
  try {
    execSync(`pkill -f "base-path /api/terminal/agent-${agentId} "`, { stdio: 'ignore' });
  } catch {
    // pkill exits non-zero when nothing matched — that's fine.
  }
}

/** Kill a ttyd whose backing tmux session is gone (avoids a client reconnect loop). */
function killOrphaned(agentId: string, instance: AgentTerminalInstance): void {
  log.log(`Killing orphaned agent ttyd for ${agentId.slice(0, 8)} (session ${instance.tmuxSession} gone)`);
  try {
    process.kill(instance.pid, 'SIGTERM');
  } catch { /* already dead */ }
  instances.delete(agentId);
}

export interface AgentTerminalStartResult {
  success: boolean;
  url?: string;
  error?: string;
}

// Per-agent in-flight start lock. Without it, two concurrent start calls (e.g.
// React StrictMode double-mounting the viewer in dev) both pass the reuse check
// before the async findFreePort resolves and each spawn a ttyd. Coalescing them
// onto one promise guarantees a single ttyd per agent.
const starting = new Map<string, Promise<AgentTerminalStartResult>>();

/**
 * Start (or reuse) a ttyd attached to the agent's interactive tmux session.
 * Idempotent and concurrency-safe: returns the existing terminal URL if one is
 * already running, and coalesces overlapping start calls.
 */
export function startAgentTerminal(agentId: string): Promise<AgentTerminalStartResult> {
  const inflight = starting.get(agentId);
  if (inflight) return inflight;
  const p = startAgentTerminalImpl(agentId).finally(() => {
    starting.delete(agentId);
  });
  starting.set(agentId, p);
  return p;
}

async function startAgentTerminalImpl(agentId: string): Promise<AgentTerminalStartResult> {
  const sessionName = interactiveTmuxSessionName(agentId);

  // Reuse a healthy existing instance.
  const existing = instances.get(agentId);
  if (existing) {
    let alive = false;
    try {
      process.kill(existing.pid, 0);
      alive = true;
    } catch { alive = false; }
    if (alive && hasInteractiveTmuxSession(agentId)) {
      return { success: true, url: `/api/terminal/agent-${agentId}/` };
    }
    killOrphaned(agentId, existing);
  }

  if (!hasInteractiveTmuxSession(agentId)) {
    return { success: false, error: 'No interactive session for this agent' };
  }
  if (!commandExists('ttyd')) {
    return { success: false, error: 'ttyd is not installed (required for the Classic TUI view)' };
  }

  // No tracked-alive instance at this point → kill any leaked stray ttyd for
  // this agent before spawning a fresh one.
  killStrayTtyd(agentId);

  let port: number;
  try {
    port = await findFreePort();
  } catch (err: any) {
    return { success: false, error: err.message };
  }

  const basePath = `/api/terminal/agent-${agentId}`;
  const ttydArgs: string[] = [
    '--port', String(port),
    '--writable',
    '--base-path', basePath,
    '--client-option', DRACULA_THEME,
    '--client-option', 'fontSize=13',
    '--client-option', 'scrollback=10000',
    '--client-option', 'disableLeaveAlert=true',
    '--client-option', 'enableSixel=true',
    // Attach to the live interactive session. No tmux option mangling here:
    // the claude TUI handles its own mouse/scroll, so we leave the session as-is.
    'tmux', 'attach-session', '-t', sessionName,
  ];

  log.log(`Starting agent ttyd on port ${port}: ttyd ${ttydArgs.join(' ')}`);
  const proc = spawn('ttyd', ttydArgs, { stdio: 'ignore', detached: true });
  proc.unref();

  if (!proc.pid) {
    return { success: false, error: 'Failed to spawn ttyd process' };
  }

  instances.set(agentId, { pid: proc.pid, port, process: proc, tmuxSession: sessionName });

  proc.on('exit', (code) => {
    log.log(`Agent ttyd for ${agentId.slice(0, 8)} exited (code ${code})`);
    instances.delete(agentId);
  });

  return { success: true, url: `/api/terminal/agent-${agentId}/` };
}

/** Stop the agent's ttyd viewer. The tmux session is intentionally left running. */
export function stopAgentTerminal(agentId: string): void {
  const instance = instances.get(agentId);
  if (!instance) return;
  try {
    process.kill(instance.pid, 'SIGTERM');
  } catch { /* already dead */ }
  instances.delete(agentId);
  log.log(`Stopped agent ttyd for ${agentId.slice(0, 8)}`);
}

/**
 * Resolve the ttyd port for the proxy. Returns null (and cleans up) if the ttyd
 * is dead or its tmux session has gone away.
 */
export function getAgentTerminalPort(agentId: string): number | null {
  const instance = instances.get(agentId);
  if (!instance) return null;
  try {
    process.kill(instance.pid, 0);
  } catch {
    instances.delete(agentId);
    return null;
  }
  if (!hasInteractiveTmuxSession(agentId)) {
    killOrphaned(agentId, instance);
    return null;
  }
  return instance.port;
}

/**
 * Kill every agent ttyd viewer on the system (orphans from a prior commander
 * instance). Called once at startup so a restart gets a clean slate — the
 * frontend re-requests a fresh viewer when a Classic TUI view is opened.
 */
export function sweepAllAgentTtyds(): void {
  try {
    execSync('pkill -f "ttyd.*base-path /api/terminal/agent-"', { stdio: 'ignore' });
  } catch {
    // nothing to sweep
  }
  instances.clear();
}

/** Kill all agent ttyd processes (graceful shutdown). */
export function stopAllAgentTerminals(): void {
  for (const [agentId, instance] of instances) {
    try {
      process.kill(instance.pid, 'SIGTERM');
    } catch { /* already dead */ }
    log.log(`Stopped agent ttyd for ${agentId.slice(0, 8)} (shutdown)`);
  }
  instances.clear();
}
