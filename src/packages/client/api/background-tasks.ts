/**
 * Background-task output API client.
 * Backs the live hover panel of the BackgroundTasksRail — see
 * GET /api/agents/:id/background-tasks/:key/output.
 */

import { apiUrl, authFetch } from '../utils/storage';

export interface BackgroundTaskOutput {
  exists: boolean;
  content: string;
  size: number;
  truncated?: boolean;
  mtimeMs?: number;
  outputFile?: string;
}

/** Tail a background task's output file (last `tail` bytes, whole lines). */
export async function fetchBackgroundTaskOutput(
  agentId: string,
  taskKey: string,
  tail = 2048
): Promise<BackgroundTaskOutput> {
  const response = await authFetch(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}/background-tasks/${encodeURIComponent(taskKey)}/output?tail=${tail}`)
  );
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to fetch task output: ${response.statusText}`);
  }
  return await response.json();
}
