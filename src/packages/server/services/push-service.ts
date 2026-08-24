/**
 * Push Service (Firebase Cloud Messaging, HTTP v1)
 *
 * Delivers agent notifications to registered devices through Google's FCM
 * infrastructure instead of the app's own always-on WebSocket. The phone then
 * needs NO persistent socket of its own: FCM rides the single connection the
 * OS already maintains for every app, which is why this path costs ~0 battery
 * compared with the foreground service in
 * android/app/src/main/java/com/tidecommander/app/WebSocketForegroundService.java
 * (that service stays as the fallback when FCM isn't configured).
 *
 * Auth uses a service-account JSON (Firebase console → Project settings →
 * Service accounts → Generate new private key). The legacy "server key" API
 * was shut down by Google in 2024, so we mint a short-lived OAuth2 access
 * token from a self-signed JWT — ~40 lines of node:crypto instead of pulling
 * in google-auth-library.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import type { AgentNotification } from '../../shared/types.js';

const log = createLogger('Push');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

/** Service-account credentials. Env var wins so deployments can mount it elsewhere. */
const SERVICE_ACCOUNT_FILE =
  process.env.TIDE_FCM_SERVICE_ACCOUNT || path.join(DATA_DIR, 'fcm-service-account.json');

const DEVICES_FILE = path.join(DATA_DIR, 'push-devices.json');

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Must match MainActivity.AGENT_NOTIFICATION_CHANNEL_ID. */
const ANDROID_CHANNEL_ID = 'agent_alerts';
/** Drop undelivered pushes after an hour — a stale "Task Complete" is noise. */
const PUSH_TTL_SECONDS = 3600;
/** Give up on a token after this many consecutive send failures. */
const MAX_CONSECUTIVE_FAILURES = 10;

// ─── Types ────────────────────────────────────────────────────────────

export type PushPlatform = 'android' | 'ios' | 'web';

export interface PushDevice {
  /** FCM registration token — the address we push to. */
  token: string;
  platform: PushPlatform;
  /** Stable per-install id so re-registering the same phone replaces its row. */
  deviceId?: string;
  deviceName?: string;
  appVersion?: string;
  registeredAt: number;
  lastSeenAt: number;
  lastSuccessAt?: number;
  failureCount: number;
}

export interface PushStatus {
  configured: boolean;
  projectId?: string;
  clientEmail?: string;
  serviceAccountPath: string;
  devices: Array<Omit<PushDevice, 'token'> & { tokenPreview: string }>;
  lastError?: string;
  lastSentAt?: number;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface RegisterDeviceInput {
  token: string;
  platform?: string;
  deviceId?: string;
  deviceName?: string;
  appVersion?: string;
}

// ─── Module state ─────────────────────────────────────────────────────

let lastError: string | undefined;
let lastSentAt: number | undefined;

/** Cached credentials, invalidated when the file's mtime changes. */
let cachedAccount: { account: ServiceAccount; mtimeMs: number } | null = null;
/** Cached OAuth2 access token; FCM tokens live 1h, we refresh a bit early. */
let cachedToken: { value: string; expiresAt: number } | null = null;

// ─── Storage helpers ──────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizePlatform(value: unknown): PushPlatform {
  return value === 'ios' || value === 'web' ? value : 'android';
}

