/**
 * Google OAuth token health.
 *
 * Gmail, Calendar, and Drive all authenticate with the SAME `GOOGLE_REFRESH_TOKEN`
 * secret, so token liveness is a single shared fact — this module owns it.
 *
 * Why this exists: each client used to report `connected` from the mere presence of
 * three non-empty secret strings plus a non-null API handle. Nothing ever validated
 * the refresh token against Google and nothing invalidated the handle when Google
 * rejected it, so a revoked or expired token still rendered as "Connected" — and a
 * server restart didn't help, because init() only constructs an OAuth2 client from
 * the token string without exchanging it.
 *
 * The probe below performs a real refresh_token -> access_token exchange, which is
 * the only way to learn that a refresh token is dead.
 */

import { google } from 'googleapis';
import type { IntegrationContext } from '../../../shared/integration-types.js';

// ─── Types ───

export type GoogleTokenState =
  /** Never probed (no credentials yet, or probe hasn't run). */
  | 'unknown'
  /** Refresh token exchanged successfully. */
  | 'valid'
  /** Google rejected the refresh token — user must re-authorize. */
  | 'expired'
  /** Client ID/secret rejected — credentials are wrong, not the token. */
  | 'invalid_client'
  /** Probe couldn't reach Google (offline, DNS, 5xx). Says nothing about the token. */
  | 'unreachable';

export interface GoogleTokenHealth {
  state: GoogleTokenState;
  /** Epoch ms of the last completed probe; 0 if never probed. */
  checkedAt: number;
  /** Human-readable detail for the UI when state isn't 'valid'. */
  error?: string;
}

/** The token is definitively dead and only a fresh OAuth consent will fix it. */
export function needsReauth(health: GoogleTokenHealth): boolean {
  return health.state === 'expired' || health.state === 'invalid_client';
}

// ─── State ───

let health: GoogleTokenHealth = { state: 'unknown', checkedAt: 0 };

/** In-flight probe, so N concurrent status calls trigger at most one token exchange. */
let inFlight: Promise<GoogleTokenHealth> | null = null;

let monitorTimer: ReturnType<typeof setInterval> | null = null;

/** Status endpoints are polled every ~3s by the settings UI; only re-probe this often. */
const PROBE_TTL_MS = 5 * 60_000;
/** Background re-probe, so a token that dies mid-session surfaces without user action. */
const MONITOR_INTERVAL_MS = 15 * 60_000;

export function getTokenHealth(): GoogleTokenHealth {
  return health;
}

// ─── Error classification ───

/**
 * Map an error from a token exchange or Google API call onto a token state.
 *
 * Returns null when the error says nothing about token validity (a 404 on a file,
 * a missing scope, a rate limit) — callers must leave the health state untouched
 * rather than flapping the UI to "expired" on unrelated failures.
 */
function classify(err: unknown): { state: GoogleTokenState; error: string } | null {
  const e = err as {
    message?: string;
    code?: string | number;
    response?: { status?: number; data?: { error?: string; error_description?: string } };
  };

  const oauthError = e?.response?.data?.error ?? '';
  const description = e?.response?.data?.error_description ?? '';
  const message = e?.message ?? String(err);
  const haystack = `${oauthError} ${message}`.toLowerCase();

  // The definitive signal: Google rejected the refresh token itself. Emitted when the
  // token is revoked, expired (a "Testing"-mode OAuth consent screen expires refresh
  // tokens after 7 days), or the user changed their password.
  if (haystack.includes('invalid_grant')) {
    return {
      state: 'expired',
      error: description || 'Google rejected the refresh token (invalid_grant). Re-authorize to reconnect.',
    };
  }

  // Client ID/secret are wrong or the OAuth client was deleted. Re-consent won't help
  // until the credentials are fixed, but it's still a hard auth failure worth surfacing.
  if (haystack.includes('invalid_client') || haystack.includes('unauthorized_client')) {
    return {
      state: 'invalid_client',
      error: description || 'Google rejected the OAuth client credentials (invalid_client).',
    };
  }

  // Couldn't reach Google at all. Explicitly NOT an auth verdict: reporting "expired"
  // because the host is offline would send users through a pointless re-consent flow.
  const code = String(e?.code ?? '');
  const status = e?.response?.status;
  const networkish =
    ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code) ||
    (typeof status === 'number' && status >= 500);
  if (networkish) {
    return { state: 'unreachable', error: `Could not reach Google to verify the token (${code || status}).` };
  }

  return null;
}

