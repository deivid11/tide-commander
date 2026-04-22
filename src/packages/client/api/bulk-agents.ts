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
export async function bulkChangeModel(
  agentIds: string[],
  provider: 'claude' | 'codex' | 'opencode',
  model: string,
  effort?: ClaudeEffort | null
): Promise<BulkActionResult> {
  const body: Record<string, unknown> = { agentIds, provider, model };
  if (provider === 'claude' && effort !== undefined) {
    body.effort = effort;
  }
  return postBulkAction('/api/agents/bulk/change-model', body);
}
