/**
 * SlackNameCache — caches resolved display names for Slack user IDs and
 * channel IDs so the trigger template can render `@David` / `#navi` instead
 * of cryptic `U078UV85AEM` / `C02JE0A23BJ`.
 *
 * One instance is owned by each `SlackInstance`, giving free per-instance
 * isolation: the `default` (xoxb- bot) and `personal` (xoxp- user token) caches
 * never bleed into each other even when the same user/channel id is visible
 * to both tokens.
 *
 * The `users.info` / `conversations.info` Slack endpoints are Tier 4
 * (~100 req/min) so we don't bother routing through the polling pacer; with
 * cache hit-rate ≈100% after warm-up the additional traffic is negligible.
 */

export interface CachedEntry<T> {
  value: T;
  storedAt: number;
}

export interface SlackNameCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * Insertion-ordered Map gives free LRU when we evict the oldest on overflow,
 * same trick used by message-dedupe.ts in the WhatsApp integration.
 */
class TtlLruCache<K, V> {
  private readonly map = new Map<K, CachedEntry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.storedAt > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, storedAt: this.now() });
    if (this.map.size > this.maxEntries) {
      // Drop the oldest (insertion order) to bound memory.
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export class SlackNameCache {
  private readonly users: TtlLruCache<string, string | null>;
  private readonly channels: TtlLruCache<string, string | null>;
  private readonly userInflight = new Map<string, Promise<string | null>>();
  private readonly channelInflight = new Map<string, Promise<string | null>>();

  constructor(opts: SlackNameCacheOptions = {}) {
    const ttl = opts.ttlMs ?? 10 * 60_000;
    const max = opts.maxEntries ?? 500;
    const now = opts.now ?? Date.now;
    this.users = new TtlLruCache(ttl, max, now);
    this.channels = new TtlLruCache(ttl, max, now);
  }

  /** Synchronous read — returns the cached value or undefined when stale/absent. */
  peekUser(userId: string): string | null | undefined {
    return this.users.get(userId);
  }

  peekChannel(channelId: string): string | null | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Resolve a userId to a display name with cache + in-flight coalescing. The
   * fetcher is provided by `SlackInstance` so this module stays decoupled from
   * the WebClient. Returns null when the name can't be resolved — callers
   * fall back to the bare userId.
   */
  async lookupUser(userId: string, fetcher: () => Promise<string | null>): Promise<string | null> {
    if (!userId) return null;
    const cached = this.users.get(userId);
    if (cached !== undefined) return cached;

    const pending = this.userInflight.get(userId);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const name = await fetcher();
        this.users.set(userId, name ?? null);
        return name ?? null;
      } catch {
        // Don't poison the cache on transient errors — a future call retries.
        return null;
      } finally {
        this.userInflight.delete(userId);
      }
    })();
    this.userInflight.set(userId, promise);
    return promise;
  }

  async lookupChannel(channelId: string, fetcher: () => Promise<string | null>): Promise<string | null> {
    if (!channelId) return null;
    const cached = this.channels.get(channelId);
    if (cached !== undefined) return cached;

    const pending = this.channelInflight.get(channelId);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const name = await fetcher();
        this.channels.set(channelId, name ?? null);
        return name ?? null;
      } catch {
        return null;
      } finally {
        this.channelInflight.delete(channelId);
      }
    })();
    this.channelInflight.set(channelId, promise);
    return promise;
  }

  /** Force-prime an entry — used when other code paths already know the name. */
  primeUser(userId: string, name: string | null): void {
    if (!userId) return;
    this.users.set(userId, name);
  }

  primeChannel(channelId: string, name: string | null): void {
    if (!channelId) return;
    this.channels.set(channelId, name);
  }

  size(): { users: number; channels: number } {
    return { users: this.users.size(), channels: this.channels.size() };
  }

  clear(): void {
    this.users.clear();
    this.channels.clear();
    this.userInflight.clear();
    this.channelInflight.clear();
  }
}
