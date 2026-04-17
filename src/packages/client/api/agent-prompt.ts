/**
 * Agent Prompt API Client
 * Fetches the composed system prompt that is injected into a given agent.
 */

import { getApiBaseUrl, getAuthToken } from '../utils/storage';

export async function fetchAgentInjectedPrompt(agentId: string): Promise<string> {
  const token = getAuthToken();
  const response = await fetch(
    `${getApiBaseUrl()}/api/agents/${encodeURIComponent(agentId)}/injected-prompt`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch injected prompt: ${response.statusText}`);
  }

  const data = (await response.json()) as { prompt?: string };
  return data.prompt || '';
}