export function loadDevices(): PushDevice[] {
  try {
    if (!fs.existsSync(DEVICES_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((d: unknown): d is Record<string, unknown> => !!d && typeof d === 'object')
      .filter((d) => typeof d.token === 'string' && (d.token as string).length > 0)
      .map((d) => ({
        token: d.token as string,
        platform: normalizePlatform(d.platform),
        deviceId: typeof d.deviceId === 'string' ? d.deviceId : undefined,
        deviceName: typeof d.deviceName === 'string' ? d.deviceName : undefined,
        appVersion: typeof d.appVersion === 'string' ? d.appVersion : undefined,
        registeredAt: typeof d.registeredAt === 'number' ? d.registeredAt : Date.now(),
        lastSeenAt: typeof d.lastSeenAt === 'number' ? d.lastSeenAt : Date.now(),
        lastSuccessAt: typeof d.lastSuccessAt === 'number' ? d.lastSuccessAt : undefined,
        failureCount: typeof d.failureCount === 'number' ? d.failureCount : 0,
      }));
  } catch (error: unknown) {
    log.error(`Failed to load push devices: ${errMsg(error)}`);
    return [];
  }
}

function saveDevices(devices: PushDevice[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf-8');
  } catch (error: unknown) {
    log.error(`Failed to save push devices: ${errMsg(error)}`);
  }
}

/**
 * Register (or refresh) a device token.
 *
 * FCM rotates tokens on its own schedule, so the same phone shows up with a
 * new token periodically. Keying the replace on deviceId — not the token —
 * keeps one row per install instead of accumulating dead tokens that each
 * cost a failed HTTP request per notification.
 */
export function registerDevice(input: RegisterDeviceInput): PushDevice {
  const token = String(input.token || '').trim();
  if (!token) throw new Error('token is required');

  const now = Date.now();
  const devices = loadDevices();
  const deviceId = input.deviceId?.trim() || undefined;

  const existingIndex = devices.findIndex(
    (d) => d.token === token || (deviceId != null && d.deviceId === deviceId)
  );

  const device: PushDevice = {
    token,
    platform: normalizePlatform(input.platform),
    deviceId,
    deviceName: input.deviceName?.trim() || undefined,
    appVersion: input.appVersion?.trim() || undefined,
    registeredAt: existingIndex >= 0 ? devices[existingIndex].registeredAt : now,
    lastSeenAt: now,
    lastSuccessAt: existingIndex >= 0 ? devices[existingIndex].lastSuccessAt : undefined,
    failureCount: 0,
  };

  if (existingIndex >= 0) devices[existingIndex] = device;
  else devices.push(device);

  saveDevices(devices);
  log.log(`Registered push device ${device.deviceName || device.deviceId || tokenPreview(token)}`);
  return device;
}

export function unregisterDevice(token: string): boolean {
  const devices = loadDevices();
  const next = devices.filter((d) => d.token !== token);
  if (next.length === devices.length) return false;
  saveDevices(next);
  log.log(`Unregistered push device ${tokenPreview(token)}`);
  return true;
}

function tokenPreview(token: string): string {
  return token.length <= 12 ? token : `${token.slice(0, 8)}…${token.slice(-4)}`;
}

// ─── Service account / OAuth2 ─────────────────────────────────────────

function readServiceAccount(): ServiceAccount | null {
  try {
    if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) return null;
    const { mtimeMs } = fs.statSync(SERVICE_ACCOUNT_FILE);
    if (cachedAccount && cachedAccount.mtimeMs === mtimeMs) return cachedAccount.account;

    const parsed = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf-8'));
    const account = validateServiceAccount(parsed);
    cachedAccount = { account, mtimeMs };
    // A new file means the old access token was minted for another project.
    cachedToken = null;
    return account;
  } catch (error: unknown) {
    log.error(`Invalid FCM service account at ${SERVICE_ACCOUNT_FILE}: ${errMsg(error)}`);
    return null;
  }
}

export function validateServiceAccount(parsed: unknown): ServiceAccount {
  const obj = (parsed || {}) as Record<string, unknown>;
  const projectId = typeof obj.project_id === 'string' ? obj.project_id : '';
  const clientEmail = typeof obj.client_email === 'string' ? obj.client_email : '';
  const privateKey = typeof obj.private_key === 'string' ? obj.private_key : '';
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Service account JSON must contain project_id, client_email and private_key');
  }
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('private_key does not look like a PEM key');
  }
  return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
}

/** Persist a pasted service-account JSON so push works without shell access. */
export function saveServiceAccount(parsed: unknown): ServiceAccount {
  const account = validateServiceAccount(parsed);
  ensureDataDir();
  // 0600: this key can send pushes to every device of the project.
  fs.writeFileSync(SERVICE_ACCOUNT_FILE, JSON.stringify(parsed, null, 2), { encoding: 'utf-8', mode: 0o600 });
  cachedAccount = null;
  cachedToken = null;
  lastError = undefined;
  log.log(`Saved FCM service account for project ${account.project_id}`);
  return account;
}

export function clearServiceAccount(): void {
  if (fs.existsSync(SERVICE_ACCOUNT_FILE)) fs.unlinkSync(SERVICE_ACCOUNT_FILE);
  cachedAccount = null;
  cachedToken = null;
  // Drop the error too: it belonged to credentials that no longer exist, and
  // the settings panel would keep showing it next to "not configured".
  lastError = undefined;
  log.log('Cleared FCM service account');
}

