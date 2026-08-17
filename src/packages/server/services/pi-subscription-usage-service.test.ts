import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const fetchClaudeRateLimitsForToken = vi.hoisted(() => vi.fn());

vi.mock('./claude-usage-service.js', () => ({
  fetchClaudeRateLimitsForToken,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), log: vi.fn(), info: vi.fn() }),
}));

import {
  resetClaudeProfileUsageCacheForTests,
  setClaudeCredentialsDirForTests,
} from './claude-credentials-service.js';
import { setProviderCredentialsDirForTests } from './provider-credentials-service.js';
import {
  resetCodexProfileUsageCacheForTests,
  setCodexNativeRateLimitsReaderForTests,
} from './codex-usage-service.js';
import {
  buildPiSubscriptionUsageSnapshot,
  deletePiCredentialProfile,
  getPiCredentialProfilesUsage,
  listPiCredentialProfiles,
  renamePiCredentialProfile,
  resetPiSubscriptionUsageCacheForTests,
  resolvePiModelProvider,
  saveActivePiCredentialProfile,
  setPiCredentialsDirForTests,
  switchPiCredentialProfile,
} from './pi-subscription-usage-service.js';

function oauth(access: string, refresh = `refresh-${access}`, expires = Date.now() + 3_600_000) {
  return { type: 'oauth', access, refresh, expires };
}

function authFile(entries: Record<string, unknown>): string {
  return JSON.stringify(entries, null, 2);
}

const rateLimits = {
  fiveHour: { utilization: 25, resetsAt: '2026-08-20T20:00:00Z' },
  sevenDay: { utilization: 40, resetsAt: '2026-08-24T20:00:00Z' },
  sevenDayOpus: null,
  sevenDayFable: null,
  sevenDaySonnet: null,
};

const baseAgent = {
  id: 'pi-1',
  provider: 'pi',
  piModel: 'anthropic/claude-opus-5',
  tokensUsed: 1200,
  contextUsed: 800,
  contextLimit: 200_000,
  taskCount: 3,
  lastActivity: 123,
} as any;

