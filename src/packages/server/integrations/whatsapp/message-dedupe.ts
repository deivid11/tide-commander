/**
 * MessageDedupeCache — small in-memory LRU+TTL cache used by the WhatsApp
 * bridge to suppress upstream dual-fires (`message` + `message_create` for the
 * same Baileys event on inbound messages, see whatsapp-trigger-handler.ts for
 * the upstream call-site that motivates this).
 *
 * Keyed by composite `${sessionId}:${messageId}` so distinct sessions can't
 * cross-contaminate. Insertion-ordered Map gives a free LRU when we evict the
 * oldest on overflow.
 */

export interface DedupeOptions {
  maxEntries: number;
  ttlMs: number;
  /** Defaults to Date.now; overridable for tests. */
  now?: () => number;
}

export class MessageDedupeCache {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: DedupeOptions) {
    this.maxEntries = opts.maxEntries;
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Returns true if (sessionId, messageId) was seen within the TTL — caller
   * should drop the event. Returns false (and records the id) otherwise.
   *
   * If `messageId` is empty/undefined, returns false unconditionally — better
   * to forward a non-dedupable event than silently drop a real message.
   */
  isDuplicate(sessionId: string, messageId: string | undefined): boolean {
    if (!messageId) return false;
    const key = `${sessionId}:${messageId}`;
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
