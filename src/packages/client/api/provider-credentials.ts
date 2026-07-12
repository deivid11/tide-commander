/**
 * Grok + Codex OAuth credential profiles API.
 * Same account-switcher model as claude-credentials, generalized: a single
 * active ~/.<provider>/auth.json plus named copies used to switch accounts.
 */

import { apiUrl, authFetch } from '../utils/storage';

export type CredentialProviderId = 'grok' | 'codex';

export interface ProviderCredentialProfileMeta {
  id: string;
  name: string;
  isActive: boolean;
  path: string;
  valid: boolean;
  fingerprint: string | null;
  label: string | null;
  email: string | null;
  expiresAt: number | null;
  mtimeMs: number | null;
  matchesNamed: string | null;
}

export interface ProviderCredentialsList {
  provider: CredentialProviderId;
  dir: string;
  active: ProviderCredentialProfileMeta | null;
  profiles: ProviderCredentialProfileMeta[];
}

export interface ProviderCredentialsSwitchResult {
  ok: true;
  active: ProviderCredentialProfileMeta;
  profiles: ProviderCredentialProfileMeta[];
  stashedAs: string | null;
  previousMatchesNamed: string | null;
}

function basePath(provider: CredentialProviderId): string {
  return `/api/system/${provider}-credentials`;
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

export async function fetchProviderCredentials(provider: CredentialProviderId): Promise<ProviderCredentialsList> {
  const response = await authFetch(apiUrl(basePath(provider)));
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to list ${provider} credentials: ${response.status}`));
  }
  return (await response.json()) as ProviderCredentialsList;
}

export async function switchProviderCredentials(
  provider: CredentialProviderId,
  name: string,
  opts: { stashActiveAs?: string } = {},
): Promise<ProviderCredentialsSwitchResult> {
  const response = await authFetch(apiUrl(`${basePath(provider)}/switch`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stashActiveAs: opts.stashActiveAs }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to switch ${provider} credentials: ${response.status}`));
  }
  return (await response.json()) as ProviderCredentialsSwitchResult;
}

export async function saveProviderCredentials(
  provider: CredentialProviderId,
  name: string,
  opts: { force?: boolean } = {},
): Promise<ProviderCredentialsList> {
  const response = await authFetch(apiUrl(`${basePath(provider)}/save`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, force: opts.force }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to save ${provider} credentials: ${response.status}`));
  }
  return (await response.json()) as ProviderCredentialsList;
}

export async function renameProviderCredentials(
  provider: CredentialProviderId,
  from: string,
  to: string,
): Promise<ProviderCredentialsList> {
  const response = await authFetch(apiUrl(`${basePath(provider)}/rename`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to rename ${provider} credentials: ${response.status}`));
  }
  return (await response.json()) as ProviderCredentialsList;
}

export async function deleteProviderCredentials(
  provider: CredentialProviderId,
  name: string,
): Promise<ProviderCredentialsList> {
  const response = await authFetch(apiUrl(`${basePath(provider)}/${encodeURIComponent(name)}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to delete ${provider} credentials: ${response.status}`));
  }
  return (await response.json()) as ProviderCredentialsList;
}