describe('pi-subscription-usage-service', () => {
  let dir: string;
  let claudeDir: string;
  let codexDir: string;
  let grokDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pi-creds-'));
    claudeDir = path.join(dir, 'claude');
    codexDir = path.join(dir, 'codex');
    grokDir = path.join(dir, 'grok');
    fs.mkdirSync(claudeDir);
    fs.mkdirSync(codexDir);
    fs.mkdirSync(grokDir);
    setPiCredentialsDirForTests(dir);
    setClaudeCredentialsDirForTests(claudeDir);
    setProviderCredentialsDirForTests({ codex: codexDir, grok: grokDir });
    resetPiSubscriptionUsageCacheForTests();
    resetClaudeProfileUsageCacheForTests();
    resetCodexProfileUsageCacheForTests();
    fetchClaudeRateLimitsForToken.mockReset();
    fetchClaudeRateLimitsForToken.mockResolvedValue({ rateLimits, error: null, status: 200 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setPiCredentialsDirForTests(null);
    setClaudeCredentialsDirForTests(null);
    setProviderCredentialsDirForTests({});
    setCodexNativeRateLimitsReaderForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves explicit, runtime-reported, and configured Pi model providers', () => {
    expect(resolvePiModelProvider(baseAgent)).toBe('anthropic');
    expect(resolvePiModelProvider({ ...baseAgent, piModel: '', piModelProvider: 'openai-codex' })).toBe('openai-codex');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ defaultProvider: 'github-copilot' }));
    expect(resolvePiModelProvider({ ...baseAgent, piModel: '', piModelProvider: undefined })).toBe('github-copilot');
  });

  it('lists only the selected provider profiles without leaking tokens', () => {
    fs.writeFileSync(path.join(dir, 'auth.json'), authFile({
      anthropic: oauth('active-token'),
      'openai-codex': oauth('openai-token'),
    }));
    fs.writeFileSync(path.join(dir, 'auth.dave.json'), authFile({ anthropic: oauth('dave-token') }));
    fs.writeFileSync(path.join(dir, 'auth.openai-only.json'), authFile({ 'openai-codex': oauth('other-openai') }));

    const list = listPiCredentialProfiles('anthropic');

    expect(list.active?.valid).toBe(true);
    expect(list.profiles.map((profile) => profile.name)).toEqual(['dave']);
    expect(list.profileDir).toBe(claudeDir);
    expect(list.active?.fingerprint).toMatch(/^[a-f0-9]{12}$/);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain('active-token');
    expect(serialized).not.toContain('dave-token');
  });

  it('switches a named Claude session into Pi while preserving every other Pi login', () => {
    fs.writeFileSync(path.join(dir, 'auth.json'), authFile({
      anthropic: oauth('active-anthropic'),
      'openai-codex': oauth('keep-openai'),
    }));
    fs.writeFileSync(path.join(claudeDir, '.credentials.dave.json'), JSON.stringify({
      claudeAiOauth: {
        accessToken: 'dave-anthropic',
        refreshToken: 'refresh-dave',
        expiresAt: Date.now() + 3_600_000,
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_20x',
      },
    }));

    expect(() => switchPiCredentialProfile('anthropic', 'dave')).toThrow(/stashActiveAs/);
    const result = switchPiCredentialProfile('anthropic', 'dave', { stashActiveAs: 'previous' });

    expect(result.stashedAs).toBe('previous');
    const active = JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'), 'utf-8'));
    const previous = JSON.parse(fs.readFileSync(path.join(dir, 'auth.previous.json'), 'utf-8'));
    expect(active.anthropic.access).toBe('dave-anthropic');
    expect(active['openai-codex'].access).toBe('keep-openai');
    expect(previous.anthropic.access).toBe('active-anthropic');
  });

  it('saves, renames, and deletes named Pi profiles', () => {
    fs.writeFileSync(path.join(dir, 'auth.json'), authFile({ anthropic: oauth('active-token') }));

    expect(saveActivePiCredentialProfile('anthropic', 'mine').profiles.map((profile) => profile.name)).toEqual(['mine']);
    expect(renamePiCredentialProfile('anthropic', 'mine', 'renamed').profiles[0].name).toBe('renamed');
    expect(deletePiCredentialProfile('anthropic', 'renamed').profiles).toEqual([]);
  });

  it('shows the current and named Anthropic account usage in the Pi snapshot', async () => {
    const shared = oauth('shared-token');
    fs.writeFileSync(path.join(dir, 'auth.json'), authFile({
      anthropic: shared,
      'openai-codex': oauth('openai-token'),
    }));
    fs.writeFileSync(path.join(dir, 'auth.current.json'), authFile({ anthropic: shared }));
    fs.writeFileSync(path.join(dir, 'auth.other.json'), authFile({ anthropic: oauth('other-token') }));

    const [snapshot, profiles] = await Promise.all([
      buildPiSubscriptionUsageSnapshot(baseAgent),
      getPiCredentialProfilesUsage('anthropic'),
    ]);

    expect(snapshot.modelProvider).toBe('anthropic');
    expect(snapshot.credentialType).toBe('oauth');
    expect(snapshot.rateLimits?.fiveHour?.utilization).toBe(25);
    expect(snapshot.quotaWindows.map((window) => window.key)).toEqual(['session', 'weekly']);
    expect(snapshot.subscriptions).toEqual([
      { provider: 'anthropic', label: 'Anthropic Claude Pro/Max', active: true },
      { provider: 'openai-codex', label: 'OpenAI ChatGPT Plus/Pro', active: false },
    ]);
    expect(profiles.usage.map((entry) => entry.id).sort()).toEqual(['active', 'current', 'other']);
    // active/current share one grant; the concurrent snapshot shares the same cache.
    expect(fetchClaudeRateLimitsForToken).toHaveBeenCalledTimes(2);
    expect(snapshot.session).toMatchObject({ tokensUsed: 1200, contextUsed: 800, taskCount: 3 });
  });

  it('shows each saved Codex account daily/weekly limits for a Pi Codex model', async () => {
    const codexCredential = { ...oauth('codex-access'), accountId: 'acct-1' };
    fs.writeFileSync(path.join(dir, 'auth.json'), authFile({
      'openai-codex': codexCredential,
      xai: oauth('keep-xai'),
    }));
    fs.writeFileSync(path.join(codexDir, 'auth.felipe.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'codex-access',
        refresh_token: 'refresh-codex-access',
        account_id: 'acct-1',
      },
    }));
    setCodexNativeRateLimitsReaderForTests(async () => ({
      primary: { usedPercent: 35, resetsAt: 1_800_000_000, windowDurationMins: 300 },
      secondary: { usedPercent: 60, resetsAt: 1_800_500_000, windowDurationMins: 10_080 },
    }));

    const agent = { ...baseAgent, piModel: 'openai-codex/gpt-5.6-sol' };
    const [list, profiles, snapshot] = await Promise.all([
      Promise.resolve(listPiCredentialProfiles('openai-codex')),
      getPiCredentialProfilesUsage('openai-codex'),
      buildPiSubscriptionUsageSnapshot(agent),
    ]);

    expect(list.profiles).toMatchObject([{ name: 'felipe', source: 'codex', isActive: true }]);
    expect(profiles.usage.find((entry) => entry.id === 'felipe')?.quotaWindows.map((window) => [window.key, window.utilization])).toEqual([
      ['daily', 35],
      ['weekly', 60],
    ]);
    expect(snapshot.quotaWindows.map((window) => window.key)).toEqual(['daily', 'weekly']);
    expect(snapshot.rateLimitsError).toBeNull();
  });

  it('shows weekly/monthly xAI limits for Pi-owned Grok sessions', async () => {
    fs.writeFileSync(path.join(dir, 'auth.json'), authFile({ xai: oauth('xai-access') }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const isCredits = String(input).includes('format=credits');
      return new Response(JSON.stringify({
        config: isCredits
          ? {
              creditUsagePercent: 22,
              currentPeriod: {
                type: 'USAGE_PERIOD_TYPE_WEEKLY',
                start: '2026-08-10T00:00:00Z',
                end: '2026-08-17T00:00:00Z',
              },
            }
          : {
              used: { val: 250 },
              monthlyLimit: { val: 1000 },
              billingPeriodEnd: '2026-09-01T00:00:00Z',
            },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const result = await getPiCredentialProfilesUsage('xai');
    const active = result.usage.find((entry) => entry.id === 'active');

    expect(active?.quotaWindows.map((window) => [window.key, window.utilization])).toEqual([
      ['weekly', 22],
      ['monthly', 25],
    ]);
    expect(active?.quotaWindows.find((window) => window.key === 'monthly')).toMatchObject({ used: 250, limit: 1000 });
  });

  it('refreshes an expired dormant Anthropic profile and persists the rotated grant', async () => {
    fs.writeFileSync(path.join(dir, 'auth.json'), authFile({ anthropic: oauth('active-token') }));
    fs.writeFileSync(path.join(dir, 'auth.old.json'), authFile({
      anthropic: oauth('expired-token', 'expired-refresh', Date.now() - 1),
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'renewed-access',
      refresh_token: 'renewed-refresh',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await getPiCredentialProfilesUsage('anthropic');

    expect(result.usage.find((entry) => entry.id === 'old')?.error).toBeNull();
    expect(fetchClaudeRateLimitsForToken).toHaveBeenCalledWith('renewed-access');
    const renewed = JSON.parse(fs.readFileSync(path.join(dir, 'auth.old.json'), 'utf-8')).anthropic;
    expect(renewed.access).toBe('renewed-access');
    expect(renewed.refresh).toBe('renewed-refresh');
  });
});
