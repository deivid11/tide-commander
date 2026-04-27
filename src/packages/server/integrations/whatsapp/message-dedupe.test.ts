import { describe, it, expect } from 'vitest';
import { MessageDedupeCache } from './message-dedupe.js';

describe('MessageDedupeCache', () => {
  it('returns false on first sight and true on the second within TTL', () => {
    const cache = new MessageDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    expect(cache.isDuplicate('s1', 'msg-A')).toBe(false);
    expect(cache.isDuplicate('s1', 'msg-A')).toBe(true);
  });

  it('does not dedupe distinct message ids', () => {
    const cache = new MessageDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    expect(cache.isDuplicate('s1', 'msg-A')).toBe(false);
    expect(cache.isDuplicate('s1', 'msg-B')).toBe(false);
  });

  it('isolates by sessionId — same id in different sessions is not a dup', () => {
    const cache = new MessageDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    expect(cache.isDuplicate('main', 'shared-id')).toBe(false);
    expect(cache.isDuplicate('other', 'shared-id')).toBe(false);
    expect(cache.isDuplicate('main', 'shared-id')).toBe(true);
    expect(cache.isDuplicate('other', 'shared-id')).toBe(true);
  });

  it('never dedupes when messageId is missing — broadcasts pass through', () => {
    const cache = new MessageDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    expect(cache.isDuplicate('s1', undefined)).toBe(false);
    expect(cache.isDuplicate('s1', undefined)).toBe(false);
    expect(cache.isDuplicate('s1', '')).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it('expires entries after the TTL window', () => {
    let now = 1_000_000;
    const cache = new MessageDedupeCache({
      maxEntries: 16,
      ttlMs: 60_000,
      now: () => now,
    });
    expect(cache.isDuplicate('s1', 'msg-A')).toBe(false);
    now += 30_000;
    expect(cache.isDuplicate('s1', 'msg-A')).toBe(true); // still inside TTL
    now += 31_000; // total 61s past first sight — outside TTL
    expect(cache.isDuplicate('s1', 'msg-A')).toBe(false);
    expect(cache.isDuplicate('s1', 'msg-A')).toBe(true); // re-recorded
  });

  it('evicts the oldest entry when maxEntries is exceeded', () => {
    const cache = new MessageDedupeCache({ maxEntries: 3, ttlMs: 60_000 });
    cache.isDuplicate('s1', 'a');
    cache.isDuplicate('s1', 'b');
    cache.isDuplicate('s1', 'c');
    expect(cache.size()).toBe(3);
    // Insert a 4th — 'a' (oldest) should be evicted.
    cache.isDuplicate('s1', 'd');
    expect(cache.size()).toBe(3);
    // 'a' is no longer remembered, so it returns false (not a dup).
    expect(cache.isDuplicate('s1', 'a')).toBe(false);
    // 'd' is still in the cache.
    expect(cache.isDuplicate('s1', 'd')).toBe(true);
  });

  it('clear() empties the cache', () => {
    const cache = new MessageDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    cache.isDuplicate('s1', 'a');
    cache.isDuplicate('s1', 'b');
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.isDuplicate('s1', 'a')).toBe(false); // forgotten
  });

  it('reproduces the upstream dual-fire scenario: same id, different events', () => {
    // Simulate the bug: upstream fires `message_create` then `message` for the
    // SAME Baileys key.id within the same tick.
    const cache = new MessageDedupeCache({ maxEntries: 16, ttlMs: 60_000 });
    const sessionId = 'main';
    const baileysMessageId = '3EB0BD2BD942A27A611147';

    // First webhook arrives (message_create).
    expect(cache.isDuplicate(sessionId, baileysMessageId)).toBe(false);
    // Second webhook arrives milliseconds later (message). Bridge would
    // broadcast a duplicate without the cache.
    expect(cache.isDuplicate(sessionId, baileysMessageId)).toBe(true);
  });
});
