/**
 * Provider Usage API client — pairs with
 * `src/packages/server/routes/agents.ts` (`GET /api/agents/:id/usage`).
 *
 * Claude: local tracking + ~/.claude/stats-cache.json + Anthropic OAuth
 * session/weekly rate-limit gauges (CLI `/usage`).
 * Grok: local tracking + CLI chat-proxy billing/credit gauges (CLI `/usage`).
 * Pi: subscriptions loaded by Pi plus limits for the active model provider.
 * When a live fetch fails, `rateLimits` is null and `cliHint` is shown.
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

export interface ClaudeRateLimitWindow {
  utilization: number;   // 0-100 percent used
  resetsAt: string;      // ISO timestamp when the window resets
  /** Absolute credits used (Grok billing gauges). */
  used?: number;
  /** Absolute credit limit (Grok billing gauges). */
  limit?: number;
}

export interface ClaudeRateLimits {
  fiveHour: ClaudeRateLimitWindow | null;       // "Current session" in the CLI
  sevenDay: ClaudeRateLimitWindow | null;       // "Current week (all models)"
  sevenDayOpus: ClaudeRateLimitWindow | null;   // "Current week (Opus only)"
  sevenDayFable: ClaudeRateLimitWindow | null;  // "Current week (Fable)"
  /** @deprecated Compatibility alias. */
  sevenDaySonnet: ClaudeRateLimitWindow | null;
}

export interface ClaudeUsageSnapshot {
  provider: 'claude';
  fetchedAt: number;
  session: ClaudeUsageSession;
  today: DailyActivityEntry | null;
  recentDays: DailyActivityEntry[];
  statsCacheLastComputed: string | null;
  rateLimits: ClaudeRateLimits | null;
  rateLimitsError: string | null;
  cliHint: string;
}

export interface GrokRateLimits {
  /** Rolling weekly usage allotment (CLI "Weekly limit"). */
  weekly: ClaudeRateLimitWindow | null;
  /** Calendar / plan monthly allotment (CLI "Monthly limit"). */
  monthly: ClaudeRateLimitWindow | null;
  /** Optional pay-as-you-go / on-demand cap when enabled. */
  onDemand: ClaudeRateLimitWindow | null;
}

export interface GrokUsageSnapshot {
  provider: 'grok';
  fetchedAt: number;
  session: ClaudeUsageSession;
  rateLimits: GrokRateLimits | null;
  rateLimitsError: string | null;
  cliHint: string;
}

export interface CodexUsageSnapshot {
  provider: 'codex';
  fetchedAt: number;
  rateLimits: {
    daily: ClaudeRateLimitWindow | null;
    weekly: ClaudeRateLimitWindow | null;
  } | null;
  rateLimitsError: string | null;
  cliHint: string;
}

export interface PiLoadedSubscription {
  provider: string;
  label: string;
  active: boolean;
}

export type PiQuotaWindowKey =
  | 'session'
  | 'five-hour'
  | 'daily'
  | 'weekly'
  | 'weekly-opus'
  | 'weekly-fable'
  | 'monthly'
  | 'on-demand';

export interface PiQuotaWindow extends ClaudeRateLimitWindow {
  key: PiQuotaWindowKey;
}

export interface PiUsageSnapshot {
  provider: 'pi';
  fetchedAt: number;
  modelProvider: string | null;
  credentialType: 'oauth' | 'api_key' | null;
  subscriptions: PiLoadedSubscription[];
  session: ClaudeUsageSession;
  /** Anthropic compatibility payload used by older servers. */
  rateLimits: ClaudeRateLimits | null;
  /** Active-account windows for providers with live subscription usage APIs. */
  quotaWindows: PiQuotaWindow[];
  rateLimitsError: string | null;
  cliHint: string;
}

export type ProviderUsageSnapshot = ClaudeUsageSnapshot | CodexUsageSnapshot | GrokUsageSnapshot | PiUsageSnapshot;

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

export interface ClaudeUsageByDayAgentEntry {
  agentId: string;
  agentName: string;
  tokens: ClaudeTokenTotals;
  requestCount: number;
}

export interface ClaudeUsageByDayEntry {
  date: string;
  totalTokens: number;
  requestCount: number;
  agents: ClaudeUsageByDayAgentEntry[];
}

export interface ClaudeUsageByDaySummary {
  provider: 'claude';
  fetchedAt: number;
  since: string | null;
  until: string | null;
  source: 'claude-jsonl';
  days: ClaudeUsageByDayEntry[];
}

export async function fetchClaudeUsage(agentId: string): Promise<ClaudeUsageSnapshot> {
  const snapshot = await fetchProviderUsage(agentId);
  if (snapshot.provider !== 'claude') {
    throw new Error(`Expected Claude usage snapshot, got ${snapshot.provider}`);
  }
  return snapshot;
}

/** Fetch the provider/subscription usage snapshot for an agent. */
export async function fetchProviderUsage(agentId: string): Promise<ProviderUsageSnapshot> {
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
  return (await response.json()) as ProviderUsageSnapshot;
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

export async function fetchClaudeUsageByDay(opts: { since?: number; until?: number; days?: number } = {}): Promise<ClaudeUsageByDaySummary> {
  const params = new URLSearchParams();
  if (typeof opts.since === 'number') params.set('since', String(opts.since));
  if (typeof opts.until === 'number') params.set('until', String(opts.until));
  if (typeof opts.days === 'number') params.set('days', String(opts.days));
  const query = params.toString();
  const response = await authFetch(apiUrl(`/api/agents/usage-by-day${query ? `?${query}` : ''}`));
  if (!response.ok) {
    let message = `Failed to fetch daily usage summary: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors — fall back to the status line
    }
    throw new Error(message);
  }
  return (await response.json()) as ClaudeUsageByDaySummary;
}
