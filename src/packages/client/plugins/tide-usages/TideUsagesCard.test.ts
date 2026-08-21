import { describe, expect, it } from 'vitest';
import { formatResetCountdown, isProviderUsagesData } from './TideUsagesCard';

describe('Tide /usages renderer data', () => {
  it('accepts a provider usage report', () => {
    expect(isProviderUsagesData({
      kind: 'provider-usages',
      title: 'Límites',
      fetchedAt: Date.now(),
      providers: [{
        id: 'codex',
        label: 'Codex',
        accounts: [{
          id: 'active',
          label: 'Cuenta activa',
          daily: { key: 'daily', label: 'Diario', utilization: 42 },
          weekly: null,
        }],
      }],
    })).toBe(true);
  });

  it('rejects malformed reports', () => {
    expect(isProviderUsagesData({ kind: 'provider-usages', providers: {} })).toBe(false);
    expect(isProviderUsagesData({ kind: 'provider-usages', providers: [{ id: 'codex' }] })).toBe(false);
  });

  it('formats the remaining reset time as days and hours', () => {
    const now = Date.parse('2026-08-20T10:00:00.000Z');
    expect(formatResetCountdown('2026-08-22T16:30:00.000Z', now)).toBe('2d 6h');
    expect(formatResetCountdown('2026-08-20T14:18:00.000Z', now)).toBe('4h 18m');
    expect(formatResetCountdown('2026-08-20T09:00:00.000Z', now)).toBe('Ahora');
  });
});
