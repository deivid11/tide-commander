/**
 * Git Watch Service — server-side git status polling pushed over WebSocket.
 *
 * Replaces per-client HTTP polling of GET /api/files/git-status and
 * /api/files/git-branch. Each client declares the directories it cares about
 * via the `git_watch` message; this service polls the UNION of all watched
 * directories once (shared across every connected client), and pushes a
 * `git_status_update` only when a directory's status actually changed.
 *
 * Net effect vs polling: one async git run per directory per cycle regardless
 * of client count, zero network traffic while nothing changes, and no
 * event-loop blocking (the HTTP routes use execSync; this service uses
 * execFile). Polling stops entirely when no client watches anything —
 * e.g. when the mobile app parks its socket in the background.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import type { WebSocket } from 'ws';
import type { GitWatchedDirStatus, GitWatchedFile } from '../../shared/types.js';
import { logger } from '../utils/index.js';

const execFileAsync = promisify(execFile);
const log = logger.files;

const POLL_INTERVAL_MS = 10_000;
const GIT_TIMEOUT_MS = 8_000;
// Safety cap per socket — far above any real area/building configuration.
const MAX_WATCHED_PATHS = 200;
// Cap on file entries per directory in the pushed payload. A working dir with
// a big untracked tree (generated output, caches) reports tens of thousands of
// entries — one real repo here yields ~65k, an 8.1 MB `git_status_update`
// frame. That blocked the event loop on JSON.stringify and froze every client
// that parsed and rendered it. The count is still reported in full via
// `totalFiles`; only the per-file list is capped.
const MAX_STATUS_FILES = 2_000;

interface CacheEntry {
  fingerprint: string;
  payload: GitWatchedDirStatus;
}

const subscriptions = new Map<WebSocket, Set<string>>();
const cache = new Map<string, CacheEntry>();
// Last over-cap file count warned per dir, so the 10 s poll doesn't repeat the
// same "has N changed files" warning forever (it used to log ~12 lines/min per
// big repo); re-warn only when the count changes.
const overCapWarned = new Map<string, number>();
let pollTimer: NodeJS.Timeout | null = null;
let pollInFlight = false;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf-8',
  });
  return stdout;
}

function toPosixSeparators(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Parse `git status --porcelain -uall` output into absolute-path file entries.
 *
 * Only the first MAX_STATUS_FILES entries are materialized — the rest are
 * counted and dropped, so a 65k-file working tree costs a line scan instead of
 * 65k objects that then have to be serialized and shipped to every client.
 */
function parsePorcelain(
  gitRoot: string,
  output: string
): { files: GitWatchedFile[]; totalFiles: number } {
  const files: GitWatchedFile[] = [];
  let totalFiles = 0;
  const lines = output.replace(/\n$/, '').split('\n').filter(Boolean);

  for (const line of lines) {
    // Porcelain v1: "XY PATH" or "XY ORIG -> NEW" for renames. Paths are
    // relative to the git root.
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filePart = line.substring(3);

    let filePath: string;
    let oldPath: string | undefined;
    if (filePart.includes(' -> ')) {
      const [old, newPath] = filePart.split(' -> ');
      filePath = toPosixSeparators(path.join(gitRoot, newPath));
      oldPath = toPosixSeparators(path.join(gitRoot, old));
    } else {
      filePath = toPosixSeparators(path.join(gitRoot, filePart));
    }

    let status: GitWatchedFile['status'];
    if (
      (indexStatus === 'U' || workTreeStatus === 'U') ||
      (indexStatus === 'D' && workTreeStatus === 'D') ||
      (indexStatus === 'A' && workTreeStatus === 'A')
    ) {
      status = 'conflict';
    } else if (indexStatus === 'A' && workTreeStatus === 'D') {
      // Orphaned staged-add (file deleted from disk) — the git-status HTTP
      // route auto-unstages these; the read-only watcher just skips them.
      continue;
    } else if (indexStatus === '?' || workTreeStatus === '?') {
      status = 'untracked';
    } else if (indexStatus === 'A' || workTreeStatus === 'A') {
      status = 'added';
    } else if (indexStatus === 'D' || workTreeStatus === 'D') {
      status = 'deleted';
    } else if (indexStatus === 'R' || workTreeStatus === 'R') {
      status = 'renamed';
    } else {
      status = 'modified';
    }

    totalFiles++;
    if (files.length < MAX_STATUS_FILES) {
      files.push({ path: filePath, name: path.basename(filePath), status, oldPath });
    }
  }

  return { files, totalFiles };
}

