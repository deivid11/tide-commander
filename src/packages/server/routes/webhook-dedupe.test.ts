import { describe, it, expect } from 'vitest';
import { WebhookDedupeCache } from './webhook-dedupe.js';

describe('WebhookDedupeCache', () => {
  it('returns false on first sight and true on the second within TTL', () => {
    const cache = new WebhookDedupeCache({ maxEntries: 16, ttlMs: 10 * 60_000 });
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(false);
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(true);
  });

  it('does not dedupe distinct request ids', () => {
    const cache = new WebhookDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(false);
    expect(cache.isDuplicate('trig-1', 'uuid-B')).toBe(false);
  });

  it('isolates by triggerId — same uuid against a different trigger is not a dup', () => {
    const cache = new WebhookDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(false);
    expect(cache.isDuplicate('trig-2', 'uuid-A')).toBe(false);
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(true);
    expect(cache.isDuplicate('trig-2', 'uuid-A')).toBe(true);
  });

  it('never dedupes when requestId is missing — unidentified deliveries pass through', () => {
    const cache = new WebhookDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    expect(cache.isDuplicate('trig-1', undefined)).toBe(false);
    expect(cache.isDuplicate('trig-1', undefined)).toBe(false);
    expect(cache.isDuplicate('trig-1', '')).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it('expires entries after the TTL window', () => {
    let now = 1_000_000;
    const cache = new WebhookDedupeCache({
      maxEntries: 16,
      ttlMs: 10 * 60_000,
      now: () => now,
    });
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(false);
    now += 5 * 60_000; // 5 min
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(true);
    now += 6 * 60_000; // 11 min total — past TTL
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(false);
    expect(cache.isDuplicate('trig-1', 'uuid-A')).toBe(true);
  });

  it('evicts the oldest entry when maxEntries is exceeded', () => {
    const cache = new WebhookDedupeCache({ maxEntries: 3, ttlMs: 60_000 });
    cache.isDuplicate('t', 'a');
    cache.isDuplicate('t', 'b');
    cache.isDuplicate('t', 'c');
    expect(cache.size()).toBe(3);
    cache.isDuplicate('t', 'd'); // evicts 'a'
    expect(cache.size()).toBe(3);
    expect(cache.isDuplicate('t', 'a')).toBe(false); // forgotten
    expect(cache.isDuplicate('t', 'd')).toBe(true);  // still cached
  });

  it('clear() empties the cache', () => {
    const cache = new WebhookDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    cache.isDuplicate('t', 'a');
    cache.isDuplicate('t', 'b');
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.isDuplicate('t', 'a')).toBe(false);
  });

  it('reproduces the Bitbucket retry scenario: same X-Request-UUID across attempts', () => {
    // Bitbucket reuses X-Request-UUID and increments X-Attempt-Number on retry.
    // The receiver must ACK 200 + skip routing on retries 2..N.
    const cache = new WebhookDedupeCache({ maxEntries: 16, ttlMs: 10 * 60_000 });
    const triggerId = 'pr-review';
    const requestUuid = '5c3e9b8d-0f3a-4f2b-9c1f-2a3b4c5d6e7f';

    expect(cache.isDuplicate(triggerId, requestUuid)).toBe(false); // attempt 1
    expect(cache.isDuplicate(triggerId, requestUuid)).toBe(true);  // attempt 2 — retry
    expect(cache.isDuplicate(triggerId, requestUuid)).toBe(true);  // attempt 3 — retry
  });
});
