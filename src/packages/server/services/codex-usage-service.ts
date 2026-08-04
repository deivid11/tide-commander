import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Agent } from '../../shared/types.js';
import { getCodexBinaryPath } from './system-prompt-service.js';
import { listProviderCredentialProfiles } from './provider-credentials-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CodexUsage');

export interface CodexRateLimitWindow {
  utilization: number;
  resetsAt: string;
  windowDurationMins: number | null;
}

export interface CodexUsageSnapshot {
  provider: 'codex';
  fetchedAt: number;
  rateLimits: { daily: CodexRateLimitWindow | null; weekly: CodexRateLimitWindow | null } | null;
  rateLimitsError: string | null;
  cliHint: string;
}

interface RawWindow { usedPercent?: unknown; resetsAt?: unknown; windowDurationMins?: unknown }

export function classifyCodexRateLimits(raw: { primary?: RawWindow | null; secondary?: RawWindow | null } | null | undefined) {
  const result: { daily: CodexRateLimitWindow | null; weekly: CodexRateLimitWindow | null } = { daily: null, weekly: null };
  for (const value of [raw?.primary, raw?.secondary]) {
    if (!value || typeof value.usedPercent !== 'number') continue;
    const mins = typeof value.windowDurationMins === 'number' ? value.windowDurationMins : null;
    const resetsAtSeconds = typeof value.resetsAt === 'number' ? value.resetsAt : 0;
    const window = {
      utilization: Math.max(0, Math.min(100, value.usedPercent)),
      resetsAt: resetsAtSeconds > 0 ? new Date(resetsAtSeconds * 1000).toISOString() : '',
      windowDurationMins: mins,
    };
    // App-server identifies windows by duration rather than by name. Anything
    // up to two days is the daily allowance; longer periods are weekly.
    if (mins !== null && mins <= 2 * 24 * 60) result.daily = window;
    else result.weekly = window;
  }
  return result;
}

