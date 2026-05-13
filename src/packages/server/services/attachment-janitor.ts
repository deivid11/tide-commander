/**
 * Attachment Janitor
 *
 * Sweeps the trigger-attachment root (`/tmp/tide-commander-uploads/triggers/`)
 * and deletes files whose mtime is older than the TTL. Runs once on boot, then
 * every hour. Empty `<source>/<messageId>/` directories are removed after
 * their files are gone. NEVER touches anything outside the triggers/ subtree —
 * user-uploaded files at the top of `/tmp/tide-commander-uploads/` are left
 * alone.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';
import { TRIGGER_ATTACHMENT_ROOT } from './attachment-downloader.js';

const log = createLogger('AttachmentJanitor');

/** Files older than this are unlinked. */
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Sweep cadence after the initial boot pass. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let sweepTimer: NodeJS.Timeout | null = null;

interface SweepStats {
  files: number;
  dirs: number;
  freedBytes: number;
}

async function sweepFile(filePath: string, stats: SweepStats): Promise<void> {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch {
    return;
  }
  if (!st.isFile()) return;
  if (Date.now() - st.mtimeMs < TTL_MS) return;
  try {
    await fs.unlink(filePath);
    stats.files += 1;
    stats.freedBytes += st.size;
  } catch (err) {
    log.warn(`failed to unlink ${filePath}: ${err}`);
  }
}

async function sweepDir(dirPath: string, stats: SweepStats, depth: number): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    // Missing dir is fine — first boot before any download.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') log.warn(`readdir failed for ${dirPath}: ${err}`);
    return;
  }

  for (const entry of entries) {
    const child = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await sweepDir(child, stats, depth + 1);
    } else if (entry.isFile()) {
      await sweepFile(child, stats);
    }
  }

  // Try to clean up empty intermediate dirs (source/, messageId/).
  // NEVER remove the root itself (depth === 0). The downloader re-creates
  // <source>/<messageId>/ on each call so removing them is safe.
  if (depth === 0) return;
  try {
    const remaining = await fs.readdir(dirPath);
    if (remaining.length === 0) {
      await fs.rmdir(dirPath);
      stats.dirs += 1;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOTEMPTY' && code !== 'ENOENT') {
      log.warn(`rmdir failed for ${dirPath}: ${err}`);
    }
  }
}

/** Run one sweep pass over the trigger-attachment root. */
export async function sweepOnce(): Promise<SweepStats> {
  const stats: SweepStats = { files: 0, dirs: 0, freedBytes: 0 };
  await sweepDir(TRIGGER_ATTACHMENT_ROOT, stats, 0);
  const freedMb = stats.freedBytes / (1024 * 1024);
  log.log(`[attachment-janitor] swept ${stats.files} files, ${stats.dirs} dirs, freed ${freedMb.toFixed(2)} MB`);
  return stats;
}

/** Initialize the janitor: run once now, then every hour. */
export function initAttachmentJanitor(): void {
  if (sweepTimer) return; // idempotent
  // Fire-and-forget the initial sweep — never block startup on it.
  void sweepOnce().catch((err) => log.warn(`initial sweep failed: ${err}`));
  sweepTimer = setInterval(() => {
    void sweepOnce().catch((err) => log.warn(`scheduled sweep failed: ${err}`));
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive for the janitor — let the process exit
  // cleanly when the rest of the server shuts down.
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

/** Stop the janitor (test/teardown helper). */
export function shutdownAttachmentJanitor(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
