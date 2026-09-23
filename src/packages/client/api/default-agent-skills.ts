/**
 * Default Agent Skills — the skills pre-selected when the spawn modal opens.
 *
 * The list lives on the server (one setting per installation, shared by every
 * browser and the phone app), so this module keeps a small cache plus a
 * subscription so the spawn modals pick up an edit made in Settings without a
 * reload. Until the first fetch resolves — and if it fails — the factory list
 * from the shared constant is used, so the modal is never empty by accident.
 */

import { useEffect, useState } from 'react';
import { FACTORY_DEFAULT_AGENT_SKILL_SLUGS } from '../../shared/types';
import { getAuthToken, getApiBaseUrl } from '../utils/storage';

export interface DefaultAgentSkills {
  /** Slugs pre-selected for a new agent. Empty is valid: pre-select nothing. */
  slugs: string[];
  /** The list Tide Commander ships with, for the "Reset" affordance. */
  factoryDefault: string[];
  /** True once this installation saved its own list. */
  configured: boolean;
  /** False while this is still the local factory fallback, not a server answer. */
  loaded: boolean;
}

const FACTORY: DefaultAgentSkills = {
  slugs: [...FACTORY_DEFAULT_AGENT_SKILL_SLUGS],
  factoryDefault: [...FACTORY_DEFAULT_AGENT_SKILL_SLUGS],
  configured: false,
  loaded: false,
};

let cache: DefaultAgentSkills = FACTORY;
let inFlight: Promise<DefaultAgentSkills> | null = null;

const listeners = new Set<(value: DefaultAgentSkills) => void>();

function publish(value: DefaultAgentSkills): DefaultAgentSkills {
  cache = value;
  for (const listener of listeners) listener(value);
  return value;
}

function normalize(data: any): DefaultAgentSkills {
  return {
    slugs: Array.isArray(data?.slugs) ? data.slugs.filter((s: unknown) => typeof s === 'string') : FACTORY.slugs,
    factoryDefault: Array.isArray(data?.factoryDefault)
      ? data.factoryDefault.filter((s: unknown) => typeof s === 'string')
      : FACTORY.factoryDefault,
    configured: Boolean(data?.configured),
    loaded: true,
  };
}

function endpoint(): string {
  return `${getApiBaseUrl()}/api/agents/system-settings/default-agent-skills`;
}

function authHeaders(): Record<string, string> {
  return { 'Authorization': `Bearer ${getAuthToken()}` };
}

/** The last known list. Synchronous, so the spawn modal can read it on open. */
export function getCachedDefaultAgentSkills(): DefaultAgentSkills {
  return cache;
}

/** Fetch the list from the server, de-duping concurrent callers. */
export async function fetchDefaultAgentSkills(): Promise<DefaultAgentSkills> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch(endpoint(), { headers: authHeaders() });
      if (!response.ok) {
        throw new Error(`Failed to fetch default agent skills: ${response.statusText}`);
      }
      return publish(normalize(await response.json()));
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Replace the list. Pass `[]` to pre-select nothing. */
export async function updateDefaultAgentSkills(slugs: string[]): Promise<DefaultAgentSkills> {
  const response = await fetch(endpoint(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ slugs }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update default agent skills: ${response.statusText}`);
  }
  return publish(normalize(await response.json()));
}

/** Drop this installation's list and go back to the factory one. */
export async function resetDefaultAgentSkills(): Promise<DefaultAgentSkills> {
  const response = await fetch(endpoint(), { method: 'DELETE', headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to reset default agent skills: ${response.statusText}`);
  }
  return publish(normalize(await response.json()));
}

/**
 * The live list, refreshed on mount so a change made elsewhere (another tab,
 * the phone) is picked up the next time a component using it mounts.
 */
export function useDefaultAgentSkills(): DefaultAgentSkills {
  const [value, setValue] = useState<DefaultAgentSkills>(cache);

  useEffect(() => {
    listeners.add(setValue);
    // Keep the cached value on failure — the factory list is a fine fallback.
    fetchDefaultAgentSkills().catch(() => {});
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}

/**
 * Map configured slugs onto the ids of the skills that actually exist here.
 * Slugs with no matching (enabled) skill are simply skipped — a default can
 * name a skill that was deleted, or one that lives on another installation.
 */
export function resolveDefaultSkillIds(
  skills: ReadonlyArray<{ id: string; slug: string }>,
  slugs: ReadonlyArray<string>
): string[] {
  const wanted = new Set(slugs);
  return skills.filter(skill => wanted.has(skill.slug)).map(skill => skill.id);
}
