/**
 * Terminal Service
 * Manages ttyd processes for terminal buildings.
 * Supports optional tmux session persistence.
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createServer } from 'net';
import type { Building, TerminalStatus } from '../../shared/types.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('TerminalService');

interface TerminalInstance {
  pid: number;
  port: number;
  process: ChildProcess;
  tmuxSession?: string;
}

// Map of buildingId -> running terminal instance
const instances = new Map<string, TerminalInstance>();

// Base port for auto-assignment
const BASE_PORT = 7681;
const MAX_PORT = 7780;

/**
 * Find a free port starting from BASE_PORT
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    // Collect ports already in use by our instances
    const usedPorts = new Set<number>();
    for (const inst of instances.values()) {
      usedPorts.add(inst.port);
    }

    const tryPort = (port: number) => {
      if (port > MAX_PORT) {
        reject(new Error('No free ports available in range'));
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
 * Check if a command exists on the system
 */
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a terminal (ttyd) for a building
 */
export async function startTerminal(building: Building): Promise<{ success: boolean; error?: string }> {
  const config = building.terminal;
  if (!config?.enabled) {
    return { success: false, error: 'Terminal config not enabled' };
  }

  // Check if already running
  if (instances.has(building.id)) {
    return { success: false, error: 'Terminal already running' };
  }

  // Check ttyd is installed
  if (!commandExists('ttyd')) {
    return { success: false, error: 'ttyd is not installed. Install it with your package manager (e.g., sudo dnf install ttyd)' };
  }

  // Determine port
  let port: number;
  try {
    port = config.port || await findFreePort();
  } catch (err: any) {
    return { success: false, error: err.message };
  }

  // Determine shell
  const shell = config.shell || process.env.SHELL || '/bin/bash';

  // Build ttyd args
  // --base-path ensures ttyd generates URLs under the proxy prefix
  // so /token, /ws etc. become /api/terminal/<id>/token, /api/terminal/<id>/ws
  const basePath = `/api/terminal/${building.id}`;
  const ttydArgs: string[] = [
    '--port', String(port),
    '--writable',
    '--base-path', basePath,
    // Dark theme matching Commander's Dracula palette
    '--client-option', 'theme={"background":"#1a1a2e","foreground":"#f8f8f2","cursor":"#f8f8f2","cursorAccent":"#1a1a2e","selectionBackground":"#44475a","black":"#21222c","red":"#ff5555","green":"#50fa7b","yellow":"#f1fa8c","blue":"#bd93f9","magenta":"#ff79c6","cyan":"#8be9fd","white":"#f8f8f2","brightBlack":"#6272a4","brightRed":"#ff6e6e","brightGreen":"#69ff94","brightYellow":"#ffffa5","brightBlue":"#d6acff","brightMagenta":"#ff92df","brightCyan":"#a4ffff","brightWhite":"#ffffff"}',
    // Font size and scrollback
    '--client-option', 'fontSize=13',
    '--client-option', 'scrollback=10000',
    '--client-option', 'disableLeaveAlert=true',
    '--client-option', 'enableSixel=true',
  ];

  // Add cwd if specified
  if (building.cwd) {
    ttydArgs.push('--cwd', building.cwd);
  }

  // Parse extra args
  if (config.args) {
    const extra = config.args.split(/\s+/).filter(a => a);
    ttydArgs.push(...extra);
  }

  let tmuxSession: string | undefined;

  if (config.saveSession) {
    // Check tmux is installed
    if (!commandExists('tmux')) {
      return { success: false, error: 'tmux is not installed (required for session persistence)' };
    }

    tmuxSession = config.sessionName || `tide-${building.id.replace(/^building_/, '').slice(0, 16)}`;

    // Create or attach to tmux session
    try {
      // Check if session already exists
      execSync(`tmux has-session -t ${tmuxSession} 2>/dev/null`);
      log.log(`Attaching to existing tmux session: ${tmuxSession}`);
    } catch {
      // Create new session in detached mode
      const startDir = building.cwd || process.env.HOME || '/';
      execSync(`tmux new-session -d -s ${tmuxSession} -c "${startDir}"`);
      log.log(`Created new tmux session: ${tmuxSession}`);
    }

    // Configure tmux session: mouse support + subtle status bar
    try {
      const tmuxOpts = [
        `tmux set-option -t ${tmuxSession} mouse on`,
        // Allow OSC 52 clipboard (ttyd/xterm.js use this for copy)
        `tmux set-option -t ${tmuxSession} set-clipboard on`,
        // Copy selection to clipboard via OSC 52 escape sequence
        `tmux set-option -t ${tmuxSession} -s copy-command 'true'`,
        // Subtle dark status bar matching Commander's theme
        `tmux set-option -t ${tmuxSession} status-style 'bg=#1a1a2e,fg=#a9b1d6'`,
        `tmux set-option -t ${tmuxSession} status-left '#[fg=#6272a4]#{session_name} '`,
        `tmux set-option -t ${tmuxSession} status-right '#[fg=#6272a4]%H:%M'`,
        `tmux set-option -t ${tmuxSession} status-left-length 20`,
        `tmux set-option -t ${tmuxSession} window-status-current-style 'fg=#8be9fd'`,
        `tmux set-option -t ${tmuxSession} window-status-style 'fg=#6272a4'`,
        // Allow terminal override for clipboard passthrough
        `tmux set-option -t ${tmuxSession} -sa terminal-features ',xterm-256color:clipboard'`,
      ];
      execSync(tmuxOpts.join(' && '));
    } catch {
      log.warn(`Failed to configure tmux session ${tmuxSession}`);
    }

    // ttyd will attach to the tmux session
    ttydArgs.push('tmux', 'attach-session', '-t', tmuxSession);
  } else {
    // Direct shell
    ttydArgs.push(shell);
  }

  log.log(`Starting ttyd on port ${port}: ttyd ${ttydArgs.join(' ')}`);

  const proc = spawn('ttyd', ttydArgs, {
    stdio: 'ignore',
    detached: true,
  });

  // Don't let the parent process wait for this child
  proc.unref();

  if (!proc.pid) {
    return { success: false, error: 'Failed to spawn ttyd process' };
  }

  const instance: TerminalInstance = {
    pid: proc.pid,
    port,
    process: proc,
    tmuxSession,
  };

  instances.set(building.id, instance);

  // Handle unexpected exit
  proc.on('exit', (code) => {
    log.log(`ttyd process for ${building.name} exited with code ${code}`);
    instances.delete(building.id);
  });

  log.log(`Terminal started for ${building.name} (PID: ${proc.pid}, port: ${port})`);
  return { success: true };
}

