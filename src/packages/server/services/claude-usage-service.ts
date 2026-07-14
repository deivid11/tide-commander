/**
 * Claude Usage Service
 *
 * Surfaces the same data the Claude Code CLI shows in its `/usage` slash
 * command panel — assembled from local sources plus the same Anthropic
 * endpoint the CLI's TUI queries for its rate-limit gauges:
 *   - per-agent session totals (tokens + context) from Tide's own tracking
 *   - daily activity history from `~/.claude/stats-cache.json` (the file the
 *     CLI populates as it runs — same cache `/usage` reads from)
 *   - live session/weekly rate-limit gauges from
 *     `https://api.anthropic.com/api/oauth/usage`, authenticated with the
 *     CLI's own OAuth token in `~/.claude/.credentials.json`
 * When the rate-limit fetch fails (no credentials, expired token, offline),
 * the snapshot still carries the local data and a `cliHint` string the
 * frontend shows as fallback.
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

export interface ClaudeRateLimitWindow {
  utilization: number;   // 0-100 percent used
  resetsAt: string;      // ISO timestamp when the window resets
}

export interface ClaudeRateLimits {
  fiveHour: ClaudeRateLimitWindow | null;       // "Current session" in the CLI
  sevenDay: ClaudeRateLimitWindow | null;       // "Current week (all models)"
  sevenDayOpus: ClaudeRateLimitWindow | null;   // "Current week (Opus only)"
  sevenDayFable: ClaudeRateLimitWindow | null;  // CLI "Current week (Fable)"
  /** @deprecated Compatibility alias for clients older than Claude Code's Fable label. */
  sevenDaySonnet: ClaudeRateLimitWindow | null;
}

