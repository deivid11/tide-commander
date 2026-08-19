/** Pi OAuth account profiles stored as auth.json + auth.<name>.json copies. */

import { apiUrl, authFetch } from '../utils/storage';
import type { ClaudeRateLimits, ClaudeRateLimitWindow } from './claude-usage';

export interface PiCredentialProfileMeta {
  id: string;
  name: string;
  isActive: boolean;
  path: string;
  valid: boolean;
  fingerprint: string | null;
  provider: string;
  label: string;
  credentialType: 'oauth' | 'api_key' | null;
  expiresAt: number | null;
  detail: string | null;
  source: 'pi' | 'claude' | 'codex' | 'grok';
  mtimeMs: number | null;
  matchesNamed: string | null;
}

export interface PiCredentialsList {
  provider: string;
  dir: string;
  profileDir: string | null;
  active: PiCredentialProfileMeta | null;
  profiles: PiCredentialProfileMeta[];
}

export interface PiCredentialsSwitchResult {
  ok: true;
  active: PiCredentialProfileMeta;
  profiles: PiCredentialProfileMeta[];
  stashedAs: string | null;
  previousMatchesNamed: string | null;
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
  used?: number;
  limit?: number;
}

export interface PiProfileUsage {
  id: string;
  rateLimits: ClaudeRateLimits | null;
  quotaWindows: PiQuotaWindow[];
  error: string | null;
  fetchedAt: number;
}

export interface PiProfilesUsageResult {
  usage: PiProfileUsage[];
}

function providerQuery(modelProvider: string): string {
  return new URLSearchParams({ modelProvider }).toString();
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (body?.error && typeof body.error === 'string') return body.error;
  } catch {
    // Use the caller's status-based fallback.
  }
  return fallback;
}

export async function fetchPiCredentials(modelProvider: string): Promise<PiCredentialsList> {
  const response = await authFetch(apiUrl(`/api/system/pi-credentials?${providerQuery(modelProvider)}`));
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to list Pi credentials: ${response.status}`));
  }
  return (await response.json()) as PiCredentialsList;
}

export async function fetchPiCredentialsUsage(modelProvider: string): Promise<PiProfilesUsageResult> {
  const response = await authFetch(apiUrl(`/api/system/pi-credentials/usage?${providerQuery(modelProvider)}`));
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to fetch Pi credentials usage: ${response.status}`));
  }
  return (await response.json()) as PiProfilesUsageResult;
}

export async function switchPiCredentials(
  modelProvider: string,
  name: string,
  opts: { stashActiveAs?: string } = {},
): Promise<PiCredentialsSwitchResult> {
  const response = await authFetch(apiUrl('/api/system/pi-credentials/switch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelProvider, name, stashActiveAs: opts.stashActiveAs }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to switch Pi credentials: ${response.status}`));
  }
  return (await response.json()) as PiCredentialsSwitchResult;
}

export async function savePiCredentials(
  modelProvider: string,
  name: string,
  opts: { force?: boolean } = {},
): Promise<PiCredentialsList> {
  const response = await authFetch(apiUrl('/api/system/pi-credentials/save'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelProvider, name, force: opts.force }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to save Pi credentials: ${response.status}`));
  }
  return (await response.json()) as PiCredentialsList;
}

export async function renamePiCredentials(
  modelProvider: string,
  from: string,
  to: string,
): Promise<PiCredentialsList> {
  const response = await authFetch(apiUrl('/api/system/pi-credentials/rename'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelProvider, from, to }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to rename Pi credentials: ${response.status}`));
  }
  return (await response.json()) as PiCredentialsList;
}

export async function deletePiCredentials(modelProvider: string, name: string): Promise<PiCredentialsList> {
  const query = providerQuery(modelProvider);
  const response = await authFetch(apiUrl(`/api/system/pi-credentials/${encodeURIComponent(name)}?${query}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to delete Pi credentials: ${response.status}`));
  }
  return (await response.json()) as PiCredentialsList;
}
