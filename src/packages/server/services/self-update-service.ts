/**
 * Self-Update Service
 *
 * Detects how Tide Commander was installed (global npm/pnpm/yarn/bun vs dev mode)
 * and runs `npm install -g tide-commander@latest` when invoked from the UI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SelfUpdate');

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

export interface InstallInfo {
  isGlobalInstall: boolean;
  packageManager: PackageManager;
  installRoot: string | null;
  currentVersion: string;
  /** Whether the install dir is writable by this process (else the update needs sudo). */
  writable: boolean;
  suggestedManualCommand: string | null;
  reason: string;
}

/**
 * Whether `dir` is writable by the current process — determines if
 * `npm install -g` could succeed without sudo.
 */
function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function readPackageJson(dir: string): { name?: string; version?: string } | null {
  try {
    const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectPackageManager(installRoot: string): { pm: PackageManager; suggested: string | null } {
  const lower = installRoot.toLowerCase();

  // Bun: ~/.bun/install/global/node_modules/tide-commander/
  if (lower.includes(`${path.sep}.bun${path.sep}install${path.sep}global${path.sep}`) || lower.includes(`${path.sep}.bun${path.sep}`)) {
    return { pm: 'bun', suggested: 'bun add -g tide-commander@latest' };
  }

  // Pnpm:
  //   ~/.local/share/pnpm/global/<N>/node_modules/tide-commander/
  //   ~/Library/pnpm/global/...
  //   ~/.pnpm/global/...
  if (lower.includes(`${path.sep}pnpm${path.sep}global${path.sep}`) || lower.includes(`${path.sep}.pnpm${path.sep}`)) {
    return { pm: 'pnpm', suggested: 'pnpm add -g tide-commander@latest' };
  }

  // Yarn:
  //   ~/.config/yarn/global/node_modules/tide-commander/
  //   ~/.yarn/global/...
  if (lower.includes(`${path.sep}yarn${path.sep}global${path.sep}`) || lower.includes(`${path.sep}.yarn${path.sep}`)) {
    return { pm: 'yarn', suggested: 'yarn global add tide-commander@latest' };
  }

  // npm — global prefix typically ends in /lib/node_modules/tide-commander
  // Works for system npm, nvm, asdf, volta, fnm, npm config prefix overrides.
  if (lower.includes(`${path.sep}lib${path.sep}node_modules${path.sep}`)) {
    return { pm: 'npm', suggested: 'npm install -g tide-commander@latest' };
  }

  // Some Windows / non-standard prefixes don't have /lib — fall back to npm
  return { pm: 'npm', suggested: 'npm install -g tide-commander@latest' };
}

/**
 * Locate the tide-commander package root on disk (the dir whose package.json
 * has name === "tide-commander"). Returns null if it can't be determined.
 */
export function locateInstallRoot(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));

    // Walk up looking for the nearest package.json named "tide-commander"
    let current = here;
    while (current !== path.dirname(current)) {
      const pkgPath = path.join(current, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = readPackageJson(current);
        if (pkg?.name === 'tide-commander') {
          return current;
        }
      }
      current = path.dirname(current);
    }
  } catch (err) {
    log.error(`Failed to locate install root: ${(err as Error).message}`);
  }
  return null;
}

/**
 * Returns true when the install root looks like a global npm-style install
 * (lives under a node_modules directory) AND is not the dev/repo checkout
 * (no .git/ at the package root).
 */
function isGlobalInstallPath(installRoot: string): { isGlobal: boolean; reason: string } {
  const parent = path.dirname(installRoot);
  const insideNodeModules = path.basename(parent) === 'node_modules';
  const hasGitDir = fs.existsSync(path.join(installRoot, '.git'));

  if (hasGitDir) {
    return { isGlobal: false, reason: 'Install root contains .git/ — running from a repo checkout (dev mode).' };
  }

  if (!insideNodeModules) {
    return { isGlobal: false, reason: 'Install root is not inside a node_modules directory — running from source.' };
  }

  return { isGlobal: true, reason: 'Install root lives under node_modules — looks like a global install.' };
}

/**
 * Build the full install info snapshot used by the UI.
 */