export interface ClaudeUsageSnapshot {
  provider: 'claude';
  fetchedAt: number;
  session: ClaudeUsageSession;
  today: DailyActivityEntry | null;
  recentDays: DailyActivityEntry[];   // newest first, capped at 8 entries
  statsCacheLastComputed: string | null;
  rateLimits: ClaudeRateLimits | null;
  rateLimitsError: string | null;
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

const STATS_CACHE_PATH = path.join(os.homedir(), '.claude', 'stats-cache.json');
const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_USAGE_TIMEOUT_MS = 5_000;

// --- Local throttling of the Anthropic OAuth usage endpoint ------------------
//
// The rate-limit gauges are ACCOUNT-WIDE — identical no matter which agent asks —
// so a single cached value serves every agent and every client poll. Before this
// throttle, each hovered agent chip / open usage panel fired its own request to
// Anthropic and the endpoint started returning 429. We (1) reuse a good result
// for a TTL, (2) dedupe concurrent fetches into ONE network request
// (single-flight), and (3) back off hard when Anthropic rate-limits us — honoring
// its `Retry-After` header when present.
const RATE_LIMIT_CACHE_TTL_MS = 60_000;         // reuse a good result for a minute
const RATE_LIMIT_429_BACKOFF_MS = 5 * 60_000;   // after a 429, don't retry for 5 min
const RATE_LIMIT_ERROR_BACKOFF_MS = 30_000;     // after any other failure, cool down 30s

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

interface DailyUsageBucket {
  requestCount: number;
  tokens: ClaudeTokenTotals;
}

interface DailyUsageAccumulator {
  requestIds: Set<string>;
  buckets: Map<string, DailyUsageBucket>;
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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
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

function createTokenTotals(): ClaudeTokenTotals {
  return {
    input: 0,
    cacheCreation: 0,
    cacheRead: 0,
    output: 0,
    total: 0,
  };
}

function createAccumulator(): SessionUsageAccumulator {
  return {
    requestIds: new Set(),
    firstTimestamp: null,
    lastTimestamp: null,
    tokens: createTokenTotals(),
  };
}

function createDailyAccumulator(): DailyUsageAccumulator {
  return {
    requestIds: new Set(),
    buckets: new Map(),
  };
}

function addTokenTotals(target: ClaudeTokenTotals, source: ClaudeTokenTotals): void {
  target.input += source.input;
  target.cacheCreation += source.cacheCreation;
  target.cacheRead += source.cacheRead;
  target.output += source.output;
  target.total += source.total;
}

function localDateKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function startOfLocalDay(timestampMs: number): number {
  const d = new Date(timestampMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addUsageToDailyAccumulator(acc: DailyUsageAccumulator, requestId: string, timestamp: string, usage: JsonlUsage): void {
  if (acc.requestIds.has(requestId)) return;

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return;

  const input = toPositiveInteger(usage.input_tokens);
  const cacheCreation = toPositiveInteger(usage.cache_creation_input_tokens);
  const cacheRead = toPositiveInteger(usage.cache_read_input_tokens);
  const output = toPositiveInteger(usage.output_tokens);
  const total = input + cacheCreation + cacheRead + output;
  if (total <= 0) return;

  acc.requestIds.add(requestId);

  const date = localDateKey(timestampMs);
  const bucket = acc.buckets.get(date) ?? {
    requestCount: 0,
    tokens: createTokenTotals(),
  };
  bucket.requestCount += 1;
  bucket.tokens.input += input;
  bucket.tokens.cacheCreation += cacheCreation;
  bucket.tokens.cacheRead += cacheRead;
  bucket.tokens.output += output;
  bucket.tokens.total += total;
  acc.buckets.set(date, bucket);
}

async function scanFileUsageRecords(
  filePath: string,
  sinceMs: number | null,
  untilMs: number | null,
  onRecord: (requestId: string, timestamp: string, usage: JsonlUsage) => void,
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

    onRecord(parsed.requestId, parsed.timestamp, parsed.usage);
  }
}

async function scanFileIntoAccumulator(
  filePath: string,
  acc: SessionUsageAccumulator,
  sinceMs: number | null,
  untilMs: number | null,
): Promise<void> {
  await scanFileUsageRecords(filePath, sinceMs, untilMs, (requestId, timestamp, usage) => {
    addUsage(acc, requestId, timestamp, usage);
  });
}

async function scanFileIntoDailyAccumulator(
  filePath: string,
  acc: DailyUsageAccumulator,
  sinceMs: number | null,
  untilMs: number | null,
): Promise<void> {
  await scanFileUsageRecords(filePath, sinceMs, untilMs, (requestId, timestamp, usage) => {
    addUsageToDailyAccumulator(acc, requestId, timestamp, usage);
  });
}

function parseRateLimitWindow(value: unknown): ClaudeRateLimitWindow | null {
  if (!value || typeof value !== 'object') return null;
  const window = value as Record<string, unknown>;
  if (typeof window.utilization !== 'number' || !Number.isFinite(window.utilization)) return null;
  if (typeof window.resets_at !== 'string' || window.resets_at === '') return null;
  return {
    utilization: window.utilization,
    resetsAt: window.resets_at,
  };
}

// One entry of the endpoint's `limits` array, which carries `percent` where the
// legacy top-level windows carry `utilization`.
function parseLimitEntry(entry: Record<string, unknown>): ClaudeRateLimitWindow | null {
  if (typeof entry.percent !== 'number' || !Number.isFinite(entry.percent)) return null;
  if (typeof entry.resets_at !== 'string' || entry.resets_at === '') return null;
  return { utilization: entry.percent, resetsAt: entry.resets_at };
}

// `scope.model.display_name` for a `weekly_scoped` entry ("Fable", "Opus", ...).
// Its `id` is null, so the display name is the only model discriminator.
function parseScopedModelName(entry: Record<string, unknown>): string | null {
  const scope = entry.scope as Record<string, unknown> | null | undefined;
  const model = scope?.model as Record<string, unknown> | null | undefined;
  const name = model?.display_name;
  return typeof name === 'string' && name !== '' ? name.toLowerCase() : null;
}

/**
 * Read the gauges out of the endpoint's `limits` array — its current shape, and
 * the only one that still carries the per-model weekly allowances: the legacy
 * top-level `seven_day_opus` / `seven_day_sonnet` keys now come back null even
 * while those gauges are live in the CLI's `/usage` panel.
 */
function parseLimitsArray(body: Record<string, unknown>): Partial<ClaudeRateLimits> {
  const parsed: Partial<ClaudeRateLimits> = {};
  if (!Array.isArray(body.limits)) return parsed;

  for (const raw of body.limits) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const window = parseLimitEntry(entry);
    if (!window) continue;

    if (entry.kind === 'session') {
      parsed.fiveHour = window;
    } else if (entry.kind === 'weekly_all') {
      parsed.sevenDay = window;
    } else if (entry.kind === 'weekly_scoped') {
      // Substring match so a renamed "Claude Fable 5" still lands on its gauge.
      const model = parseScopedModelName(entry);
      if (model?.includes('fable')) parsed.sevenDayFable = window;
      else if (model?.includes('opus')) parsed.sevenDayOpus = window;
    }
  }
  return parsed;
}

export interface RateLimitFetchResult {
  rateLimits: ClaudeRateLimits | null;
  error: string | null;
  // HTTP status when Anthropic responded (used to pick the backoff length).
  status?: number;
  // Parsed `Retry-After` header (ms from now) when the endpoint sent one.
  retryAfterMs?: number;
}

// `Retry-After` is either delta-seconds or an HTTP date; return ms-from-now.
function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

/**
 * Fetch the `/usage` gauges for an arbitrary Claude OAuth access token.
 * RAW network call, no caching — exported for the multi-account switcher,
 * which shows each stored profile's session/weekly limits and does its own
 * per-fingerprint caching (claude-credentials-service).
 */
export async function fetchClaudeRateLimitsForToken(accessToken: string): Promise<RateLimitFetchResult> {
  try {
    const response = await fetch(OAUTH_USAGE_URL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(OAUTH_USAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        rateLimits: null,
        error: `Anthropic usage endpoint returned ${response.status}`,
        status: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      };
    }
    const body = await response.json() as Record<string, unknown>;
    // `limits[]` wins; the top-level windows are the fallback for older payloads.
    const limits = parseLimitsArray(body);
    const sevenDayFable = limits.sevenDayFable
      ?? parseRateLimitWindow(body.seven_day_fable ?? body.seven_day_sonnet);
    return {
      rateLimits: {
        fiveHour: limits.fiveHour ?? parseRateLimitWindow(body.five_hour),
        sevenDay: limits.sevenDay ?? parseRateLimitWindow(body.seven_day),
        sevenDayOpus: limits.sevenDayOpus ?? parseRateLimitWindow(body.seven_day_opus),
        sevenDayFable,
        sevenDaySonnet: sevenDayFable,
      },
      error: null,
      status: response.status,
    };
  } catch (err: any) {
    log.warn(`Failed to fetch Claude rate limits: ${err}`);
    const reason = err?.name === 'TimeoutError' ? 'request timed out' : (err?.message ?? 'request failed');
    return { rateLimits: null, error: `Could not reach Anthropic usage endpoint (${reason})` };
  }
}

/**
 * Fetch the live session/weekly rate-limit gauges — the data behind the
 * progress bars in the CLI's `/usage` panel — using the OAuth token the CLI
 * keeps in `~/.claude/.credentials.json`. Returns the gauges or an error
 * string (never throws); the caller folds either into the snapshot.
 *
 * This is the RAW network call. Go through `getClaudeRateLimits()` instead —
 * it caches, dedupes, and rate-limits calls to this so we don't hammer (and get
 * 429'd by) the Anthropic endpoint.
 */
async function fetchClaudeRateLimitsFromApi(): Promise<RateLimitFetchResult> {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return { rateLimits: null, error: 'No Claude CLI credentials found' };
    }
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const oauth = credentials?.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || oauth.accessToken === '') {
      return { rateLimits: null, error: 'Claude CLI credentials are missing an OAuth token' };
    }
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) {
      return { rateLimits: null, error: 'Claude CLI OAuth token has expired — run any Claude session to refresh it' };
    }
    return await fetchClaudeRateLimitsForToken(oauth.accessToken);
  } catch (err) {
    log.warn(`Failed to read Claude credentials at ${CREDENTIALS_PATH}: ${err}`);
    return { rateLimits: null, error: 'Failed to read Claude CLI credentials' };
  }
}

