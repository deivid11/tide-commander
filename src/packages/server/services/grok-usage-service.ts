/**
 * Grok Usage Service
 *
 * Surfaces the same plan-limit gauges the Grok CLI's `/usage` command shows,
 * using the CLI chat-proxy billing endpoints with the OAuth token in
 * `~/.grok/auth.json`:
 *
 *   - `GET /v1/billing?format=credits` — subscription usage percent +
 *     current weekly/monthly period (what the CLI logs as
 *     "billing: fetched credits config")
 *   - `GET /v1/billing` — calendar-month spend/credit allotment
 *     (`used` / `monthlyLimit`) when the credits payload is weekly-only
 *
 * When both are available the snapshot exposes **weekly** and **monthly**
 * gauges side-by-side, matching the terminal `/usage` panel.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Agent } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GrokUsage');

export interface GrokRateLimitWindow {
  utilization: number; // 0-100 percent used
  resetsAt: string; // ISO timestamp when the window resets
  /** Absolute credits used (when known — spend-style monthly caps). */
  used?: number;
  /** Absolute credit limit (when known). */
  limit?: number;
}

export interface GrokRateLimits {
  /** Rolling weekly usage allotment (CLI "Weekly limit"). */
  weekly: GrokRateLimitWindow | null;
  /** Calendar / plan monthly allotment (CLI "Monthly limit"). */
  monthly: GrokRateLimitWindow | null;
  /** Optional pay-as-you-go / on-demand cap when enabled. */
  onDemand: GrokRateLimitWindow | null;
}

export interface GrokUsageSession {
  tokensUsed: number;
  contextUsed: number;
  contextLimit: number;
  taskCount: number;
  lastActivity: number;
}

export interface GrokUsageSnapshot {
  provider: 'grok';
  fetchedAt: number;
  session: GrokUsageSession;
  rateLimits: GrokRateLimits | null;
  rateLimitsError: string | null;
  cliHint: string;
}

const AUTH_PATH = path.join(os.homedir(), '.grok', 'auth.json');
const DEFAULT_BILLING_BASE = 'https://cli-chat-proxy.grok.com/v1/billing';
const BILLING_TIMEOUT_MS = 5_000;

// Account-wide gauges — one cache line serves every Grok agent/client poll.
const RATE_LIMIT_CACHE_TTL_MS = 60_000;
const RATE_LIMIT_429_BACKOFF_MS = 5 * 60_000;
const RATE_LIMIT_ERROR_BACKOFF_MS = 30_000;

interface AuthEntry {
  key?: unknown;
  expires_at?: unknown;
  expiresAt?: unknown;
}

function billingBaseUrl(): string {
  const base = process.env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim();
  if (base) {
    return `${base.replace(/\/+$/, '')}/billing`;
  }
  return DEFAULT_BILLING_BASE;
}

function readGrokAccessToken(): { token: string } | { error: string } {
  try {
    if (!fs.existsSync(AUTH_PATH)) {
      return { error: 'No Grok CLI credentials found — run `grok login`' };
    }
    const raw = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8')) as Record<string, AuthEntry>;
    // auth.json is keyed by issuer::client_id; pick the first entry with a token.
    for (const entry of Object.values(raw)) {
      if (!entry || typeof entry !== 'object') continue;
      const token = entry.key;
      if (typeof token !== 'string' || token === '') continue;

      const expiresRaw = entry.expires_at ?? entry.expiresAt;
      if (typeof expiresRaw === 'string' || typeof expiresRaw === 'number') {
        const expiresMs =
          typeof expiresRaw === 'number' ? expiresRaw : Date.parse(expiresRaw);
        if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
          return {
            error:
              'Grok CLI OAuth token has expired — run `grok login` or any Grok session to refresh it',
          };
        }
      }
      return { token };
    }
    return { error: 'Grok CLI credentials are missing an OAuth token' };
  } catch (err) {
    log.warn(`Failed to read Grok credentials at ${AUTH_PATH}: ${err}`);
    return { error: 'Failed to read Grok CLI credentials' };
  }
}

