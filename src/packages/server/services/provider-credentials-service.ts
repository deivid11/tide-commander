/**
 * Provider Credentials Service (Grok + Codex)
 *
 * Same account-switcher model as claude-credentials-service, generalized for
 * providers that keep a SINGLE active auth file plus named copies:
 *   - Grok:  ~/.grok/auth.json   + ~/.grok/auth.<name>.json
 *   - Codex: ~/.codex/auth.json  + ~/.codex/auth.<name>.json
 *
 * Operators keep accounts as named profiles and promote one to active when the
 * current account hits limits. Tokens are never returned to clients — only
 * non-secret metadata (email, plan label, expiry) + a stable fingerprint.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ProviderCredentials');

export type CredentialProviderId = 'grok' | 'codex';

export interface ProviderCredentialProfileMeta {
  /** "active" for the live auth file, or the named profile slug. */
  id: string;
  name: string;
  isActive: boolean;
  path: string;
  valid: boolean;
  /** SHA-256 of the access token, first 12 hex chars — identity, no secret. */
  fingerprint: string | null;
  /** Plan / subscription label when known (e.g. "team", "SuperGrok"). */
  label: string | null;
  email: string | null;
  /** Access-token expiry (ms epoch) when known. */
  expiresAt: number | null;
  mtimeMs: number | null;
  /** When active's fingerprint matches a named profile, that name (active only). */
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

interface ParsedProviderCredentials {
  raw: string;
  fingerprint: string | null;
  label: string | null;
  email: string | null;
  expiresAt: number | null;
  valid: boolean;
}

interface ProviderConfig {
  provider: CredentialProviderId;
  /** Directory holding the auth files. */
  dir: string;
  /** Active file name, e.g. "auth.json". */
  activeFile: string;
  /** Named-copy prefix/suffix: auth.<name>.json → prefix "auth.", suffix ".json". */
  namedPrefix: string;
  namedSuffix: string;
  /** Extract non-secret metadata + the fingerprint token from a raw auth file. */
  parse(raw: string): { fingerprint: string | null; label: string | null; email: string | null; expiresAt: number | null; valid: boolean };
}

// --- JWT helper (metadata only; never logs or returns the token) -----------

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const pad = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const json = Buffer.from(pad.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fingerprintToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

// --- Provider-specific parsers ---------------------------------------------

/** Grok ~/.grok/auth.json: dict keyed by "issuer::client_id" → { key, email, expires_at, ... }. */
function parseGrokCredentials(raw: string): ReturnType<ProviderConfig['parse']> {
  try {
    const data = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    for (const entry of Object.values(data)) {
      if (!entry || typeof entry !== 'object') continue;
      const token = typeof entry.key === 'string' ? entry.key : '';
      if (!token) continue;
      const expiresRaw = entry.expires_at ?? entry.expiresAt;
      let expiresAt: number | null = null;
      if (typeof expiresRaw === 'number') expiresAt = expiresRaw;
      else if (typeof expiresRaw === 'string') {
        const ms = Date.parse(expiresRaw);
        expiresAt = Number.isFinite(ms) ? ms : null;
      }
      const email = typeof entry.email === 'string' ? entry.email : null;
      const label = typeof entry.principal_type === 'string' ? entry.principal_type : null;
      return { fingerprint: fingerprintToken(token), label, email, expiresAt, valid: true };
    }
    return { fingerprint: null, label: null, email: null, expiresAt: null, valid: false };
  } catch {
    return { fingerprint: null, label: null, email: null, expiresAt: null, valid: false };
  }
}

/** Codex ~/.codex/auth.json: { tokens: { access_token, id_token, ... } }; plan/email live in the id_token JWT. */
function parseCodexCredentials(raw: string): ReturnType<ProviderConfig['parse']> {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const tokens = data.tokens as Record<string, unknown> | undefined;
    const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token : '';
    const idToken = typeof tokens?.id_token === 'string' ? tokens.id_token : '';
    // API-key-only auth (no ChatGPT login) is also valid.
    const apiKey = typeof data.OPENAI_API_KEY === 'string' ? data.OPENAI_API_KEY : '';
    const fpToken = accessToken || apiKey;
    if (!fpToken) return { fingerprint: null, label: null, email: null, expiresAt: null, valid: false };

    let email: string | null = null;
    let label: string | null = apiKey && !accessToken ? 'API key' : null;
    let expiresAt: number | null = null;
    const claims = idToken ? decodeJwtPayload(idToken) : null;
    if (claims) {
      if (typeof claims.email === 'string') email = claims.email;
      const auth = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
      if (auth && typeof auth.chatgpt_plan_type === 'string') label = auth.chatgpt_plan_type;
    }
    // Access-token expiry (its own JWT exp) — the value the CLI refreshes on.
    const accessClaims = accessToken ? decodeJwtPayload(accessToken) : null;
    if (accessClaims && typeof accessClaims.exp === 'number') expiresAt = accessClaims.exp * 1000;
    return { fingerprint: fingerprintToken(fpToken), label, email, expiresAt, valid: true };
  } catch {
    return { fingerprint: null, label: null, email: null, expiresAt: null, valid: false };
  }
}

