import { describe, expect, it } from 'vitest';
import type { ProviderUsageSnapshot } from '../../api/claude-usage';
import { getWeeklyUsageWindow } from './PlanLimitsTooltip';

const baseSession = {
  tokensUsed: 0,
  contextUsed: 0,
  contextLimit: 200_000,
  taskCount: 0,
  lastActivity: 0,
};

function snapshot(value: Partial<ProviderUsageSnapshot>): ProviderUsageSnapshot {
  return value as ProviderUsageSnapshot;
}

describe('getWeeklyUsageWindow', () => {
  it('uses Pi active-provider weekly quota windows (y2d6h4as shape)', () => {
    const usage = snapshot({
      provider: 'pi',
      fetchedAt: 0,
      modelProvider: 'openai-codex',
      credentialType: 'oauth',
      subscriptions: [],
      session: baseSession,
      rateLimits: null,
      quotaWindows: [{
        key: 'weekly',
        utilization: 43,
        resetsAt: '2026-08-26T16:14:44.000Z',
      }],
      rateLimitsError: null,
      cliHint: '',
    });

    expect(getWeeklyUsageWindow(usage)?.utilization).toBe(43);
  });

  it('normalizes native Claude, Codex, and Grok weekly windows', () => {
    const weekly = { utilization: 57, resetsAt: '2026-08-26T16:14:44.000Z' };
    expect(getWeeklyUsageWindow(snapshot({
      provider: 'claude',
      rateLimits: { fiveHour: null, sevenDay: weekly, sevenDayOpus: null, sevenDayFable: null, sevenDaySonnet: null },
    }))?.utilization).toBe(57);
    expect(getWeeklyUsageWindow(snapshot({
      provider: 'codex',
      rateLimits: { daily: null, weekly },
    }))?.utilization).toBe(57);
    expect(getWeeklyUsageWindow(snapshot({
      provider: 'grok',
      rateLimits: { weekly, monthly: null, onDemand: null },
    }))?.utilization).toBe(57);
  });

  it('reads weekly windows from native OpenCode Go snapshots', () => {
    const usage = snapshot({
      provider: 'opencode',
      modelProvider: 'opencode-go',
      plan: 'go',
      quotaWindows: [{ key: 'weekly', utilization: 46, resetsAt: '2026-08-24T00:00:00.243Z' }],
      rateLimits: null,
    });
    expect(getWeeklyUsageWindow(usage)?.utilization).toBe(46);
  });

  it('returns no fake weekly window for OpenCode dynamic free models', () => {
    const usage = snapshot({
      provider: 'opencode',
      modelProvider: 'opencode',
      plan: 'free',
      quotaWindows: [],
      rateLimits: null,
    });
    expect(getWeeklyUsageWindow(usage)).toBeNull();
  });

  it('falls back to Pi model-specific weekly windows', () => {
    const usage = snapshot({
      provider: 'pi',
      quotaWindows: [{ key: 'weekly-opus', utilization: 31, resetsAt: '2026-08-26T16:14:44.000Z' }],
      rateLimits: null,
    });
    expect(getWeeklyUsageWindow(usage)?.utilization).toBe(31);
  });
});
