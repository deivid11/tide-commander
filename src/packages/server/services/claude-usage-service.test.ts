import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the Claude credentials file "exists"; the stats cache and projects dir
// are absent so buildClaudeUsageSnapshot takes the cheap local-data path and the
// only network I/O is the rate-limit fetch we're exercising here.
const mockExistsSync = vi.hoisted(() =>
  vi.fn((p: unknown) => String(p).endsWith('.credentials.json')),
);
const mockReadFileSync = vi.hoisted(() =>
  vi.fn((p: unknown) => {
    if (String(p).endsWith('.credentials.json')) {
      return JSON.stringify({
        claudeAiOauth: { accessToken: 'tok-123', expiresAt: 4_102_444_800_000 },
      });
    }
    return '';
  }),
);

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtimeMs: 0 })),
  createReadStream: vi.fn(),
}));

vi.mock('../data/index.js', () => ({
  getClaudeProjectDir: vi.fn(() => '/tmp/does-not-exist'),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), log: vi.fn(), info: vi.fn() }),
}));

import { buildClaudeUsageSnapshot, resetClaudeRateLimitCache } from './claude-usage-service.js';

const agent = { id: 'a1', tokensUsed: 0, contextUsed: 0, contextLimit: 200_000, taskCount: 0, lastActivity: 0 } as any;

function okResponse(utilization = 42) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      five_hour: { utilization, resets_at: '2026-07-08T00:00:00Z' },
      seven_day: { utilization, resets_at: '2026-07-14T00:00:00Z' },
    }),
  };
}

function statusResponse(status: number, retryAfter: string | null = null) {
  return { ok: false, status, headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? retryAfter : null) } };
}

describe('claude-usage-service rate-limit throttle', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
    resetClaudeRateLimitCache();
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('dedupes concurrent snapshot builds into a single upstream fetch', async () => {
    const [a, b, c] = await Promise.all([
      buildClaudeUsageSnapshot(agent),
      buildClaudeUsageSnapshot(agent),
      buildClaudeUsageSnapshot(agent),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.rateLimits?.fiveHour?.utilization).toBe(42);
    expect(b.rateLimits).not.toBeNull();
    expect(c.rateLimits).not.toBeNull();
  });

  it('reuses the cached result within the TTL, refetches after it expires', async () => {
    await buildClaudeUsageSnapshot(agent);
    await buildClaudeUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(1); // second served from cache

    vi.setSystemTime(new Date('2026-07-08T12:02:00Z')); // +2 min > 60s TTL
    await buildClaudeUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off after a 429 and keeps serving the last good gauges', async () => {
    await buildClaudeUsageSnapshot(agent); // seeds last-good gauges

    vi.setSystemTime(new Date('2026-07-08T12:02:00Z')); // let TTL lapse
    fetchMock.mockResolvedValueOnce(statusResponse(429));
    const afterLimit = await buildClaudeUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(afterLimit.rateLimitsError).toContain('429');
    expect(afterLimit.rateLimits?.fiveHour?.utilization).toBe(42); // stale but shown

    // Within the 5-minute 429 backoff: no further upstream calls.
    vi.setSystemTime(new Date('2026-07-08T12:03:00Z'));
    await buildClaudeUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors a Retry-After header longer than the default TTL', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(429, '120')); // 120s
    await buildClaudeUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 90s later — past the 60s TTL but still inside the 120s Retry-After window.
    vi.setSystemTime(new Date('2026-07-08T12:01:30Z'));
    await buildClaudeUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the Retry-After window — one more fetch is allowed.
    vi.setSystemTime(new Date('2026-07-08T12:02:30Z'));
    await buildClaudeUsageSnapshot(agent);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
