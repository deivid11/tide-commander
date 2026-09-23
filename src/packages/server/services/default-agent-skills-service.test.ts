/**
 * The spawn-modal default list is the only thing standing between a new agent
 * and a prompt full of skills nobody uses, so the fallback rules are pinned
 * here: absent file -> factory list, saved empty list -> actually empty.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TEST_DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-default-skills-'));
process.env.XDG_DATA_HOME = TEST_DATA_HOME;

const SETTINGS_FILE = path.join(TEST_DATA_HOME, 'tide-commander', 'default-agent-skills.json');

const {
  getDefaultAgentSkillSlugs,
  setDefaultAgentSkillSlugs,
  resetDefaultAgentSkillSlugs,
  getFactoryDefaultAgentSkillSlugs,
  isDefaultAgentSkillsConfigured,
  renameDefaultAgentSkillSlug,
  normalizeSlugs,
} = await import('./default-agent-skills-service.js');

beforeEach(() => {
  resetDefaultAgentSkillSlugs();
});

afterAll(() => {
  fs.rmSync(TEST_DATA_HOME, { recursive: true, force: true });
});

describe('default agent skills service', () => {
  it('falls back to the factory list when nothing is configured', () => {
    expect(isDefaultAgentSkillsConfigured()).toBe(false);
    expect(getDefaultAgentSkillSlugs()).toEqual(getFactoryDefaultAgentSkillSlugs());
  });

  it('ships with the noisy status skills turned off', () => {
    expect(getFactoryDefaultAgentSkillSlugs()).not.toContain('agent-tracking');
    expect(getFactoryDefaultAgentSkillSlugs()).not.toContain('task-label');
  });

  it('persists an installation-specific list', () => {
    setDefaultAgentSkillSlugs(['full-notifications', 'agent-tracking']);

    expect(isDefaultAgentSkillsConfigured()).toBe(true);
    expect(getDefaultAgentSkillSlugs()).toEqual(['full-notifications', 'agent-tracking']);
    expect(fs.existsSync(SETTINGS_FILE)).toBe(true);
  });

  it('treats a saved empty list as "pre-select nothing", not as unset', () => {
    setDefaultAgentSkillSlugs([]);

    expect(isDefaultAgentSkillsConfigured()).toBe(true);
    expect(getDefaultAgentSkillSlugs()).toEqual([]);
  });

  it('resets back to the factory list', () => {
    setDefaultAgentSkillSlugs([]);
    resetDefaultAgentSkillSlugs();

    expect(isDefaultAgentSkillsConfigured()).toBe(false);
    expect(getDefaultAgentSkillSlugs()).toEqual(getFactoryDefaultAgentSkillSlugs());
  });

  it('drops duplicates, blanks and non-strings while keeping order', () => {
    expect(normalizeSlugs(['b', ' a ', 'b', '', '  ', 7 as unknown as string, null])).toEqual(['b', 'a']);

    setDefaultAgentSkillSlugs(['streaming-exec', 'streaming-exec', ' agent-memory ']);
    expect(getDefaultAgentSkillSlugs()).toEqual(['streaming-exec', 'agent-memory']);
  });

  it('follows a renamed custom skill instead of silently dropping it', () => {
    setDefaultAgentSkillSlugs(['full-notifications', 'my-skill']);
    renameDefaultAgentSkillSlug('my-skill', 'my-renamed-skill');

    expect(getDefaultAgentSkillSlugs()).toEqual(['full-notifications', 'my-renamed-skill']);
  });

  it('ignores renames of skills that are not in the list', () => {
    setDefaultAgentSkillSlugs(['full-notifications']);
    renameDefaultAgentSkillSlug('other-skill', 'other-renamed');

    expect(getDefaultAgentSkillSlugs()).toEqual(['full-notifications']);
  });

  it('does not create a configuration just because a rename happened', () => {
    renameDefaultAgentSkillSlug('full-notifications', 'renamed');

    expect(isDefaultAgentSkillsConfigured()).toBe(false);
    expect(getDefaultAgentSkillSlugs()).toEqual(getFactoryDefaultAgentSkillSlugs());
  });

  it('recovers from a corrupt settings file by using the factory list', () => {
    setDefaultAgentSkillSlugs(['streaming-exec']);
    fs.writeFileSync(SETTINGS_FILE, 'not json', 'utf-8');

    expect(getDefaultAgentSkillSlugs()).toEqual(getFactoryDefaultAgentSkillSlugs());
  });
});
