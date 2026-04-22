/**
 * OpenCode API Client
 * Wraps server endpoints that proxy the `opencode` CLI.
 */

import { apiUrl, authFetch } from '../utils/storage';

export interface OpencodeModelsResponse {
  models: string[];
  source: 'cli' | 'fallback';
  cached: boolean;
  fetchedAt: number;
}

export async function fetchOpencodeModels(refresh = false): Promise<OpencodeModelsResponse> {
  const url = apiUrl(`/api/agents/opencode/models${refresh ? '?refresh=true' : ''}`);
  const response = await authFetch(url);

  if (!response.ok) {
    let message = `Failed to load opencode models (HTTP ${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  return (await response.json()) as OpencodeModelsResponse;
}