function readNativeRateLimits(codexHome?: string): Promise<{ primary?: RawWindow | null; secondary?: RawWindow | null }> {
  return new Promise((resolve, reject) => {
    const env = codexHome ? { ...process.env, CODEX_HOME: codexHome } : process.env;
    const child = spawn(getCodexBinaryPath(), ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err?: Error, value?: { primary?: RawWindow | null; secondary?: RawWindow | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      if (err) reject(err); else resolve(value ?? {});
    };
    const timer = setTimeout(() => finish(new Error('Codex usage request timed out')), 10_000);
    child.on('error', (err) => finish(err));
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 1 && message.result) {
            child.stdin?.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
            child.stdin?.write(`${JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: {} })}\n`);
          } else if (message.id === 2) {
            if (message.error) finish(new Error(message.error.message || 'Codex rejected the usage request'));
            else finish(undefined, message.result?.rateLimits ?? {});
          }
        } catch { /* wait for the next complete JSON line */ }
      }
    });
    child.on('close', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex app-server exited with code ${code}`));
    });
    child.stdin?.write(`${JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'tide-commander', title: 'Tide Commander', version: '1.0.0' }, capabilities: { experimentalApi: true } },
    })}\n`);
  });
}

let cache: { expiresAt: number; snapshot: CodexUsageSnapshot } | null = null;

export async function buildCodexUsageSnapshot(_agent: Agent): Promise<CodexUsageSnapshot> {
  if (cache && cache.expiresAt > Date.now()) return cache.snapshot;
  let snapshot: CodexUsageSnapshot;
  try {
    const rateLimits = classifyCodexRateLimits(await readNativeRateLimits());
    snapshot = { provider: 'codex', fetchedAt: Date.now(), rateLimits, rateLimitsError: null, cliHint: 'Run /status in Codex to see current usage limits.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    snapshot = { provider: 'codex', fetchedAt: Date.now(), rateLimits: null, rateLimitsError: message, cliHint: 'Run /status in Codex to see current usage limits.' };
  }
  cache = { expiresAt: Date.now() + 60_000, snapshot };
  return snapshot;
}

// ---------------------------------------------------------------------------
// Per-profile rate-limit gauges (daily + weekly), for the account switcher —
// same admin model as getClaudeCredentialProfilesUsage.
//
// The active account is read through the real ~/.codex so the CLI keeps
// owning its own token refresh. Dormant named profiles are read through a
// throwaway CODEX_HOME seeded with that profile's auth.json; when the
// app-server refreshes the tokens during the read, the rotated credentials
// are persisted back to every copy of the profile so it isn't left holding
// dead tokens. Results are keyed by profile id ("active" or the name) and one
// native read serves every profile sharing a fingerprint.
// ---------------------------------------------------------------------------

export interface CodexProfileUsage {
  /** "active" for the live auth file, else the named profile slug. */
  id: string;
  rateLimits: { daily: CodexRateLimitWindow | null; weekly: CodexRateLimitWindow | null } | null;
  error: string | null;
  fetchedAt: number;
}

export interface CodexProfilesUsageResult {
  usage: CodexProfileUsage[];
}

const PROFILE_USAGE_TTL_OK_MS = 2 * 60 * 1000;
const PROFILE_USAGE_TTL_ERR_MS = 45 * 1000;

interface ProfileUsageCacheEntry {
  rateLimits: CodexProfileUsage['rateLimits'];
  error: string | null;
  fetchedAt: number;
  validUntil: number;
}

const profileUsageCache = new Map<string, ProfileUsageCacheEntry>();
const profileUsageInFlight = new Map<string, Promise<ProfileUsageCacheEntry>>();

type NativeRateLimitsReader = (codexHome?: string) => Promise<{ primary?: RawWindow | null; secondary?: RawWindow | null }>;
let nativeReaderOverride: NativeRateLimitsReader | null = null;

export function setCodexNativeRateLimitsReaderForTests(reader: NativeRateLimitsReader | null): void {
  nativeReaderOverride = reader;
}

export function resetCodexProfileUsageCacheForTests(): void {
  profileUsageCache.clear();
  profileUsageInFlight.clear();
}

function readRateLimits(codexHome?: string): Promise<{ primary?: RawWindow | null; secondary?: RawWindow | null }> {
  return (nativeReaderOverride ?? readNativeRateLimits)(codexHome);
}

interface CodexProfileGroup {
  /** Profile ids sharing this account ("active" and/or named slugs). */
  ids: string[];
  /** Auth file paths holding this account (refresh writes back to all). */
  paths: string[];
  includesActive: boolean;
}

/** Atomic write with restrictive permissions (credentials are secrets). */
function writeAuthAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.auth.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

function persistRefreshedAuth(group: CodexProfileGroup, seededRaw: string, refreshedRaw: string): void {
  for (const filePath of group.paths) {
    try {
      // Skip copies that changed while the read was in flight — never clobber
      // a newer on-disk grant with our response.
      if (fs.readFileSync(filePath, 'utf-8') !== seededRaw) continue;
      writeAuthAtomic(filePath, refreshedRaw);
    } catch (err) {
      log.warn(`Refreshed Codex tokens but failed to persist to ${filePath}: ${err}`);
    }
  }
  log.log(`Refreshed dormant Codex credentials for profile(s): ${group.ids.join(', ')}`);
}

async function readDormantProfileRateLimits(group: CodexProfileGroup) {
  const sourcePath = group.paths[0];
  const seededRaw = fs.readFileSync(sourcePath, 'utf-8');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-codex-usage-'));
  try {
    fs.writeFileSync(path.join(tmpHome, 'auth.json'), seededRaw, { encoding: 'utf-8', mode: 0o600 });
    // Custom config can affect auth flows (enterprise base URLs, auth prefs).
    const configPath = path.join(path.dirname(sourcePath), 'config.toml');
    if (fs.existsSync(configPath)) fs.copyFileSync(configPath, path.join(tmpHome, 'config.toml'));

    const rateLimits = classifyCodexRateLimits(await readRateLimits(tmpHome));

    try {
      const refreshedRaw = fs.readFileSync(path.join(tmpHome, 'auth.json'), 'utf-8');
      if (refreshedRaw !== seededRaw) persistRefreshedAuth(group, seededRaw, refreshedRaw);
    } catch {
      // refresh write-back is best-effort; the gauges are still valid
    }

    return rateLimits;
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function fetchUsageForCodexGroup(fingerprint: string, group: CodexProfileGroup): Promise<ProfileUsageCacheEntry> {
  const cached = profileUsageCache.get(fingerprint);
  if (cached && Date.now() < cached.validUntil) return Promise.resolve(cached);

  const inFlight = profileUsageInFlight.get(fingerprint);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<ProfileUsageCacheEntry> => {
    let rateLimits: CodexProfileUsage['rateLimits'] = null;
    let error: string | null = null;
    try {
      rateLimits = group.includesActive
        ? classifyCodexRateLimits(await readRateLimits())
        : await readDormantProfileRateLimits(group);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const entry: ProfileUsageCacheEntry = {
      rateLimits,
      error,
      fetchedAt: Date.now(),
      validUntil: Date.now() + (error ? PROFILE_USAGE_TTL_ERR_MS : PROFILE_USAGE_TTL_OK_MS),
    };
    profileUsageCache.set(fingerprint, entry);
    return entry;
  })().finally(() => profileUsageInFlight.delete(fingerprint));

  profileUsageInFlight.set(fingerprint, promise);
  return promise;
}

/**
 * Daily + weekly rate-limit gauges for every stored Codex credential profile,
 * keyed by profile id ("active" or name). One native read per distinct
 * account (profiles sharing a fingerprint share the fetch), cached briefly.
 */
export async function getCodexCredentialProfilesUsage(): Promise<CodexProfilesUsageResult> {
  const list = listProviderCredentialProfiles('codex');
  const candidates = [...(list.active ? [list.active] : []), ...list.profiles];

  const groups = new Map<string, CodexProfileGroup>();
  const usage: CodexProfileUsage[] = [];

  for (const meta of candidates) {
    if (!meta.valid || !meta.fingerprint) {
      usage.push({ id: meta.id, rateLimits: null, error: 'Invalid credentials file', fetchedAt: Date.now() });
      continue;
    }
    const existing = groups.get(meta.fingerprint);
    if (existing) {
      existing.ids.push(meta.id);
      if (!existing.paths.includes(meta.path)) existing.paths.push(meta.path);
      existing.includesActive = existing.includesActive || meta.id === 'active';
    } else {
      groups.set(meta.fingerprint, { ids: [meta.id], paths: [meta.path], includesActive: meta.id === 'active' });
    }
  }

  await Promise.all(
    Array.from(groups.entries()).map(async ([fingerprint, group]) => {
      const entry = await fetchUsageForCodexGroup(fingerprint, group);
      for (const id of group.ids) {
        usage.push({ id, rateLimits: entry.rateLimits, error: entry.error, fetchedAt: entry.fetchedAt });
      }
    }),
  );

  return { usage };
}
