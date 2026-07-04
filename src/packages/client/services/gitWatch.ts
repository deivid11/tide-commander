/**
 * Client-side git watch registry.
 *
 * Components/hooks declare the directories they need git status for via
 * acquireGitWatch(); this module keeps a ref-counted union and mirrors it to
 * the server with a single `git_watch` message (the server replaces the
 * socket's whole watch set each time). Status data arrives as
 * `git_status_update` pushes and lands in store.gitDirStatuses — no HTTP
 * polling anywhere.
 *
 * NOTE: imports from '../websocket/send' (not the '../websocket' index) so
 * connection.ts can call resyncGitWatch() on socket open without an import
 * cycle.
 */

import { sendMessage, isConnected } from '../websocket/send';

const refCounts = new Map<string, number>();
let lastSentKey: string | null = null;
let sendTimer: number | null = null;

function syncNow(): void {
  // The server's subscription state lives on the socket: while disconnected
  // there is nothing to update (and sendMessage would toast an error).
  // connection.ts calls resyncGitWatch() on every socket open.
  if (!isConnected()) {
    lastSentKey = null;
    return;
  }
  const paths = [...refCounts.keys()].sort();
  const key = paths.join('\n');
  if (key === lastSentKey) return;
  lastSentKey = key;
  sendMessage({ type: 'git_watch', payload: { paths } });
}

/** Coalesce bursts of acquire/release (e.g. several hooks mounting at once). */
function scheduleSync(): void {
  if (sendTimer !== null) return;
  sendTimer = window.setTimeout(() => {
    sendTimer = null;
    syncNow();
  }, 50);
}

/**
 * Register interest in git status for the given directories.
 * Returns a release function — call it on unmount/change (idempotent).
 */
export function acquireGitWatch(paths: string[]): () => void {
  const mine = [...new Set(paths.filter((p) => typeof p === 'string' && p.length > 0))];
  for (const p of mine) {
    refCounts.set(p, (refCounts.get(p) || 0) + 1);
  }
  scheduleSync();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const p of mine) {
      const n = refCounts.get(p) || 0;
      if (n <= 1) refCounts.delete(p);
      else refCounts.set(p, n - 1);
    }
    scheduleSync();
  };
}

/**
 * Re-send the current watch list. Called by connection.ts whenever the socket
 * (re)opens — the server keeps subscriptions per socket, so a new socket
 * starts empty.
 */
export function resyncGitWatch(): void {
  lastSentKey = null;
  syncNow();
}

/** Ask the server to recompute these directories now and push the result. */
export function requestGitRefresh(paths: string[]): void {
  const cleaned = paths.filter((p) => typeof p === 'string' && p.length > 0);
  if (cleaned.length === 0 || !isConnected()) return;
  sendMessage({ type: 'git_refresh', payload: { paths: cleaned } });
}
