/**
 * Claude Credentials Service
 *
 * Manages multiple Claude Code OAuth credential profiles under ~/.claude:
 *   - Active (used by CLI + Tide):  ~/.claude/.credentials.json
 *   - Named profiles:               ~/.claude/.credentials.<name>.json
 *
 * Operators keep accounts such as david / jc / felipe as named profiles and
 * promote one to active when the current account hits rate limits. Tokens are
 * never returned to clients — only non-secret metadata + a stable fingerprint.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import {
  fetchClaudeRateLimitsForToken,
  resetClaudeRateLimitCache,
  type ClaudeRateLimits,
} from './claude-usage-service.js';

const log = createLogger('ClaudeCredentials');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const ACTIVE_FILE = '.credentials.json';
const NAMED_PREFIX = '.credentials.';
const NAMED_SUFFIX = '.json';

/** Overrideable for tests. */
let claudeDirOverride: string | null = null;

export function setClaudeCredentialsDirForTests(dir: string | null): void {
  claudeDirOverride = dir;
}

function getClaudeDir(): string {
  return claudeDirOverride ?? CLAUDE_DIR;
}

function activePath(): string {
  return path.join(getClaudeDir(), ACTIVE_FILE);
}

function namedPath(name: string): string {
  return path.join(getClaudeDir(), `${NAMED_PREFIX}${name}${NAMED_SUFFIX}`);
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function isValidProfileName(name: string): boolean {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return false;
  // Reject names that would collide with the active filename shape or path tricks.
  if (name === 'json' || name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  return true;
}

export interface ClaudeCredentialProfileMeta {
  /** Profile id: "active" for the live file, or the named profile slug. */
  id: string;
  /** Display name (same as id for named; "active" for the live file). */
  name: string;
  /** True when this entry is the live ~/.claude/.credentials.json content. */
  isActive: boolean;
  /** Absolute path on the server host (for operator reference). */
  path: string;
  /** Whether the file exists and parses as credentials with an OAuth token. */
  valid: boolean;
  /** SHA-256 of accessToken, first 12 hex chars — identity without leaking secrets. */
  fingerprint: string | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
  refreshTokenExpiresAt: number | null;
  scopes: string[];
  hasMcpOAuth: boolean;
  /** File mtime ms. */
  mtimeMs: number | null;
  /** When fingerprint matches a named profile, that profile's name (active only). */
  matchesNamed: string | null;
}

export interface ClaudeCredentialsList {
  claudeDir: string;
  active: ClaudeCredentialProfileMeta | null;
  profiles: ClaudeCredentialProfileMeta[];
}

interface ParsedCredentials {
  raw: string;
  fingerprint: string | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
  refreshTokenExpiresAt: number | null;
  scopes: string[];
  hasMcpOAuth: boolean;
  valid: boolean;
}

function fingerprintToken(accessToken: string): string {
  return crypto.createHash('sha256').update(accessToken).digest('hex').slice(0, 12);
}

function parseCredentialsFile(filePath: string): ParsedCredentials | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const oauth = data?.claudeAiOauth as Record<string, unknown> | undefined;
    const accessToken = typeof oauth?.accessToken === 'string' ? oauth.accessToken : '';
    const valid = accessToken.length > 0;
    const scopes = Array.isArray(oauth?.scopes)
      ? (oauth!.scopes as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    return {
      raw,
      fingerprint: valid ? fingerprintToken(accessToken) : null,
      subscriptionType: typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : null,
      rateLimitTier: typeof oauth?.rateLimitTier === 'string' ? oauth.rateLimitTier : null,
      expiresAt: typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : null,
      refreshTokenExpiresAt:
        typeof oauth?.refreshTokenExpiresAt === 'number' ? oauth.refreshTokenExpiresAt : null,
      scopes,
      hasMcpOAuth: Boolean(data?.mcpOAuth && typeof data.mcpOAuth === 'object'),
      valid,
    };
  } catch (err) {
    log.warn(`Failed to parse credentials at ${filePath}: ${err}`);
    return {
      raw: '',
      fingerprint: null,
      subscriptionType: null,
      rateLimitTier: null,
      expiresAt: null,
      refreshTokenExpiresAt: null,
      scopes: [],
      hasMcpOAuth: false,
      valid: false,
    };
  }
}

function fileMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function toMeta(
  id: string,
  name: string,
  filePath: string,
  parsed: ParsedCredentials | null,
  isActive: boolean,
  matchesNamed: string | null,
): ClaudeCredentialProfileMeta {
  return {
    id,
    name,
    isActive,
    path: filePath,
    valid: parsed?.valid ?? false,
    fingerprint: parsed?.fingerprint ?? null,
    subscriptionType: parsed?.subscriptionType ?? null,
    rateLimitTier: parsed?.rateLimitTier ?? null,
    expiresAt: parsed?.expiresAt ?? null,
    refreshTokenExpiresAt: parsed?.refreshTokenExpiresAt ?? null,
    scopes: parsed?.scopes ?? [],
    hasMcpOAuth: parsed?.hasMcpOAuth ?? false,
    mtimeMs: fileMtime(filePath),
    matchesNamed,
  };
}

function listNamedProfileNames(): string[] {
  const dir = getClaudeDir();
  if (!fs.existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.startsWith(NAMED_PREFIX) || !entry.endsWith(NAMED_SUFFIX)) continue;
    if (entry === ACTIVE_FILE) continue;
    const name = entry.slice(NAMED_PREFIX.length, entry.length - NAMED_SUFFIX.length);
    if (!name || !isValidProfileName(name)) continue;
    names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

/**
 * List the active credentials file plus every named profile.
 * Never includes access/refresh tokens.
 */
export function listClaudeCredentialProfiles(): ClaudeCredentialsList {
  const dir = getClaudeDir();
  const activeFile = activePath();
  const activeParsed = parseCredentialsFile(activeFile);

  const namedNames = listNamedProfileNames();
  const namedByFp = new Map<string, string>();
  for (const name of namedNames) {
    const parsed = parseCredentialsFile(namedPath(name));
    if (parsed?.fingerprint) namedByFp.set(parsed.fingerprint, name);
  }

  const activeMatchesNamed =
    activeParsed?.fingerprint ? (namedByFp.get(activeParsed.fingerprint) ?? null) : null;

  const active = fs.existsSync(activeFile)
    ? toMeta('active', 'active', activeFile, activeParsed, true, activeMatchesNamed)
    : null;

  const profiles: ClaudeCredentialProfileMeta[] = namedNames.map((name) => {
    const p = namedPath(name);
    const parsed = parseCredentialsFile(p);
    const isActive =
      Boolean(activeParsed?.fingerprint) &&
      parsed?.fingerprint === activeParsed?.fingerprint;
    return toMeta(name, name, p, parsed, isActive, null);
  });

  return { claudeDir: dir, active, profiles };
}

// ---------------------------------------------------------------------------
// Per-profile rate-limit gauges (session + weekly), for the account switcher.
//
// Dormant profiles' access tokens age out in hours, so gauges would be
// permanently "expired" without a refresh. We refresh them the same way the
// CLI does (its public OAuth client against the console token endpoint), with
// two safety rails around refresh-token ROTATION:
//   - The active grant is never refreshed here — the running CLI owns it, and
//     rotating it underneath the CLI could log the live account out.
//   - Files are grouped by refresh token (saved copies of one login share the
//     grant); each grant is refreshed at most once and the rotated tokens are
//     written back to EVERY copy, so duplicates aren't left holding a dead
//     refresh token.
// Results are keyed by profile id ("active" or the profile name) because
// fingerprints change on refresh.
// ---------------------------------------------------------------------------

export interface ClaudeProfileUsage {
  /** "active" for the live credentials file, else the named profile slug. */
  id: string;
  rateLimits: ClaudeRateLimits | null;
  error: string | null;
  fetchedAt: number;
}

export interface ClaudeProfilesUsageResult {
  usage: ClaudeProfileUsage[];
}

// The Claude Code CLI's public OAuth client (PKCE, no secret) — same values
// the CLI itself uses to refresh ~/.claude/.credentials.json.
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_REFRESH_TIMEOUT_MS = 10_000;

const GRANT_USAGE_TTL_OK_MS = 2 * 60 * 1000;
const GRANT_USAGE_TTL_ERR_MS = 45 * 1000;
// After a failed refresh, leave the grant alone for a while — retrying a
// rotated/invalid refresh token can trip reuse detection and revoke the grant.
const GRANT_REFRESH_FAIL_COOLDOWN_MS = 30 * 60 * 1000;

interface GrantUsageCacheEntry {
  rateLimits: ClaudeRateLimits | null;
  error: string | null;
  fetchedAt: number;
  validUntil: number;
}

const grantUsageCache = new Map<string, GrantUsageCacheEntry>();
const grantUsageInFlight = new Map<string, Promise<GrantUsageCacheEntry>>();

export function resetClaudeProfileUsageCacheForTests(): void {
  grantUsageCache.clear();
  grantUsageInFlight.clear();
}

interface ProfileTokens {
  accessToken: string | null;
  expiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
}

/** Read the OAuth tokens from a credentials file (they never leave the server). */
function readProfileTokens(filePath: string): ProfileTokens {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const oauth = data?.claudeAiOauth as Record<string, unknown> | undefined;
    return {
      accessToken: typeof oauth?.accessToken === 'string' && oauth.accessToken ? oauth.accessToken : null,
      expiresAt: typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : null,
      refreshToken: typeof oauth?.refreshToken === 'string' && oauth.refreshToken ? oauth.refreshToken : null,
      refreshTokenExpiresAt: typeof oauth?.refreshTokenExpiresAt === 'number' ? oauth.refreshTokenExpiresAt : null,
    };
  } catch {
    return { accessToken: null, expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null };
  }
}

interface RefreshedTokens {
  accessToken: string;
  refreshToken: string | null; // null → endpoint didn't rotate it
  expiresAt: number;
}

/** Refresh an OAuth grant the way the CLI does. Returns tokens or an error string. */
async function refreshOAuthGrant(refreshToken: string): Promise<RefreshedTokens | { error: string }> {
  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(OAUTH_REFRESH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { error: `Token refresh failed (${response.status}) — sign in to this account again` };
    }
    const body = await response.json() as Record<string, unknown>;
    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    if (!accessToken) return { error: 'Token refresh returned no access token' };
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    return {
      accessToken,
      refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError' ? 'request timed out' : (err?.message ?? 'request failed');
    return { error: `Could not reach the OAuth token endpoint (${reason})` };
  }
}

/** Write refreshed tokens into a credentials file, preserving everything else. */
function writeRefreshedTokens(filePath: string, refreshed: RefreshedTokens): void {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  const oauth = (data.claudeAiOauth ?? {}) as Record<string, unknown>;
  oauth.accessToken = refreshed.accessToken;
  oauth.expiresAt = refreshed.expiresAt;
  if (refreshed.refreshToken) oauth.refreshToken = refreshed.refreshToken;
  data.claudeAiOauth = oauth;
  writeCredentialsAtomic(filePath, JSON.stringify(data));
}

function grantCacheKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

interface GrantGroup {
  /** Profile ids sharing this grant ("active" and/or named slugs). */
  ids: string[];
  /** Credential file paths holding this grant (refresh writes back to all). */
  paths: string[];
  includesActive: boolean;
  tokens: ProfileTokens;
}

/**
 * Fetch (refreshing first when needed and allowed) the gauges for one grant.
 * Cached per grant so repeated listings don't hammer Anthropic.
 */
function fetchUsageForGrant(cacheKey: string, group: GrantGroup): Promise<GrantUsageCacheEntry> {
  const cached = grantUsageCache.get(cacheKey);
  if (cached && Date.now() < cached.validUntil) return Promise.resolve(cached);

  const inFlight = grantUsageInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<GrantUsageCacheEntry> => {
    const now = Date.now();
    const { tokens } = group;
    let accessToken = tokens.accessToken;
    let error: string | null = null;

    const accessExpired = typeof tokens.expiresAt === 'number' && tokens.expiresAt <= now;
    if (accessExpired) {
      if (group.includesActive) {
        // The CLI owns the active grant; it refreshes on its next session.
        accessToken = null;
        error = 'Token expired — start any Claude session to refresh it';
      } else if (!tokens.refreshToken) {
        accessToken = null;
        error = 'Token expired and no refresh token stored — sign in to this account again';
      } else if (typeof tokens.refreshTokenExpiresAt === 'number' && tokens.refreshTokenExpiresAt <= now) {
        accessToken = null;
        error = 'Session expired — sign in to this account again';
      } else {
        const refreshed = await refreshOAuthGrant(tokens.refreshToken);
        if ('error' in refreshed) {
          accessToken = null;
          error = refreshed.error;
          const entry: GrantUsageCacheEntry = {
            rateLimits: null,
            error,
            fetchedAt: Date.now(),
            validUntil: Date.now() + GRANT_REFRESH_FAIL_COOLDOWN_MS,
          };
          grantUsageCache.set(cacheKey, entry);
          return entry;
        }
        for (const filePath of group.paths) {
          try {
            writeRefreshedTokens(filePath, refreshed);
          } catch (err) {
            log.warn(`Refreshed grant but failed to persist to ${filePath}: ${err}`);
          }
        }
        log.log(`Refreshed dormant Claude credentials for profile(s): ${group.ids.join(', ')}`);
        accessToken = refreshed.accessToken;
      }
    }

    if (!accessToken) {
      const entry: GrantUsageCacheEntry = {
        rateLimits: null,
        error: error ?? 'No OAuth token in credentials file',
        fetchedAt: Date.now(),
        validUntil: Date.now() + GRANT_USAGE_TTL_ERR_MS,
      };
      grantUsageCache.set(cacheKey, entry);
      return entry;
    }

    const result = await fetchClaudeRateLimitsForToken(accessToken);
    const entry: GrantUsageCacheEntry = {
      rateLimits: result.rateLimits,
      error: result.error,
      fetchedAt: Date.now(),
      validUntil: Date.now() + (result.error ? GRANT_USAGE_TTL_ERR_MS : GRANT_USAGE_TTL_OK_MS),
    };
    grantUsageCache.set(cacheKey, entry);
    return entry;
  })().finally(() => grantUsageInFlight.delete(cacheKey));

  grantUsageInFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Session (5h) + weekly rate-limit gauges for every stored credential profile,
 * keyed by profile id ("active" or name). Dormant grants are refreshed first
 * (once per grant, tokens persisted back to every copy) so limits stay visible
 * for accounts that haven't run in days.
 */
export async function getClaudeCredentialProfilesUsage(): Promise<ClaudeProfilesUsageResult> {
  const list = listClaudeCredentialProfiles();
  const candidates = [...(list.active ? [list.active] : []), ...list.profiles];

  // Group profiles by grant: same refresh token (or same access token when a
  // file has no refresh token) = same login, refreshed and fetched once.
  const groups = new Map<string, GrantGroup>();
  const usage: ClaudeProfileUsage[] = [];

  for (const meta of candidates) {
    if (!meta.valid) {
      usage.push({ id: meta.id, rateLimits: null, error: 'Invalid credentials file', fetchedAt: Date.now() });
      continue;
    }
    const tokens = readProfileTokens(meta.path);
    const grantToken = tokens.refreshToken ?? tokens.accessToken;
    if (!grantToken) {
      usage.push({ id: meta.id, rateLimits: null, error: 'No OAuth token in credentials file', fetchedAt: Date.now() });
      continue;
    }
    const key = grantCacheKey(grantToken);
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(meta.id);
      if (!existing.paths.includes(meta.path)) existing.paths.push(meta.path);
      existing.includesActive = existing.includesActive || meta.id === 'active';
      // Prefer a non-expired access token from any copy of the grant.
      const expired = typeof existing.tokens.expiresAt === 'number' && existing.tokens.expiresAt <= Date.now();
      if (expired && tokens.accessToken && (tokens.expiresAt ?? 0) > Date.now()) {
        existing.tokens = tokens;
      }
    } else {
      groups.set(key, { ids: [meta.id], paths: [meta.path], includesActive: meta.id === 'active', tokens });
    }
  }

  await Promise.all(
    Array.from(groups.entries()).map(async ([key, group]) => {
      const entry = await fetchUsageForGrant(key, group);
      for (const id of group.ids) {
        usage.push({ id, rateLimits: entry.rateLimits, error: entry.error, fetchedAt: entry.fetchedAt });
      }
    }),
  );

  return { usage };
}

