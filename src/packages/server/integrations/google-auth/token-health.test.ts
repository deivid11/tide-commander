/**
 * Tests for shared Google OAuth token health.
 *
 * The load-bearing rule: only Google *rejecting* the credentials may flip an
 * integration to "needs reauth". A network failure must never do it — otherwise an
 * offline host sends the user through a pointless re-consent flow, and a token that
 * is actually fine gets reported as expired.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const getAccessToken = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        getAccessToken() {
          return getAccessToken();
        }
      },
    },
  },
}));

const {
  getTokenHealth,
  markTokenFresh,
  needsReauth,
  probeTokenHealth,
  reportGoogleApiError,
  reportGoogleApiSuccess,
} = await import('./token-health.js');

/** Shape of the errors googleapis throws for OAuth failures. */
function oauthError(error: string, description?: string) {
  return Object.assign(new Error(error), {
    response: { status: 400, data: { error, error_description: description } },
  });
}

function networkError(code: string) {
  return Object.assign(new Error(`connect ${code}`), { code });
}

/** Minimal IntegrationContext — only `secrets` and `log` are touched by the probe. */
function makeCtx(secrets: Record<string, string | undefined>) {
  return {
    secrets: { get: (k: string) => secrets[k], set: () => {} },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Parameters<typeof probeTokenHealth>[0];
}

const ctx = makeCtx({
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REFRESH_TOKEN: 'refresh',
});

beforeEach(() => {
  getAccessToken.mockReset();
  markTokenFresh(); // reset shared module state to a known-good baseline
});

describe('probeTokenHealth', () => {
  it('reports valid when the refresh token exchanges successfully', async () => {
    getAccessToken.mockResolvedValue({ token: 'ya29.access' });

    const health = await probeTokenHealth(ctx, { force: true });

    expect(health.state).toBe('valid');
    expect(needsReauth(health)).toBe(false);
  });

  it('reports expired on invalid_grant — the signal that the token is revoked', async () => {
    getAccessToken.mockRejectedValue(oauthError('invalid_grant', 'Token has been expired or revoked.'));

    const health = await probeTokenHealth(ctx, { force: true });

    expect(health.state).toBe('expired');
    expect(needsReauth(health)).toBe(true);
    expect(health.error).toContain('expired or revoked');
  });

  it('reports invalid_client when the OAuth app credentials are rejected', async () => {
    getAccessToken.mockRejectedValue(oauthError('invalid_client'));

    const health = await probeTokenHealth(ctx, { force: true });

    expect(health.state).toBe('invalid_client');
    expect(needsReauth(health)).toBe(true);
  });

  it('does NOT claim the token expired when Google is simply unreachable', async () => {
    getAccessToken.mockRejectedValue(networkError('ENOTFOUND'));

    const health = await probeTokenHealth(ctx, { force: true });

    expect(health.state).toBe('unreachable');
    // The whole point: an offline host must not trigger a re-consent flow.
    expect(needsReauth(health)).toBe(false);
  });

  it('treats a missing access token in the response as expired', async () => {
    getAccessToken.mockResolvedValue({ token: null });

    const health = await probeTokenHealth(ctx, { force: true });

    expect(health.state).toBe('expired');
  });

  it('reports unknown (not expired) when credentials were never configured', async () => {
    const health = await probeTokenHealth(makeCtx({}), { force: true });

    expect(health.state).toBe('unknown');
    expect(needsReauth(health)).toBe(false);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('serves a cached verdict instead of re-exchanging on every status poll', async () => {
    getAccessToken.mockResolvedValue({ token: 'ya29.access' });

    await probeTokenHealth(ctx, { force: true });
    await probeTokenHealth(ctx); // the settings UI polls every ~3s
    await probeTokenHealth(ctx);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent probes into a single token exchange', async () => {
    getAccessToken.mockResolvedValue({ token: 'ya29.access' });

    await Promise.all([
      probeTokenHealth(ctx, { force: true }),
      probeTokenHealth(ctx, { force: true }),
      probeTokenHealth(ctx, { force: true }),
    ]);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('reportGoogleApiError', () => {
  it('flips health to expired the moment a real Drive/Gmail call hits invalid_grant', () => {
    reportGoogleApiError(oauthError('invalid_grant'));

    expect(getTokenHealth().state).toBe('expired');
    expect(needsReauth(getTokenHealth())).toBe(true);
  });

  it('ignores errors that say nothing about the token (404, missing scope, rate limit)', () => {
    reportGoogleApiError(Object.assign(new Error('File not found'), { response: { status: 404 } }));

    // Still valid from the beforeEach baseline — an unrelated failure must not
    // disconnect a working integration.
    expect(getTokenHealth().state).toBe('valid');
  });

  it('does not let a transient 5xx overwrite a known-good verdict', () => {
    reportGoogleApiError(Object.assign(new Error('backend error'), { response: { status: 503 } }));

    expect(getTokenHealth().state).toBe('valid');
  });

  it('does not let a network blip overwrite a known-dead verdict', () => {
    reportGoogleApiError(oauthError('invalid_grant'));
    reportGoogleApiError(networkError('ETIMEDOUT'));

    // The token is still dead; reconnect must stay on screen.
    expect(getTokenHealth().state).toBe('expired');
  });

  it('recovers to valid once a call succeeds again', () => {
    reportGoogleApiError(oauthError('invalid_grant'));
    expect(getTokenHealth().state).toBe('expired');

    reportGoogleApiSuccess();

    expect(getTokenHealth().state).toBe('valid');
    expect(needsReauth(getTokenHealth())).toBe(false);
  });
});