/**
 * Stop a terminal (ttyd) for a building
 */
export async function stopTerminal(building: Building): Promise<{ success: boolean; error?: string }> {
  const instance = instances.get(building.id);
  if (!instance) {
    return { success: false, error: 'Terminal not running' };
  }

  try {
    // Kill the ttyd process
    process.kill(instance.pid, 'SIGTERM');
  } catch (err: any) {
    log.error(`Failed to kill ttyd PID ${instance.pid}: ${err.message}`);
  }

  instances.delete(building.id);

  // Note: tmux session is kept alive intentionally for persistence
  // It will be reattached on next start if saveSession is enabled

  log.log(`Terminal stopped for ${building.name}`);
  return { success: true };
}

/**
 * Restart a terminal
 */
export async function restartTerminal(building: Building): Promise<{ success: boolean; error?: string }> {
  await stopTerminal(building);
  // Small delay to let port free up
  await new Promise(resolve => setTimeout(resolve, 500));
  return startTerminal(building);
}

/**
 * Get terminal status for a building
 */
export function getTerminalStatus(building: Building): TerminalStatus | null {
  const instance = instances.get(building.id);
  if (!instance) return null;

  // Check if process is still alive
  try {
    process.kill(instance.pid, 0); // Signal 0 = just check
  } catch {
    // Process is dead
    instances.delete(building.id);
    return null;
  }

  return {
    pid: instance.pid,
    port: instance.port,
    url: `/api/terminal/${building.id}/`,
    tmuxSession: instance.tmuxSession,
  };
}

/**
 * Check if terminal is running for a building
 */
export function isTerminalRunning(buildingId: string): boolean {
  const instance = instances.get(buildingId);
  if (!instance) return false;

  try {
    process.kill(instance.pid, 0);
    return true;
  } catch {
    instances.delete(buildingId);
    return false;
  }
}

/**
 * Cleanup terminal - kill ttyd and optionally destroy tmux session
 */
export async function cleanupTerminal(building: Building, destroySession = false): Promise<void> {
  const instance = instances.get(building.id);
  if (instance) {
    try {
      process.kill(instance.pid, 'SIGTERM');
    } catch { /* already dead */ }

    if (destroySession && instance.tmuxSession) {
      try {
        execSync(`tmux kill-session -t ${instance.tmuxSession}`);
        log.log(`Destroyed tmux session: ${instance.tmuxSession}`);
      } catch { /* session may not exist */ }
    }

    instances.delete(building.id);
  }
}

/**
 * Cleanup all running terminals (called on server shutdown)
 */
export function cleanupAllTerminals(): void {
  for (const [buildingId, instance] of instances) {
    try {
      process.kill(instance.pid, 'SIGTERM');
      log.log(`Cleaned up terminal for building ${buildingId}`);
    } catch { /* already dead */ }
  }
  instances.clear();
}

/**
 * Poll terminal status - check if ttyd processes are still alive
 */
export function pollTerminalStatuses(): Map<string, TerminalStatus> {
  const statuses = new Map<string, TerminalStatus>();

  for (const [buildingId, instance] of instances) {
    try {
      process.kill(instance.pid, 0);
      statuses.set(buildingId, {
        pid: instance.pid,
        port: instance.port,
        url: `/api/terminal/${buildingId}/`,
        tmuxSession: instance.tmuxSession,
      });
    } catch {
      // Process died
      instances.delete(buildingId);
    }
  }

  return statuses;
}
