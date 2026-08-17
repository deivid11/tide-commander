/**
 * Area Terminal Service
 *
 * Manages the per-area "default terminal": a zero-config ttyd + tmux shell
 * that every area gets for free, cwd'd to the area's first assigned directory.
 * No terminal building needs to exist — the flat statusbar (and any future
 * surface) can start one on demand via POST /api/areas/:areaId/terminal.
 *
 * Mirrors agent-terminal-service (per-agent Classic TUI viewers): keyed by
 * areaId, isolated port range, `area-<areaId>` proxy path under /api/terminal/.
 * Unlike the agent viewer, this service OWNS its tmux session (`tide-area-*`),
 * creating it on first start so the shell persists across ttyd restarts and
 * server restarts.
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createServer } from 'net';
import { existsSync } from 'fs';
import { loadAreas } from '../data/index.js';
import { configureTideTmuxSession } from './terminal-service.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('AreaTerminal');

interface AreaTerminalInstance {
  pid: number;
  port: number;
  process: ChildProcess;
  tmuxSession: string;
}

// areaId -> running ttyd instance
const instances = new Map<string, AreaTerminalInstance>();

// Dedicated port range, above building terminals (7681-7780) and agent
// terminals (7781-7880) so the three never collide.
const BASE_PORT = 7881;
const MAX_PORT = 7980;

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
        reject(new Error('No free ports available for area terminals'));
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
 * tmux session name for an area's default terminal. Area ids are
 * `area_<ts>_<suffix>`; strip anything tmux-unsafe just in case.
 */