interface RateLimitCacheEntry {
  rateLimits: ClaudeRateLimits | null;
  error: string | null;
  // Timestamp until which this entry is served without touching the network.
  validUntil: number;
}

// Account-wide, so a single cache line serves every agent/client. Never keyed.
let rateLimitCache: RateLimitCacheEntry | null = null;
// Last successful gauges, kept so we can serve them (stale) while backing off —
// the panel keeps showing numbers instead of going blank after a transient 429.
let lastGoodRateLimits: ClaudeRateLimits | null = null;
// In-flight fetch, so N concurrent callers share ONE network request.
let rateLimitInFlight: Promise<{ rateLimits: ClaudeRateLimits | null; error: string | null }> | null = null;

/**
 * Cached, single-flight, backoff-aware accessor for the rate-limit gauges.
 *
 * Guarantees at most one request to the Anthropic usage endpoint per TTL window
 * (or per backoff window after a failure), no matter how many agents or clients
 * poll `/api/agents/:id/usage` concurrently. On 429 we honor `Retry-After` (or
 * fall back to a 5-minute cooldown); on any other failure we cool down briefly.
 * `resetClaudeRateLimitCache()` clears the cache for tests.
 */
async function getClaudeRateLimits(): Promise<{ rateLimits: ClaudeRateLimits | null; error: string | null }> {
  const now = Date.now();

  // Serve the cached value while it's still valid (covers both the TTL after a
  // success AND the backoff window after a failure).
  if (rateLimitCache && now < rateLimitCache.validUntil) {
    return { rateLimits: rateLimitCache.rateLimits, error: rateLimitCache.error };
  }

  // Single-flight: concurrent callers await the same request rather than each
  // firing their own (which is exactly what triggered the 429s).
  if (rateLimitInFlight) return rateLimitInFlight;

  rateLimitInFlight = (async () => {
    const result = await fetchClaudeRateLimitsFromApi();

    let ttl = RATE_LIMIT_CACHE_TTL_MS;
    if (result.rateLimits) {
      lastGoodRateLimits = result.rateLimits;
    } else if (result.status === 429) {
      // Respect Anthropic's own Retry-After when it sends one; never shorter
      // than the normal TTL so a stray header can't reopen the floodgates.
      ttl = Math.max(result.retryAfterMs ?? RATE_LIMIT_429_BACKOFF_MS, RATE_LIMIT_CACHE_TTL_MS);
    } else {
      ttl = RATE_LIMIT_ERROR_BACKOFF_MS;
    }

    // During a failure/backoff, still surface the last good gauges (stale) so
    // the panel keeps showing numbers alongside the error string.
    const entry: RateLimitCacheEntry = {
      rateLimits: result.rateLimits ?? lastGoodRateLimits,
      error: result.error,
      validUntil: Date.now() + ttl,
    };
    rateLimitCache = entry;
    return { rateLimits: entry.rateLimits, error: entry.error };
  })();

  try {
    return await rateLimitInFlight;
  } finally {
    rateLimitInFlight = null;
  }
}

