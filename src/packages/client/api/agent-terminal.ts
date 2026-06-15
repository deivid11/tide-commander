/**
 * Agent terminal API — start/stop the ttyd that attaches to an interactive-TUI
 * agent's tmux session (Classic TUI view mode).
 */
import { getAuthToken, getApiBaseUrl } from '../utils/storage';

/**
 * Start (or reuse) the agent's interactive terminal. Returns the proxy URL to
 * pass to <TerminalEmbed>. Throws with a readable message on failure.
 */
export async function startAgentTerminal(agentId: string): Promise<{ url: string }> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/agents/${agentId}/terminal`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to start terminal (${response.status})`);
  }
  return response.json();
}

/** Stop the agent's terminal viewer (the tmux session keeps running). */
export async function stopAgentTerminal(agentId: string): Promise<void> {
  const token = getAuthToken();
  await fetch(`${getApiBaseUrl()}/api/agents/${agentId}/terminal`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}
