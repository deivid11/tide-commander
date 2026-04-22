/**
 * Backup Service
 *
 * In-process hourly backup scheduler. Runs inside the Commander node process
 * (no cron, no external deps). When Commander is down the data files can't
 * change, so there's no downside to coupling the backup lifecycle to the
 * server process.
 *
 * The actual backup work is done by scripts/backup-data.sh (shipped with the
 * package). This service calls it via child_process.execFile on a setInterval.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const log = createLogger('BackupService');

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const SETTINGS_FILE = path.join(DATA_DIR, 'backup-settings.json');

const BACKUP_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander-backups'
);

function findProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== '/' && dir !== '') {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();

export function getBackupScriptPath(): string {
  return path.join(PROJECT_ROOT, 'scripts', 'backup-data.sh');
}

// ── Persisted settings ───────────────────────────────────────────────────────

interface BackupSettings {
  enabled: boolean;
}

function readSettings(): BackupSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return { enabled: !!data.enabled };
    }
  } catch (err: any) {
    log.error(`Failed to read backup settings: ${err.message}`);
  }
  // Default: enabled — backups are on for everyone out of the box.
  return { enabled: true };
}

function writeSettings(settings: BackupSettings): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// ── In-process scheduler ─────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunAt: string | null = null;
let lastRunOk: boolean | null = null;
let lastRunError: string | null = null;

function runBackupScript(): void {
  const scriptPath = getBackupScriptPath();
  if (!fs.existsSync(scriptPath)) {
    log.error(`Backup script not found at ${scriptPath} — skipping`);
    lastRunAt = new Date().toISOString();
    lastRunOk = false;
    lastRunError = 'Script not found';
    return;
  }

  log.log('Starting hourly backup…');
  execFile('bash', [scriptPath], { timeout: 120_000 }, (err, stdout, stderr) => {
    lastRunAt = new Date().toISOString();
    if (err) {
      lastRunOk = false;
      lastRunError = stderr?.trim() || err.message;
      log.error(`Backup failed: ${lastRunError}`);
    } else {
      lastRunOk = true;
      lastRunError = null;
      const msg = stdout?.trim();
      if (msg) log.log(msg);
    }
  });
}

function startScheduler(): void {
  if (timer) return; // already running
  timer = setInterval(runBackupScript, INTERVAL_MS);
  timer.unref(); // don't hold the process open
  log.log('Backup scheduler started (every 1 h)');
  // Run immediately on first start so the first backup doesn't wait an hour.
  runBackupScript();
}

function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  log.log('Backup scheduler stopped');
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface BackupStatus {
  enabled: boolean;
  running: boolean;
  scriptPath: string;
  scriptExists: boolean;
  backupDir: string;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastRunError: string | null;
}

export function getBackupStatus(): BackupStatus {
  const settings = readSettings();
  return {
    enabled: settings.enabled,
    running: timer !== null,
    scriptPath: getBackupScriptPath(),
    scriptExists: fs.existsSync(getBackupScriptPath()),
    backupDir: BACKUP_DIR,
    lastRunAt,
    lastRunOk,
    lastRunError,
  };
}

export function setBackupEnabled(enabled: boolean): BackupStatus {
  writeSettings({ enabled });
  if (enabled) {
    startScheduler();
  } else {
    stopScheduler();
  }
  return getBackupStatus();
}

/**
 * Called once at server boot. Reads persisted setting and starts the
 * scheduler if backups are enabled.
 */
export function initBackupService(): void {
  const { enabled } = readSettings();
  if (enabled) {
    startScheduler();
  } else {
    log.log('Backups disabled — scheduler not started');
  }
}

/**
 * Called on graceful shutdown to clear the interval timer cleanly.
 */
export function shutdownBackupService(): void {
  stopScheduler();
}