/** Test helper: drop the cached rate-limit result and backoff state. */
export function resetClaudeRateLimitCache(): void {
  rateLimitCache = null;
  lastGoodRateLimits = null;
  rateLimitInFlight = null;
}

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Tally one main-session transcript for `localDay`. Counts the main
 * conversation only — `isSidechain` (Task/subagent) turns are excluded so the
 * totals line up with the CLI's own daily messageCount. `startedToday` is true
 * when the file's first timestamped record falls on `localDay`, which is how we
 * approximate the CLI's "sessions started today" sessionCount.
 */
async function scanTranscriptForDay(
  filePath: string,
  localDay: string,
): Promise<{ messageCount: number; toolCallCount: number; startedToday: boolean }> {
  let messageCount = 0;
  let toolCallCount = 0;
  let firstLocalDate: string | null = null;

  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"timestamp"')) continue;
    let record: Record<string, any>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    if (!Number.isFinite(ts)) continue;
    const localDate = localDateKey(ts);
    if (firstLocalDate === null) firstLocalDate = localDate;
    if (localDate !== localDay || record.isSidechain) continue;

    if (record.type === 'user' || record.type === 'assistant') messageCount += 1;
    const content = record.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && block.type === 'tool_use') toolCallCount += 1;
      }
    }
  }
  return { messageCount, toolCallCount, startedToday: firstLocalDate === localDay };
}

