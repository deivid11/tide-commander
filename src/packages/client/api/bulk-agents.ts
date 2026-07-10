/**
 * Bulk Agent Management API Client
 * Handles bulk operations on multiple agents at once
 */

import { getAuthToken, getApiBaseUrl } from '../utils/storage';
import type { ClaudeEffort } from '../../shared/agent-types';

export interface BulkActionResult {
  succeeded: string[];
  failed: string[];
}

export interface BulkSkillActionResult {
  skillId: string;
  /** Agents whose assignment actually changed (added on `add`, removed on `remove`). */
  updated: string[];
  /** For `add`: agents that already had the skill (no-op). */
  alreadyHad?: string[];
  /** For `remove`: agents that did not have the skill (no-op). */
  didNotHave?: string[];
  /** Agent IDs that could not be found. */
  failed: string[];
}

export interface BulkAddSkillsPerSkill {
  skillId: string;
  skillName: string;
  updated: string[];
  alreadyHad: string[];
  failed: string[];
}
export interface BulkAddSkillsResult {
  skillIds: string[];
  results: BulkAddSkillsPerSkill[];
}

export interface BulkRemoveSkillsPerSkill {
  skillId: string;
  skillName: string;
  updated: string[];
  didNotHave: string[];
  failed: string[];
}
export interface BulkRemoveSkillsResult {
  skillIds: string[];
  results: BulkRemoveSkillsPerSkill[];
}

async function postBulkAction(endpoint: string, body: Record<string, unknown>): Promise<BulkActionResult> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': token,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Bulk action failed: ${response.statusText}`);
  }

  const data = await response.json();
  // Backend returns { deleted/stopped/cleared/moved/changed: string[], failed: string[] }
  // Normalize to a common shape
  const failed: string[] = data.failed || [];
  const succeeded: string[] = data.deleted || data.stopped || data.cleared || data.moved || data.changed || [];
  return { succeeded, failed };
}

/**
 * Delete multiple agents at once
 */
export async function bulkDeleteAgents(agentIds: string[]): Promise<BulkActionResult> {
  return postBulkAction('/api/agents/bulk/delete', { agentIds });
}

/**
 * Stop multiple agents at once
 */
export async function bulkStopAgents(agentIds: string[]): Promise<BulkActionResult> {
  return postBulkAction('/api/agents/bulk/stop', { agentIds });
}

/**
 * Clear context for multiple agents at once
 */
export async function bulkClearContext(agentIds: string[]): Promise<BulkActionResult> {
  return postBulkAction('/api/agents/bulk/clear-context', { agentIds });
}

/**
 * Move multiple agents to a specific area (or unassign with null)
 */
export async function bulkMoveToArea(agentIds: string[], areaId: string | null): Promise<BulkActionResult> {
  return postBulkAction('/api/agents/bulk/move-area', { agentIds, areaId });
}

/**
 * Change model for multiple agents. Clears session/context so the new model takes effect.
 * For Claude provider, optionally sets reasoning effort level too (pass `null` to clear
 * an existing effort back to default; omit/undefined leaves it unchanged).
 */
/**
 * Add one or more skills to multiple agents. Idempotent — agents that already
 * have a given skill come back under that skill's `alreadyHad` list.
 */
export async function bulkAddSkills(agentIds: string[], skillIds: string[]): Promise<BulkAddSkillsResult> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/bulk/skills/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: JSON.stringify({ agentIds, skillIds }),
  });
  if (!response.ok) {
    throw new Error(`Bulk add-skill failed: ${response.statusText}`);
  }
  return (await response.json()) as BulkAddSkillsResult;
}

/**
 * Remove one or more skills from multiple agents. Idempotent — agents that
 * didn't have a given skill come back under that skill's `didNotHave` list.
 */
export async function bulkRemoveSkills(agentIds: string[], skillIds: string[]): Promise<BulkRemoveSkillsResult> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/bulk/skills/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: JSON.stringify({ agentIds, skillIds }),
  });
  if (!response.ok) {
    throw new Error(`Bulk remove-skill failed: ${response.statusText}`);
  }
  return (await response.json()) as BulkRemoveSkillsResult;
}

export async function bulkChangeModel(
  agentIds: string[],
  provider: 'claude' | 'codex' | 'opencode' | 'grok',
  model: string,
  effort?: ClaudeEffort | null
): Promise<BulkActionResult> {
  const body: Record<string, unknown> = { agentIds, provider, model };
  if ((provider === 'claude' || provider === 'grok') && effort !== undefined) {
    body.effort = effort;
  }
  return postBulkAction('/api/agents/bulk/change-model', body);
}
