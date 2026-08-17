import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Agent } from '../../shared/types.js';
import {
  fetchClaudeRateLimitsForToken,
  type ClaudeRateLimits,
  type ClaudeRateLimitWindow,
} from './claude-usage-service.js';
import { createLogger } from '../utils/logger.js';
import {
  deleteClaudeCredentialProfile,
  getClaudeCredentialProfilesUsage,
  listClaudeCredentialProfiles,
  renameClaudeCredentialProfile,
  type ClaudeCredentialProfileMeta,
} from './claude-credentials-service.js';
import {
  deleteProviderCredentialProfile,
  listProviderCredentialProfiles,
  renameProviderCredentialProfile,
  type CredentialProviderId,
  type ProviderCredentialProfileMeta,
} from './provider-credentials-service.js';
import {
  getCodexCredentialProfilesUsage,
  type CodexRateLimitWindow,
} from './codex-usage-service.js';
import {
  fetchGrokRateLimitsForToken,
  type GrokRateLimitWindow,
} from './grok-usage-service.js';

const log = createLogger('PiSubscriptionUsage');

const ACTIVE_FILE = 'auth.json';
const NAMED_PREFIX = 'auth.';
const NAMED_SUFFIX = '.json';
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const PROVIDER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const SUBSCRIPTION_LABELS: Record<string, string> = {
  anthropic: 'Anthropic Claude Pro/Max',
  'openai-codex': 'OpenAI ChatGPT Plus/Pro',
  'github-copilot': 'GitHub Copilot',
  xai: 'xAI Grok/X',
  radius: 'Radius',
};

const ANTHROPIC_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN_REFRESH_TIMEOUT_MS = 10_000;
const PROFILE_USAGE_TTL_OK_MS = 2 * 60_000;
const PROFILE_USAGE_TTL_ERR_MS = 45_000;
const PROFILE_REFRESH_FAIL_TTL_MS = 30 * 60_000;

interface PiOAuthCredential extends Record<string, unknown> {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
}

interface PiApiKeyCredential extends Record<string, unknown> {
  type: 'api_key';
  key?: string;
}

type PiCredential = PiOAuthCredential | PiApiKeyCredential;

interface ParsedPiCredentialFile {
  data: Record<string, unknown>;
  credential: PiCredential | null;
  fingerprint: string | null;
  valid: boolean;
}

export interface PiLoadedSubscription {
  provider: string;
  label: string;
  active: boolean;
}

export type PiCredentialProfileSource = 'pi' | 'claude' | 'codex' | 'grok';

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
  source: PiCredentialProfileSource;
  mtimeMs: number | null;
  matchesNamed: string | null;
}

export interface PiCredentialsList {
  provider: string;
  /** Pi's credential directory (the active auth.json lives here). */
  dir: string;
  /** Native account-profile directory when choices are imported from a provider CLI. */
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
  /** Anthropic compatibility payload used by older clients. */
  rateLimits: ClaudeRateLimits | null;
  /** Provider-neutral windows rendered per Pi account. */
  quotaWindows: PiQuotaWindow[];
  error: string | null;
  fetchedAt: number;
}

export interface PiProfilesUsageResult {
  usage: PiProfileUsage[];
}

export interface PiSubscriptionUsageSnapshot {
  provider: 'pi';
  fetchedAt: number;
  modelProvider: string | null;
  credentialType: 'oauth' | 'api_key' | null;
  subscriptions: PiLoadedSubscription[];
  session: {
    tokensUsed: number;
    contextUsed: number;
    contextLimit: number;
    taskCount: number;
    lastActivity: number;
  };
  /** Anthropic compatibility payload used by older clients. */
  rateLimits: ClaudeRateLimits | null;
  /** Active account windows for Anthropic, Codex, or xAI. */
  quotaWindows: PiQuotaWindow[];
  rateLimitsError: string | null;
  cliHint: string;
}

let piDirOverride: string | null = null;

export function setPiCredentialsDirForTests(dir: string | null): void {
  piDirOverride = dir;
}

function piAgentDir(): string {
  if (piDirOverride) return piDirOverride;
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return path.join(os.homedir(), '.pi', 'agent');
  if (configured === '~') return os.homedir();
  if (configured.startsWith('~/')) return path.join(os.homedir(), configured.slice(2));
  return path.resolve(configured);
}

function activePath(): string {
  return path.join(piAgentDir(), ACTIVE_FILE);
}

function namedPath(name: string): string {
  return path.join(piAgentDir(), `${NAMED_PREFIX}${name}${NAMED_SUFFIX}`);
}