/**
 * Reconstruct today's activity entry live from the session transcripts.
 *
 * The CLI's `stats-cache.json` only rolls up through `lastComputedDate` (it
 * recomputes lazily, typically once per day), so the current day is normally
 * absent from `dailyActivity` and never appears in the usage panel. We rebuild
 * it from `~/.claude/projects/<project>/<sessionId>.jsonl`, bucketed by LOCAL
 * date to match the cache's own day boundaries, and scoped to main-conversation
 * messages so the totals stay within a few percent of the CLI's historical
 * days. Returns null when there's no activity yet today.
 */
async function computeTodayActivity(): Promise<DailyActivityEntry | null> {
  const today = todayString();
  const startMs = startOfLocalDay(Date.now());
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');

  let projects: fs.Dirent[];
  try {
    if (!fs.existsSync(projectsDir)) return null;
    projects = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (err) {
    log.warn(`Failed to list Claude projects dir ${projectsDir}: ${err}`);
    return null;
  }

  let messageCount = 0;
  let toolCallCount = 0;
  let sessionsStartedToday = 0;

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(projectsDir, project.name);
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(projectPath, { withFileTypes: true });
    } catch (err) {
      log.warn(`Failed to read project dir ${projectPath}: ${err}`);
      continue;
    }
    for (const file of files) {
      // Main session transcripts only: `<sessionId>.jsonl`. Subagent files live
      // under `subagents/` (not visited here) and `agent-*.jsonl` is skipped;
      // their turns are already excluded as sidechains in the parent transcript.
      if (!file.isFile() || !file.name.endsWith('.jsonl') || file.name.startsWith('agent-')) continue;
      const filePath = path.join(projectPath, file.name);
      // mtime fast-path: a file untouched since local midnight can't hold a
      // today line (Claude only appends, so mtime tracks the latest record).
      try {
        if (fs.statSync(filePath).mtimeMs < startMs) continue;
      } catch {
        continue;
      }
      const result = await scanTranscriptForDay(filePath, today);
      messageCount += result.messageCount;
      toolCallCount += result.toolCallCount;
      if (result.startedToday) sessionsStartedToday += 1;
    }
  }

  if (messageCount === 0 && toolCallCount === 0) return null;
  return { date: today, messageCount, sessionCount: sessionsStartedToday, toolCallCount };
}

