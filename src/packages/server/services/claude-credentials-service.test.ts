import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const resetCache = vi.hoisted(() => vi.fn());

vi.mock('./claude-usage-service.js', () => ({
  resetClaudeRateLimitCache: resetCache,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), log: vi.fn(), info: vi.fn() }),
}));

import {
  deleteClaudeCredentialProfile,
  isValidProfileName,
  listClaudeCredentialProfiles,
  renameClaudeCredentialProfile,
  saveActiveClaudeCredentialProfile,
  setClaudeCredentialsDirForTests,
  switchClaudeCredentialProfile,
} from './claude-credentials-service.js';

function cred(token: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: `refresh-${token}`,
      expiresAt: Date.now() + 3_600_000,
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_20x',
      scopes: ['user:inference'],
      ...extra,
    },
  });
}

describe('claude-credentials-service', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-claude-creds-'));
    setClaudeCredentialsDirForTests(tmp);
    resetCache.mockClear();
  });

  afterEach(() => {
    setClaudeCredentialsDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('validates profile names', () => {
    expect(isValidProfileName('david')).toBe(true);
    expect(isValidProfileName('jc')).toBe(true);
    expect(isValidProfileName('felipe_2')).toBe(true);
    expect(isValidProfileName('')).toBe(false);
    expect(isValidProfileName('../etc')).toBe(false);
    expect(isValidProfileName('has space')).toBe(false);
  });

  it('lists active and named profiles without leaking tokens', () => {
    fs.writeFileSync(path.join(tmp, '.credentials.json'), cred('tok-active'));
    fs.writeFileSync(path.join(tmp, '.credentials.david.json'), cred('tok-david'));
    fs.writeFileSync(path.join(tmp, '.credentials.jc.json'), cred('tok-jc'));

    const list = listClaudeCredentialProfiles();
    expect(list.active?.valid).toBe(true);
    expect(list.active?.fingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(list.profiles.map((p) => p.name)).toEqual(['david', 'jc']);
    expect(list.profiles.every((p) => !p.isActive)).toBe(true);
    const blob = JSON.stringify(list);
    expect(blob).not.toContain('tok-active');
    expect(blob).not.toContain('tok-david');
    expect(blob).not.toContain('refresh-');
  });

  it('detects when active matches a named profile', () => {
    const same = cred('tok-shared');
    fs.writeFileSync(path.join(tmp, '.credentials.json'), same);
    fs.writeFileSync(path.join(tmp, '.credentials.david.json'), same);
    fs.writeFileSync(path.join(tmp, '.credentials.jc.json'), cred('tok-jc'));

    const list = listClaudeCredentialProfiles();
    expect(list.active?.matchesNamed).toBe('david');
    expect(list.profiles.find((p) => p.name === 'david')?.isActive).toBe(true);
    expect(list.profiles.find((p) => p.name === 'jc')?.isActive).toBe(false);
  });

  it('switches to a named profile and requires stash when active is unique', () => {
    fs.writeFileSync(path.join(tmp, '.credentials.json'), cred('tok-active'));
    fs.writeFileSync(path.join(tmp, '.credentials.david.json'), cred('tok-david'));

    expect(() => switchClaudeCredentialProfile('david')).toThrow(/stashActiveAs/);

    const result = switchClaudeCredentialProfile('david', { stashActiveAs: 'previous' });
    expect(result.stashedAs).toBe('previous');
    expect(result.active.fingerprint).toBe(
      listClaudeCredentialProfiles().profiles.find((p) => p.name === 'david')?.fingerprint,
    );
    expect(resetCache).toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmp, '.credentials.previous.json'))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, '.credentials.json'), 'utf-8')).toContain('tok-david');
    expect(fs.readFileSync(path.join(tmp, '.credentials.previous.json'), 'utf-8')).toContain('tok-active');
    // Named source is kept (copy model)
    expect(fs.existsSync(path.join(tmp, '.credentials.david.json'))).toBe(true);
  });

  it('switches without stash when active already matches a named profile', () => {
    const david = cred('tok-david');
    fs.writeFileSync(path.join(tmp, '.credentials.json'), david);
    fs.writeFileSync(path.join(tmp, '.credentials.david.json'), david);
    fs.writeFileSync(path.join(tmp, '.credentials.jc.json'), cred('tok-jc'));

    const result = switchClaudeCredentialProfile('jc');
    expect(result.stashedAs).toBeNull();
    expect(result.previousMatchesNamed).toBe('david');
    expect(fs.readFileSync(path.join(tmp, '.credentials.json'), 'utf-8')).toContain('tok-jc');
  });

  it('saves active as a named profile', () => {
    fs.writeFileSync(path.join(tmp, '.credentials.json'), cred('tok-active'));
    const list = saveActiveClaudeCredentialProfile('mine');
    expect(list.profiles.some((p) => p.name === 'mine')).toBe(true);
    expect(list.active?.matchesNamed).toBe('mine');
  });

  it('refuses overwrite of different named profile without force', () => {
    fs.writeFileSync(path.join(tmp, '.credentials.json'), cred('tok-active'));
    fs.writeFileSync(path.join(tmp, '.credentials.david.json'), cred('tok-david'));
    expect(() => saveActiveClaudeCredentialProfile('david')).toThrow(/already exists/);
    saveActiveClaudeCredentialProfile('david', { force: true });
    expect(fs.readFileSync(path.join(tmp, '.credentials.david.json'), 'utf-8')).toContain('tok-active');
  });

  it('renames and deletes named profiles', () => {
    fs.writeFileSync(path.join(tmp, '.credentials.json'), cred('tok-active'));
    fs.writeFileSync(path.join(tmp, '.credentials.david.json'), cred('tok-david'));
    renameClaudeCredentialProfile('david', 'dave');
    expect(fs.existsSync(path.join(tmp, '.credentials.dave.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.credentials.david.json'))).toBe(false);
    deleteClaudeCredentialProfile('dave');
    expect(fs.existsSync(path.join(tmp, '.credentials.dave.json'))).toBe(false);
  });
});