function unwrapVal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'val' in (value as object)) {
    const inner = (value as { val: unknown }).val;
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return null;
}

function parseIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Map API period type strings / date span → weekly | monthly | period. */
export function classifyPeriodType(
  typeRaw: unknown,
  startIso: string | null,
  endIso: string | null,
): 'weekly' | 'monthly' | 'period' {
  if (typeof typeRaw === 'string') {
    const t = typeRaw.toUpperCase();
    if (t.includes('WEEK')) return 'weekly';
    if (t.includes('MONTH')) return 'monthly';
  }
  if (!startIso || !endIso) return 'period';
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'period';
  const days = (end - start) / (24 * 60 * 60 * 1000);
  if (days >= 5 && days <= 10) return 'weekly';
  if (days >= 25 && days <= 35) return 'monthly';
  return 'period';
}

/** @deprecated use classifyPeriodType — kept for existing tests. */
export function classifyBillingPeriod(
  startIso: string | null,
  endIso: string | null,
): 'weekly' | 'monthly' | 'period' {
  return classifyPeriodType(null, startIso, endIso);
}

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

interface BillingFetchResult {
  rateLimits: GrokRateLimits | null;
  error: string | null;
  status?: number;
  retryAfterMs?: number;
}

async function fetchBillingJson(
  url: string,
  token: string,
): Promise<{ ok: true; status: number; config: Record<string, unknown>; retryAfterMs?: number } | { ok: false; status: number; error: string; retryAfterMs?: number }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'x-grok-client-version': '0.2.93',
    },
    signal: AbortSignal.timeout(BILLING_TIMEOUT_MS),
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `Grok billing endpoint returned ${response.status}`,
      retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
    };
  }
  const body = (await response.json()) as { config?: Record<string, unknown> };
  return {
    ok: true,
    status: response.status,
    config: body?.config ?? {},
    retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
  };
}

/**
 * Parse `/billing?format=credits` — the payload the CLI uses for the
 * Weekly/Monthly percent gauges in `/usage`.
 */
export function parseCreditsConfig(config: Record<string, unknown>): {
  weekly: GrokRateLimitWindow | null;
  monthly: GrokRateLimitWindow | null;
  onDemand: GrokRateLimitWindow | null;
} {
  let weekly: GrokRateLimitWindow | null = null;
  let monthly: GrokRateLimitWindow | null = null;
  let onDemand: GrokRateLimitWindow | null = null;

  const percentRaw = config.creditUsagePercent;
  const percent =
    typeof percentRaw === 'number' && Number.isFinite(percentRaw)
      ? clampPercent(percentRaw)
      : null;

  const currentPeriod =
    config.currentPeriod && typeof config.currentPeriod === 'object'
      ? (config.currentPeriod as Record<string, unknown>)
      : null;
  const periodStart = parseIso(currentPeriod?.start) ?? parseIso(config.billingPeriodStart);
  const periodEnd = parseIso(currentPeriod?.end) ?? parseIso(config.billingPeriodEnd);
  const kind = classifyPeriodType(currentPeriod?.type, periodStart, periodEnd);

  if (percent != null && periodEnd) {
    const window: GrokRateLimitWindow = {
      utilization: percent,
      resetsAt: periodEnd,
    };
    if (kind === 'weekly') weekly = window;
    else if (kind === 'monthly') monthly = window;
    else {
      // Unknown period type — prefer weekly label when span is short-ish.
      if (kind === 'period' && periodStart && periodEnd) {
        const days =
          (Date.parse(periodEnd) - Date.parse(periodStart)) / (24 * 60 * 60 * 1000);
        if (days <= 14) weekly = window;
        else monthly = window;
      } else {
        weekly = window;
      }
    }
  }

  // productUsage[] can carry per-product percents (e.g. GrokBuild) — prefer the
  // primary creditUsagePercent above, but fall back if it was missing.
  if (percent == null && Array.isArray(config.productUsage)) {
    for (const entry of config.productUsage) {
      if (!entry || typeof entry !== 'object') continue;
      const p = (entry as { usagePercent?: unknown }).usagePercent;
      if (typeof p === 'number' && Number.isFinite(p) && periodEnd) {
        const window: GrokRateLimitWindow = {
          utilization: clampPercent(p),
          resetsAt: periodEnd,
        };
        if (kind === 'monthly') monthly = window;
        else weekly = window;
        break;
      }
    }
  }

  // Grok 1.0.3 omits both creditUsagePercent and productUsage when a unified-
  // billing period has consumed zero quota. Its own /usage screen renders that
  // exact payload as 0%, so mirror the CLI instead of reporting unavailable.
  if (!weekly && !monthly && percent == null && periodEnd && config.isUnifiedBillingUser === true) {
    const window: GrokRateLimitWindow = { utilization: 0, resetsAt: periodEnd };
    if (kind === 'monthly') monthly = window;
    else weekly = window;
  }

  const onDemandCap = unwrapVal(config.onDemandCap);
  const onDemandUsed = unwrapVal(config.onDemandUsed) ?? 0;
  if (onDemandCap != null && onDemandCap > 0) {
    onDemand = {
      utilization: clampPercent((onDemandUsed / onDemandCap) * 100),
      resetsAt: periodEnd ?? parseIso(config.billingPeriodEnd) ?? new Date().toISOString(),
      used: onDemandUsed,
      limit: onDemandCap,
    };
  }

  return { weekly, monthly, onDemand };
}

