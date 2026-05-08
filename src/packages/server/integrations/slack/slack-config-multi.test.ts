import { describe, it, expect, beforeEach } from 'vitest';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from '../../data/index.js';
import {
  deleteConfig,
  getConfigValues,
  instanceSecretKey,
  loadConfig,
  saveConfig,
  setConfigValues,
  updateConfig,
} from './slack-config.js';

const TRACKED = ['slack-config.json', 'slack-config-personal.json', 'slack-config-team-bot.json'];

beforeEach(() => {
  const dir = getDataDir();
  for (const f of TRACKED) {
    const p = path.join(dir, f);
    if (fssync.existsSync(p)) fssync.unlinkSync(p);
  }
  // Reset the per-instance memo by writing-then-deleting through the API so cached state matches disk.
  // (loadConfig/saveConfig caches by instance id; to make tests independent we re-save cleared defaults
  //  for any id the test will read.)
  saveConfig({ enabled: false, status: 'disconnected' }, 'default');
  saveConfig({ enabled: false, status: 'disconnected' }, 'personal');
  // Re-delete the persisted default so tests asserting "doesn't exist yet" still pass.
  deleteConfig('personal');
  // Wipe the just-written files so on-disk state matches expectations.
  for (const f of TRACKED) {
    const p = path.join(dir, f);
    if (fssync.existsSync(p)) fssync.unlinkSync(p);
  }
});

describe('slack-config (per-instance)', () => {
  it('default instance writes to the legacy slack-config.json filename', () => {
    saveConfig({ enabled: true, status: 'disconnected' }, 'default');
    const fpath = path.join(getDataDir(), 'slack-config.json');
    expect(fssync.existsSync(fpath)).toBe(true);
  });

  it('non-default instance writes to slack-config-<id>.json', () => {
    saveConfig({ enabled: true, status: 'disconnected' }, 'personal');
    const fpath = path.join(getDataDir(), 'slack-config-personal.json');
    expect(fssync.existsSync(fpath)).toBe(true);
    expect(fssync.existsSync(path.join(getDataDir(), 'slack-config.json'))).toBe(false);
  });

  it('loadConfig returns isolated state per instance id', () => {
    saveConfig({ enabled: true, status: 'connected', botName: 'tide-bot' }, 'default');
    saveConfig({ enabled: false, status: 'disconnected', botName: 'me' }, 'personal');
    expect(loadConfig('default').botName).toBe('tide-bot');
    expect(loadConfig('personal').botName).toBe('me');
  });

  it('updateConfig only modifies the targeted instance', () => {
    saveConfig({ enabled: true, status: 'connected' }, 'default');
    saveConfig({ enabled: false, status: 'disconnected' }, 'personal');
    updateConfig({ status: 'error', lastError: 'oops' }, 'personal');
    expect(loadConfig('default').status).toBe('connected');
    expect(loadConfig('personal').status).toBe('error');
    expect(loadConfig('personal').lastError).toBe('oops');
  });

  it('deleteConfig removes the per-instance file (but never the default)', () => {
    saveConfig({ enabled: true, status: 'disconnected' }, 'default');
    saveConfig({ enabled: true, status: 'disconnected' }, 'personal');
    deleteConfig('personal');
    expect(fssync.existsSync(path.join(getDataDir(), 'slack-config-personal.json'))).toBe(false);

    // Default is left alone even when explicitly requested.
    deleteConfig('default');
    expect(fssync.existsSync(path.join(getDataDir(), 'slack-config.json'))).toBe(true);
  });

  it('instanceSecretKey: default uses bare key, others get __<id> suffix', () => {
    expect(instanceSecretKey('SLACK_BOT_TOKEN', 'default')).toBe('SLACK_BOT_TOKEN');
    expect(instanceSecretKey('SLACK_BOT_TOKEN', 'personal')).toBe('SLACK_BOT_TOKEN__personal');
    expect(instanceSecretKey('SLACK_APP_TOKEN', 'team-bot')).toBe('SLACK_APP_TOKEN__team-bot');
  });

  it('getConfigValues + setConfigValues route through per-instance secret keys', async () => {
    const store = new Map<string, string>();
    const secrets = {
      get: (k: string) => store.get(k),
      set: (k: string, v: string) => { store.set(k, v); },
    };

    await setConfigValues(
      { enabled: true, SLACK_BOT_TOKEN: 'xoxp-personal-real-token', authMode: 'polling' },
      secrets,
      'personal',
    );
    expect(store.get('SLACK_BOT_TOKEN__personal')).toBe('xoxp-personal-real-token');
    expect(store.get('SLACK_BOT_TOKEN')).toBeUndefined();
    expect(loadConfig('personal').enabled).toBe(true);
    expect(loadConfig('personal').authMode).toBe('polling');

    // Default instance keeps the bare key for legacy compat.
    await setConfigValues(
      { SLACK_BOT_TOKEN: 'xoxb-bot-token' },
      secrets,
      'default',
    );
    expect(store.get('SLACK_BOT_TOKEN')).toBe('xoxb-bot-token');

    // Token mask round-trip: the masked '********' value is preserved (never overwrites the secret).
    await setConfigValues({ SLACK_BOT_TOKEN: '********' }, secrets, 'personal');
    expect(store.get('SLACK_BOT_TOKEN__personal')).toBe('xoxp-personal-real-token');

    const values = getConfigValues(secrets, 'personal');
    expect(values.SLACK_BOT_TOKEN).toBe('********');
    expect(values.authMode).toBe('polling');
    expect(values.enabled).toBe(true);
  });
});
