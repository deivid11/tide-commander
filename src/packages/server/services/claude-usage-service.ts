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
import * as readline from 'readline';
import type { Agent } from '../../shared/types.js';
import { getClaudeProjectDir } from '../data/index.js';
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
  // Of the requestCount above, how many were attributable to subagent JSONLs
  // (Task/Agent tool spawns and Workflow-tool fan-outs).
  subagentRequestCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  // Rolled-up totals: parent session + every subagent JSONL underneath.
  tokens: ClaudeTokenTotals;
  // Breakdown of the subagent contribution included in `tokens` above.
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

const STATS_CACHE_PATH = path.join(os.homedir(), '.claude', 'stats-cache.json');

interface StatsCacheFile {
  version?: number;
  lastComputedDate?: string;
  dailyActivity?: DailyActivityEntry[];
}

interface JsonlUsage {
  input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  output_tokens?: unknown;
}

interface SessionUsageAccumulator {
  requestIds: Set<string>;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  tokens: ClaudeTokenTotals;
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

function toPositiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function parseBoundary(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  const asDate = Date.parse(value);
  return Number.isFinite(asDate) ? asDate : null;
}

function normalizeBoundary(value: unknown): string | null {
  const ms = parseBoundary(value);
  return ms === null ? null : new Date(ms).toISOString();
}

interface SessionJsonlPaths {
  main: string;
  // Every `agent-*.jsonl` under `<projectDir>/<sessionId>/subagents/**`.
  // Covers both Task/Agent tool spawns (flat under subagents/) and Workflow
  // tool runs (nested under subagents/workflows/<runId>/).
  subagents: string[];
}

function collectSubagentJsonlPaths(projectDir: string, sessionId: string): string[] {
  const root = path.join(projectDir, sessionId, 'subagents');
  if (!fs.existsSync(root)) return [];
  const results: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      log.warn(`Failed to read subagent dir ${dir}: ${err}`);
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        queue.push(full);
      } else if (e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) {
        results.push(full);
      }
    }
  }
  return results;
}

function findClaudeSessionFile(agent: Agent): SessionJsonlPaths | null {
  if (!agent.sessionId) return null;

  const tryProjectDir = (projectDir: string): SessionJsonlPaths | null => {
    const main = path.join(projectDir, `${agent.sessionId}.jsonl`);
    if (!fs.existsSync(main)) return null;
    return { main, subagents: collectSubagentJsonlPaths(projectDir, agent.sessionId!) };
  };

  const direct = tryProjectDir(getClaudeProjectDir(agent.cwd));
  if (direct) return direct;

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    if (!fs.existsSync(projectsDir)) return null;
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const found = tryProjectDir(path.join(projectsDir, entry.name));
      if (found) return found;
    }
  } catch (err) {
    log.warn(`Failed to search Claude session files: ${err}`);
  }

  return null;
}

function usageFromJsonLine(line: string): { requestId: string; timestamp: string; usage: JsonlUsage } | null {
  if (!line.includes('"usage"') || !line.includes('"requestId"')) return null;

  try {
    const parsed = JSON.parse(line) as Record<string, any>;
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : '';
    if (!requestId || requestId === '<synthetic>') return null;

    const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : '';
    if (!timestamp) return null;

    const usage = parsed.message?.usage ?? parsed.usage;
    if (!usage || typeof usage !== 'object') return null;

    return { requestId, timestamp, usage };
  } catch {
    return null;
  }
}

function addUsage(acc: SessionUsageAccumulator, requestId: string, timestamp: string, usage: JsonlUsage): void {
  if (acc.requestIds.has(requestId)) return;

  const input = toPositiveInteger(usage.input_tokens);
  const cacheCreation = toPositiveInteger(usage.cache_creation_input_tokens);
  const cacheRead = toPositiveInteger(usage.cache_read_input_tokens);
  const output = toPositiveInteger(usage.output_tokens);
  const total = input + cacheCreation + cacheRead + output;
  if (total <= 0) return;

  acc.requestIds.add(requestId);
  acc.tokens.input += input;
  acc.tokens.cacheCreation += cacheCreation;
  acc.tokens.cacheRead += cacheRead;
  acc.tokens.output += output;
  acc.tokens.total += total;

  if (!acc.firstTimestamp || timestamp < acc.firstTimestamp) {
    acc.firstTimestamp = timestamp;
  }
  if (!acc.lastTimestamp || timestamp > acc.lastTimestamp) {
    acc.lastTimestamp = timestamp;
  }
}

