import { describe, expect, it, vi } from 'vitest';
import { createFileExistenceStore, type FileRef } from './fileExistence';

describe('createFileExistenceStore', () => {
  it('batches every watched absolute path into one request and reports misses', async () => {
    const fetcher = vi.fn(async (refs: FileRef[]) => refs.map((ref) => !ref.path.includes('montage')));
    const store = createFileExistenceStore(fetcher);
    const listener = vi.fn();
    store.subscribe(listener);

    store.watch([{ path: '/pg/montage.png' }, { path: '/pg/guide.pdf' }]);
    store.watch([{ path: '/pg/guide.pdf' }, { path: 'relative/never-checked.ts' }]);
    await store.flushNow();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0].map((ref) => ref.path).sort()).toEqual(['/pg/guide.pdf', '/pg/montage.png']);
    expect(store.isMissing({ path: '/pg/montage.png' })).toBe(true);
    expect(store.isMissing({ path: '/pg/guide.pdf' })).toBe(false);
    expect(store.isMissing({ path: 'relative/never-checked.ts' })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sends the cwd with each path and keys answers by (cwd, path)', async () => {
    // Same absolute path, two agents: from the workspace cwd it resolves into a repo.
    const fetcher = vi.fn(async (refs: FileRef[]) => refs.map((ref) => ref.baseDir === '/ws'));
    const store = createFileExistenceStore(fetcher);
    store.watch([{ path: '/ws/apps/x.ts', baseDir: '/ws' }, { path: '/ws/apps/x.ts', baseDir: '/other' }]);
    await store.flushNow();
    expect(fetcher.mock.calls[0][0]).toEqual([
      { path: '/ws/apps/x.ts', baseDir: '/ws' },
      { path: '/ws/apps/x.ts', baseDir: '/other' },
    ]);
    expect(store.isMissing({ path: '/ws/apps/x.ts', baseDir: '/ws' })).toBe(false);
    expect(store.isMissing({ path: '/ws/apps/x.ts', baseDir: '/other' })).toBe(true);
  });

  it('re-checks a missing file sooner than a present one, and only while watched', async () => {
    let clock = 0;
    let exists = false;
    const fetcher = vi.fn(async (refs: FileRef[]) => refs.map(() => exists));
    const store = createFileExistenceStore(fetcher, () => clock);

    const unwatch = store.watch([{ path: '/pg/out.png' }]);
    await store.flushNow();
    expect(store.isMissing({ path: '/pg/out.png' })).toBe(true);

    clock = 5_000; // still fresh
    store.revalidate();
    await store.flushNow();
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock = 11_000; // missing TTL elapsed; the file got written meanwhile
    exists = true;
    store.revalidate();
    await store.flushNow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.isMissing({ path: '/pg/out.png' })).toBe(false);

    unwatch();
    clock = 200_000;
    store.revalidate();
    await store.flushNow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the last answer when the server is unreachable', async () => {
    let fail = false;
    const store = createFileExistenceStore(async (refs) => {
      if (fail) throw new Error('offline');
      return refs.map(() => false);
    }, () => 0);
    store.watch([{ path: '/pg/a.txt' }]);
    await store.flushNow();
    fail = true;
    store.markMissing({ path: '/pg/b.txt' });
    expect(store.isMissing({ path: '/pg/a.txt' })).toBe(true);
    expect(store.isMissing({ path: '/pg/b.txt' })).toBe(true);
  });
});