/**
 * Parse default `/billing` — absolute used/monthlyLimit spend-style cap.
 * Used to fill the monthly gauge when the credits payload only has weekly.
 */
export function parseSpendConfig(config: Record<string, unknown>): GrokRateLimitWindow | null {
  const used = unwrapVal(config.used) ?? unwrapVal(config.includedUsed);
  const limit = unwrapVal(config.monthlyLimit);
  const periodEnd = parseIso(config.billingPeriodEnd);
  if (used == null || limit == null || limit <= 0 || !periodEnd) return null;
  return {
    utilization: clampPercent((used / limit) * 100),
    resetsAt: periodEnd,
    used,
    limit,
  };
}

/**
 * Raw network calls to the CLI chat-proxy billing endpoints. Prefer
 * `getGrokAccountRateLimits()` which caches + single-flights.
 */
async function fetchGrokBillingFromApi(accessToken?: string): Promise<BillingFetchResult> {
  const creds = accessToken ? { token: accessToken } : readGrokAccessToken();
  if ('error' in creds) {
    return { rateLimits: null, error: creds.error };
  }

  const base = billingBaseUrl();
  try {
    // Parallel: credits format (CLI /usage) + default spend allotment.
    const [creditsResult, spendResult] = await Promise.all([
      fetchBillingJson(`${base}?format=credits`, creds.token),
      fetchBillingJson(base, creds.token),
    ]);

    // Prefer status/retry from credits (primary); fall back to spend.
    if (!creditsResult.ok && !spendResult.ok) {
      return {
        rateLimits: null,
        error: creditsResult.error,
        status: creditsResult.status,
        retryAfterMs: creditsResult.retryAfterMs ?? spendResult.retryAfterMs,
      };
    }

    let weekly: GrokRateLimitWindow | null = null;
    let monthly: GrokRateLimitWindow | null = null;
    let onDemand: GrokRateLimitWindow | null = null;

    if (creditsResult.ok) {
      const parsed = parseCreditsConfig(creditsResult.config);
      weekly = parsed.weekly;
      monthly = parsed.monthly;
      onDemand = parsed.onDemand;
    }

    // Fill monthly from spend allotment when credits only gave weekly (the
    // SuperGrok dual-gauge layout in the CLI /usage panel).
    if (spendResult.ok) {
      const spendMonthly = parseSpendConfig(spendResult.config);
      if (spendMonthly && !monthly) {
        monthly = spendMonthly;
      }
      // On-demand may only appear on the default payload.
      if (!onDemand) {
        const onDemandCap = unwrapVal(spendResult.config.onDemandCap);
        const onDemandUsed = unwrapVal(spendResult.config.onDemandUsed) ?? 0;
        const periodEnd = parseIso(spendResult.config.billingPeriodEnd);
        if (onDemandCap != null && onDemandCap > 0 && periodEnd) {
          onDemand = {
            utilization: clampPercent((onDemandUsed / onDemandCap) * 100),
            resetsAt: periodEnd,
            used: onDemandUsed,
            limit: onDemandCap,
          };
        }
      }
    }

    if (!weekly && !monthly && !onDemand) {
      return {
        rateLimits: null,
        error: creditsResult.ok
          ? 'Grok billing response had no usable usage limits'
          : creditsResult.error,
        status: creditsResult.ok ? creditsResult.status : creditsResult.status,
      };
    }

    return {
      rateLimits: { weekly, monthly, onDemand },
      error: null,
      status: creditsResult.ok ? creditsResult.status : spendResult.status,
    };
  } catch (err: any) {
    log.warn(`Failed to fetch Grok billing: ${err}`);
    const reason =
      err?.name === 'TimeoutError' ? 'request timed out' : (err?.message ?? 'request failed');
    return { rateLimits: null, error: `Could not reach Grok billing endpoint (${reason})` };
  }
}