export function getInstallInfo(): InstallInfo {
  const installRoot = locateInstallRoot();

  if (!installRoot) {
    return {
      isGlobalInstall: false,
      packageManager: 'unknown',
      installRoot: null,
      currentVersion: 'unknown',
      writable: false,
      suggestedManualCommand: null,
      reason: 'Could not locate tide-commander package root on disk.',
    };
  }

  const pkg = readPackageJson(installRoot);
  const currentVersion = pkg?.version ?? 'unknown';

  const { isGlobal, reason } = isGlobalInstallPath(installRoot);
  if (!isGlobal) {
    return {
      isGlobalInstall: false,
      packageManager: 'unknown',
      installRoot,
      currentVersion,
      writable: false,
      suggestedManualCommand: null,
      reason,
    };
  }

  const { pm, suggested } = detectPackageManager(installRoot);
  // npm replaces the package dir inside node_modules — check that parent is writable.
  const writable = isWritable(path.dirname(installRoot));
  // A root-owned prefix can't be updated without sudo — surface that in the command.
  const needsSudo = pm === 'npm' && !writable;
  const suggestedManualCommand = needsSudo && suggested ? `sudo ${suggested}` : suggested;

  return {
    isGlobalInstall: true,
    packageManager: pm,
    installRoot,
    currentVersion,
    writable,
    suggestedManualCommand,
    reason,
  };
}

/**
 * Whether the current install can be auto-updated by this server.
 * Only npm-style globals whose install dir is writable (no sudo needed).
 */
export function isAutoUpdateSupported(info: InstallInfo = getInstallInfo()): boolean {
  return info.isGlobalInstall && info.packageManager === 'npm' && info.writable;
}

// ── Shared update lock ───────────────────────────────────────────────────────
// One npm self-update at a time, across ALL initiators (the manual SSE route
// and the auto-update scheduler). Module state is enough: both live in the
// same process.

let updateInProgress = false;

export function isUpdateInProgress(): boolean {
  return updateInProgress;
}

/** Acquire the update lock. Returns false if an update is already running. */
export function tryBeginUpdate(): boolean {
  if (updateInProgress) return false;
  updateInProgress = true;
  return true;
}

export function endUpdate(): void {
  updateInProgress = false;
}

export interface RunUpdateCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunUpdateResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  permissionDenied: boolean;
}

/**
 * Run `npm install -g tide-commander@latest`. Streams stdout/stderr via callbacks.
 * Never throws; always resolves with the captured output and exit code.
 */
export function runNpmGlobalUpdate(callbacks: RunUpdateCallbacks = {}): Promise<RunUpdateResult> {
  return new Promise((resolve) => {
    const args = ['install', '-g', 'tide-commander@latest'];

    // Disable npm fund/audit output noise to keep the log readable
    const env = {
      ...process.env,
      npm_config_fund: 'false',
      npm_config_audit: 'false',
      npm_config_progress: 'false',
    };

    log.log(`Running: npm ${args.join(' ')}`);
    const child = spawn('npm', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8');
      stdout += text;
      callbacks.onStdout?.(text);
    });

    child.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8');
      stderr += text;
      callbacks.onStderr?.(text);
    });

    child.on('error', (err) => {
      const message = `Failed to spawn npm: ${err.message}\n`;
      stderr += message;
      callbacks.onStderr?.(message);
      resolve({
        exitCode: -1,
        signal: null,
        stdout,
        stderr,
        permissionDenied: /eacces|eperm|permission/i.test(message),
      });
    });

    child.on('close', (code, signal) => {
      const combined = `${stdout}\n${stderr}`;
      const permissionDenied = /EACCES|EPERM|permission denied/i.test(combined);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        permissionDenied,
      });
    });
  });
}

export interface GitPullResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run `git pull --ff-only` in the dev checkout. --ff-only keeps the failure
 * mode clean: on diverged history or overlapping local changes git aborts
 * WITHOUT touching the working tree (no conflict markers left behind), so the
 * caller can simply report the message. Never throws; always resolves with the
 * captured output and exit code.
 */
export function runGitPull(cwd: string, timeoutMs = 180_000): Promise<GitPullResult> {
  return new Promise((resolve) => {
    log.log(`Running: git pull --ff-only (in ${cwd})`);
    const child = spawn('git', ['pull', '--ff-only'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };

    child.stdout?.on('data', (buf: Buffer) => {
      stdout += buf.toString('utf8');
    });
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString('utf8');
    });
    child.on('error', (err) => {
      stderr += `Failed to spawn git: ${err.message}\n`;
      finish(-1);
    });
    child.on('close', (code) => finish(code));
  });
}

