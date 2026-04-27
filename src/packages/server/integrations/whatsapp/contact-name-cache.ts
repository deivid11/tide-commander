/**
 * ContactNameCache — resolves a Baileys JID to a display name via the
 * upstream contacts endpoint, with TTL caching and per-(session,jid) request
 * coalescing.
 *
 * Why this exists: the upstream whatsapp-api strips `pushName` from its
 * webhook payloads (see whatsapp-trigger-handler.ts header), so the bridge
 * has no in-band name to forward to the frontend toast. The contacts list is
 * built upstream from `contacts.upsert/update` and `messaging-history.set`
 * Baileys events, and exposes each contact's `notify` (push name) under
 * `name`/`pushname`. We hit `GET /api/sessions/:id/contacts` once per session
 * per refresh window and cache by JID.
 *
 * Design notes:
 *  - Single fetch per session warms many JIDs; the cache key is composite
 *    `${sessionId}:${jid}` so distinct sessions don't bleed into each other.
 *  - TTL applies per-entry (sliding refresh on miss/expiry). Default 5 min.
 *  - In-flight fetches are coalesced: if 5 messages arrive simultaneously and
 *    miss the cache, only one upstream call happens; the rest await the same
 *    promise. Prevents thundering-herd on session reconnect.
 *  - A miss after a successful fetch records `null` so we don't refetch the
 *    upstream for every unknown contact (negative cache).
 *  - On fetch error, we cache nothing — caller falls back to no name and the
 *    next message will retry.
 */

export interface CachedContactName {
  name: string | null;
  ts: number;
}

export interface ContactLite {
  id: string;
  name?: string | null;
  pushname?: string | null;
}

export interface ContactNameCacheOptions {
  /** Per-entry TTL. Defaults to 5 min. */
  ttlMs?: number;
  /** Override clock — used by tests. */
  now?: () => number;
  /**
   * Fetcher invoked on cache miss. Implementation should return the FULL
   * contacts list for the session — the cache batch-primes every entry.
   */
  fetchContacts: (sessionId: string) => Promise<ContactLite[]>;
}

export class ContactNameCache {
  private readonly entries = new Map<string, CachedContactName>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly fetchContacts: (sessionId: string) => Promise<ContactLite[]>;
  /** Pending session fetches keyed by sessionId — coalesces concurrent misses. */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(opts: ContactNameCacheOptions) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
    this.fetchContacts = opts.fetchContacts;
  }

  /**
   * Returns the cached display name (or null), refreshing from upstream if
   * the cache is stale or missing. On fetch error, returns the stale value if
   * any, otherwise null. Never throws — name enrichment is best-effort.
   */
  async lookup(sessionId: string, jid: string): Promise<string | null> {
    if (!sessionId || !jid) return null;
    const key = this.cacheKey(sessionId, jid);
    const cached = this.entries.get(key);
    if (cached && this.now() - cached.ts < this.ttlMs) {
      return cached.name;
    }

    await this.refreshSession(sessionId);

    const after = this.entries.get(key);
    if (after) return after.name;
    // Negative-cache the miss so we don't refetch on every message from this jid.
    this.entries.set(key, { name: null, ts: this.now() });
    return null;
  }

  /** Synchronous read — useful for tests and dashboards. */
  peek(sessionId: string, jid: string): CachedContactName | undefined {
    return this.entries.get(this.cacheKey(sessionId, jid));
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /**
   * Force-prime from a known contacts list (useful when upstream pushes the
   * list via WS event, or for tests). Overwrites stale entries.
   */
  prime(sessionId: string, contacts: ContactLite[]): void {
    const t = this.now();
    for (const c of contacts) {
      if (!c?.id) continue;
      const key = this.cacheKey(sessionId, c.id);
      const name = pickName(c);
      this.entries.set(key, { name, ts: t });
    }
  }

  private cacheKey(sessionId: string, jid: string): string {
    return `${sessionId}:${jid}`;
  }

  private async refreshSession(sessionId: string): Promise<void> {
    const pending = this.inflight.get(sessionId);
    if (pending) {
      await pending;
      return;
    }
    const promise = (async () => {
      try {
        const contacts = await this.fetchContacts(sessionId);
        if (Array.isArray(contacts)) this.prime(sessionId, contacts);
      } catch {
        // Swallow — caller falls back to no-name. Don't cache an empty result
        // on error; let the next call retry.
      }
    })();
    this.inflight.set(sessionId, promise);
    try {
      await promise;
    } finally {
      this.inflight.delete(sessionId);
    }
  }
}

function pickName(contact: ContactLite): string | null {
  const candidate =
    (typeof contact.name === 'string' && contact.name) ||
    (typeof contact.pushname === 'string' && contact.pushname) ||
    null;
  return candidate || null;
}
