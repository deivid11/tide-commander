/**
 * WebhookDedupeCache — in-memory LRU+TTL keyed by `${triggerId}:${requestId}`.
 *
 * Bitbucket Cloud retries failed deliveries and includes `X-Request-UUID` +
 * `X-Attempt-Number` headers; the same `X-Request-UUID` is reused across
 * retries. Without this cache, a retried delivery would re-fire the workflow
 * downstream of the receiver. Modeled on `whatsapp/message-dedupe.ts` —
 * insertion-ordered Map gives free LRU eviction on overflow.
 *
 * Cap: defaults to 1024 entries (so the cache cannot grow unbounded). At
 * ~24 webhooks/minute sustained that's ~40 minutes of history; the TTL is
 * 10 min so eviction by overflow only kicks in for misbehaving retry loops.
 */

export interface WebhookDedupeOptions {
  maxEntries: number;
  ttlMs: number;
  /** Defaults to Date.now; overridable for tests. */
  now?: () => number;
}

export class WebhookDedupeCache {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: WebhookDedupeOptions) {
    this.maxEntries = opts.maxEntries;
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Returns true if (triggerId, requestId) was seen within the TTL — caller
   * should ACK 200 and skip workflow routing. Returns false (and records the
   * id) otherwise.
   *
   * If `requestId` is empty/undefined, returns false unconditionally — better
   * to forward an unidentified delivery than silently drop it.
   */
  isDuplicate(triggerId: string, requestId: string | undefined): boolean {
    if (!requestId) return false;
    const key = `${triggerId}:${requestId}`;
    const t = this.now();
    const seenAt = this.entries.get(key);
    if (seenAt !== undefined && t - seenAt < this.ttlMs) {
      return true;
    }
    if (seenAt !== undefined) {
      this.entries.delete(key);
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, t);
    return false;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