export function areaTmuxSessionName(areaId: string): string {
  return `tide-area-${areaId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function isTmuxSessionAlive(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill any stray ttyd bound to this area's proxy base-path. Guards against
 * duplicates leaked by an earlier crash/race (the trailing space pins the
 * match to the exact areaId).
 */
function killStrayTtyd(areaId: string): void {
  try {
    execSync(`pkill -f "base-path /api/terminal/area-${areaId} "`, { stdio: 'ignore' });
  } catch {
    // pkill exits non-zero when nothing matched — that's fine.
  }
}

/** Kill a ttyd whose backing tmux session is gone (avoids a client reconnect loop). */
function killOrphaned(areaId: string, instance: AreaTerminalInstance): void {
  log.log(`Killing orphaned area ttyd for ${areaId} (session ${instance.tmuxSession} gone)`);
  try {
    process.kill(instance.pid, 'SIGTERM');
  } catch { /* already dead */ }
  instances.delete(areaId);
}

export interface AreaTerminalStartResult {
  success: boolean;
  url?: string;
  error?: string;
}

// Per-area in-flight start lock — coalesces concurrent start calls (e.g. two
// flat panes on the same area, or React StrictMode double-effects) onto one
// promise so only a single ttyd is ever spawned per area.
const starting = new Map<string, Promise<AreaTerminalStartResult>>();

/**
 * Start (or reuse) the area's default terminal. Idempotent and
 * concurrency-safe: returns the existing proxy URL if one is already running.
 */
export function startAreaTerminal(areaId: string): Promise<AreaTerminalStartResult> {
  const inflight = starting.get(areaId);
  if (inflight) return inflight;
  const p = startAreaTerminalImpl(areaId).finally(() => {
    starting.delete(areaId);
  });
  starting.set(areaId, p);
  return p;
}

async function startAreaTerminalImpl(areaId: string): Promise<AreaTerminalStartResult> {
  const url = `/api/terminal/area-${areaId}/`;

  // Reuse a healthy existing instance.
  const existing = instances.get(areaId);
  if (existing) {
    let alive = false;
    try {
      process.kill(existing.pid, 0);
      alive = true;
    } catch { alive = false; }
    if (alive && isTmuxSessionAlive(existing.tmuxSession)) {
      return { success: true, url };
    }
    killOrphaned(areaId, existing);
  }

  const area = loadAreas().find(a => a.id === areaId);
  if (!area) {
    return { success: false, error: 'Area not found' };
  }
  if (!commandExists('ttyd')) {
    return { success: false, error: 'ttyd is not installed. Install it with your package manager (e.g., sudo dnf install ttyd)' };
  }
  if (!commandExists('tmux')) {
    return { success: false, error: 'tmux is not installed (required for the area terminal)' };
  }

  // No tracked-alive instance at this point → kill any leaked stray ttyd for
  // this area before spawning a fresh one.
  killStrayTtyd(areaId);

  // cwd = the area's first assigned directory that exists, HOME as fallback so
  // folder-less areas still get a working shell.
  const assignedDir = area.directories.find(d => d && d.trim().length > 0 && existsSync(d.trim()))?.trim();
  const startDir = assignedDir || process.env.HOME || '/';

  const tmuxSession = areaTmuxSessionName(areaId);
  if (!isTmuxSessionAlive(tmuxSession)) {
    // The session keeps the cwd it was created with; if the area's folder
    // changed since, the user's shell has likely cd'd around anyway.
    try {
      execSync(`tmux new-session -d -s ${tmuxSession} -c "${startDir}"`);
      log.log(`Created area tmux session ${tmuxSession} in ${startDir}`);
    } catch (err: any) {
      return { success: false, error: `Failed to create tmux session: ${err.message}` };
    }
    configureTideTmuxSession(tmuxSession);
  }

  let port: number;
  try {
    port = await findFreePort();
  } catch (err: any) {
    return { success: false, error: err.message };
  }

  const basePath = `/api/terminal/area-${areaId}`;
  const ttydArgs: string[] = [
    '--port', String(port),
    '--writable',
    '--base-path', basePath,
    '--client-option', DRACULA_THEME,
    '--client-option', 'fontSize=13',
    '--client-option', 'scrollback=10000',
    '--client-option', 'disableLeaveAlert=true',
    '--client-option', 'enableSixel=true',
    'tmux', 'attach-session', '-t', tmuxSession,
  ];

  log.log(`Starting area ttyd on port ${port}: ttyd ${ttydArgs.join(' ')}`);
  const proc = spawn('ttyd', ttydArgs, { stdio: 'ignore', detached: true });
  proc.unref();

  if (!proc.pid) {
    return { success: false, error: 'Failed to spawn ttyd process' };
  }

  instances.set(areaId, { pid: proc.pid, port, process: proc, tmuxSession });

  proc.on('exit', (code) => {
    log.log(`Area ttyd for ${areaId} exited (code ${code})`);
    instances.delete(areaId);
  });

  return { success: true, url };
}

/** Stop the area's ttyd. The tmux session is intentionally left running. */
export function stopAreaTerminal(areaId: string): void {
  const instance = instances.get(areaId);
  if (!instance) return;
  try {
    process.kill(instance.pid, 'SIGTERM');
  } catch { /* already dead */ }
  instances.delete(areaId);
  log.log(`Stopped area ttyd for ${areaId}`);
}

/**
 * Resolve the ttyd port for the proxy. Returns null (and cleans up) if the
 * ttyd is dead or its tmux session has gone away (user typed `exit`).
 */
export function getAreaTerminalPort(areaId: string): number | null {
  const instance = instances.get(areaId);
  if (!instance) return null;
  try {
    process.kill(instance.pid, 0);
  } catch {
    instances.delete(areaId);
    return null;
  }
  if (!isTmuxSessionAlive(instance.tmuxSession)) {
    killOrphaned(areaId, instance);
    return null;
  }
  return instance.port;
}

/**
 * Kill every area ttyd on the system (orphans from a prior commander
 * instance). Called once at startup — the tmux sessions survive, so the shell
 * state is preserved and the frontend just re-requests a fresh viewer.
 */
export function sweepAllAreaTtyds(): void {
  try {
    execSync('pkill -f "ttyd.*base-path /api/terminal/area-"', { stdio: 'ignore' });
  } catch {
    // nothing to sweep
  }
  instances.clear();
}

/** Kill all area ttyd processes (graceful shutdown). tmux sessions stay alive. */
export function stopAllAreaTerminals(): void {
  for (const [areaId, instance] of instances) {
    try {
      process.kill(instance.pid, 'SIGTERM');
    } catch { /* already dead */ }
    log.log(`Stopped area ttyd for ${areaId} (shutdown)`);
  }
  instances.clear();
}
