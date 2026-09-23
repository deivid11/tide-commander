/**
 * Default Agent Skills Service
 *
 * Persists the per-installation list of skills pre-selected when a new agent is
 * spawned. The spawn modals read this list and use it as the initial selection;
 * the user can still add or remove skills for any individual agent.
 *
 * Only the pre-selection changes — agents that already exist keep whatever
 * skills they were given.
 *
 * Stored as SLUGS, not ids: slugs are stable for built-in skills (their ids are
 * derived from the slug anyway), readable in the JSON file, and portable across
 * installations through config export/import. Custom skills can be renamed,
 * which regenerates their slug, so `renameDefaultAgentSkillSlug` is called from
 * the skill service to keep the selection pointing at the same skill.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FACTORY_DEFAULT_AGENT_SKILL_SLUGS } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('DefaultAgentSkills');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const DEFAULT_AGENT_SKILLS_FILE = path.join(DATA_DIR, 'default-agent-skills.json');

interface DefaultAgentSkillsData {
  slugs: string[];
  updatedAt: number;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** The slugs shipped with Tide Commander, used until the install overrides them. */
export function getFactoryDefaultAgentSkillSlugs(): string[] {
  return [...FACTORY_DEFAULT_AGENT_SKILL_SLUGS];
}

/** True when this installation saved its own list (so the UI can offer "reset"). */
export function isDefaultAgentSkillsConfigured(): boolean {
  return fs.existsSync(DEFAULT_AGENT_SKILLS_FILE);
}

function readStored(): string[] | null {
  try {
    if (!fs.existsSync(DEFAULT_AGENT_SKILLS_FILE)) return null;
    const data: DefaultAgentSkillsData = JSON.parse(fs.readFileSync(DEFAULT_AGENT_SKILLS_FILE, 'utf-8'));
    if (!Array.isArray(data.slugs)) return null;
    return normalizeSlugs(data.slugs);
  } catch (error: any) {
    log.error(` Failed to load default agent skills: ${error.message}`);
    return null;
  }
}

/** Trim, drop non-strings and duplicates, preserve order. */
export function normalizeSlugs(slugs: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const slug of slugs) {
    if (typeof slug !== 'string') continue;
    const trimmed = slug.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * The effective list of skill slugs to pre-select for a new agent.
 *
 * An empty saved list is meaningful ("pre-select nothing") and is NOT replaced
 * by the factory default — only the absence of a saved list falls back.
 */
export function getDefaultAgentSkillSlugs(): string[] {
  ensureDataDir();
  const stored = readStored();
  return stored ?? getFactoryDefaultAgentSkillSlugs();
}

/** Save this installation's list. Pass `[]` to pre-select nothing. */
export function setDefaultAgentSkillSlugs(slugs: string[]): string[] {
  ensureDataDir();
  const normalized = normalizeSlugs(slugs);
  const data: DefaultAgentSkillsData = {
    slugs: normalized,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(DEFAULT_AGENT_SKILLS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    log.log(` Default agent skills updated: ${normalized.length ? normalized.join(', ') : '(none)'}`);
  } catch (error: any) {
    log.error(` Failed to save default agent skills: ${error.message}`);
    throw error;
  }
  return normalized;
}

/** Drop the override and go back to the factory list. */
export function resetDefaultAgentSkillSlugs(): void {
  ensureDataDir();
  try {
    if (fs.existsSync(DEFAULT_AGENT_SKILLS_FILE)) {
      fs.unlinkSync(DEFAULT_AGENT_SKILLS_FILE);
      log.log(' Default agent skills reset to the factory list');
    }
  } catch (error: any) {
    log.error(` Failed to reset default agent skills: ${error.message}`);
    throw error;
  }
}

/**
 * Follow a skill whose slug changed (a custom skill was renamed) so it stays in
 * the saved selection. No-op when nothing is saved or the old slug isn't in it.
 */
export function renameDefaultAgentSkillSlug(oldSlug: string, newSlug: string): void {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  const stored = readStored();
  if (!stored || !stored.includes(oldSlug)) return;
  setDefaultAgentSkillSlugs(stored.map(slug => (slug === oldSlug ? newSlug : slug)));
}