function assertValidProfileName(name: string): void {
  if (!NAME_RE.test(name) || name === 'json' || name.includes('..')) {
    throw new Error(
      `Invalid profile name "${name}". Use 1–64 chars: letters, digits, dot, underscore, hyphen; must start with alphanumeric.`,
    );
  }
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!PROVIDER_RE.test(normalized)) throw new Error(`Invalid Pi model provider "${provider}"`);
  return normalized;
}

function fingerprintToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function credentialFingerprint(credential: PiCredential | null): string | null {
  if (credential?.type === 'oauth') return fingerprintToken(credential.access);
  if (credential?.type === 'api_key' && typeof credential.key === 'string' && credential.key) {
    return fingerprintToken(credential.key);
  }
  return null;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseCredential(value: unknown): PiCredential | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const credential = value as Record<string, unknown>;
  if (
    credential.type === 'oauth'
    && typeof credential.access === 'string'
    && credential.access
    && typeof credential.refresh === 'string'
    && credential.refresh
    && typeof credential.expires === 'number'
  ) {
    return credential as PiOAuthCredential;
  }
  if (credential.type === 'api_key') return credential as PiApiKeyCredential;
  return null;
}

function parseCredentialFile(filePath: string, provider: string): ParsedPiCredentialFile | null {
  if (!fs.existsSync(filePath)) return null;
  const data = readJsonObject(filePath);
  if (!data) return { data: {}, credential: null, fingerprint: null, valid: false };
  const credential = parseCredential(data[provider]);
  const fingerprint = credentialFingerprint(credential);
  const valid = credential?.type === 'oauth'
    ? Boolean(fingerprint)
    : credential?.type === 'api_key' && Boolean(fingerprint);
  return { data, credential, fingerprint, valid };
}

function fileMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function toMeta(
  provider: string,
  id: string,
  name: string,
  filePath: string,
  parsed: ParsedPiCredentialFile | null,
  isActive: boolean,
  matchesNamed: string | null,
): PiCredentialProfileMeta {
  return {
    id,
    name,
    isActive,
    path: filePath,
    valid: parsed?.valid ?? false,
    fingerprint: parsed?.fingerprint ?? null,
    provider,
    label: SUBSCRIPTION_LABELS[provider] ?? provider,
    credentialType: parsed?.credential?.type ?? null,
    expiresAt: parsed?.credential?.type === 'oauth' ? parsed.credential.expires : null,
    detail: null,
    source: 'pi',
    mtimeMs: fileMtime(filePath),
    matchesNamed,
  };
}

