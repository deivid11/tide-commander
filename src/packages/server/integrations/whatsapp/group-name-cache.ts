/**
 * GroupNameCache — resolves a Baileys group JID (`*@g.us`) to its current
 * subject via the upstream `GET /api/sessions/:id/groups` endpoint.
 *
 * Why this exists: per-message webhook payloads from the upstream WA service
 * do not carry the group subject (verified against trigger_events for the
 * Bolba group: `groupName` was always NULL). The upstream DOES expose the
 * subject through the groups list endpoint — one call warms many JIDs at
 * once. Without this cache, the bridge would always fall back to
 * `humanizeGroupJid()` and bubbles would render `Grupo <last4>` instead of
 * the real subject.
 *
 * Mirrors ContactNameCache deliberately — same TTL semantics, same fetch
 * coalescing, same negative caching, same prime() escape hatch.
 */

export interface CachedGroupName {
  name: string | null;
  ts: number;
}

export interface GroupLite {
  id: string;
  name?: string | null;
}

export interface GroupNameCacheOptions {
  /** Per-entry TTL. Defaults to 10 min (matches ContactNameCache). */
  ttlMs?: number;
  now?: () => number;
  /**
   * Fetcher invoked on cache miss. Returns the FULL groups list for the
   * session; the cache batch-primes every entry.
   */
  fetchGroups: (sessionId: string) => Promise<GroupLite[]>;
}

export class GroupNameCache {
  private readonly entries = new Map<string, CachedGroupName>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly fetchGroups: (sessionId: string) => Promise<GroupLite[]>;
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(opts: GroupNameCacheOptions) {
    this.ttlMs = opts.ttlMs ?? 10 * 60_000;
    this.now = opts.now ?? Date.now;
    this.fetchGroups = opts.fetchGroups;
  }

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
    // Negative-cache so we don't refetch on every message from this group.
    this.entries.set(key, { name: null, ts: this.now() });
    return null;
  }

  peek(sessionId: string, jid: string): CachedGroupName | undefined {
    return this.entries.get(this.cacheKey(sessionId, jid));
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  prime(sessionId: string, groups: GroupLite[]): void {
    const t = this.now();
    for (const g of groups) {
      if (!g?.id) continue;
      const key = this.cacheKey(sessionId, g.id);
      const name = typeof g.name === 'string' && g.name ? g.name : null;
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
        const groups = await this.fetchGroups(sessionId);
        if (Array.isArray(groups)) this.prime(sessionId, groups);
      } catch {
        // Swallow — caller falls back to humanizeGroupJid. Don't cache an empty
        // result on error; let the next call retry.
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
