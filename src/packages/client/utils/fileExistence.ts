/**
 * Which files referenced in the conversation still exist on disk — backs the
 * "dead link" styling of file chips, so a chip for a scratch file the agent
 * later deleted reads as gone BEFORE it is clicked.
 *
 * One module-level cache shared by every row. Rows subscribe with the paths
 * they show; lookups are batched into one POST /api/files/exists-batch per
 * tick, and paths that are still on screen are re-validated periodically so a
 * file that reappears (or is deleted while visible) updates in place.
 *
 * Each path travels with the agent cwd it was resolved against, and the server
 * runs the viewer's own resolver on it (cheap strategies) — so a chip is dead
 * only when clicking it could not open anything, not merely when the naive
 * cwd+path join misses (an agent in a workspace folder citing a repo path).
 *
 * Only absolute paths are checked: a relative reference the client cannot
 * anchor is never marked dead on a guess.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';

export interface FileRef {
  /** Absolute path (already joined onto the cwd when the reference was relative). */
  path: string;
  /** Agent cwd the reference was written from — enables the server's fallbacks. */
  baseDir?: string;
}

type Fetcher = (refs: FileRef[]) => Promise<boolean[]>;

const SEP = '\u0000';
const keyOf = (ref: FileRef): string => `${ref.baseDir ?? ''}${SEP}${ref.path}`;
const refOf = (key: string): FileRef => {
  const index = key.indexOf(SEP);
  const baseDir = key.slice(0, index);
  return { path: key.slice(index + 1), ...(baseDir ? { baseDir } : {}) };
};

interface Entry {
  exists: boolean;
  checkedAt: number;
}

const BATCH_DELAY_MS = 60;
const BATCH_MAX = 300;
/** A present file rarely vanishes; a missing one may be about to be written. */
const EXISTS_TTL_MS = 60_000;
const MISSING_TTL_MS = 10_000;
const REVALIDATE_INTERVAL_MS = 15_000;

export function createFileExistenceStore(fetcher: Fetcher, now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const subscribers = new Map<string, number>();
  const listeners = new Set<() => void>();
  let pending = new Set<string>();
  let inFlight = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let version = 0;

  const emit = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  const isStale = (path: string): boolean => {
    const entry = entries.get(path);
    if (!entry) return true;
    return now() - entry.checkedAt > (entry.exists ? EXISTS_TTL_MS : MISSING_TTL_MS);
  };

  const flush = async () => {
    timer = null;
    const batch = [...pending].filter((key) => !inFlight.has(key)).slice(0, BATCH_MAX);
    pending = new Set([...pending].filter((key) => !batch.includes(key)));
    if (pending.size > 0) schedule();
    if (batch.length === 0) return;
    for (const key of batch) inFlight.add(key);
    try {
      const results = await fetcher(batch.map(refOf));
      const checkedAt = now();
      let changed = false;
      batch.forEach((key, index) => {
        const exists = results[index];
        if (typeof exists !== 'boolean') return;
        const previous = entries.get(key);
        entries.set(key, { exists, checkedAt });
        if (!previous || previous.exists !== exists) changed = true;
      });
      if (changed) emit();
    } catch {
      // Offline / server restarting: leave the chips as they are.
    } finally {
      inFlight = new Set([...inFlight].filter((key) => !batch.includes(key)));
    }
  };

  function schedule() {
    if (timer === null) timer = setTimeout(() => { void flush(); }, BATCH_DELAY_MS);
  }

  const request = (keys: Iterable<string>) => {
    let added = false;
    for (const key of keys) {
      if (!refOf(key).path.startsWith('/')) continue;
      if (!isStale(key)) continue;
      pending.add(key);
      added = true;
    }
    if (added) schedule();
  };

  return {
    /** Register interest in `refs` (checks stale ones); returns the unsubscribe. */
    watch(refs: readonly FileRef[]): () => void {
      const keys = refs.map(keyOf);
      for (const key of keys) subscribers.set(key, (subscribers.get(key) ?? 0) + 1);
      request(keys);
      return () => {
        for (const key of keys) {
          const count = (subscribers.get(key) ?? 1) - 1;
          if (count <= 0) subscribers.delete(key);
          else subscribers.set(key, count);
        }
      };
    },
    /** Re-check every watched reference whose entry has gone stale. */
    revalidate(): void {
      request(subscribers.keys());
    },
    /** A viewer just found out for sure (e.g. the modal hit a 404 with every fallback). */
    markMissing(ref: FileRef): void {
      const key = keyOf(ref);
      const previous = entries.get(key);
      entries.set(key, { exists: false, checkedAt: now() });
      if (!previous || previous.exists) emit();
    },
    isMissing(ref: FileRef): boolean {
      return entries.get(keyOf(ref))?.exists === false;
    },
    hasWatchers(): boolean {
      return subscribers.size > 0;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getVersion(): number {
      return version;
    },
    /** Test seam: run the pending batch now. */
    flushNow(): Promise<void> {
      if (timer !== null) clearTimeout(timer);
      return flush();
    },
  };
}

export type FileExistenceStore = ReturnType<typeof createFileExistenceStore>;

let sharedStore: FileExistenceStore | null = null;

function getSharedStore(): FileExistenceStore {
  if (sharedStore) return sharedStore;
  sharedStore = createFileExistenceStore(async (refs) => {
    // Lazy import keeps this module free of window-dependent code at load
    // time (node-environment unit tests import the store factory above).
    const { apiUrl, authFetch } = await import('./storage');
    const res = await authFetch(apiUrl('/api/files/exists-batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: refs }),
    });
    if (!res.ok) throw new Error(`exists-batch ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results as boolean[] : [];
  });
  if (typeof window !== 'undefined') {
    const store = sharedStore;
    setInterval(() => {
      if (document.visibilityState === 'visible' && store.hasWatchers()) store.revalidate();
    }, REVALIDATE_INTERVAL_MS);
    // Coming back to the tab is exactly when files may have changed under us.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') store.revalidate();
    });
  }
  return sharedStore;
}

/** Record a confirmed miss (the file viewer got a 404) so chips update at once. */
export function markFileMissing(path: string, baseDir?: string): void {
  if (path.startsWith('/')) getSharedStore().markMissing({ path, baseDir });
}

/**
 * The subset of `paths` (absolute, already resolved) known to be missing.
 * Pass `enabled: false` for rows whose file may still be being written
 * (a running tool) — they are neither checked nor marked.
 */
export function useMissingFiles(paths: readonly string[], enabled = true, baseDir?: string): ReadonlySet<string> {
  const store = getSharedStore();
  const key = enabled ? paths.filter((path) => path.startsWith('/')).join('\n') : '';
  useEffect(() => {
    if (!key) return undefined;
    return store.watch(key.split('\n').map((path) => ({ path, baseDir })));
  }, [store, key, baseDir]);
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return useMemo(() => {
    if (!key) return EMPTY;
    const missing = key.split('\n').filter((path) => store.isMissing({ path, baseDir }));
    return missing.length > 0 ? new Set(missing) : EMPTY;
    // `version` is the store's change signal.
  }, [store, key, baseDir, version]);
}

const EMPTY: ReadonlySet<string> = new Set();

/** Tooltip suffix shared by every chip that renders a missing file. */
export const MISSING_FILE_TITLE = 'File no longer exists on disk — click to see what can be recovered';
