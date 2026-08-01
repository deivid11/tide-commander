/**
 * Small TTL cache with in-flight request de-duplication.
 *
 * Written for the branch graph, where the same page gets asked for repeatedly:
 * a hover prefetch, then the real open a moment later, then again every time
 * the modal is reopened. Without de-duplication the prefetch and the open fire
 * two identical requests; without a TTL the graph would go stale after a commit.
 *
 * `now` is injected everywhere so the behaviour is testable without fake timers.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    /** Bounds memory on repos with many filter combinations. */
    private readonly maxEntries = 24
  ) {}

  get(key: string, now: number = Date.now()): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order so the least recently used entry is evicted first.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /**
   * Resolve from cache, or run `fetcher` — sharing a single promise when the
   * same key is requested again while the first call is still in flight.
   */
  async load(key: string, fetcher: () => Promise<T>, now: number = Date.now()): Promise<T> {
    const cached = this.get(key, now);
    if (cached !== undefined) return cached;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = fetcher()
      .then((value) => {
        this.set(key, value, Date.now());
        return value;
      })
      .finally(() => { this.inflight.delete(key); });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Warm the cache without caring about the result (fire and forget). */
  prefetch(key: string, fetcher: () => Promise<T>, now: number = Date.now()): void {
    if (this.get(key, now) !== undefined || this.inflight.has(key)) return;
    void this.load(key, fetcher, now).catch(() => { /* a failed warm-up is not an error */ });
  }

  /** Drop everything — used by the explicit refresh action. */
  clear(): void {
    this.entries.clear();
  }

  /** True when the key would be served without a network round trip. */
  isWarm(key: string, now: number = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }
}
