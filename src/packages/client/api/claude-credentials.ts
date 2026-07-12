/**
 * Claude CLI OAuth credential profiles API.
 * Manages ~/.claude/.credentials.json + named ~/.claude/.credentials.<name>.json
 * copies used to switch accounts when rate-limited.
 */

import { apiUrl, authFetch } from '../utils/storage';

export interface ClaudeCredentialProfileMeta {
  id: string;
  name: string;
  isActive: boolean;
  path: string;
  valid: boolean;
  fingerprint: string | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
  refreshTokenExpiresAt: number | null;
  scopes: string[];
  hasMcpOAuth: boolean;
  mtimeMs: number | null;
  matchesNamed: string | null;
}

export interface ClaudeCredentialsList {
  claudeDir: string;
  active: ClaudeCredentialProfileMeta | null;
  profiles: ClaudeCredentialProfileMeta[];
}

export interface ClaudeCredentialsSwitchResult {
  ok: true;
  active: ClaudeCredentialProfileMeta;
  profiles: ClaudeCredentialProfileMeta[];
  stashedAs: string | null;
  previousMatchesNamed: string | null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (body?.error && typeof body.error === 'string') return body.error;
  } catch {
    // ignore
  }
  return fallback;
}

export async function fetchClaudeCredentials(): Promise<ClaudeCredentialsList> {
  const response = await authFetch(apiUrl('/api/system/claude-credentials'));
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to list Claude credentials: ${response.status}`));
  }
  return (await response.json()) as ClaudeCredentialsList;
}

export async function switchClaudeCredentials(
  name: string,
  opts: { stashActiveAs?: string } = {},
): Promise<ClaudeCredentialsSwitchResult> {
  const response = await authFetch(apiUrl('/api/system/claude-credentials/switch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stashActiveAs: opts.stashActiveAs }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to switch Claude credentials: ${response.status}`));
  }
  return (await response.json()) as ClaudeCredentialsSwitchResult;
}

export async function saveClaudeCredentials(
  name: string,
  opts: { force?: boolean } = {},
): Promise<ClaudeCredentialsList> {
  const response = await authFetch(apiUrl('/api/system/claude-credentials/save'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, force: opts.force }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to save Claude credentials: ${response.status}`));
  }
  return (await response.json()) as ClaudeCredentialsList;
}

export async function renameClaudeCredentials(from: string, to: string): Promise<ClaudeCredentialsList> {
  const response = await authFetch(apiUrl('/api/system/claude-credentials/rename'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to rename Claude credentials: ${response.status}`));
  }
  return (await response.json()) as ClaudeCredentialsList;
}

export async function deleteClaudeCredentials(name: string): Promise<ClaudeCredentialsList> {
  const response = await authFetch(apiUrl(`/api/system/claude-credentials/${encodeURIComponent(name)}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to delete Claude credentials: ${response.status}`));
  }
  return (await response.json()) as ClaudeCredentialsList;
}
