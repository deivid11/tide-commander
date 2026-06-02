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

export interface ClaudeTokenTotals {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  total: number;
}

export interface ClaudeUsageByAgentEntry {
  agentId: string;
  agentName: string;
  sessionId: string;
  model: string | null;
  cwd: string;
  requestCount: number;
  subagentRequestCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  // Rolled-up total: parent session + every subagent JSONL underneath.
  tokens: ClaudeTokenTotals;
  // Subagent portion of `tokens` above (Task/Agent tool spawns + Workflow runs).
  subagentTokens: ClaudeTokenTotals;
  percent: number;
}

export interface ClaudeUsageByAgentSummary {
  provider: 'claude';
  fetchedAt: number;
  since: string | null;
  until: string | null;
  source: 'claude-jsonl';
  totalTokens: number;
  entries: ClaudeUsageByAgentEntry[];
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

export async function fetchClaudeUsageByAgent(opts: { since?: number; until?: number } = {}): Promise<ClaudeUsageByAgentSummary> {
  const params = new URLSearchParams();
  if (typeof opts.since === 'number') params.set('since', String(opts.since));
  if (typeof opts.until === 'number') params.set('until', String(opts.until));
  const query = params.toString();
  const response = await authFetch(apiUrl(`/api/agents/usage-by-agent${query ? `?${query}` : ''}`));
  if (!response.ok) {
    let message = `Failed to fetch usage summary: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors — fall back to the status line
    }
    throw new Error(message);
  }
  return (await response.json()) as ClaudeUsageByAgentSummary;
}
