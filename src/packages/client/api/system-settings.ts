/**
 * System Settings API Client
 * Handles API calls for system-level settings like global prompts
 */

import { getAuthToken } from '../utils/storage';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5174';

/**
 * Get the current system prompt
 */
export async function fetchSystemPrompt(): Promise<string> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE}/api/agents/system-settings/prompt`, {
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
  const response = await fetch(`${API_BASE}/api/agents/system-settings/prompt`, {
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
  const response = await fetch(`${API_BASE}/api/agents/system-settings/prompt`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to clear system prompt: ${response.statusText}`);
  }
}
