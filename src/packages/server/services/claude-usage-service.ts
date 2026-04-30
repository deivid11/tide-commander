/**
 * Claude Usage Service
 *
 * Surfaces the same data the Claude Code CLI shows in its `/usage` slash
 * command panel — but assembled from sources we can read non-interactively.
 *
 * The CLI's interactive `/usage` panel pulls weekly/session rate-limit
 * percentages from Anthropic's API at runtime. That request can't be replayed
 * server-side without driving the CLI's React TUI through a real PTY (the
 * slash-command interception only fires on real keystrokes; piping `/usage\r`
 * into stdin gets sent to the model as plain text instead). So this service
 * returns what's reliably available locally:
 *   - per-agent session totals (tokens + context) from Tide's own tracking
 *   - daily activity history from `~/.claude/stats-cache.json` (the file the
 *     CLI populates as it runs — same cache `/usage` reads from)
 * and a `cliHint` string the frontend can display so the user knows where to
 * look for the live rate-limit gauges.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Agent } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ClaudeUsage');

export interface DailyActivityEntry {
  date: string;            // YYYY-MM-DD
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
  recentDays: DailyActivityEntry[];   // newest first, capped at 14 entries
  statsCacheLastComputed: string | null;
  cliHint: string;
}

const STATS_CACHE_PATH = path.join(os.homedir(), '.claude', 'stats-cache.json');

interface StatsCacheFile {
  version?: number;
  lastComputedDate?: string;
  dailyActivity?: DailyActivityEntry[];
}

function readStatsCache(): StatsCacheFile | null {
  try {
    if (!fs.existsSync(STATS_CACHE_PATH)) return null;
    const raw = fs.readFileSync(STATS_CACHE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    log.warn(`Failed to read stats cache at ${STATS_CACHE_PATH}: ${err}`);
    return null;
  }
}

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function buildClaudeUsageSnapshot(agent: Agent): ClaudeUsageSnapshot {
  const cache = readStatsCache();
  const all = cache?.dailyActivity ?? [];
  // The cache writes oldest-first; sort newest-first for display.
  const sortedDesc = [...all].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const today = sortedDesc.find((e) => e.date === todayString()) ?? null;
  const recentDays = sortedDesc.slice(0, 14);

  return {
    provider: 'claude',
    fetchedAt: Date.now(),
    session: {
      tokensUsed: agent.tokensUsed ?? 0,
      contextUsed: agent.contextUsed ?? 0,
      contextLimit: agent.contextLimit ?? 200_000,
      taskCount: agent.taskCount ?? 0,
      lastActivity: agent.lastActivity ?? 0,
    },
    today,
    recentDays,
    statsCacheLastComputed: cache?.lastComputedDate ?? null,
    cliHint: 'Run /usage inside this agent\'s terminal to see live weekly and session rate-limit gauges (those live in the Claude Code TUI and aren\'t exposed as a non-interactive command).',
  };
}
