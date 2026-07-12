/**
 * Auto-rebuild of the served client bundle for OTA UI sync.
 *
 * The OTA endpoints (routes/system.ts) serve `installRoot/dist`. That dist is
 * only refreshed by a full `npm run build` (release pipeline) — so editing UI
 * source without rebuilding leaves phones pulling the same stale bundle and
 * reporting "up to date".
 *
 * This module closes that gap for DEV checkouts: when the OTA check runs and
 * the client source is newer than the served dist, it kicks off a single-flight
 * `npm run build` in the background. The phone keeps getting the current bundle
 * until the build lands, then picks up the fresh hash on its next check.
 *
 * Guardrails:
 *  - Dev only (`.git` present). A global npm install has no source/build tools,
 *    and must never have its server spawn a build.
 *  - Single-flight: at most one build runs at a time.
 *  - `lastAttemptSourceMtime` gate: a given source snapshot is built at most
 *    once, so a WIP type error (which aborts `build:types` and leaves dist
 *    untouched) doesn't retrigger a failing build on every poll — the next
 *    edit (newer mtime) is what re-arms it.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';
import { getInstallInfo } from './self-update-service.js';

const log = createLogger('WebBundleBuilder');

// Source roots whose changes should retrigger a CLIENT rebuild. Server-only
// dirs are deliberately excluded so a pure server edit doesn't spawn a build.
const SOURCE_ROOTS = ['src/packages/client', 'src/packages/shared', 'public'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const NEWEST_CACHE_MS = 15_000;

let buildInFlight: Promise<void> | null = null;
let lastAttemptSourceMtime = 0;
let cachedNewest: { at: number; value: number } = { at: 0, value: 0 };

/** A dev checkout (has a .git dir) — the only place we auto-build. */
export function isDevInstall(installRoot: string | null): boolean {
  return !!installRoot && fs.existsSync(path.join(installRoot, '.git'));
}

function newestMtimeUnder(root: string): number {
  let newest = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // dir vanished mid-walk — ignore
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* file removed between readdir and stat — skip */
        }
      }
    }
  };
  walk(root);
  return newest;
}

function computeNewestSourceMtime(installRoot: string): number {
  const now = Date.now();
  if (now - cachedNewest.at < NEWEST_CACHE_MS) return cachedNewest.value;
  let newest = 0;
  for (const rel of SOURCE_ROOTS) {
    const abs = path.join(installRoot, rel);
    if (fs.existsSync(abs)) newest = Math.max(newest, newestMtimeUnder(abs));
  }
  cachedNewest = { at: now, value: newest };
  return newest;
}

function distBuildTime(installRoot: string): number {
  try {
    return fs.statSync(path.join(installRoot, 'dist', 'index.html')).mtimeMs;
  } catch {
    return 0; // no dist yet
  }
}

function runBuild(installRoot: string): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    log.log('Client source newer than served bundle — rebuilding (npm run build)...');
    let stderrTail = '';
    const child = spawn('npm', ['run', 'build'], {
      cwd: installRoot,
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    child.on('error', (err) => {
      log.error(`Web bundle rebuild failed to start: ${err.message}`);
      resolve();
    });
    child.on('exit', (code) => {
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      if (code === 0) {
        log.log(`Web bundle rebuild complete in ${secs}s — phones will pull on next check`);
      } else {
        log.error(
          `Web bundle rebuild exited with code ${code} after ${secs}s. Old bundle stays served. ` +
            `Tail:\n${stderrTail.trim()}`,
        );
      }
      resolve();
    });
  });
}

/**
 * If the client source is newer than the served dist, start a single-flight
 * background rebuild (dev checkouts only). Returns immediately — never blocks
 * the OTA check that calls it.
 */
export function maybeTriggerWebBundleRebuild(): void {
  const installRoot = getInstallInfo().installRoot;
  if (!isDevInstall(installRoot) || !installRoot) return;
  if (buildInFlight) return;

  const newest = computeNewestSourceMtime(installRoot);
  const distTime = distBuildTime(installRoot);
  // Build only when source moved past BOTH the served dist and the last snapshot
  // we already tried (the latter stops a failing build from looping every poll).
  if (!(newest > distTime && newest > lastAttemptSourceMtime)) return;

  lastAttemptSourceMtime = newest;
  buildInFlight = runBuild(installRoot).finally(() => {
    buildInFlight = null;
    cachedNewest = { at: 0, value: 0 }; // force a fresh walk on the next check
  });
}
