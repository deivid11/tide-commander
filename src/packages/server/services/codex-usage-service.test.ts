import { describe, expect, it } from 'vitest';
import { classifyCodexRateLimits } from './codex-usage-service.js';

describe('classifyCodexRateLimits', () => {
  it('maps native windows to daily and weekly gauges by duration', () => {
    const limits = classifyCodexRateLimits({
      primary: { usedPercent: 12, windowDurationMins: 1440, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 34, windowDurationMins: 10080, resetsAt: 1_800_086_400 },
    });
    expect(limits.daily?.utilization).toBe(12);
    expect(limits.weekly?.utilization).toBe(34);
    expect(limits.daily?.resetsAt).toBe(new Date(1_800_000_000_000).toISOString());
  });
});
