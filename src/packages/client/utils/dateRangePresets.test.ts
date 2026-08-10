import { describe, it, expect } from 'vitest';
import { resolvePresetSince, toISODate, describeRange, DATE_RANGE_PRESETS } from './dateRangePresets';

// Fixed instant so the assertions never drift with the wall clock.
const NOW = new Date(2026, 6, 31, 15, 30).getTime(); // 31 Jul 2026, local time

describe('toISODate', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    expect(toISODate(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
    expect(toISODate(new Date(2026, 11, 31).getTime())).toBe('2026-12-31');
  });

  // UTC conversion would roll a late-evening timestamp onto the next day for
  // users east of Greenwich, silently dropping that day's commits.
  it('uses the local calendar day, not UTC', () => {
    const lateEvening = new Date(2026, 6, 31, 23, 45).getTime();
    expect(toISODate(lateEvening)).toBe('2026-07-31');
  });
});

describe('resolvePresetSince', () => {
  it('computes each relative window', () => {
    expect(resolvePresetSince('24h', NOW)).toBe('2026-07-30');
    expect(resolvePresetSince('7d', NOW)).toBe('2026-07-24');
    expect(resolvePresetSince('30d', NOW)).toBe('2026-07-01');
    expect(resolvePresetSince('90d', NOW)).toBe('2026-05-02');
    expect(resolvePresetSince('1y', NOW)).toBe('2025-07-31');
  });

  it('returns nothing for the non-computed presets', () => {
    expect(resolvePresetSince('any', NOW)).toBe('');
    expect(resolvePresetSince('custom', NOW)).toBe('');
  });

  it('crosses month and year boundaries correctly', () => {
    const jan2 = new Date(2026, 0, 2).getTime();
    expect(resolvePresetSince('7d', jan2)).toBe('2025-12-26');
  });

  it('exposes a preset for every id it can resolve', () => {
    const ids = DATE_RANGE_PRESETS.map((p) => p.id);
    expect(ids).toContain('any');
    expect(ids).toContain('custom');
    for (const id of ids) {
      expect(() => resolvePresetSince(id, NOW)).not.toThrow();
    }
  });
});

describe('describeRange', () => {
  it('summarises whichever bounds are set', () => {
    expect(describeRange('2026-01-01', '2026-02-01')).toBe('2026-01-01 → 2026-02-01');
    expect(describeRange('2026-01-01', '')).toBe('desde 2026-01-01');
    expect(describeRange('', '2026-02-01')).toBe('hasta 2026-02-01');
    expect(describeRange('', '')).toBe('');
  });
});