function createAccumulator(): SessionUsageAccumulator {
  return {
    requestIds: new Set(),
    firstTimestamp: null,
    lastTimestamp: null,
    tokens: {
      input: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
      total: 0,
    },
  };
}

async function scanFileIntoAccumulator(
  filePath: string,
  acc: SessionUsageAccumulator,
  sinceMs: number | null,
  untilMs: number | null,
): Promise<void> {
  // Fast-path: if `since` is set and the file hasn't been touched since then,
  // no line in it can be within the window — skip the read entirely. Safe
  // because Claude appends to these files; mtime tracks the latest line.
  if (sinceMs !== null) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < sinceMs) return;
    } catch {
      return;
    }
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    const parsed = usageFromJsonLine(line);
    if (!parsed) continue;

    const timestampMs = Date.parse(parsed.timestamp);
    if (!Number.isFinite(timestampMs)) continue;
    if (sinceMs !== null && timestampMs < sinceMs) continue;
    if (untilMs !== null && timestampMs > untilMs) continue;

    addUsage(acc, parsed.requestId, parsed.timestamp, parsed.usage);
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

export async function buildClaudeUsageByAgentSummary(
  agents: Agent[],
  opts: { since?: unknown; until?: unknown } = {}
): Promise<ClaudeUsageByAgentSummary> {
  const sinceMs = parseBoundary(opts.since);
  const untilMs = parseBoundary(opts.until);
  const entries: ClaudeUsageByAgentEntry[] = [];

  for (const agent of agents) {
    if (agent.provider !== 'claude' || !agent.sessionId) continue;

    const paths = findClaudeSessionFile(agent);
    if (!paths) continue;

    try {
      const mainAcc = createAccumulator();
      await scanFileIntoAccumulator(paths.main, mainAcc, sinceMs, untilMs);

      const subAcc = createAccumulator();
      for (const subPath of paths.subagents) {
        await scanFileIntoAccumulator(subPath, subAcc, sinceMs, untilMs);
      }

      const combinedTotal = mainAcc.tokens.total + subAcc.tokens.total;
      if (combinedTotal <= 0) continue;

      const combinedTokens: ClaudeTokenTotals = {
        input: mainAcc.tokens.input + subAcc.tokens.input,
        cacheCreation: mainAcc.tokens.cacheCreation + subAcc.tokens.cacheCreation,
        cacheRead: mainAcc.tokens.cacheRead + subAcc.tokens.cacheRead,
        output: mainAcc.tokens.output + subAcc.tokens.output,
        total: combinedTotal,
      };

      const earliest = (a: string | null, b: string | null): string | null =>
        a && b ? (a < b ? a : b) : (a ?? b);
      const latest = (a: string | null, b: string | null): string | null =>
        a && b ? (a > b ? a : b) : (a ?? b);

      entries.push({
        agentId: agent.id,
        agentName: agent.name,
        sessionId: agent.sessionId,
        model: agent.model ?? null,
        cwd: agent.cwd,
        requestCount: mainAcc.requestIds.size + subAcc.requestIds.size,
        subagentRequestCount: subAcc.requestIds.size,
        firstTimestamp: earliest(mainAcc.firstTimestamp, subAcc.firstTimestamp),
        lastTimestamp: latest(mainAcc.lastTimestamp, subAcc.lastTimestamp),
        tokens: combinedTokens,
        subagentTokens: { ...subAcc.tokens },
        percent: 0,
      });
    } catch (err) {
      log.warn(`Failed to scan Claude usage for agent ${agent.name} (${agent.id}): ${err}`);
    }
  }

  entries.sort((a, b) => b.tokens.total - a.tokens.total);
  const totalTokens = entries.reduce((sum, entry) => sum + entry.tokens.total, 0);
  for (const entry of entries) {
    entry.percent = totalTokens > 0
      ? Number(((entry.tokens.total / totalTokens) * 100).toFixed(1))
      : 0;
  }

  return {
    provider: 'claude',
    fetchedAt: Date.now(),
    since: normalizeBoundary(opts.since),
    until: normalizeBoundary(opts.until),
    source: 'claude-jsonl',
    totalTokens,
    entries,
  };
}