export async function buildClaudeUsageSnapshot(agent: Agent): Promise<ClaudeUsageSnapshot> {
  const cache = readStatsCache();
  const all = cache?.dailyActivity ?? [];
  // The cache writes oldest-first; sort newest-first for display.
  const sortedDesc = [...all].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const cachedToday = sortedDesc.find((e) => e.date === todayString()) ?? null;

  // Once the CLI has rolled today into its cache, trust that copy; until then
  // reconstruct it live so the panel still shows the current day. Run the
  // transcript scan alongside the rate-limit fetch — they're independent I/O.
  const [liveToday, { rateLimits, error: rateLimitsError }] = await Promise.all([
    cachedToday ? Promise.resolve<DailyActivityEntry | null>(null) : computeTodayActivity(),
    getClaudeRateLimits(),
  ]);

  const today = cachedToday ?? liveToday;
  const recentDays = (liveToday ? [liveToday, ...sortedDesc] : sortedDesc).slice(0, 8);

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
    rateLimits,
    rateLimitsError,
    cliHint: 'Run /usage inside this agent\'s terminal to see live weekly and session rate-limit gauges.',
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

function parseDays(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return 14;
  return Math.max(2, Math.min(60, Math.round(parsed)));
}

function buildDayKeys(sinceMs: number, untilMs: number): string[] {
  const keys: string[] = [];
  const untilDay = startOfLocalDay(untilMs);
  for (let cursor = startOfLocalDay(sinceMs); cursor <= untilDay; cursor += 24 * 60 * 60 * 1000) {
    keys.push(localDateKey(cursor));
  }
  return keys;
}

export async function buildClaudeUsageByDaySummary(
  agents: Agent[],
  opts: { since?: unknown; until?: unknown; days?: unknown } = {}
): Promise<ClaudeUsageByDaySummary> {
  const untilMs = parseBoundary(opts.until) ?? Date.now();
  const sinceMs = parseBoundary(opts.since) ?? (startOfLocalDay(untilMs) - ((parseDays(opts.days) - 1) * 24 * 60 * 60 * 1000));
  const agentBuckets = new Map<string, { agentId: string; agentName: string; buckets: Map<string, DailyUsageBucket> }>();

  for (const agent of agents) {
    if (agent.provider !== 'claude' || !agent.sessionId) continue;

    const paths = findClaudeSessionFile(agent);
    if (!paths) continue;

    try {
      const mainAcc = createDailyAccumulator();
      await scanFileIntoDailyAccumulator(paths.main, mainAcc, sinceMs, untilMs);

      const subAcc = createDailyAccumulator();
      for (const subPath of paths.subagents) {
        await scanFileIntoDailyAccumulator(subPath, subAcc, sinceMs, untilMs);
      }

      const buckets = new Map<string, DailyUsageBucket>();
      const mergeBucket = (date: string, source: DailyUsageBucket) => {
        const target = buckets.get(date) ?? {
          requestCount: 0,
          tokens: createTokenTotals(),
        };
        target.requestCount += source.requestCount;
        addTokenTotals(target.tokens, source.tokens);
        buckets.set(date, target);
      };

      for (const [date, bucket] of mainAcc.buckets) mergeBucket(date, bucket);
      for (const [date, bucket] of subAcc.buckets) mergeBucket(date, bucket);

      const agentTotal = [...buckets.values()].reduce((sum, bucket) => sum + bucket.tokens.total, 0);
      if (agentTotal <= 0) continue;

      agentBuckets.set(agent.id, {
        agentId: agent.id,
        agentName: agent.name,
        buckets,
      });
    } catch (err) {
      log.warn(`Failed to scan Claude daily usage for agent ${agent.name} (${agent.id}): ${err}`);
    }
  }

  const days = buildDayKeys(sinceMs, untilMs).map((date) => {
    const dayAgents: ClaudeUsageByDayAgentEntry[] = [];
    for (const agentUsage of agentBuckets.values()) {
      const bucket = agentUsage.buckets.get(date);
      if (!bucket || bucket.tokens.total <= 0) continue;
      dayAgents.push({
        agentId: agentUsage.agentId,
        agentName: agentUsage.agentName,
        tokens: { ...bucket.tokens },
        requestCount: bucket.requestCount,
      });
    }

    dayAgents.sort((a, b) => b.tokens.total - a.tokens.total);

    return {
      date,
      totalTokens: dayAgents.reduce((sum, entry) => sum + entry.tokens.total, 0),
      requestCount: dayAgents.reduce((sum, entry) => sum + entry.requestCount, 0),
      agents: dayAgents,
    };
  });

  return {
    provider: 'claude',
    fetchedAt: Date.now(),
    since: normalizeBoundary(sinceMs),
    until: normalizeBoundary(untilMs),
    source: 'claude-jsonl',
    days,
  };
}
