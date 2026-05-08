import { describe, it, expect, beforeEach } from 'vitest';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from '../../data/index.js';
import {
  addInstance,
  getInstanceMeta,
  listInstanceMetas,
  removeInstance,
  renameInstance,
  resetManifestCache,
  validateInstanceId,
} from './slack-instance-manifest.js';
import { saveConfig, deleteConfig } from './slack-config.js';

// Files this suite touches inside the shared XDG sandbox (test-setup.ts).
const TRACKED_FILES = [
  'slack-instances.json',
  'slack-config.json',
  'slack-config-personal.json',
  'slack-config-alpha.json',
  'slack-config-beta.json',
  'slack-config-my-account.json',
];

function wipeState(): void {
  resetManifestCache();
  const dir = getDataDir();
  for (const f of TRACKED_FILES) {
    const p = path.join(dir, f);
    try {
      if (fssync.existsSync(p)) fssync.unlinkSync(p);
    } catch {
      // best-effort
    }
  }
}

beforeEach(wipeState);

describe('slack-instance-manifest', () => {
  it('seeds the default instance on first read', () => {
    const list = listInstanceMetas();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('default');
    expect(list[0].label).toBe('Default');
  });

  it('addInstance creates a new instance and listInstanceMetas returns it', () => {
    addInstance('personal', 'Personal');
    const list = listInstanceMetas();
    expect(list.map((i) => i.id)).toEqual(['default', 'personal']);
    expect(list[1].label).toBe('Personal');
  });

  it('rejects invalid instance ids', () => {
    expect(validateInstanceId('')).toMatch(/required/i);
    expect(validateInstanceId('UPPER')).toMatch(/lowercase/);
    expect(validateInstanceId('-leading')).toMatch(/lowercase/);
    expect(validateInstanceId('with space')).toMatch(/lowercase/);
    expect(validateInstanceId('a'.repeat(40))).toMatch(/lowercase/);
    expect(validateInstanceId('default')).toBeNull();
    expect(validateInstanceId('team-bot')).toBeNull();
  });

  it('rejects duplicate ids', () => {
    addInstance('alpha', 'Alpha');
    expect(() => addInstance('alpha', 'Alpha 2')).toThrow(/already exists/);
  });

  it('refuses to delete the default instance', () => {
    expect(() => removeInstance('default')).toThrow(/Cannot remove the default/);
  });

  it('renameInstance updates the label but not the id', () => {
    addInstance('personal', 'Personal');
    renameInstance('personal', 'My Account');
    expect(getInstanceMeta('personal')?.label).toBe('My Account');
  });

  it('removeInstance drops the per-instance config file', () => {
    addInstance('personal', 'Personal');
    saveConfig({ enabled: true, status: 'disconnected' }, 'personal');
    const fpath = path.join(getDataDir(), 'slack-config-personal.json');
    expect(fssync.existsSync(fpath)).toBe(true);
    removeInstance('personal');
    expect(fssync.existsSync(fpath)).toBe(false);
  });

  it('persists across reloads (file round-trip)', () => {
    addInstance('alpha', 'Alpha');
    addInstance('beta', 'Beta');

    // Drop the in-memory cache and re-read from disk.
    resetManifestCache();
    const list = listInstanceMetas();
    expect(list.map((i) => i.id).sort()).toEqual(['alpha', 'beta', 'default']);
  });

  it('treats a corrupt manifest file as empty (default-only) rather than throwing', () => {
    const fpath = path.join(getDataDir(), 'slack-instances.json');
    fssync.writeFileSync(fpath, '{ this is not json', 'utf-8');
    resetManifestCache();
    const list = listInstanceMetas();
    expect(list.map((i) => i.id)).toEqual(['default']);
  });

  // Sanity: cleanup helper itself is idempotent (preventing flake from earlier tests).
  it('wipeState is idempotent', () => {
    deleteConfig('personal'); // no-op when not present
    wipeState();
    expect(listInstanceMetas().map((i) => i.id)).toEqual(['default']);
  });
});
