import { describe, it, expect, vi } from 'vitest';
import { SlackNameCache } from './slack-name-cache.js';

describe('SlackNameCache', () => {
  it('caches user-name lookups and only calls the fetcher once per id within TTL', async () => {
    const cache = new SlackNameCache({ ttlMs: 60_000 });
    const fetcher = vi.fn(async () => 'David');

    const first = await cache.lookupUser('U1', fetcher);
    const second = await cache.lookupUser('U1', fetcher);
    expect(first).toBe('David');
    expect(second).toBe('David');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses into a single fetch', async () => {
    let resolveFetch!: (v: string | null) => void;
    const fetcher = vi.fn(() => new Promise<string | null>((r) => { resolveFetch = r; }));
    const cache = new SlackNameCache();

    const a = cache.lookupUser('U2', fetcher);
    const b = cache.lookupUser('U2', fetcher);
    const c = cache.lookupUser('U2', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFetch('Ana');
    expect(await a).toBe('Ana');
    expect(await b).toBe('Ana');
    expect(await c).toBe('Ana');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null on fetcher failure without poisoning the cache', async () => {
    const cache = new SlackNameCache();
    const failing = vi.fn(async () => { throw new Error('boom'); });
    const result = await cache.lookupUser('U3', failing);
    expect(result).toBeNull();

    // Subsequent call retries the fetcher (no negative cache for errors).
    const ok = vi.fn(async () => 'Carlos');
    const after = await cache.lookupUser('U3', ok);
    expect(after).toBe('Carlos');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('expires entries after the TTL window', async () => {
    let now = 1_000_000;
    const cache = new SlackNameCache({ ttlMs: 60_000, now: () => now });
    const fetcher = vi.fn(async () => 'David');

    await cache.lookupUser('U4', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 30_000;
    await cache.lookupUser('U4', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1); // still cached

    now += 31_000;
    await cache.lookupUser('U4', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2); // refetched after TTL
  });

  it('evicts the oldest entry when maxEntries is exceeded (LRU bound)', async () => {
    const cache = new SlackNameCache({ maxEntries: 3 });
    await cache.lookupUser('U_a', async () => 'A');
    await cache.lookupUser('U_b', async () => 'B');
    await cache.lookupUser('U_c', async () => 'C');
    expect(cache.size().users).toBe(3);

    // 4th insert evicts the oldest (U_a).
    await cache.lookupUser('U_d', async () => 'D');
    expect(cache.size().users).toBe(3);
    expect(cache.peekUser('U_a')).toBeUndefined();
    expect(cache.peekUser('U_d')).toBe('D');
  });

  it('keeps user and channel caches isolated', async () => {
    const cache = new SlackNameCache();
    await cache.lookupUser('SAME_ID', async () => 'as-user');
    await cache.lookupChannel('SAME_ID', async () => 'as-channel');
    expect(cache.peekUser('SAME_ID')).toBe('as-user');
    expect(cache.peekChannel('SAME_ID')).toBe('as-channel');
  });

  it('primeUser / primeChannel populate the cache without an async fetch', () => {
    const cache = new SlackNameCache();
    cache.primeUser('U_p', 'Primed User');
    cache.primeChannel('C_p', '#primed');
    expect(cache.peekUser('U_p')).toBe('Primed User');
    expect(cache.peekChannel('C_p')).toBe('#primed');
  });

  it('two cache instances do not share state (per-instance isolation)', async () => {
    const a = new SlackNameCache();
    const b = new SlackNameCache();
    await a.lookupUser('U1', async () => 'David in default');
    await b.lookupUser('U1', async () => 'David in personal');
    expect(a.peekUser('U1')).toBe('David in default');
    expect(b.peekUser('U1')).toBe('David in personal');
  });

  it('clear() drops all entries from both caches', async () => {
    const cache = new SlackNameCache();
    await cache.lookupUser('U1', async () => 'A');
    await cache.lookupChannel('C1', async () => '#x');
    expect(cache.size()).toEqual({ users: 1, channels: 1 });
    cache.clear();
    expect(cache.size()).toEqual({ users: 0, channels: 0 });
  });

  it('returns null and never calls the fetcher for empty keys', async () => {
    const cache = new SlackNameCache();
    const fetcher = vi.fn(async () => 'should-not-fire');
    expect(await cache.lookupUser('', fetcher)).toBeNull();
    expect(await cache.lookupChannel('', fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
