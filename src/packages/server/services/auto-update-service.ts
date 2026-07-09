/**
 * Auto-Update Service
 *
 * Opt-in (disabled by default) unattended updates: periodically checks npm for
 * a newer tide-commander version and, when one exists AND no agent is busy,
 * runs the same install + auto-restart flow the manual Settings update uses.
 *
 * Safety rules:
 *   - Only runs for auto-updatable installs (npm global, writable — the same
 *     check the manual flow uses).
 *   - Never installs while an agent is working; re-checks idleness again after
 *     the install and DEFERS the restart if an agent started working meanwhile
 *     (the new version sits on disk until the fleet goes idle).
 *   - Shares the update lock with the manual SSE route — never two installs.
 *   - Gives up on a version after repeated install failures instead of
 *     retrying it forever.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchLatestNpmVersion, getVersionRelation } from '../../shared/version.js';
import { createLogger } from '../utils/logger.js';
import { getAllAgents } from './agent-service.js';
import {
  endUpdate,
  getInstallInfo,
  isAutoUpdateSupported,
  isUpdateInProgress,
  runNpmGlobalUpdate,
  schedulePostUpdateRestart,
  tryBeginUpdate,
} from './self-update-service.js';

const log = createLogger('AutoUpdate');

const PACKAGE_NAME = 'tide-commander';
const CHECK_INTERVAL_MS = 30 * 60 * 1000;   // check npm every 30 min
const FIRST_CHECK_DELAY_MS = 5 * 60 * 1000; // let the server settle after boot
const ENABLE_CHECK_DELAY_MS = 60 * 1000;    // first check shortly after opting in
const PENDING_RESTART_RETRY_MS = 60 * 1000; // installed-but-busy: re-try restart every minute
const MAX_FAILURES_PER_VERSION = 3;

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);
const SETTINGS_FILE = path.join(DATA_DIR, 'auto-update-setting.json');

// ── Persisted setting ────────────────────────────────────────────────────────

interface AutoUpdateSettings {
  enabled: boolean;
}

function readSettings(): AutoUpdateSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return { enabled: !!data.enabled };
    }
  } catch (err: any) {
    log.error(`Failed to read auto-update settings: ${err.message}`);
  }
  // Default: DISABLED — unattended restarts are opt-in.
  return { enabled: false };
}

function writeSettings(settings: AutoUpdateSettings): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// ── Scheduler state ──────────────────────────────────────────────────────────

let intervalTimer: ReturnType<typeof setInterval> | null = null;
let delayTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;

let lastCheckAt: string | null = null;
let lastResult: string | null = null;
let lastError: string | null = null;
// Version already installed on disk, waiting for an idle window to restart.
let pendingRestartVersion: string | null = null;
const failuresByVersion = new Map<string, number>();

function note(result: string): void {
  lastResult = result;
  log.log(result);
}

/** Agents mid-turn (or blocked on a permission prompt) — a restart would interrupt them. */
function countBusyAgents(): number {
  try {
    return getAllAgents().filter(
      (agent) => agent.status === 'working' || agent.status === 'waiting_permission'
    ).length;
  } catch (err) {
    log.warn(`Failed to read agent statuses: ${err}`);
    return 1; // fail safe: assume busy rather than restart under someone's feet
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void tick();
  }, PENDING_RESTART_RETRY_MS);
  retryTimer.unref?.();
}