/**
 * Detect a process supervisor that already restarts us on exit.
 *
 * Under PM2 (the common `tide-commander --foreground` deployment) spawning our
 * own detached relauncher is actively harmful: PM2 ALSO restarts the process the
 * moment the old server exits, so the relauncher's new server and PM2's fresh
 * server race for the same port. The loser dies with EADDRINUSE and — in
 * containers whose PID 1 doesn't reap — lingers as a zombie that then trips the
 * launcher's port guard on the next boot (the multi-day crash loop).
 *
 * PM2 injects pm_id / PM2_HOME into every managed process, and the launcher
 * passes its env straight to the server child, so these are visible here. An
 * explicit TIDE_COMMANDER_SUPERVISED=1 lets other auto-restarting supervisors
 * (systemd Restart=, docker restart-policy) opt into the same behaviour.
 *
 * NOTE: we deliberately do NOT key on TIDE_COMMANDER_FOREGROUND — foreground is
 * not the same as supervised. A bare `--foreground` attached in a terminal has
 * nothing to restart it, so there the detached relauncher must stay.
 */
function isSupervisedRestart(): boolean {
  return (
    process.env.pm_id !== undefined ||
    Boolean(process.env.PM2_HOME) ||
    process.env.TIDE_COMMANDER_SUPERVISED === '1'
  );
}

/**
 * After a successful global update, bring up the freshly installed binary
 * without the user having to relaunch by hand.
 *
 * When supervised (PM2/systemd/docker — see isSupervisedRestart), we simply exit:
 * the supervisor restarts the process into the already-on-disk new code, and
 * spawning our own relauncher would only race it for the port.
 *
 * Otherwise (standalone install) spawns a fully detached
 * `tide-commander start --restart` that inherits the current server's
 * environment (same PORT/HOST/AUTH_TOKEN/HTTPS). That process SIGTERMs the
 * still-running old server (triggering its graceful shutdown so the port is
 * released), waits for it to exit, then starts the new server and rewrites the
 * PID file. The caller MUST NOT exit — the relauncher (or, when supervised, our
 * own scheduled exit) drives the handoff.
 *
 * Returns true if a restart was scheduled (relauncher spawned, or supervised
 * exit queued), false if it could not be (in which case the caller should fall
 * back to exiting for a manual restart).
 */
export function schedulePostUpdateRestart(delayMs = 600): boolean {
  // Supervised deployment: don't spawn a competing relauncher. Exit after the
  // same flush grace so any in-flight SSE 'done' frame reaches the client, then
  // let the process manager restart us into the freshly-installed build.
  if (isSupervisedRestart()) {
    log.log('Supervised restart (PM2/systemd/docker) detected — exiting for the process manager to restart into the updated build.');
    const timer = setTimeout(() => {
      log.log('Exiting now; the process manager will restart Tide Commander.');
      process.exit(0);
    }, delayMs);
    timer.unref?.();
    return true;
  }

  let cliPath: string;
  try {
    // self-update-service.js lives at dist/.../server/services/, the CLI entry
    // at dist/.../server/cli.js — one level up.
    cliPath = fileURLToPath(new URL('../cli.js', import.meta.url));
  } catch (err) {
    log.error(`Cannot resolve CLI path for auto-restart: ${(err as Error).message}`);
    return false;
  }

  if (!fs.existsSync(cliPath)) {
    log.error(`CLI entrypoint not found for auto-restart: ${cliPath}`);
    return false;
  }

  // Small delay so the SSE 'done' frame flushes to the client before the
  // relauncher SIGTERMs us.
  const timer = setTimeout(() => {
    try {
      // --replace-pid pins the relauncher to THIS process: the PID file can be
      // stale (clobbered by failed duplicate starts), and killing/waiting on
      // the wrong PID makes the relauncher race the still-dying old server.
      const child = spawn(process.execPath, [cliPath, 'start', '--restart', '--replace-pid', String(process.pid)], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
        cwd: process.cwd(),
      });
      child.on('error', (err) => {
        log.error(`Auto-restart relauncher failed to spawn: ${err.message}`);
      });
      child.unref();
      log.log(`Spawned detached relauncher: tide-commander start --restart --replace-pid ${process.pid}`);
    } catch (err) {
      log.error(`Failed to spawn auto-restart relauncher: ${(err as Error).message}`);
    }
  }, delayMs);
  timer.unref?.();

  return true;
}
