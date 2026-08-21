import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyCodexRateLimits,
  getCodexCredentialProfilesUsage,
  resetCodexProfileUsageCacheForTests,
  selectCodexRateLimitWindows,
  setCodexNativeRateLimitsReaderForTests,
} from './codex-usage-service.js';
import { setProviderCredentialsDirForTests } from './provider-credentials-service.js';

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

  it('merges a scoped short-term limit with the top-level weekly limit', () => {
    const selected = selectCodexRateLimitWindows({
      rateLimits: {
        primary: { usedPercent: 79, windowDurationMins: 10080, resetsAt: 1_800_086_400 },
        secondary: null,
      },
      rateLimitsByLimitId: {
        codex_spark: {
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 4, windowDurationMins: 10080, resetsAt: 1_800_086_400 },
        },
      },
    });

    expect(selected.primary).toMatchObject({ usedPercent: 12, windowDurationMins: 300 });
    expect(selected.secondary).toMatchObject({ usedPercent: 79, windowDurationMins: 10080 });
  });
});

function codexAuth(token: string) {
  return JSON.stringify({ tokens: { access_token: token, refresh_token: `refresh-${token}` } });
}

describe('getCodexCredentialProfilesUsage', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-codex-creds-'));
    setProviderCredentialsDirForTests({ codex: tmp });
    resetCodexProfileUsageCacheForTests();
  });

  afterEach(() => {
    setCodexNativeRateLimitsReaderForTests(null);
    setProviderCredentialsDirForTests({});
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('fetches once per account and keys results by profile id', async () => {
    const shared = codexAuth('tok-active');
    fs.writeFileSync(path.join(tmp, 'auth.json'), shared);
    fs.writeFileSync(path.join(tmp, 'auth.david.json'), shared);
    fs.writeFileSync(path.join(tmp, 'auth.jc.json'), codexAuth('tok-jc'));

    const reader = vi.fn(async (codexHome?: string) => ({
      primary: { usedPercent: codexHome ? 55 : 11, windowDurationMins: 1440, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1_800_086_400 },
    }));
    setCodexNativeRateLimitsReaderForTests(reader);

    const result = await getCodexCredentialProfilesUsage();
    const byId = Object.fromEntries(result.usage.map((u) => [u.id, u]));

    expect(reader).toHaveBeenCalledTimes(2);
    // The active account is read through the real CODEX_HOME (no override).
    expect(reader).toHaveBeenCalledWith(undefined);
    expect(byId.active.rateLimits?.daily?.utilization).toBe(11);
    // Named copy of the active account shares the same fetch.
    expect(byId.david.rateLimits?.daily?.utilization).toBe(11);
    // Dormant account is read through a temp CODEX_HOME.
    expect(byId.jc.rateLimits?.daily?.utilization).toBe(55);
    expect(byId.jc.rateLimits?.weekly?.utilization).toBe(5);
  });

  it('seeds the temp CODEX_HOME with the dormant auth and persists refreshed tokens back', async () => {
    fs.writeFileSync(path.join(tmp, 'auth.json'), codexAuth('tok-active'));
    fs.writeFileSync(path.join(tmp, 'auth.jc.json'), codexAuth('tok-jc'));

    const refreshed = codexAuth('tok-jc-refreshed');
    const reader = vi.fn(async (codexHome?: string) => {
      if (codexHome) {
        expect(fs.readFileSync(path.join(codexHome, 'auth.json'), 'utf-8')).toContain('tok-jc');
        fs.writeFileSync(path.join(codexHome, 'auth.json'), refreshed);
      }
      return { primary: { usedPercent: 1, windowDurationMins: 1440, resetsAt: 1_800_000_000 } };
    });
    setCodexNativeRateLimitsReaderForTests(reader);

    await getCodexCredentialProfilesUsage();

    expect(fs.readFileSync(path.join(tmp, 'auth.jc.json'), 'utf-8')).toBe(refreshed);
    // The live auth.json is never touched by dormant reads.
    expect(fs.readFileSync(path.join(tmp, 'auth.json'), 'utf-8')).toContain('tok-active');
  });

  it('reports reader failures per account without failing the whole listing', async () => {
    fs.writeFileSync(path.join(tmp, 'auth.json'), codexAuth('tok-active'));
    fs.writeFileSync(path.join(tmp, 'auth.jc.json'), codexAuth('tok-jc'));

    const reader = vi.fn(async (codexHome?: string) => {
      if (codexHome) throw new Error('401 Unauthorized');
      return { primary: { usedPercent: 9, windowDurationMins: 1440, resetsAt: 1_800_000_000 } };
    });
    setCodexNativeRateLimitsReaderForTests(reader);

    const result = await getCodexCredentialProfilesUsage();
    const byId = Object.fromEntries(result.usage.map((u) => [u.id, u]));

    expect(byId.active.error).toBeNull();
    expect(byId.active.rateLimits?.daily?.utilization).toBe(9);
    expect(byId.jc.error).toBe('401 Unauthorized');
    expect(byId.jc.rateLimits).toBeNull();
  });

  it('marks invalid credential files without invoking the reader', async () => {
    fs.writeFileSync(path.join(tmp, 'auth.broken.json'), '{not json');

    const reader = vi.fn(async () => ({}));
    setCodexNativeRateLimitsReaderForTests(reader);

    const result = await getCodexCredentialProfilesUsage();
    const broken = result.usage.find((u) => u.id === 'broken');
    expect(broken?.error).toBe('Invalid credentials file');
    expect(broken?.rateLimits).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });
});
