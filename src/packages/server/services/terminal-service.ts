/**
 * Terminal Service
 * Manages ttyd processes for terminal buildings.
 * Supports optional tmux session persistence.
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createServer } from 'net';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Building, TerminalStatus } from '../../shared/types.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('TerminalService');

interface TerminalInstance {
  pid: number;
  port: number;
  process: ChildProcess;
  tmuxSession?: string;
}

// Callback invoked when a ttyd process exits (buildingId, exitCode)
type TerminalExitCallback = (buildingId: string, code: number | null) => void;
let onExitCallback: TerminalExitCallback | null = null;

/**
 * Register a callback to be notified when any ttyd process exits.
 * Used by building-service to immediately broadcast status changes.
 */
export function onTerminalExit(cb: TerminalExitCallback): void {
  onExitCallback = cb;
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
 * Check if a tmux session is still alive.
 * Returns true if session exists, false if it has been destroyed.
 */
function isTmuxSessionAlive(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a ttyd instance whose backing session (tmux) has died.
 * ttyd stays alive after its child exits and keeps accepting reconnections
 * that immediately fail, causing an infinite error loop on the client.
 */
function killOrphanedTtyd(buildingId: string, instance: TerminalInstance): void {
  log.log(`Killing orphaned ttyd for ${buildingId} (tmux session "${instance.tmuxSession}" is gone)`);
  try {
    process.kill(instance.pid, 'SIGTERM');
  } catch { /* already dead */ }
  instances.delete(buildingId);
  if (onExitCallback) {
    onExitCallback(buildingId, null);
  }
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
        // Auto-copy selection to clipboard on mouse drag end (both emacs and vi copy modes)
        `tmux bind-key -T copy-mode MouseDragEnd1Pane send-keys -X copy-selection-and-cancel`,
        `tmux bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-selection-and-cancel`,
      ];
      execSync(tmuxOpts.join(' && '));

      // Bind right-click context menu via tmux config file (complex display-menu syntax
      // cannot be reliably escaped in JS strings)
      const tmuxConfPath = join(tmpdir(), `tide-tmux-${tmuxSession}.conf`);
      writeFileSync(tmuxConfPath, [
        '# Right-click context menu (mirrors default M-MouseDown3Pane)',
        'bind-key -T root MouseDown3Pane display-menu -T "#[align=centre]#{pane_index} (#{pane_id})" -t = -x M -y M \\',
        '  "#{?#{m/r:(copy|view)-mode,#{pane_mode}},Go To Top,}" "<" {send-keys -X history-top} \\',
        '  "#{?#{m/r:(copy|view)-mode,#{pane_mode}},Go To Bottom,}" ">" {send-keys -X history-bottom} \\',
        '  "" \\',
        '  "#{?mouse_word,Search For #[underscore]#{=/9/...:mouse_word},}" C-r {if-shell -F "#{?#{m/r:(copy|view)-mode,#{pane_mode}},0,1}" "copy-mode -t=" ; send-keys -X -t = search-backward "#{q:mouse_word}"} \\',
        '  "#{?mouse_word,Type #[underscore]#{=/9/...:mouse_word},}" C-y {copy-mode -q ; send-keys -l "#{q:mouse_word}"} \\',
        '  "#{?mouse_word,Copy #[underscore]#{=/9/...:mouse_word},}" c {copy-mode -q ; set-buffer "#{q:mouse_word}"} \\',
        '  "#{?mouse_line,Copy Line,}" l {copy-mode -q ; set-buffer "#{q:mouse_line}"} \\',
        '  "" \\',
        '  "Horizontal Split" h {split-window -h} \\',
        '  "Vertical Split" v {split-window -v} \\',
        '  "" \\',
        '  "#{?#{>:#{window_panes},1},,-}Swap Up" u {swap-pane -U} \\',
        '  "#{?#{>:#{window_panes},1},,-}Swap Down" d {swap-pane -D} \\',
        '  "#{?pane_marked_set,,-}Swap Marked" s {swap-pane} \\',
        '  "" \\',
        '  Kill X {kill-pane} \\',
        '  Respawn R {respawn-pane -k} \\',
        '  "#{?pane_marked,Unmark,Mark}" m {select-pane -m} \\',
        '  "#{?#{>:#{window_panes},1},,-}#{?window_zoomed_flag,Unzoom,Zoom}" z {resize-pane -Z}',
      ].join('\n'));
      execSync(`tmux source-file ${tmuxConfPath}`);
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

  // Handle process exit - clean up and notify listeners immediately
  proc.on('exit', (code) => {
    log.log(`ttyd process for ${building.name} exited with code ${code}`);
    instances.delete(building.id);
    if (onExitCallback) {
      onExitCallback(building.id, code);
    }
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
 * Get terminal status for a building.
 * Returns null (and cleans up) if ttyd is dead or its tmux session is gone.
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

  // Check tmux session health (same orphan detection as isTerminalRunning)
  if (instance.tmuxSession && !isTmuxSessionAlive(instance.tmuxSession)) {
    killOrphanedTtyd(building.id, instance);
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
 * Check if terminal is running for a building.
 * For tmux-backed terminals, also verifies the tmux session is alive.
 * If ttyd is running but the tmux session is dead, kills the orphaned ttyd.
 */
export function isTerminalRunning(buildingId: string): boolean {
  const instance = instances.get(buildingId);
  if (!instance) return false;

  try {
    process.kill(instance.pid, 0);
  } catch {
    instances.delete(buildingId);
    return false;
  }

  // ttyd is alive — but if it's backed by tmux, check that the session still exists.
  // When the user types 'exit', the tmux session is destroyed but ttyd stays alive,
  // accepting reconnections that immediately fail (infinite error loop).
  if (instance.tmuxSession && !isTmuxSessionAlive(instance.tmuxSession)) {
    killOrphanedTtyd(buildingId, instance);
    return false;
  }

  return true;
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
 * and that their backing tmux sessions (if any) still exist.
 */
export function pollTerminalStatuses(): Map<string, TerminalStatus> {
  const statuses = new Map<string, TerminalStatus>();

  for (const [buildingId, instance] of instances) {
    try {
      process.kill(instance.pid, 0);
    } catch {
      // Process died
      instances.delete(buildingId);
      continue;
    }

    // Check tmux session health
    if (instance.tmuxSession && !isTmuxSessionAlive(instance.tmuxSession)) {
      killOrphanedTtyd(buildingId, instance);
      continue;
    }

    statuses.set(buildingId, {
      pid: instance.pid,
      port: instance.port,
      url: `/api/terminal/${buildingId}/`,
      tmuxSession: instance.tmuxSession,
    });
  }

  return statuses;
}
