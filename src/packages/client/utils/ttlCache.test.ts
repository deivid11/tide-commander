import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from './ttlCache';

describe('TtlCache', () => {
  it('returns a stored value before it expires', () => {
    const c = new TtlCache<number>(1000);
    c.set('a', 1, 0);
    expect(c.get('a', 500)).toBe(1);
    expect(c.isWarm('a', 500)).toBe(true);
  });

  it('drops the value once the ttl passes', () => {
    const c = new TtlCache<number>(1000);
    c.set('a', 1, 0);
    expect(c.get('a', 1000)).toBeUndefined();
    expect(c.get('a', 1500)).toBeUndefined();
    expect(c.isWarm('a', 1500)).toBe(false);
  });

  it('evicts the least recently used entry past the cap', () => {
    const c = new TtlCache<number>(10_000, 2);
    c.set('a', 1, 0);
    c.set('b', 2, 0);
    c.get('a', 0);            // 'a' becomes most recent, so 'b' is next out
    c.set('c', 3, 0);

    expect(c.get('a', 0)).toBe(1);
    expect(c.get('c', 0)).toBe(3);
    expect(c.get('b', 0)).toBeUndefined();
  });

  it('serves load() from cache without calling the fetcher', async () => {
    const c = new TtlCache<string>(1000);
    c.set('k', 'cached', 0);
    const fetcher = vi.fn(async () => 'fresh');

    await expect(c.load('k', fetcher, 100)).resolves.toBe('cached');
    expect(fetcher).not.toHaveBeenCalled();
  });

  // The prefetch and the real open would otherwise fire two identical requests.
  it('shares one in-flight promise across concurrent loads', async () => {
    const c = new TtlCache<string>(1000);
    let resolve!: (v: string) => void;
    const fetcher = vi.fn(() => new Promise<string>((r) => { resolve = r; }));

    const a = c.load('k', fetcher, 0);
    const b = c.load('k', fetcher, 0);
    resolve('value');

    expect(await a).toBe('value');
    expect(await b).toBe('value');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure instead of caching the error', async () => {
    const c = new TtlCache<string>(1000);
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');

    await expect(c.load('k', fetcher, 0)).rejects.toThrow('boom');
    await expect(c.load('k', fetcher, 0)).resolves.toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('prefetch warms the cache and is a no-op when already warm', async () => {
    const c = new TtlCache<string>(1000);
    const fetcher = vi.fn(async () => 'warm');

    c.prefetch('k', fetcher, 0);
    await Promise.resolve();
    await Promise.resolve();

    expect(c.isWarm('k')).toBe(true);
    c.prefetch('k', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('swallows prefetch failures', async () => {
    const c = new TtlCache<string>(1000);
    const fetcher = vi.fn(async () => { throw new Error('offline'); });

    expect(() => c.prefetch('k', fetcher, 0)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.isWarm('k')).toBe(false);
  });

  it('clear() empties the cache', () => {
    const c = new TtlCache<number>(1000);
    c.set('a', 1, 0);
    c.clear();
    expect(c.get('a', 0)).toBeUndefined();
  });
});
