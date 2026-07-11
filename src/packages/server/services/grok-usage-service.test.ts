import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() =>
  vi.fn((p: unknown) => String(p).endsWith('auth.json')),
);
const mockReadFileSync = vi.hoisted(() =>
  vi.fn((p: unknown) => {
    if (String(p).endsWith('auth.json')) {
      return JSON.stringify({
        'https://auth.x.ai::client': {
          key: 'tok-grok-123',
          expires_at: '2099-01-01T00:00:00Z',
        },
      });
    }
    return '';
  }),
);

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), log: vi.fn(), info: vi.fn() }),
}));

import {
  buildGrokUsageSnapshot,
  classifyBillingPeriod,
  classifyPeriodType,
  parseCreditsConfig,
  parseSpendConfig,
  resetGrokRateLimitCache,
} from './grok-usage-service.js';

const agent = {
  id: 'g1',
  tokensUsed: 100,
  contextUsed: 50_000,
  contextLimit: 500_000,
  taskCount: 3,
  lastActivity: 1,
} as any;

function creditsResponse(percent = 16) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      config: {
        creditUsagePercent: percent,
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-07-09T00:00:00+00:00',
          end: '2026-07-16T00:00:00+00:00',
        },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        billingPeriodStart: '2026-07-09T00:00:00+00:00',
        billingPeriodEnd: '2026-07-16T00:00:00+00:00',
      },
    }),
  };
}

function spendResponse(used = 0, limit = 15_000) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      config: {
        monthlyLimit: { val: limit },
        used: { val: used },
        onDemandCap: { val: 0 },
        billingPeriodStart: '2026-07-01T00:00:00+00:00',
        billingPeriodEnd: '2026-08-01T00:00:00+00:00',
      },
    }),
  };
}

function statusResponse(status: number, retryAfter: string | null = null) {
  return {
    ok: false,
    status,
    headers: {
      get: (h: string) => (h.toLowerCase() === 'retry-after' ? retryAfter : null),
    },
  };
}

describe('classifyPeriodType / classifyBillingPeriod', () => {
  it('detects weekly and monthly from type and span', () => {
    expect(
      classifyPeriodType(
        'USAGE_PERIOD_TYPE_WEEKLY',
        '2026-07-01T00:00:00Z',
        '2026-07-08T00:00:00Z',
      ),
    ).toBe('weekly');
    expect(
      classifyPeriodType(
        'USAGE_PERIOD_TYPE_MONTHLY',
        '2026-07-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).toBe('monthly');
    expect(
      classifyBillingPeriod('2026-07-01T00:00:00Z', '2026-07-08T00:00:00Z'),
    ).toBe('weekly');
  });
});

describe('parseCreditsConfig / parseSpendConfig', () => {
  it('maps credits format to a weekly gauge', () => {
    const parsed = parseCreditsConfig({
      creditUsagePercent: 16,
      currentPeriod: {
        type: 'USAGE_PERIOD_TYPE_WEEKLY',
        start: '2026-07-09T00:00:00+00:00',
        end: '2026-07-16T00:00:00+00:00',
      },
    });
    expect(parsed.weekly?.utilization).toBe(16);
    expect(parsed.weekly?.resetsAt).toContain('2026-07-16');
    expect(parsed.monthly).toBeNull();
  });

  it('maps spend config to a monthly gauge with absolute credits', () => {
    const monthly = parseSpendConfig({
      monthlyLimit: { val: 15_000 },
      used: { val: 0 },
      billingPeriodEnd: '2026-08-01T00:00:00+00:00',
    });
    expect(monthly?.utilization).toBe(0);
    expect(monthly?.used).toBe(0);
    expect(monthly?.limit).toBe(15_000);
  });
});

describe('grok-usage-service rate-limit throttle', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
    resetGrokRateLimitCache();
    // Each snapshot fires credits + spend in parallel.
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('format=credits')) return creditsResponse(16);
      return spendResponse(0, 15_000);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps credits weekly + spend monthly into dual gauges', async () => {
    const snap = await buildGrokUsageSnapshot(agent);
    expect(snap.provider).toBe('grok');
    expect(snap.rateLimits?.weekly?.utilization).toBe(16);
    expect(snap.rateLimits?.weekly?.resetsAt).toContain('2026-07-16');
    expect(snap.rateLimits?.monthly?.utilization).toBe(0);
    expect(snap.rateLimits?.monthly?.limit).toBe(15_000);
    expect(snap.session.contextUsed).toBe(50_000);
    // One credits + one spend per build (parallel).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('format=credits');
  });

  it('dedupes concurrent snapshot builds into a single upstream pair', async () => {
    const [a, b, c] = await Promise.all([
      buildGrokUsageSnapshot(agent),
      buildGrokUsageSnapshot(agent),
      buildGrokUsageSnapshot(agent),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one credits + one spend
    expect(a.rateLimits?.weekly?.utilization).toBe(16);
    expect(b.rateLimits).not.toBeNull();
    expect(c.rateLimits).not.toBeNull();
  });

  it('reuses the cached result within the TTL, refetches after it expires', async () => {
    await buildGrokUsageSnapshot(agent);
    await buildGrokUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-07-10T12:02:00Z'));
    await buildGrokUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('backs off after a 429 and keeps serving the last good gauges', async () => {
    await buildGrokUsageSnapshot(agent);

    vi.setSystemTime(new Date('2026-07-10T12:02:00Z'));
    fetchMock.mockImplementation(async () => statusResponse(429));
    const afterLimit = await buildGrokUsageSnapshot(agent);
    expect(afterLimit.rateLimitsError).toContain('429');
    expect(afterLimit.rateLimits?.weekly?.utilization).toBe(16);

    const callsAfter429 = fetchMock.mock.calls.length;
    vi.setSystemTime(new Date('2026-07-10T12:03:00Z'));
    await buildGrokUsageSnapshot(agent);
    expect(fetchMock.mock.calls.length).toBe(callsAfter429);
  });
});
