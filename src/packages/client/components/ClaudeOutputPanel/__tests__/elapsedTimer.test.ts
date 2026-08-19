import { describe, expect, it } from 'vitest';
import { resolveElapsedTimerStartedAt } from '../elapsedTimer';

describe('resolveElapsedTimerStartedAt', () => {
  const now = 1_800_000_000_000;

  it('uses the authoritative task timestamp when available', () => {
    expect(resolveElapsedTimerStartedAt(now - 42_000, null, now)).toBe(now - 42_000);
  });

  it('starts a local clock when a reloaded client has no prompt timestamp', () => {
    expect(resolveElapsedTimerStartedAt(undefined, null, now)).toBe(now);
  });

  it('keeps the local fallback stable on subsequent timer ticks', () => {
    const fallback = now - 5_000;
    expect(resolveElapsedTimerStartedAt(undefined, fallback, now)).toBe(fallback);
  });

  it('rejects a materially future server timestamp instead of freezing at 0:00', () => {
    expect(resolveElapsedTimerStartedAt(now + 60_000, null, now)).toBe(now);
  });

  it('adopts an authoritative timestamp when it arrives after fallback startup', () => {
    const fallback = now - 2_000;
    const authoritative = now - 10_000;
    expect(resolveElapsedTimerStartedAt(authoritative, fallback, now)).toBe(authoritative);
  });
});