/**
 * Report an error thrown by a live Google API call (Drive list, Gmail send, ...).
 *
 * Lets a dead token surface immediately at the point of real use instead of waiting
 * for the next background probe. Unrelated errors are ignored.
 */
export function reportGoogleApiError(err: unknown): void {
  const verdict = classify(err);
  if (!verdict) return;
  // Don't let a transient network blip overwrite a known-good/known-dead verdict.
  if (verdict.state === 'unreachable' && health.state !== 'unknown') return;
  health = { ...verdict, checkedAt: Date.now() };
}

/** Record that a Google API call succeeded — the token is provably alive. */
export function reportGoogleApiSuccess(): void {
  if (health.state === 'valid') return;
  health = { state: 'valid', checkedAt: Date.now() };
}

// ─── Probe ───

/**
 * Exchange the stored refresh token for an access token to prove it still works.
 *
 * Uses a throwaway OAuth2 client seeded with ONLY the refresh token: with no cached
 * access token, `getAccessToken()` is forced to hit Google's token endpoint rather
 * than returning a still-valid cached access token, which is what makes this a real
 * validation instead of a no-op.
 */
export async function probeTokenHealth(
  ctx: IntegrationContext,
  opts: { force?: boolean } = {},
): Promise<GoogleTokenHealth> {
  const clientId = ctx.secrets.get('GOOGLE_CLIENT_ID');
  const clientSecret = ctx.secrets.get('GOOGLE_CLIENT_SECRET');
  const refreshToken = ctx.secrets.get('GOOGLE_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    health = { state: 'unknown', checkedAt: Date.now(), error: 'Missing OAuth credentials' };
    return health;
  }

  const fresh = Date.now() - health.checkedAt < PROBE_TTL_MS;
  if (!opts.force && fresh && health.state !== 'unknown') return health;

  if (inFlight) return inFlight;

  inFlight = (async (): Promise<GoogleTokenHealth> => {
    try {
      const client = new google.auth.OAuth2(clientId, clientSecret);
      client.setCredentials({ refresh_token: refreshToken });

      const { token } = await client.getAccessToken();
      health = token
        ? { state: 'valid', checkedAt: Date.now() }
        : {
            state: 'expired',
            checkedAt: Date.now(),
            error: 'Google returned no access token for the stored refresh token.',
          };
    } catch (err) {
      const verdict = classify(err) ?? {
        state: 'unreachable' as const,
        error: err instanceof Error ? err.message : 'Token probe failed',
      };
      health = { ...verdict, checkedAt: Date.now() };
      ctx.log.warn(`[GoogleAuth] token probe: ${health.state}${health.error ? ` — ${health.error}` : ''}`);
    }
    return health;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Probe now, then re-probe periodically. Idempotent — the three Google plugins each
 * call this during init() and share the single resulting timer.
 */
export function startTokenHealthMonitor(ctx: IntegrationContext): void {
  void probeTokenHealth(ctx, { force: true });

  if (monitorTimer) return;
  monitorTimer = setInterval(() => {
    void probeTokenHealth(ctx, { force: true });
  }, MONITOR_INTERVAL_MS);
  // Don't hold the event loop open on shutdown.
  monitorTimer.unref?.();
}

export function stopTokenHealthMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

/** Called after a successful OAuth consent — the brand-new refresh token is good. */
export function markTokenFresh(): void {
  health = { state: 'valid', checkedAt: Date.now() };
}

// ─── Token rotation ───

/**
 * Re-init hooks, keyed by integration id so repeated init() calls just replace them.
 *
 * Consent granted through ONE integration writes a new `GOOGLE_REFRESH_TOKEN` that the
 * other two never see: their OAuth2 clients keep the refresh token they were seeded
 * with at init. When the reason for re-consenting was a revoked token, those clients
 * are holding a dead string — so re-authorizing via Calendar would leave Drive broken
 * while shared health reported 'valid'. Every client re-reads the secret on rotation.
 */
const reinitHandlers = new Map<string, () => Promise<void>>();

export function onTokenRotated(integrationId: string, reinit: () => Promise<void>): void {
  reinitHandlers.set(integrationId, reinit);
}

/** Announce a freshly minted refresh token: mark health good and re-arm every client. */
export async function notifyTokenRotated(): Promise<void> {
  markTokenFresh();
  for (const reinit of reinitHandlers.values()) {
    try {
      await reinit();
    } catch {
      // A sibling integration failing to re-init must not abort the OAuth callback
      // for the one the user actually just authorized.
    }
  }
}
