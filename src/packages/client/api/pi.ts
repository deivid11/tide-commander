/**
 * Pi API Client
 * Wraps server endpoints that proxy the `pi` CLI.
 */

import { apiUrl, authFetch } from '../utils/storage';

export interface PiModelsResponse {
  models: string[];
  source: 'cli';
  cached: boolean;
  fetchedAt: number;
}

export async function fetchPiModels(refresh = false): Promise<PiModelsResponse> {
  const url = apiUrl(`/api/agents/pi/models${refresh ? '?refresh=true' : ''}`);
  const response = await authFetch(url);

  if (!response.ok) {
    let message = `Failed to load pi models (HTTP ${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  return (await response.json()) as PiModelsResponse;
}