function listNamedProfileNames(provider: string): string[] {
  const dir = piAgentDir();
  if (!fs.existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry === ACTIVE_FILE || !entry.startsWith(NAMED_PREFIX) || !entry.endsWith(NAMED_SUFFIX)) continue;
    const name = entry.slice(NAMED_PREFIX.length, entry.length - NAMED_SUFFIX.length);
    if (!NAME_RE.test(name) || name === 'json' || name.includes('..')) continue;
    if (parseCredentialFile(namedPath(name), provider)?.credential) names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

function credentialFromClaudeProfile(filePath: string): PiOAuthCredential | null {
  const data = readJsonObject(filePath);
  const oauth = data?.claudeAiOauth;
  if (!oauth || typeof oauth !== 'object' || Array.isArray(oauth)) return null;
  const value = oauth as Record<string, unknown>;
  if (
    typeof value.accessToken !== 'string'
    || !value.accessToken
    || typeof value.refreshToken !== 'string'
    || !value.refreshToken
  ) return null;
  return {
    type: 'oauth',
    access: value.accessToken,
    refresh: value.refreshToken,
    expires: typeof value.expiresAt === 'number' ? value.expiresAt : 0,
  };
}

function credentialFromNativeProviderProfile(
  source: CredentialProviderId,
  filePath: string,
  expiresAt: number | null,
): PiOAuthCredential | null {
  const data = readJsonObject(filePath);
  if (!data) return null;

  if (source === 'codex') {
    const tokens = data.tokens;
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
    const value = tokens as Record<string, unknown>;
    if (
      typeof value.access_token !== 'string'
      || !value.access_token
      || typeof value.refresh_token !== 'string'
      || !value.refresh_token
    ) return null;
    const accountId = typeof value.account_id === 'string' && value.account_id
      ? value.account_id
      : undefined;
    return {
      type: 'oauth',
      access: value.access_token,
      refresh: value.refresh_token,
      expires: expiresAt ?? 0,
      ...(accountId ? { accountId } : {}),
    };
  }

  for (const raw of Object.values(data)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const value = raw as Record<string, unknown>;
    if (
      typeof value.key !== 'string'
      || !value.key
      || typeof value.refresh_token !== 'string'
      || !value.refresh_token
    ) continue;
    const rawExpiry = value.expires_at ?? value.expiresAt;
    const parsedExpiry = typeof rawExpiry === 'number'
      ? rawExpiry
      : typeof rawExpiry === 'string'
        ? Date.parse(rawExpiry)
        : Number.NaN;
    return {
      type: 'oauth',
      access: value.key,
      refresh: value.refresh_token,
      expires: Number.isFinite(parsedExpiry) ? parsedExpiry : (expiresAt ?? 0),
    };
  }
  return null;
}

function claudeProfileMeta(
  provider: string,
  profile: ClaudeCredentialProfileMeta,
  activeFingerprint: string | null,
): PiCredentialProfileMeta {
  const detail = [profile.subscriptionType, profile.rateLimitTier].filter(Boolean).join(' · ') || null;
  return {
    id: profile.id,
    name: profile.name,
    isActive: Boolean(activeFingerprint) && profile.fingerprint === activeFingerprint,
    path: profile.path,
    valid: profile.valid,
    fingerprint: profile.fingerprint,
    provider,
    label: SUBSCRIPTION_LABELS[provider],
    credentialType: 'oauth',
    expiresAt: profile.expiresAt,
    detail,
    source: 'claude',
    mtimeMs: profile.mtimeMs,
    matchesNamed: null,
  };
}

function nativeProviderProfileMeta(
  provider: string,
  source: CredentialProviderId,
  profile: ProviderCredentialProfileMeta,
  activeFingerprint: string | null,
): PiCredentialProfileMeta {
  const credential = credentialFromNativeProviderProfile(source, profile.path, profile.expiresAt);
  return {
    id: profile.id,
    name: profile.name,
    isActive: Boolean(activeFingerprint) && profile.fingerprint === activeFingerprint,
    path: profile.path,
    valid: profile.valid && Boolean(credential),
    fingerprint: profile.fingerprint,
    provider,
    label: SUBSCRIPTION_LABELS[provider] ?? provider,
    credentialType: credential ? 'oauth' : null,
    expiresAt: profile.expiresAt,
    detail: [profile.email, profile.label].filter(Boolean).join(' · ') || null,
    source,
    mtimeMs: profile.mtimeMs,
    matchesNamed: null,
  };
}

/**
 * List the account choices for one Pi model provider. Anthropic reuses the
 * operator's existing Claude named sessions, while auth.<name>.json remains
 * available for Pi-only/custom providers.
 */
export function listPiCredentialProfiles(modelProvider: string): PiCredentialsList {
  const provider = normalizeProvider(modelProvider);
  const activeFile = activePath();
  const activeParsed = parseCredentialFile(activeFile, provider);
  const profiles: PiCredentialProfileMeta[] = [];
  const usedNames = new Set<string>();
  let profileDir: string | null = null;

  if (provider === 'anthropic') {
    const claudeAccounts = listClaudeCredentialProfiles();
    profileDir = claudeAccounts.claudeDir;
    for (const profile of claudeAccounts.profiles) {
      profiles.push(claudeProfileMeta(provider, profile, activeParsed?.fingerprint ?? null));
      usedNames.add(profile.name);
    }
  } else if (provider === 'openai-codex' || provider === 'xai') {
    const source: CredentialProviderId = provider === 'openai-codex' ? 'codex' : 'grok';
    const nativeAccounts = listProviderCredentialProfiles(source);
    profileDir = nativeAccounts.dir;
    for (const profile of nativeAccounts.profiles) {
      profiles.push(nativeProviderProfileMeta(provider, source, profile, activeParsed?.fingerprint ?? null));
      usedNames.add(profile.name);
    }
  }

  for (const name of listNamedProfileNames(provider)) {
    if (usedNames.has(name)) continue;
    const profilePath = namedPath(name);
    const parsed = parseCredentialFile(profilePath, provider);
    const isActive = Boolean(activeParsed?.fingerprint)
      && parsed?.fingerprint === activeParsed?.fingerprint;
    profiles.push(toMeta(provider, name, name, profilePath, parsed, isActive, null));
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name));

  const activeMatch = activeParsed?.fingerprint
    ? profiles.find((profile) => profile.fingerprint === activeParsed.fingerprint)?.name ?? null
    : null;
  const active = fs.existsSync(activeFile)
    ? toMeta(provider, 'active', 'active', activeFile, activeParsed, true, activeMatch)
    : null;

  return { provider, dir: piAgentDir(), profileDir, active, profiles };
}

