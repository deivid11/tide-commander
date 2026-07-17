/**
 * Status semantics for the Drive client.
 *
 * Regression cover for the original bug: `getStatus()` derived `connected` from the
 * mere presence of three non-empty secret strings plus a non-null API handle, so a
 * revoked refresh token still rendered as "Connected" in the integrations screen —
 * and nothing in the codebase ever invalidated that handle when Google rejected it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const getAccessToken = vi.fn();
const request = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        generateAuthUrl() { return 'https://example.test/auth'; }
        async getToken() { return { tokens: {} }; }
        getAccessToken() { return getAccessToken(); }
        request(opts: unknown) { return request(opts); }
      },
    },
    // Mirrors real googleapis: every API method delegates to the auth client's
    // request(), which is the choke point drive-client wraps to track token health.
    drive: ({ auth }: { auth: { request: (o: unknown) => Promise<{ data: unknown }> } }) => ({
      files: {
        list: async (params: unknown) => auth.request({ url: '/drive/v3/files', params }),
      },
    }),
    docs: () => ({}),
  },
}));

vi.mock('./drive-config.js', () => ({
  loadConfig: () => ({ enabled: true, defaultFolderId: '' }),
  updateConfig: vi.fn(),
  driveConfigSchema: [],
  getConfigValues: () => ({}),
  setConfigValues: vi.fn(),
}));

const driveClient = await import('./drive-client.js');
const { markTokenFresh } = await import('../google-auth/token-health.js');

const ctx = {
  secrets: {
    get: (k: string) =>
      ({
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REFRESH_TOKEN: 'refresh',
      })[k],
    set: vi.fn(),
  },
  serverConfig: { port: 5174, host: 'localhost', baseUrl: 'http://localhost:5174' },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as never;

function invalidGrant() {
  return Object.assign(new Error('invalid_grant'), {
    response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } },
  });
}

beforeEach(async () => {
  getAccessToken.mockReset();
  request.mockReset();
  markTokenFresh(); // baseline: healthy shared token
  getAccessToken.mockResolvedValue({ token: 'ya29.access' });
  await driveClient.init(ctx);
});

describe('getStatus', () => {
  it('reports connected while the refresh token still works', async () => {
    const status = await driveClient.probeToken();

    expect(status.connected).toBe(true);
    expect(status.needsReauth).toBe(false);
    expect(status.tokenState).toBe('valid');
  });

  it('THE BUG: stops reporting connected once Google rejects the refresh token', async () => {
    getAccessToken.mockRejectedValue(invalidGrant());

    const status = await driveClient.probeToken();

    expect(status.tokenState).toBe('expired');
    expect(status.needsReauth).toBe(true);
    // Previously this stayed true forever — the integrations screen said "Connected"
    // with a dead token, which is exactly what this change fixes.
    expect(status.connected).toBe(false);
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain('expired or revoked');
  });

  it('surfaces a dead token at first real use, without waiting for a probe', async () => {
    // An agent calls Drive; googleapis routes it through the wrapped oauth2Client.request.
    request.mockRejectedValue(invalidGrant());
    await expect(driveClient.listFiles({})).rejects.toThrow();

    const status = driveClient.getStatus();

    expect(status.needsReauth).toBe(true);
    expect(status.connected).toBe(false);
  });

  it('stays connected when Google is merely unreachable (offline host)', async () => {
    getAccessToken.mockRejectedValue(Object.assign(new Error('connect ENOTFOUND'), { code: 'ENOTFOUND' }));

    const status = await driveClient.probeToken();

    expect(status.tokenState).toBe('unreachable');
    // A network blip must not push the user into a pointless re-consent flow.
    expect(status.needsReauth).toBe(false);
    expect(status.connected).toBe(true);
  });
});
