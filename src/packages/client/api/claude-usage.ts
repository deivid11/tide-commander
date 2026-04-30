/**
 * Claude Usage API client — pairs with
 * `src/packages/server/routes/agents.ts` (`GET /api/agents/:id/usage`).
 *
 * Returns the snapshot the server assembles from local data sources (agent
 * tracking + ~/.claude/stats-cache.json). The CLI's interactive `/usage`
 * panel pulls live rate-limit gauges from Anthropic's API; that part isn't
 * scrapeable non-interactively, so the snapshot includes a `cliHint` we
 * surface in the modal instead.
 */

import { authFetch, apiUrl } from '../utils/storage';

export interface DailyActivityEntry {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface ClaudeUsageSession {
  tokensUsed: number;
  contextUsed: number;
  contextLimit: number;
  taskCount: number;
  lastActivity: number;
}

export interface ClaudeUsageSnapshot {
  provider: 'claude';
  fetchedAt: number;
  session: ClaudeUsageSession;
  today: DailyActivityEntry | null;
  recentDays: DailyActivityEntry[];
  statsCacheLastComputed: string | null;
  cliHint: string;
}

export async function fetchClaudeUsage(agentId: string): Promise<ClaudeUsageSnapshot> {
  const response = await authFetch(apiUrl(`/api/agents/${encodeURIComponent(agentId)}/usage`));
  if (!response.ok) {
    let message = `Failed to fetch usage: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors — fall back to the status line
    }
    throw new Error(message);
  }
  return (await response.json()) as ClaudeUsageSnapshot;
}