async function tick(): Promise<void> {
  if (!readSettings().enabled) return;
  if (ticking) return;
  ticking = true;
  try {
    if (isUpdateInProgress()) {
      note('Auto-update check skipped: another update is in progress');
      return;
    }

    // Phase 2 of a previous tick: new version already on disk, restart was
    // deferred because agents were busy. Restart as soon as the fleet is idle.
    if (pendingRestartVersion) {
      const busy = countBusyAgents();
      if (busy > 0) {
        note(`v${pendingRestartVersion} installed — waiting for ${busy} busy agent(s) before restarting`);
        scheduleRetry();
        return;
      }
      const version = pendingRestartVersion;
      pendingRestartVersion = null;
      if (schedulePostUpdateRestart()) {
        note(`Restarting into v${version} (agents idle)`);
      } else {
        pendingRestartVersion = version;
        note(`v${version} installed but auto-restart is unavailable — restart manually`);
      }
      return;
    }

    const info = getInstallInfo();
    if (!isAutoUpdateSupported(info)) {
      note(`Auto-update not supported for this install (${info.reason})`);
      return;
    }

    const latest = await fetchLatestNpmVersion(PACKAGE_NAME);
    lastCheckAt = new Date().toISOString();
    if (!latest || getVersionRelation(info.currentVersion, latest) !== 'behind') {
      note(`Up to date (v${info.currentVersion})`);
      return;
    }

    if ((failuresByVersion.get(latest) ?? 0) >= MAX_FAILURES_PER_VERSION) {
      note(`Skipping v${latest}: ${MAX_FAILURES_PER_VERSION} failed install attempts — update manually`);
      return;
    }

    const busy = countBusyAgents();
    if (busy > 0) {
      note(`v${latest} available — deferred, ${busy} agent(s) working`);
      return;
    }

    if (!tryBeginUpdate()) {
      note('Auto-update skipped: update lock is held');
      return;
    }

    try {
      log.log(`Auto-updating ${info.currentVersion} → ${latest}…`);
      const result = await runNpmGlobalUpdate();
      if (result.exitCode !== 0) {
        failuresByVersion.set(latest, (failuresByVersion.get(latest) ?? 0) + 1);
        lastError = `npm install exited with code ${result.exitCode}${result.permissionDenied ? ' (permission denied)' : ''}`;
        note(`Auto-update to v${latest} failed: ${lastError}`);
        endUpdate();
        return;
      }

      lastError = null;

      // The install can take a while — an agent may have started working.
      // The restart is the disruptive part; defer it until idle again.
      if (countBusyAgents() > 0) {
        pendingRestartVersion = latest;
        endUpdate();
        note(`v${latest} installed — restart deferred until agents are idle`);
        scheduleRetry();
        return;
      }

      if (schedulePostUpdateRestart()) {
        note(`Updated to v${latest} — restarting now (agents idle)`);
        // Keep the lock held while the relauncher takes over (mirrors the
        // manual flow); release it if the takeover never happens.
        setTimeout(() => endUpdate(), 30_000).unref?.();
      } else {
        pendingRestartVersion = latest;
        endUpdate();
        note(`Updated to v${latest} but auto-restart is unavailable — restart manually`);
      }
    } catch (err) {
      lastError = (err as Error).message;
      note(`Auto-update failed: ${lastError}`);
      endUpdate();
    }
  } catch (err) {
    lastError = (err as Error).message;
    note(`Auto-update check failed: ${lastError}`);
  } finally {
    ticking = false;
  }
}

function startScheduler(firstDelayMs: number): void {
  if (intervalTimer) return; // already running
  delayTimer = setTimeout(() => {
    delayTimer = null;
    void tick();
  }, firstDelayMs);
  delayTimer.unref?.();
  intervalTimer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  intervalTimer.unref?.();
  log.log(`Auto-update scheduler started (first check in ${Math.round(firstDelayMs / 1000)}s, then every ${CHECK_INTERVAL_MS / 60000} min)`);
}

function stopScheduler(): void {
  if (!intervalTimer && !delayTimer && !retryTimer) return;
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
  if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  log.log('Auto-update scheduler stopped');
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface AutoUpdateStatus {
  enabled: boolean;
  supported: boolean;
  checkIntervalMinutes: number;
  lastCheckAt: string | null;
  lastResult: string | null;
  lastError: string | null;
  pendingRestartVersion: string | null;
  busyAgents: number;
  updateInProgress: boolean;
}

export function getAutoUpdateStatus(): AutoUpdateStatus {
  return {
    enabled: readSettings().enabled,
    supported: isAutoUpdateSupported(),
    checkIntervalMinutes: CHECK_INTERVAL_MS / 60000,
    lastCheckAt,
    lastResult,
    lastError,
    pendingRestartVersion,
    busyAgents: countBusyAgents(),
    updateInProgress: isUpdateInProgress(),
  };
}

export function setAutoUpdateEnabled(enabled: boolean): AutoUpdateStatus {
  writeSettings({ enabled });
  if (enabled) {
    startScheduler(ENABLE_CHECK_DELAY_MS);
  } else {
    stopScheduler();
  }
  return getAutoUpdateStatus();
}

/** Called once at server boot: start the scheduler if the user opted in. */
export function initAutoUpdateService(): void {
  if (readSettings().enabled) {
    startScheduler(FIRST_CHECK_DELAY_MS);
  } else {
    log.log('Auto-update disabled (default) — scheduler not started');
  }
}

/** Called on graceful shutdown to clear timers cleanly. */
export function shutdownAutoUpdateService(): void {
  stopScheduler();
}

/** Test-only: reset in-memory scheduler state (not the persisted setting). */
export function __resetAutoUpdateStateForTests(): void {
  stopScheduler();
  ticking = false;
  lastCheckAt = null;
  lastResult = null;
  lastError = null;
  pendingRestartVersion = null;
  failuresByVersion.clear();
}