/**
 * Change fingerprint for a directory. Hashes the raw porcelain output rather
 * than the payload: the payload's file list is capped, so stringifying it would
 * miss changes past the cap — and stringifying the UNcapped list is exactly the
 * multi-MB event-loop stall the cap exists to avoid.
 */
function statusFingerprint(parts: {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  mergeInProgress: boolean;
  totalFiles: number;
  rawStatus: string;
}): string {
  // djb2 over the porcelain text — one linear pass, no allocation.
  let hash = 5381;
  for (let i = 0; i < parts.rawStatus.length; i++) {
    hash = ((hash << 5) + hash + parts.rawStatus.charCodeAt(i)) | 0;
  }
  return [
    parts.isGitRepo ? '1' : '0',
    parts.branch ?? '',
    parts.ahead,
    parts.behind,
    parts.mergeInProgress ? '1' : '0',
    parts.totalFiles,
    (hash >>> 0).toString(36),
  ].join('|');
}

async function computeStatus(
  dirPath: string
): Promise<{ payload: GitWatchedDirStatus; fingerprint: string }> {
  const empty: GitWatchedDirStatus = {
    path: dirPath,
    isGitRepo: false,
    branch: null,
    ahead: 0,
    behind: 0,
    mergeInProgress: false,
    files: [],
    totalFiles: 0,
    truncated: false,
  };
  const emptyResult = { payload: empty, fingerprint: 'none' };

  if (!path.isAbsolute(dirPath) || !fs.existsSync(dirPath)) return emptyResult;

  let gitRoot: string;
  try {
    gitRoot = (await git(['rev-parse', '--show-toplevel'], dirPath)).trim();
  } catch {
    return emptyResult;
  }

  let files: GitWatchedFile[] = [];
  let totalFiles = 0;
  let rawStatus = '';
  try {
    rawStatus = await git(['status', '--porcelain', '-uall'], dirPath);
    ({ files, totalFiles } = parsePorcelain(gitRoot, rawStatus));
  } catch (err) {
    log.error(`[GitWatch] git status failed for ${dirPath}:`, err);
  }

  if (totalFiles > MAX_STATUS_FILES) {
    if (overCapWarned.get(dirPath) !== totalFiles) {
      overCapWarned.set(dirPath, totalFiles);
      log.warn(
        `[GitWatch] ${dirPath} has ${totalFiles} changed files — pushing the first ${MAX_STATUS_FILES}`
      );
    }
  } else {
    overCapWarned.delete(dirPath);
  }

  let branch: string | null = null;
  try {
    branch = (await git(['branch', '--show-current'], gitRoot)).trim() || 'HEAD';
  } catch {
    branch = 'HEAD';
  }

  let ahead = 0;
  let behind = 0;
  if (branch && branch !== 'HEAD') {
    try {
      const revList = (await git(
        ['rev-list', '--left-right', '--count', `${branch}...@{upstream}`],
        gitRoot
      )).trim();
      const parts = revList.split(/\s+/);
      if (parts.length === 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // No upstream configured — leave at 0
    }
  }

  const mergeInProgress = fs.existsSync(path.join(gitRoot, '.git', 'MERGE_HEAD'));

  return {
    payload: {
      path: dirPath,
      isGitRepo: true,
      branch,
      ahead,
      behind,
      mergeInProgress,
      files,
      totalFiles,
      truncated: totalFiles > files.length,
    },
    fingerprint: statusFingerprint({
      isGitRepo: true,
      branch,
      ahead,
      behind,
      mergeInProgress,
      totalFiles,
      rawStatus,
    }),
  };
}

function sendStatus(ws: WebSocket, payload: GitWatchedDirStatus): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: 'git_status_update', payload }));
  } catch (err) {
    log.error('[GitWatch] Failed to send git_status_update:', err);
  }
}