export function isPushConfigured(): boolean {
  return readServiceAccount() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Self-signed JWT → OAuth2 access token (RFC 7523 jwt-bearer flow). */
export function buildAssertion(account: ServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(account.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const assertion = buildAssertion(account, Math.floor(now / 1000));
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new Error(
      `OAuth token request failed (${response.status}): ${body.error_description || body.error || 'unknown error'}`
    );
  }

  // Refresh 5 minutes early so a send never races the expiry.
  const ttlMs = Math.max(60, (body.expires_in ?? 3600) - 300) * 1000;
  cachedToken = { value: body.access_token, expiresAt: now + ttlMs };
  return body.access_token;
}

// ─── Sending ──────────────────────────────────────────────────────────

/** Every value in an FCM data payload must be a string. */
export function buildFcmMessage(
  notification: AgentNotification,
  token: string
): Record<string, unknown> {
  const title = `${notification.agentName}: ${notification.title}`;
  const androidNotification: Record<string, unknown> = {
    channel_id: ANDROID_CHANNEL_ID,
    sound: 'default',
    notification_priority: 'PRIORITY_HIGH',
    default_vibrate_timings: true,
    // One notification per alert instead of collapsing per agent: a stack of
    // "Task Complete" lines is the point, losing all but the last isn't.
    tag: notification.id,
  };
  if (notification.imageUrl) androidNotification.image = notification.imageUrl;

  return {
    message: {
      token,
      notification: { title, body: notification.message },
      // The tap handler and the in-app dedupe both read these.
      data: {
        type: 'agent_notification',
        notificationId: notification.id,
        agentId: notification.agentId,
        agentName: notification.agentName,
        agentClass: String(notification.agentClass ?? ''),
        title: notification.title,
        message: notification.message,
        timestamp: String(notification.timestamp),
        ...(notification.iconUrl ? { iconUrl: notification.iconUrl } : {}),
        ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}),
      },
      android: {
        priority: 'HIGH',
        ttl: `${PUSH_TTL_SECONDS}s`,
        notification: androidNotification,
      },
    },
  };
}

/** FCM answers for a token that will never work again — stop trying. */
function isDeadTokenError(status: number, errorCode: string): boolean {
  if (status === 404) return true;
  return errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT';
}

export interface PushSendResult {
  sent: number;
  failed: number;
  pruned: number;
  skipped?: 'not-configured' | 'no-devices';
}

/**
 * Fan a notification out to every registered device.
 *
 * Never throws: notification delivery is best-effort and must not break the
 * caller's request path (see src/packages/server/routes/notifications.ts).
 */
export async function sendAgentPush(notification: AgentNotification): Promise<PushSendResult> {
  const account = readServiceAccount();
  if (!account) return { sent: 0, failed: 0, pruned: 0, skipped: 'not-configured' };

  const devices = loadDevices();
  if (devices.length === 0) return { sent: 0, failed: 0, pruned: 0, skipped: 'no-devices' };

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account);
  } catch (error: unknown) {
    lastError = errMsg(error);
    log.error(`FCM auth failed: ${lastError}`);
    return { sent: 0, failed: devices.length, pruned: 0 };
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const deadTokens: string[] = [];
  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    devices.map(async (device) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildFcmMessage(notification, device.token)),
      });

      if (response.ok) return { device, ok: true as const };

      const body = (await response.json().catch(() => ({}))) as {
        error?: { status?: string; message?: string };
      };
      const errorCode = body.error?.status || '';
      return {
        device,
        ok: false as const,
        status: response.status,
        errorCode,
        message: body.error?.message || `HTTP ${response.status}`,
      };
    })
  );

  const now = Date.now();
  const updated = [...devices];

  for (const result of results) {
    if (result.status === 'rejected') {
      failed++;
      lastError = errMsg(result.reason);
      continue;
    }
    const outcome = result.value;
    const index = updated.findIndex((d) => d.token === outcome.device.token);
    if (outcome.ok) {
      sent++;
      if (index >= 0) updated[index] = { ...updated[index], lastSuccessAt: now, failureCount: 0 };
      continue;
    }

    failed++;
    lastError = `${outcome.errorCode || outcome.status}: ${outcome.message}`;
    if (isDeadTokenError(outcome.status, outcome.errorCode)) {
      deadTokens.push(outcome.device.token);
      log.warn(`Dropping dead push token ${tokenPreview(outcome.device.token)} (${outcome.errorCode || outcome.status})`);
    } else if (index >= 0) {
      const failureCount = updated[index].failureCount + 1;
      updated[index] = { ...updated[index], failureCount };
      if (failureCount >= MAX_CONSECUTIVE_FAILURES) {
        deadTokens.push(outcome.device.token);
        log.warn(`Dropping push token ${tokenPreview(outcome.device.token)} after ${failureCount} failures`);
      }
    }
  }

  const surviving = updated.filter((d) => !deadTokens.includes(d.token));
  saveDevices(surviving);

  if (sent > 0) {
    lastSentAt = now;
    if (failed === 0) lastError = undefined;
  }

  return { sent, failed, pruned: deadTokens.length };
}

export function getPushStatus(): PushStatus {
  const account = readServiceAccount();
  return {
    configured: account !== null,
    projectId: account?.project_id,
    clientEmail: account?.client_email,
    serviceAccountPath: SERVICE_ACCOUNT_FILE,
    devices: loadDevices().map(({ token, ...rest }) => ({ ...rest, tokenPreview: tokenPreview(token) })),
    lastError,
    lastSentAt,
  };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