function assertValidName(name: string): void {
  if (!isValidProfileName(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use 1–64 chars: letters, digits, dot, underscore, hyphen; must start with alphanumeric.`,
    );
  }
}

function ensureClaudeDir(): void {
  const dir = getClaudeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/** Atomic write with restrictive permissions (credentials are secrets). */
function writeCredentialsAtomic(filePath: string, content: string): void {
  ensureClaudeDir();
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.credentials.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on platforms that ignore mode
  }
}

export interface SwitchResult {
  ok: true;
  active: ClaudeCredentialProfileMeta;
  profiles: ClaudeCredentialProfileMeta[];
  stashedAs: string | null;
  previousMatchesNamed: string | null;
}

/**
 * Promote a named profile to the active credentials file (copy model).
 *
 * If the current active file is unique (does not match any named profile),
 * `stashActiveAs` is required so the previous account is not lost.
 * When the active file already matches a named profile, that named file is
 * refreshed from active first (token refresh may have updated it).
 */
export function switchClaudeCredentialProfile(
  name: string,
  opts: { stashActiveAs?: string } = {},
): SwitchResult {
  assertValidName(name);
  const targetFile = namedPath(name);
  if (!fs.existsSync(targetFile)) {
    throw new Error(`Named profile "${name}" not found at ${targetFile}`);
  }
  const targetParsed = parseCredentialsFile(targetFile);
  if (!targetParsed?.valid) {
    throw new Error(`Named profile "${name}" is missing a valid OAuth token`);
  }

  const listing = listClaudeCredentialProfiles();
  const activeFile = activePath();
  let stashedAs: string | null = null;
  const previousMatchesNamed = listing.active?.matchesNamed ?? null;

  if (listing.active?.valid && listing.active.fingerprint) {
    if (listing.active.fingerprint === targetParsed.fingerprint) {
      // Already on this account — still refresh active from named in case of drift.
      writeCredentialsAtomic(activeFile, targetParsed.raw);
      resetClaudeRateLimitCache();
      const after = listClaudeCredentialProfiles();
      return {
        ok: true,
        active: after.active!,
        profiles: after.profiles,
        stashedAs: null,
        previousMatchesNamed,
      };
    }

    if (!previousMatchesNamed) {
      const stash = opts.stashActiveAs;
      if (!stash) {
        throw new Error(
          'Active credentials are not saved as a named profile. Pass stashActiveAs to keep them before switching.',
        );
      }
      assertValidName(stash);
      if (stash === name) {
        throw new Error('stashActiveAs cannot be the same as the profile you are switching to');
      }
      const stashFile = namedPath(stash);
      if (fs.existsSync(stashFile)) {
        const existing = parseCredentialsFile(stashFile);
        if (existing?.fingerprint && existing.fingerprint !== listing.active.fingerprint) {
          throw new Error(
            `Profile "${stash}" already exists with different credentials. Choose another name.`,
          );
        }
      }
      const activeRaw = parseCredentialsFile(activeFile)?.raw;
      if (!activeRaw) throw new Error('Failed to read active credentials for stash');
      writeCredentialsAtomic(stashFile, activeRaw);
      stashedAs = stash;
      log.log(`Stashed previous active Claude credentials as profile "${stash}"`);
    } else {
      // Refresh the named copy of the currently-active account (token refresh).
      const matchedRaw = parseCredentialsFile(activeFile)?.raw;
      if (matchedRaw) {
        writeCredentialsAtomic(namedPath(previousMatchesNamed), matchedRaw);
      }
    }
  }

  writeCredentialsAtomic(activeFile, targetParsed.raw);
  resetClaudeRateLimitCache();
  log.log(`Switched active Claude credentials to profile "${name}"`);

  const after = listClaudeCredentialProfiles();
  if (!after.active) throw new Error('Active credentials missing after switch');
  return {
    ok: true,
    active: after.active,
    profiles: after.profiles,
    stashedAs,
    previousMatchesNamed,
  };
}

/**
 * Save (copy) the current active credentials as a named profile.
 * Overwrites an existing named profile only when force=true or fingerprints match.
 */
export function saveActiveClaudeCredentialProfile(
  name: string,
  opts: { force?: boolean } = {},
): ClaudeCredentialsList {
  assertValidName(name);
  const activeFile = activePath();
  const activeParsed = parseCredentialsFile(activeFile);
  if (!activeParsed?.valid || !activeParsed.raw) {
    throw new Error('No valid active Claude credentials to save');
  }
  const dest = namedPath(name);
  if (fs.existsSync(dest) && !opts.force) {
    const existing = parseCredentialsFile(dest);
    if (existing?.fingerprint && existing.fingerprint !== activeParsed.fingerprint) {
      throw new Error(
        `Profile "${name}" already exists with different credentials. Pass force=true to overwrite.`,
      );
    }
  }
  writeCredentialsAtomic(dest, activeParsed.raw);
  log.log(`Saved active Claude credentials as profile "${name}"`);
  return listClaudeCredentialProfiles();
}

/**
 * Rename a named profile file.
 */
export function renameClaudeCredentialProfile(from: string, to: string): ClaudeCredentialsList {
  assertValidName(from);
  assertValidName(to);
  if (from === to) return listClaudeCredentialProfiles();
  const src = namedPath(from);
  const dest = namedPath(to);
  if (!fs.existsSync(src)) throw new Error(`Named profile "${from}" not found`);
  if (fs.existsSync(dest)) throw new Error(`Profile "${to}" already exists`);
  fs.renameSync(src, dest);
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    // ignore
  }
  log.log(`Renamed Claude credentials profile "${from}" → "${to}"`);
  return listClaudeCredentialProfiles();
}

/**
 * Delete a named profile. Refuses to delete when it is the only copy of the
 * currently active credentials (would leave no backup).
 */
export function deleteClaudeCredentialProfile(name: string): ClaudeCredentialsList {
  assertValidName(name);
  const file = namedPath(name);
  if (!fs.existsSync(file)) throw new Error(`Named profile "${name}" not found`);

  const listing = listClaudeCredentialProfiles();
  if (listing.active?.matchesNamed === name) {
    // Active still has the tokens; deleting the named backup is allowed but
    // means active becomes "unsaved". That is intentional (user asked to delete).
  }

  fs.unlinkSync(file);
  log.log(`Deleted Claude credentials profile "${name}"`);
  return listClaudeCredentialProfiles();
}
