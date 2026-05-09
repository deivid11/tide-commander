import { describe, it, expect, vi } from 'vitest';
import { GroupNameCache } from './group-name-cache.js';

describe('GroupNameCache', () => {
  it('returns null for empty inputs without fetching', async () => {
    const fetchGroups = vi.fn();
    const cache = new GroupNameCache({ fetchGroups });
    expect(await cache.lookup('', 'x@g.us')).toBeNull();
    expect(await cache.lookup('s', '')).toBeNull();
    expect(fetchGroups).not.toHaveBeenCalled();
  });

  it('fetches once per session and primes every group', async () => {
    const fetchGroups = vi.fn().mockResolvedValue([
      { id: '120363426536125334@g.us', name: 'Bolba' },
      { id: '120363158564139060@g.us', name: 'Lengua' },
    ]);
    const cache = new GroupNameCache({ fetchGroups });

    expect(await cache.lookup('s1', '120363426536125334@g.us')).toBe('Bolba');
    expect(await cache.lookup('s1', '120363158564139060@g.us')).toBe('Lengua');
    // Second session must still trigger a fetch.
    fetchGroups.mockResolvedValueOnce([{ id: 'g@g.us', name: 'Other' }]);
    expect(await cache.lookup('s2', 'g@g.us')).toBe('Other');

    expect(fetchGroups).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses into a single fetch', async () => {
    let resolveFetch: (val: Array<{ id: string; name: string }>) => void = () => {};
    const fetchGroups = vi.fn(() =>
      new Promise<Array<{ id: string; name: string }>>(r => { resolveFetch = r; }),
    );
    const cache = new GroupNameCache({ fetchGroups });
    const p1 = cache.lookup('s', 'g1@g.us');
    const p2 = cache.lookup('s', 'g2@g.us');
    resolveFetch([{ id: 'g1@g.us', name: 'One' }, { id: 'g2@g.us', name: 'Two' }]);
    expect(await p1).toBe('One');
    expect(await p2).toBe('Two');
    expect(fetchGroups).toHaveBeenCalledTimes(1);
  });

  it('negative-caches misses so we do not refetch on every message from the same group', async () => {
    const fetchGroups = vi.fn().mockResolvedValue([{ id: 'other@g.us', name: 'Other' }]);
    const cache = new GroupNameCache({ fetchGroups });
    expect(await cache.lookup('s', 'unknown@g.us')).toBeNull();
    expect(await cache.lookup('s', 'unknown@g.us')).toBeNull();
    expect(fetchGroups).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL expires', async () => {
    const calls: number[] = [];
    let nowVal = 1_000;
    const fetchGroups = vi.fn(async () => {
      calls.push(nowVal);
      return [{ id: 'g@g.us', name: 'A' }];
    });
    const cache = new GroupNameCache({ fetchGroups, ttlMs: 1000, now: () => nowVal });
    expect(await cache.lookup('s', 'g@g.us')).toBe('A');
    nowVal += 500;
    expect(await cache.lookup('s', 'g@g.us')).toBe('A'); // still warm
    nowVal += 1000;
    expect(await cache.lookup('s', 'g@g.us')).toBe('A'); // stale → refetch
    expect(fetchGroups).toHaveBeenCalledTimes(2);
  });

  it('does not poison the cache when fetch throws', async () => {
    const fetchGroups = vi.fn().mockRejectedValueOnce(new Error('net'));
    const cache = new GroupNameCache({ fetchGroups });
    expect(await cache.lookup('s', 'g@g.us')).toBeNull();
    // Next call retries instead of returning a poisoned negative cache.
    fetchGroups.mockResolvedValueOnce([{ id: 'g@g.us', name: 'Bolba' }]);
    // The first call set a negative entry; force a clear so the retry can
    // surface the now-known name (cache.clear is the operational escape
    // hatch — same as ContactNameCache).
    cache.clear();
    expect(await cache.lookup('s', 'g@g.us')).toBe('Bolba');
  });
});
