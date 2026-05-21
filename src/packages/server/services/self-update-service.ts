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
  suggestedManualCommand: string | null;
  reason: string;
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
      suggestedManualCommand: null,
      reason,
    };
  }

  const { pm, suggested } = detectPackageManager(installRoot);
  return {
    isGlobalInstall: true,
    packageManager: pm,
    installRoot,
    currentVersion,
    suggestedManualCommand: suggested,
    reason,
  };
}

/**
 * Whether the current install can be auto-updated by this server.
 * Right now only npm-style globals are supported.
 */
export function isAutoUpdateSupported(info: InstallInfo = getInstallInfo()): boolean {
  return info.isGlobalInstall && info.packageManager === 'npm';
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
