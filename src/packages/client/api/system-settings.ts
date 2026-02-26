/**
 * System Settings API Client
 * Handles API calls for system-level settings like global prompts
 */

import { getAuthToken, getApiBaseUrl } from '../utils/storage';

/**
 * Get the current system prompt
 */
export async function fetchSystemPrompt(): Promise<string> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/system-settings/prompt`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch system prompt: ${response.statusText}`);
  }

  const data = await response.json();
  return data.prompt || '';
}

/**
 * Update the system prompt
 */
export async function updateSystemPrompt(prompt: string): Promise<void> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/system-settings/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update system prompt: ${response.statusText}`);
  }
}

/**
 * Clear the system prompt
 */
export async function clearSystemPrompt(): Promise<void> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/system-settings/prompt`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to clear system prompt: ${response.statusText}`);
  }
}

/**
 * Get the current echo prompt setting
 */
export async function fetchEchoPromptSetting(): Promise<boolean> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/system-settings/echo-prompt`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch echo prompt setting: ${response.statusText}`);
  }
  const data = await response.json();
  return data.enabled || false;
}

/**
 * Update the echo prompt setting
 */
export async function updateEchoPromptSetting(enabled: boolean): Promise<void> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/system-settings/echo-prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update echo prompt setting: ${response.statusText}`);
  }
}

/**
 * Get the configured codex binary path
 */
export async function fetchCodexBinaryPath(): Promise<string> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/system-settings/codex-binary`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch codex binary path: ${response.statusText}`);
  }
  const data = await response.json();
  return data.path || '';
}

/**
 * Set the codex binary path
 */
export async function updateCodexBinaryPath(binaryPath: string): Promise<void> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/system-settings/codex-binary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ path: binaryPath }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update codex binary path: ${response.statusText}`);
  }
}