// --- Provider registry (dir overridable for tests) -------------------------

let dirOverrides: Partial<Record<CredentialProviderId, string>> = {};

export function setProviderCredentialsDirForTests(overrides: Partial<Record<CredentialProviderId, string>>): void {
  dirOverrides = overrides;
}

function providerConfig(provider: CredentialProviderId): ProviderConfig {
  if (provider === 'grok') {
    return {
      provider,
      dir: dirOverrides.grok ?? path.join(os.homedir(), '.grok'),
      activeFile: 'auth.json',
      namedPrefix: 'auth.',
      namedSuffix: '.json',
      parse: parseGrokCredentials,
    };
  }
  return {
    provider,
    dir: dirOverrides.codex ?? path.join(os.homedir(), '.codex'),
    activeFile: 'auth.json',
    namedPrefix: 'auth.',
    namedSuffix: '.json',
    parse: parseCodexCredentials,
  };
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function isValidProviderProfileName(name: string): boolean {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return false;
  if (name === 'json' || name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  return true;
}

function assertValidName(name: string): void {
  if (!isValidProviderProfileName(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use 1–64 chars: letters, digits, dot, underscore, hyphen; must start with alphanumeric.`,
    );
  }
}

function activePath(cfg: ProviderConfig): string {
  return path.join(cfg.dir, cfg.activeFile);
}

function namedPath(cfg: ProviderConfig, name: string): string {
  return path.join(cfg.dir, `${cfg.namedPrefix}${name}${cfg.namedSuffix}`);
}

function parseFile(cfg: ProviderConfig, filePath: string): ParsedProviderCredentials | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const meta = cfg.parse(raw);
    return { raw, ...meta };
  } catch (err) {
    log.warn(`Failed to parse ${cfg.provider} credentials at ${filePath}: ${err}`);
    return { raw: '', fingerprint: null, label: null, email: null, expiresAt: null, valid: false };
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
  cfg: ProviderConfig,
  id: string,
  name: string,
  filePath: string,
  parsed: ParsedProviderCredentials | null,
  isActive: boolean,
  matchesNamed: string | null,
): ProviderCredentialProfileMeta {
  return {
    id,
    name,
    isActive,
    path: filePath,
    valid: parsed?.valid ?? false,
    fingerprint: parsed?.fingerprint ?? null,
    label: parsed?.label ?? null,
    email: parsed?.email ?? null,
    expiresAt: parsed?.expiresAt ?? null,
    mtimeMs: fileMtime(filePath),
    matchesNamed,
  };
}

function listNamedProfileNames(cfg: ProviderConfig): string[] {
  if (!fs.existsSync(cfg.dir)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(cfg.dir)) {
    if (entry === cfg.activeFile) continue;
    if (!entry.startsWith(cfg.namedPrefix) || !entry.endsWith(cfg.namedSuffix)) continue;
    const name = entry.slice(cfg.namedPrefix.length, entry.length - cfg.namedSuffix.length);
    if (!name || !isValidProviderProfileName(name)) continue;
    names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

/** List the active auth file plus every named profile. Never returns tokens. */
export function listProviderCredentialProfiles(provider: CredentialProviderId): ProviderCredentialsList {
  const cfg = providerConfig(provider);
  const activeFile = activePath(cfg);
  const activeParsed = parseFile(cfg, activeFile);

  const namedNames = listNamedProfileNames(cfg);
  const namedByFp = new Map<string, string>();
  for (const name of namedNames) {
    const parsed = parseFile(cfg, namedPath(cfg, name));
    if (parsed?.fingerprint) namedByFp.set(parsed.fingerprint, name);
  }

  const activeMatchesNamed = activeParsed?.fingerprint ? (namedByFp.get(activeParsed.fingerprint) ?? null) : null;

  const active = fs.existsSync(activeFile)
    ? toMeta(cfg, 'active', 'active', activeFile, activeParsed, true, activeMatchesNamed)
    : null;

  const profiles = namedNames.map((name) => {
    const p = namedPath(cfg, name);
    const parsed = parseFile(cfg, p);
    const isActive = Boolean(activeParsed?.fingerprint) && parsed?.fingerprint === activeParsed?.fingerprint;
    return toMeta(cfg, name, name, p, parsed, isActive, null);
  });

  return { provider, dir: cfg.dir, active, profiles };
}

function ensureDir(cfg: ProviderConfig): void {
  if (!fs.existsSync(cfg.dir)) fs.mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
}

/** Atomic write with restrictive permissions (credentials are secrets). */
function writeAtomic(cfg: ProviderConfig, filePath: string, content: string): void {
  ensureDir(cfg);
  const tmp = path.join(cfg.dir, `.auth.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

/**
 * Switch the active account to a named profile. Optionally stash the current
 * active account under a name first (so an unsaved live login isn't lost).
 */
export function switchProviderCredentialProfile(
  provider: CredentialProviderId,
  name: string,
  opts: { stashActiveAs?: string } = {},
): ProviderCredentialsSwitchResult {
  assertValidName(name);
  const cfg = providerConfig(provider);
  const activeFile = activePath(cfg);
  const targetFile = namedPath(cfg, name);
  if (!fs.existsSync(targetFile)) throw new Error(`Named profile "${name}" not found`);
  const targetParsed = parseFile(cfg, targetFile);
  if (!targetParsed?.valid || !targetParsed.raw) throw new Error(`Profile "${name}" has no valid credentials`);

  const listing = listProviderCredentialProfiles(provider);
  const previousMatchesNamed = listing.active?.matchesNamed ?? null;
  let stashedAs: string | null = null;

  if (listing.active?.valid) {
    const stash = opts.stashActiveAs?.trim();
    if (!previousMatchesNamed && stash) {
      assertValidName(stash);
      if (stash === name) throw new Error('stashActiveAs cannot be the same as the profile you are switching to');
      const stashFile = namedPath(cfg, stash);
      if (fs.existsSync(stashFile)) {
        const existing = parseFile(cfg, stashFile);
        if (existing?.fingerprint && existing.fingerprint !== listing.active.fingerprint) {
          throw new Error(`Profile "${stash}" already exists with different credentials. Choose another name.`);
        }
      }
      const activeRaw = parseFile(cfg, activeFile)?.raw;
      if (!activeRaw) throw new Error('Failed to read active credentials for stash');
      writeAtomic(cfg, stashFile, activeRaw);
      stashedAs = stash;
      log.log(`Stashed previous active ${provider} credentials as profile "${stash}"`);
    } else if (previousMatchesNamed) {
      // Keep the matched named copy in sync with the (possibly refreshed) active file.
      const matchedRaw = parseFile(cfg, activeFile)?.raw;
      if (matchedRaw) writeAtomic(cfg, namedPath(cfg, previousMatchesNamed), matchedRaw);
    }
  }

  writeAtomic(cfg, activeFile, targetParsed.raw);
  log.log(`Switched active ${provider} credentials to profile "${name}"`);

  const after = listProviderCredentialProfiles(provider);
  if (!after.active) throw new Error('Active credentials missing after switch');
  return { ok: true, active: after.active, profiles: after.profiles, stashedAs, previousMatchesNamed };
}

/** Save (copy) the current active credentials as a named profile. */
export function saveActiveProviderCredentialProfile(
  provider: CredentialProviderId,
  name: string,
  opts: { force?: boolean } = {},
): ProviderCredentialsList {
  assertValidName(name);
  const cfg = providerConfig(provider);
  const activeParsed = parseFile(cfg, activePath(cfg));
  if (!activeParsed?.valid || !activeParsed.raw) throw new Error(`No valid active ${provider} credentials to save`);
  const dest = namedPath(cfg, name);
  if (fs.existsSync(dest) && !opts.force) {
    const existing = parseFile(cfg, dest);
    if (existing?.fingerprint && existing.fingerprint !== activeParsed.fingerprint) {
      throw new Error(`Profile "${name}" already exists with different credentials. Pass force=true to overwrite.`);
    }
  }
  writeAtomic(cfg, dest, activeParsed.raw);
  log.log(`Saved active ${provider} credentials as profile "${name}"`);
  return listProviderCredentialProfiles(provider);
}

/** Rename a named profile file. */
export function renameProviderCredentialProfile(
  provider: CredentialProviderId,
  from: string,
  to: string,
): ProviderCredentialsList {
  assertValidName(from);
  assertValidName(to);
  if (from === to) return listProviderCredentialProfiles(provider);
  const cfg = providerConfig(provider);
  const src = namedPath(cfg, from);
  const dest = namedPath(cfg, to);
  if (!fs.existsSync(src)) throw new Error(`Named profile "${from}" not found`);
  if (fs.existsSync(dest)) throw new Error(`Profile "${to}" already exists`);
  fs.renameSync(src, dest);
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    // ignore
  }
  log.log(`Renamed ${provider} credentials profile "${from}" → "${to}"`);
  return listProviderCredentialProfiles(provider);
}

/** Delete a named profile. */
export function deleteProviderCredentialProfile(
  provider: CredentialProviderId,
  name: string,
): ProviderCredentialsList {
  assertValidName(name);
  const cfg = providerConfig(provider);
  const file = namedPath(cfg, name);
  if (!fs.existsSync(file)) throw new Error(`Named profile "${name}" not found`);
  fs.unlinkSync(file);
  log.log(`Deleted ${provider} credentials profile "${name}"`);
  return listProviderCredentialProfiles(provider);
}