function watchedUnion(): Set<string> {
  const union = new Set<string>();
  for (const paths of subscriptions.values()) {
    for (const p of paths) union.add(p);
  }
  return union;
}

function pushToSubscribers(payload: GitWatchedDirStatus): void {
  for (const [ws, paths] of subscriptions) {
    if (paths.has(payload.path)) sendStatus(ws, payload);
  }
}

/** Compute a dir, update the cache, and push to subscribers if it changed. */
async function refreshOne(dirPath: string, forcePushTo?: WebSocket): Promise<void> {
  const { payload, fingerprint } = await computeStatus(dirPath);
  const prev = cache.get(dirPath);
  cache.set(dirPath, { fingerprint, payload });

  if (!prev || prev.fingerprint !== fingerprint) {
    pushToSubscribers(payload);
  } else if (forcePushTo) {
    // Unchanged, but an explicit refresh/subscribe asked for it.
    sendStatus(forcePushTo, payload);
  }
}

async function pollOnce(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const union = watchedUnion();

    // Drop cache entries nobody watches anymore.
    for (const key of cache.keys()) {
      if (!union.has(key)) {
        cache.delete(key);
        overCapWarned.delete(key);
      }
    }

    // Sequential on purpose: keeps the git subprocess load flat no matter how
    // many directories are watched. Local git status is fast (~tens of ms).
    for (const dirPath of union) {
      if (!watchedUnion().has(dirPath)) continue; // unsubscribed mid-cycle
      await refreshOne(dirPath);
    }
  } catch (err) {
    log.error('[GitWatch] Poll cycle failed:', err);
  } finally {
    pollInFlight = false;
  }
}

function ensurePolling(): void {
  if (pollTimer || subscriptions.size === 0) return;
  pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
}

function stopPollingIfIdle(): void {
  if (subscriptions.size === 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    cache.clear();
  }
}

export const gitWatchService = {
  /**
   * Replace a socket's watched directory set. Immediately sends the current
   * status for every requested path (cached, or freshly computed) so the
   * client renders without waiting for the next poll cycle.
   */
  setWatchList(ws: WebSocket, paths: string[]): void {
    const cleaned = [...new Set(
      (paths || [])
        .filter((p): p is string => typeof p === 'string' && path.isAbsolute(p))
        .slice(0, MAX_WATCHED_PATHS)
    )];

    if (cleaned.length === 0) {
      subscriptions.delete(ws);
      stopPollingIfIdle();
      return;
    }

    subscriptions.set(ws, new Set(cleaned));
    ensurePolling();

    void (async () => {
      for (const dirPath of cleaned) {
        const cached = cache.get(dirPath);
        if (cached) {
          sendStatus(ws, cached.payload);
        } else {
          await refreshOne(dirPath, ws);
        }
      }
    })();
  },

  /** Recompute the given (watched) paths now and push results. */
  async refreshPaths(paths: string[], requester?: WebSocket): Promise<void> {
    const union = watchedUnion();
    for (const dirPath of paths || []) {
      if (typeof dirPath !== 'string' || !union.has(dirPath)) continue;
      await refreshOne(dirPath, requester);
    }
  },

  /** Forget a socket (call on WS close). */
  removeSocket(ws: WebSocket): void {
    subscriptions.delete(ws);
    stopPollingIfIdle();
  },
};