/** Fetch Grok's weekly/monthly limits for an explicit OAuth token. */
export async function fetchGrokRateLimitsForToken(token: string): Promise<{
  rateLimits: GrokRateLimits | null;
  error: string | null;
}> {
  const result = await fetchGrokBillingFromApi(token);
  return { rateLimits: result.rateLimits, error: result.error };
}

interface RateLimitCacheEntry {
  rateLimits: GrokRateLimits | null;
  error: string | null;
  validUntil: number;
}

let rateLimitCache: RateLimitCacheEntry | null = null;
let lastGoodRateLimits: GrokRateLimits | null = null;
let rateLimitInFlight: Promise<{ rateLimits: GrokRateLimits | null; error: string | null }> | null =
  null;

export async function getGrokAccountRateLimits(): Promise<{
  rateLimits: GrokRateLimits | null;
  error: string | null;
}> {
  const now = Date.now();
  if (rateLimitCache && now < rateLimitCache.validUntil) {
    return { rateLimits: rateLimitCache.rateLimits, error: rateLimitCache.error };
  }
  if (rateLimitInFlight) return rateLimitInFlight;

  rateLimitInFlight = (async () => {
    const result = await fetchGrokBillingFromApi();

    let ttl = RATE_LIMIT_CACHE_TTL_MS;
    if (result.rateLimits) {
      lastGoodRateLimits = result.rateLimits;
    } else if (result.status === 429) {
      ttl = Math.max(result.retryAfterMs ?? RATE_LIMIT_429_BACKOFF_MS, RATE_LIMIT_CACHE_TTL_MS);
    } else {
      ttl = RATE_LIMIT_ERROR_BACKOFF_MS;
    }

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

/** Test helper: drop the cached billing result and backoff state. */
export function resetGrokRateLimitCache(): void {
  rateLimitCache = null;
  lastGoodRateLimits = null;
  rateLimitInFlight = null;
}

export async function buildGrokUsageSnapshot(agent: Agent): Promise<GrokUsageSnapshot> {
  const { rateLimits, error: rateLimitsError } = await getGrokAccountRateLimits();

  return {
    provider: 'grok',
    fetchedAt: Date.now(),
    session: {
      tokensUsed: agent.tokensUsed ?? 0,
      contextUsed: agent.contextUsed ?? 0,
      contextLimit: agent.contextLimit ?? 500_000,
      taskCount: agent.taskCount ?? 0,
      lastActivity: agent.lastActivity ?? 0,
    },
    rateLimits,
    rateLimitsError,
    cliHint:
      "Run /usage inside this agent's terminal to see live weekly and monthly usage limits.",
  };
}