function ensurePiDir(): void {
  const dir = piAgentDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writeDataAtomic(filePath: string, data: Record<string, unknown>): void {
  ensurePiDir();
  const tmp = path.join(piAgentDir(), `.auth.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on platforms that ignore modes
  }
}

function writeProviderCredential(filePath: string, provider: string, credential: PiCredential): void {
  const current = readJsonObject(filePath) ?? {};
  current[provider] = credential;
  writeDataAtomic(filePath, current);
}

export function switchPiCredentialProfile(
  modelProvider: string,
  name: string,
  opts: { stashActiveAs?: string } = {},
): PiCredentialsSwitchResult {
  const provider = normalizeProvider(modelProvider);
  assertValidProfileName(name);
  const listing = listPiCredentialProfiles(provider);
  const targetMeta = listing.profiles.find((profile) => profile.name === name);
  const targetCredential = targetMeta?.source === 'claude'
    ? credentialFromClaudeProfile(targetMeta.path)
    : targetMeta?.source === 'codex' || targetMeta?.source === 'grok'
      ? credentialFromNativeProviderProfile(targetMeta.source, targetMeta.path, targetMeta.expiresAt)
      : parseCredentialFile(namedPath(name), provider)?.credential ?? null;
  if (!targetMeta?.valid || !targetCredential) {
    throw new Error(`Named profile "${name}" has no valid ${provider} credentials`);
  }

  const activeParsed = parseCredentialFile(activePath(), provider);
  const previousMatchesNamed = listing.active?.matchesNamed ?? null;
  let stashedAs: string | null = null;

  if (listing.active?.valid && activeParsed?.credential) {
    if (!previousMatchesNamed && listing.active.fingerprint !== targetMeta.fingerprint) {
      const stash = opts.stashActiveAs?.trim();
      if (!stash) {
        throw new Error(
          'Active credentials are not saved as a named profile. Pass stashActiveAs to keep them before switching.',
        );
      }
      assertValidProfileName(stash);
      if (stash === name) throw new Error('stashActiveAs cannot be the same as the profile you are switching to');
      const stashExisting = listing.profiles.find((profile) => profile.name === stash);
      if (stashExisting?.fingerprint && stashExisting.fingerprint !== listing.active.fingerprint) {
        throw new Error(`Profile "${stash}" already exists with different ${provider} credentials. Choose another name.`);
      }
      writeProviderCredential(namedPath(stash), provider, activeParsed.credential);
      stashedAs = stash;
      log.log(`Stashed previous Pi ${provider} credentials as profile "${stash}"`);
    } else if (
      previousMatchesNamed
      && listing.profiles.find((profile) => profile.name === previousMatchesNamed)?.source === 'pi'
    ) {
      // Keep Pi-owned named copies synchronized if Pi refreshed its active token.
      writeProviderCredential(namedPath(previousMatchesNamed), provider, activeParsed.credential);
    }
  }

  // Replace only this model provider's login; every other Pi provider remains intact.
  writeProviderCredential(activePath(), provider, targetCredential);
  clearProfileUsageCache();
  log.log(`Switched active Pi ${provider} credentials to profile "${name}"`);

  const after = listPiCredentialProfiles(provider);
  if (!after.active) throw new Error('Active Pi credentials missing after switch');
  return { ok: true, active: after.active, profiles: after.profiles, stashedAs, previousMatchesNamed };
}

export function saveActivePiCredentialProfile(
  modelProvider: string,
  name: string,
  opts: { force?: boolean } = {},
): PiCredentialsList {
  const provider = normalizeProvider(modelProvider);
  assertValidProfileName(name);
  const active = parseCredentialFile(activePath(), provider);
  if (!active?.valid || !active.credential) throw new Error(`No valid active Pi ${provider} credentials to save`);

  const destination = namedPath(name);
  const listed = listPiCredentialProfiles(provider).profiles.find((profile) => profile.name === name);
  if (listed && listed.source !== 'pi') {
    if (listed.fingerprint === active.fingerprint) return listPiCredentialProfiles(provider);
    throw new Error(`Profile "${name}" is managed by ${listed.source} accounts. Choose another name.`);
  }
  const existing = parseCredentialFile(destination, provider);
  if (existing?.fingerprint && existing.fingerprint !== active.fingerprint && !opts.force) {
    throw new Error(`Profile "${name}" already exists with different credentials. Pass force=true to overwrite.`);
  }
  writeProviderCredential(destination, provider, active.credential);
  log.log(`Saved active Pi ${provider} credentials as profile "${name}"`);
  return listPiCredentialProfiles(provider);
}

export function renamePiCredentialProfile(modelProvider: string, from: string, to: string): PiCredentialsList {
  const provider = normalizeProvider(modelProvider);
  assertValidProfileName(from);
  assertValidProfileName(to);
  if (from === to) return listPiCredentialProfiles(provider);
  const listing = listPiCredentialProfiles(provider);
  const profile = listing.profiles.find((entry) => entry.name === from);
  if (!profile) throw new Error(`Named profile "${from}" not found`);
  if (listing.profiles.some((entry) => entry.name === to)) throw new Error(`Profile "${to}" already exists`);
  if (profile.source === 'claude') {
    renameClaudeCredentialProfile(from, to);
  } else if (profile.source === 'codex' || profile.source === 'grok') {
    renameProviderCredentialProfile(profile.source, from, to);
  } else {
    fs.renameSync(namedPath(from), namedPath(to));
    try {
      fs.chmodSync(namedPath(to), 0o600);
    } catch {
      // best-effort
    }
  }
  return listPiCredentialProfiles(provider);
}

export function deletePiCredentialProfile(modelProvider: string, name: string): PiCredentialsList {
  const provider = normalizeProvider(modelProvider);
  assertValidProfileName(name);
  const profile = listPiCredentialProfiles(provider).profiles.find((entry) => entry.name === name);
  if (!profile) throw new Error(`Named profile "${name}" not found`);
  if (profile.source === 'claude') deleteClaudeCredentialProfile(name);
  else if (profile.source === 'codex' || profile.source === 'grok') {
    deleteProviderCredentialProfile(profile.source, name);
  } else fs.unlinkSync(namedPath(name));
  return listPiCredentialProfiles(provider);
}

interface ProfileTokenGroup {
  ids: string[];
  paths: string[];
  includesActive: boolean;
  credential: PiOAuthCredential;
}

interface ProfileUsageCacheEntry {
  rateLimits: ClaudeRateLimits | null;
  quotaWindows: PiQuotaWindow[];
  error: string | null;
  fetchedAt: number;
  validUntil: number;
}

const profileUsageCache = new Map<string, ProfileUsageCacheEntry>();
const profileUsageInFlight = new Map<string, Promise<ProfileUsageCacheEntry>>();
const xaiUsageCache = new Map<string, ProfileUsageCacheEntry>();
const xaiUsageInFlight = new Map<string, Promise<ProfileUsageCacheEntry>>();

function quotaWindow(
  key: PiQuotaWindowKey,
  window: ClaudeRateLimitWindow | CodexRateLimitWindow | GrokRateLimitWindow | null,
): PiQuotaWindow | null {
  return window ? { key, ...window } : null;
}

function compactWindows(windows: Array<PiQuotaWindow | null>): PiQuotaWindow[] {
  return windows.filter((window): window is PiQuotaWindow => window !== null);
}

function anthropicQuotaWindows(limits: ClaudeRateLimits | null): PiQuotaWindow[] {
  if (!limits) return [];
  return compactWindows([
    quotaWindow('session', limits.fiveHour),
    quotaWindow('weekly', limits.sevenDay),
    quotaWindow('weekly-opus', limits.sevenDayOpus),
    quotaWindow('weekly-fable', limits.sevenDayFable),
  ]);
}

function friendlyCodexUsageError(error: string | null | undefined): string | null {
  if (!error) return null;
  if (/token_expired|401 Unauthorized|authentication token is expired/i.test(error)) {
    return 'Session expired — sign in to this Codex account again';
  }
  return error.split('\n')[0];
}

function codexQuotaWindows(
  limits: { daily: CodexRateLimitWindow | null; weekly: CodexRateLimitWindow | null } | null,
): PiQuotaWindow[] {
  if (!limits) return [];
  return compactWindows([
    quotaWindow('daily', limits.daily),
    quotaWindow('weekly', limits.weekly),
  ]);
}

function grokQuotaWindows(
  limits: {
    weekly: GrokRateLimitWindow | null;
    monthly: GrokRateLimitWindow | null;
    onDemand: GrokRateLimitWindow | null;
  } | null,
): PiQuotaWindow[] {
  if (!limits) return [];
  return compactWindows([
    quotaWindow('weekly', limits.weekly),
    quotaWindow('monthly', limits.monthly),
    quotaWindow('on-demand', limits.onDemand),
  ]);
}

function clearProfileUsageCache(): void {
  profileUsageCache.clear();
  profileUsageInFlight.clear();
  xaiUsageCache.clear();
  xaiUsageInFlight.clear();
}

export function resetPiSubscriptionUsageCacheForTests(): void {
  clearProfileUsageCache();
}

async function refreshAnthropicCredential(
  credential: PiOAuthCredential,
): Promise<{ credential: PiOAuthCredential } | { error: string }> {
  try {
    const response = await fetch(ANTHROPIC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: ANTHROPIC_CLIENT_ID,
        refresh_token: credential.refresh,
      }),
      signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { error: `Token refresh failed (${response.status}) — sign in to this account again` };
    }
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.access_token !== 'string' || !body.access_token) {
      return { error: 'Token refresh returned no access token' };
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    return {
      credential: {
        ...credential,
        type: 'oauth',
        access: body.access_token,
        refresh: typeof body.refresh_token === 'string' && body.refresh_token
          ? body.refresh_token
          : credential.refresh,
        // Match Pi's own five-minute early-expiry safety window.
        expires: Date.now() + expiresIn * 1000 - 5 * 60_000,
      },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { error: `Could not reach the OAuth token endpoint (${reason})` };
  }
}

function persistRefreshedGroup(group: ProfileTokenGroup, credential: PiOAuthCredential): boolean {
  const changed = group.paths.some((filePath) => {
    const current = parseCredentialFile(filePath, 'anthropic')?.credential;
    return current?.type !== 'oauth' || current.refresh !== group.credential.refresh;
  });
  if (changed) {
    log.warn(`Pi Anthropic credentials changed during refresh; preserving newer on-disk grant (${group.ids.join(', ')})`);
    return false;
  }
  for (const filePath of group.paths) writeProviderCredential(filePath, 'anthropic', credential);
  return true;
}

function fetchUsageForGroup(cacheKey: string, group: ProfileTokenGroup): Promise<ProfileUsageCacheEntry> {
  const cached = profileUsageCache.get(cacheKey);
  if (cached && cached.validUntil > Date.now()) return Promise.resolve(cached);
  const pending = profileUsageInFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async (): Promise<ProfileUsageCacheEntry> => {
    let credential = group.credential;
    if (!group.includesActive && credential.expires <= Date.now()) {
      const refreshed = await refreshAnthropicCredential(credential);
      if ('error' in refreshed) {
        const entry = {
          rateLimits: null,
          quotaWindows: [],
          error: refreshed.error,
          fetchedAt: Date.now(),
          validUntil: Date.now() + PROFILE_REFRESH_FAIL_TTL_MS,
        };
        profileUsageCache.set(cacheKey, entry);
        return entry;
      }
      persistRefreshedGroup(group, refreshed.credential);
      credential = refreshed.credential;
    }

    const result = await fetchClaudeRateLimitsForToken(credential.access);
    const entry = {
      rateLimits: result.rateLimits,
      quotaWindows: anthropicQuotaWindows(result.rateLimits),
      error: result.error,
      fetchedAt: Date.now(),
      validUntil: Date.now() + (result.error ? PROFILE_USAGE_TTL_ERR_MS : PROFILE_USAGE_TTL_OK_MS),
    };
    profileUsageCache.set(cacheKey, entry);
    return entry;
  })().finally(() => profileUsageInFlight.delete(cacheKey));

  profileUsageInFlight.set(cacheKey, request);
  return request;
}

function fetchXaiUsage(cacheKey: string, accessToken: string): Promise<ProfileUsageCacheEntry> {
  const cached = xaiUsageCache.get(cacheKey);
  if (cached && cached.validUntil > Date.now()) return Promise.resolve(cached);
  const pending = xaiUsageInFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async (): Promise<ProfileUsageCacheEntry> => {
    const result = await fetchGrokRateLimitsForToken(accessToken);
    const entry: ProfileUsageCacheEntry = {
      rateLimits: null,
      quotaWindows: grokQuotaWindows(result.rateLimits),
      error: result.error,
      fetchedAt: Date.now(),
      validUntil: Date.now() + (result.error ? PROFILE_USAGE_TTL_ERR_MS : PROFILE_USAGE_TTL_OK_MS),
    };
    xaiUsageCache.set(cacheKey, entry);
    return entry;
  })().finally(() => xaiUsageInFlight.delete(cacheKey));

  xaiUsageInFlight.set(cacheKey, request);
  return request;
}

/** Fetch usage for every named login of the selected Pi model provider. */
export async function getPiCredentialProfilesUsage(modelProvider: string): Promise<PiProfilesUsageResult> {
  const provider = normalizeProvider(modelProvider);
  const list = listPiCredentialProfiles(provider);
  const candidates = [...(list.active ? [list.active] : []), ...list.profiles];
  const usage: PiProfileUsage[] = [];

  if (provider === 'openai-codex') {
    // Reuse Codex's native per-account app-server reads. This exposes the same
    // daily/weekly plan windows in Pi without ever returning OAuth secrets.
    const nativeList = listProviderCredentialProfiles('codex');
    const nativeCandidates = [...(nativeList.active ? [nativeList.active] : []), ...nativeList.profiles];
    const nativeUsage = await getCodexCredentialProfilesUsage();
    const nativeUsageById = new Map(nativeUsage.usage.map((entry) => [entry.id, entry]));

    for (const meta of candidates) {
      const nativeMeta = meta.source === 'codex'
        ? nativeCandidates.find((candidate) => candidate.id === meta.id)
        : nativeCandidates.find((candidate) => Boolean(meta.fingerprint) && candidate.fingerprint === meta.fingerprint);
      const entry = nativeMeta ? nativeUsageById.get(nativeMeta.id) : undefined;
      const credential = meta.source === 'codex'
        ? credentialFromNativeProviderProfile('codex', meta.path, meta.expiresAt)
        : parseCredentialFile(meta.path, provider)?.credential ?? null;
      usage.push({
        id: meta.id,
        rateLimits: null,
        quotaWindows: codexQuotaWindows(entry?.rateLimits ?? null),
        error: friendlyCodexUsageError(entry?.error)
          ?? (entry
            ? null
            : credential?.type === 'api_key'
              ? 'This profile uses an API key, not a subscription'
              : meta.valid
                ? 'Live limits require a matching saved Codex account'
                : 'Invalid credentials file'),
        fetchedAt: entry?.fetchedAt ?? Date.now(),
      });
    }
    return { usage };
  }

  if (provider === 'xai') {
    const groups = new Map<string, { ids: string[]; accessToken: string }>();
    for (const meta of candidates) {
      const credential = meta.source === 'grok'
        ? credentialFromNativeProviderProfile('grok', meta.path, meta.expiresAt)
        : parseCredentialFile(meta.path, provider)?.credential ?? null;
      if (credential?.type !== 'oauth') {
        usage.push({
          id: meta.id,
          rateLimits: null,
          quotaWindows: [],
          error: credential?.type === 'api_key'
            ? 'This profile uses an API key, not a subscription'
            : 'Invalid credentials file',
          fetchedAt: Date.now(),
        });
        continue;
      }
      const key = fingerprintToken(credential.access);
      const existing = groups.get(key);
      if (existing) existing.ids.push(meta.id);
      else groups.set(key, { ids: [meta.id], accessToken: credential.access });
    }
    await Promise.all(Array.from(groups.entries()).map(async ([key, group]) => {
      const entry = await fetchXaiUsage(key, group.accessToken);
      for (const id of group.ids) {
        usage.push({
          id,
          rateLimits: null,
          quotaWindows: entry.quotaWindows,
          error: entry.error,
          fetchedAt: entry.fetchedAt,
        });
      }
    }));
    return { usage };
  }

  if (provider !== 'anthropic') {
    return {
      usage: candidates.map((meta) => ({
        id: meta.id,
        rateLimits: null,
        quotaWindows: [],
        error: meta.valid ? `Live usage gauges are not available for ${provider}` : 'Invalid credentials file',
        fetchedAt: Date.now(),
      })),
    };
  }

  // Claude-owned profiles already have robust grant refresh/rotation handling;
  // reuse their exact gauges rather than duplicating those requests in Pi.
  const claudeProfiles = list.profiles.filter((profile) => profile.source === 'claude');
  const claudeUsage = claudeProfiles.length > 0
    ? await getClaudeCredentialProfilesUsage()
    : { usage: [] };
  const claudeUsageById = new Map(claudeUsage.usage.map((entry) => [entry.id, entry]));
  for (const profile of claudeProfiles) {
    const entry = claudeUsageById.get(profile.id);
    const rateLimits = entry?.rateLimits ?? null;
    usage.push({
      id: profile.id,
      rateLimits,
      quotaWindows: anthropicQuotaWindows(rateLimits),
      error: entry ? entry.error : (profile.valid ? 'Usage unavailable' : 'Invalid credentials file'),
      fetchedAt: entry?.fetchedAt ?? Date.now(),
    });
  }

  const activeMatch = list.active?.matchesNamed
    ? list.profiles.find((profile) => profile.name === list.active?.matchesNamed)
    : undefined;
  if (activeMatch?.source === 'claude') {
    const matchedUsage = usage.find((entry) => entry.id === activeMatch.id);
    usage.push({
      id: 'active',
      rateLimits: matchedUsage?.rateLimits ?? null,
      quotaWindows: matchedUsage?.quotaWindows ?? [],
      error: matchedUsage?.error ?? null,
      fetchedAt: matchedUsage?.fetchedAt ?? Date.now(),
    });
  }

  const piCandidates = candidates.filter((meta) =>
    meta.source === 'pi' && !(meta.id === 'active' && activeMatch?.source === 'claude'));
  const groups = new Map<string, ProfileTokenGroup>();
  for (const meta of piCandidates) {
    const credential = parseCredentialFile(meta.path, provider)?.credential;
    if (credential?.type !== 'oauth') {
      usage.push({
        id: meta.id,
        rateLimits: null,
        quotaWindows: [],
        error: credential?.type === 'api_key'
          ? 'This profile uses an API key, not a subscription'
          : 'Invalid credentials file',
        fetchedAt: Date.now(),
      });
      continue;
    }
    const key = fingerprintToken(credential.refresh || credential.access);
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(meta.id);
      if (!existing.paths.includes(meta.path)) existing.paths.push(meta.path);
      existing.includesActive = existing.includesActive || meta.id === 'active' || meta.isActive;
      if (credential.expires > existing.credential.expires) existing.credential = credential;
    } else {
      groups.set(key, {
        ids: [meta.id],
        paths: [meta.path],
        includesActive: meta.id === 'active' || meta.isActive,
        credential,
      });
    }
  }

  await Promise.all(Array.from(groups.entries()).map(async ([key, group]) => {
    const entry = await fetchUsageForGroup(key, group);
    for (const id of group.ids) {
      usage.push({
        id,
        rateLimits: entry.rateLimits,
        quotaWindows: entry.quotaWindows,
        error: entry.error,
        fetchedAt: entry.fetchedAt,
      });
    }
  }));

  return { usage };
}

function providerFromModelReference(model: string | undefined): string | null {
  const normalized = model?.trim();
  if (!normalized) return null;
  const slash = normalized.indexOf('/');
  return slash > 0 ? normalized.slice(0, slash).toLowerCase() : null;
}

/** Resolve the upstream provider selected by a Pi agent without exposing auth. */
export function resolvePiModelProvider(agent: Agent): string | null {
  const explicit = providerFromModelReference(agent.piModel);
  if (explicit) return explicit;
  if (agent.piModelProvider?.trim()) return agent.piModelProvider.trim().toLowerCase();
  const reported = providerFromModelReference(agent.contextStats?.model);
  if (reported) return reported;
  const configured = readJsonObject(path.join(piAgentDir(), 'settings.json'))?.defaultProvider;
  return typeof configured === 'string' && configured.trim()
    ? configured.trim().toLowerCase()
    : null;
}

function loadedSubscriptions(modelProvider: string | null): PiLoadedSubscription[] {
  const data = readJsonObject(activePath()) ?? {};
  return Object.entries(data)
    .filter(([provider, value]) => parseCredential(value)?.type === 'oauth' && provider in SUBSCRIPTION_LABELS)
    .map(([provider]) => ({ provider, label: SUBSCRIPTION_LABELS[provider], active: provider === modelProvider }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label));
}

export async function buildPiSubscriptionUsageSnapshot(agent: Agent): Promise<PiSubscriptionUsageSnapshot> {
  const modelProvider = resolvePiModelProvider(agent);
  const activeCredential = modelProvider
    ? parseCredentialFile(activePath(), normalizeProvider(modelProvider))?.credential ?? null
    : null;
  let rateLimits: ClaudeRateLimits | null = null;
  let quotaWindows: PiQuotaWindow[] = [];
  let rateLimitsError: string | null = null;
  let cliHint = modelProvider
    ? `Pi does not expose live plan-limit gauges for ${modelProvider}.`
    : 'Select an explicit provider/model for this Pi agent to match subscription usage.';

  if (modelProvider && ['anthropic', 'openai-codex', 'xai'].includes(modelProvider)) {
    cliHint = 'Use the Pi accounts panel below to compare remaining limits or switch subscriptions.';
    const profileUsage = await getPiCredentialProfilesUsage(modelProvider);
    const activeUsage = profileUsage.usage.find((entry) => entry.id === 'active');
    rateLimits = activeUsage?.rateLimits ?? null;
    quotaWindows = activeUsage?.quotaWindows ?? [];
    rateLimitsError = activeUsage
      ? activeUsage.error
      : `No ${modelProvider} subscription is loaded in Pi.`;
  }

  return {
    provider: 'pi',
    fetchedAt: Date.now(),
    modelProvider,
    credentialType: activeCredential?.type ?? null,
    subscriptions: loadedSubscriptions(modelProvider),
    session: {
      tokensUsed: agent.tokensUsed ?? 0,
      contextUsed: agent.contextUsed ?? 0,
      contextLimit: agent.contextLimit ?? 200_000,
      taskCount: agent.taskCount ?? 0,
      lastActivity: agent.lastActivity ?? 0,
    },
    rateLimits,
    quotaWindows,
    rateLimitsError,
    cliHint,
  };
}
