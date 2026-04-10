/**
 * Bulk Agent Management API Client
 * Handles bulk operations on multiple agents at once
 */

import { getAuthToken, getApiBaseUrl } from '../utils/storage';

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
  // Backend returns { deleted/stopped/cleared/moved: string[], failed: string[] }
  // Normalize to a common shape
  const failed: string[] = data.failed || [];
  const succeeded: string[] = data.deleted || data.stopped || data.cleared || data.moved || [];
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
