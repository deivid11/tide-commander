/**
 * Browser Error Service
 *
 * Backend for the "Browser Console Error Trigger" connector. Receives error
 * briefs POSTed by the companion browser extension (see browser-extension/)
 * and routes them to an agent for investigation.
 *
 * Responsibilities:
 *   - Resolve the target agent (explicit id from the extension, else first agent)
 *   - Server-side rate-limit per (agent, fingerprint) so a misbehaving page that
 *     loops on an error cannot spam an agent (the extension already gates by
 *     occurrence thresholds; this is a defense-in-depth safety net)
 *   - Persist the capture-time screenshot to disk so the agent can Read it
 *   - Build a self-contained brief that tells the agent how to pull MORE context
 *     on its own via the chrome-devtools MCP tools
 *
 * The route lives in routes/trigger-routes.ts → POST /api/triggers/browser-error.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createLogger } from '../utils/logger.js';
import * as agentService from './agent-service.js';
import { sendCommand } from './runtime-service.js';

const log = createLogger('BrowserErrorService');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander',
);
const SCREENSHOT_DIR = path.join(DATA_DIR, 'browser-errors', 'screenshots');

// Minimum interval between deliveries for the same (agent, fingerprint). The
// extension only sends on occurrence thresholds (1, 10, 100…), but a burst can
// still cross several thresholds within seconds — this collapses those into one
// agent turn and protects against a misconfigured/looping client.
const MIN_RESEND_INTERVAL_MS = 30_000;
const lastDeliveredAt = new Map<string, number>();

// Known-benign browser notices that fire through window 'error' but are not real
// exceptions and carry no actionable script origin. The ResizeObserver loop
// notice is the canonical example — the browser raises it whenever a resize
// callback triggers another layout pass and simply defers the rest to the next
// frame. The companion extension already filters these at the source; this is a
// defense-in-depth net for browsers still running an older extension build.
const IGNORED_MESSAGE_PATTERNS: RegExp[] = [
  /resizeobserver loop (completed with undelivered notifications|limit exceeded)/i,
];

function isBenignMessage(message: string): boolean {
  return IGNORED_MESSAGE_PATTERNS.some((re) => re.test(message));
}

/** Shape POSTed by the browser extension's background worker. */
export interface BrowserErrorPayload {
  fingerprint: string;
  /** 'network' | 'js' | 'console' | 'resource' */
  kind: string;
  /** e.g. 'fetch' | 'xhr' | 'uncaught' | 'unhandledrejection' | 'error' | 'load-error' */
  subtype?: string;
  status?: number;
  method?: string;
  url?: string;
  pageUrl?: string;
  /** The active tab's live URL when the error was sent (only when page-context is enabled in the extension). */
  currentUrl?: string;
  /** The active tab's title when the error was sent. */
  currentTitle?: string;
  message: string;
  stack?: string;
  /** Request body the page sent (truncated + redacted by the extension). */
  requestBody?: string;
  /** Response body the server returned (truncated + redacted by the extension). */
  responseBody?: string;
  occurrenceCount?: number;
  firstSeen?: number;
  lastSeen?: number;
  userAgent?: string;
  origin?: string;
  /** PNG data URL captured at error time (optional). */
  screenshot?: string;
  /** Explicit target agent; falls back to the first agent when absent. */
  agentId?: string;
}

export interface BrowserErrorResult {
  delivered: boolean;
  deduped?: boolean;
  /** Dropped as a known-benign browser notice (e.g. ResizeObserver loop). */
  ignored?: boolean;
  reason?: string;
  status?: number;
  agentId?: string;
  agentName?: string;
  fingerprint?: string;
  screenshotPath?: string;
}

function ensureScreenshotDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

/** Decode a `data:image/png;base64,...` URL to disk; returns the absolute path. */
function saveScreenshot(dataUrl: string, fingerprint: string): string | undefined {
  try {
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/s.exec(dataUrl);
    if (!match) return undefined;
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buf = Buffer.from(match[2], 'base64');
    // Guard against absurd payloads (cap ~8MB of decoded image).
    if (buf.length > 8 * 1024 * 1024) {
      log.warn(`Screenshot for ${fingerprint} too large (${buf.length} bytes), skipping`);
      return undefined;
    }
    ensureScreenshotDir();
    const safeFp = fingerprint.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const file = path.join(SCREENSHOT_DIR, `${safeFp}-${Date.now()}.${ext}`);
    fs.writeFileSync(file, buf);
    return file;
  } catch (err) {
    log.error('Failed to save screenshot:', err);
    return undefined;
  }
}

const ELEMENT_SHOT_DIR = path.join(DATA_DIR, 'browser-errors', 'element-shots');

export interface ElementScreenshotResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Persist a cropped screenshot of a DOM element (sent by the extension's
 * "Screenshot" button) so the agent can `Read` it. Returns the absolute path.
 */
export function saveElementScreenshot(image: string, selector?: string): ElementScreenshotResult {
  try {
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/s.exec(image || '');
    if (!match) return { ok: false, error: 'invalid image data' };
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 12 * 1024 * 1024) return { ok: false, error: 'image too large' };
    if (!fs.existsSync(ELEMENT_SHOT_DIR)) fs.mkdirSync(ELEMENT_SHOT_DIR, { recursive: true });
    const safe = (selector || 'element').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'element';
    const file = path.join(ELEMENT_SHOT_DIR, `${safe}-${Date.now()}.${ext}`);
    fs.writeFileSync(file, buf);
    return { ok: true, path: file };
  } catch (err) {
    log.error('Failed to save element screenshot:', err);
    return { ok: false, error: 'save failed' };
  }
}

const ATTACHMENT_DIR = path.join(DATA_DIR, 'browser-errors', 'attachments');

// Map a handful of common mime types to file extensions for when the original
// filename has none.
const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'text/html': 'html',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/zip': 'zip',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/**
 * Persist an arbitrary document the user attached in the extension composer
 * (any mime type, not just images) so the agent can `Read` it. The original
 * filename is preserved (sanitized) so the agent sees a meaningful name.
 */
export function saveAttachment(dataUrl: string, filename?: string): ElementScreenshotResult {
  try {
    const match = /^data:([^;,]*)(?:;base64)?,(.+)$/s.exec(dataUrl || '');
    if (!match) return { ok: false, error: 'invalid file data' };
    const mime = match[1] || 'application/octet-stream';
    const isBase64 = /;base64/.test(dataUrl.slice(0, match[1].length + 30));
    const buf = isBase64 ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]), 'utf8');
    if (buf.length > 25 * 1024 * 1024) return { ok: false, error: 'file too large (max 25MB)' };
    if (!fs.existsSync(ATTACHMENT_DIR)) fs.mkdirSync(ATTACHMENT_DIR, { recursive: true });

    const raw = (filename || 'attachment').replace(/[/\\]/g, '_');
    const dot = raw.lastIndexOf('.');
    const base = (dot > 0 ? raw.slice(0, dot) : raw).replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60) || 'attachment';
    const ext = (dot > 0 ? raw.slice(dot + 1) : MIME_EXT[mime] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'bin';
    const file = path.join(ATTACHMENT_DIR, `${base}-${Date.now()}.${ext}`);
    fs.writeFileSync(file, buf);
    return { ok: true, path: file };
  } catch (err) {
    log.error('Failed to save attachment:', err);
    return { ok: false, error: 'save failed' };
  }
}

function pruneRateLimitMap(now: number): void {
  if (lastDeliveredAt.size < 5000) return;
  for (const [key, ts] of lastDeliveredAt) {
    if (now - ts > 60 * 60_000) lastDeliveredAt.delete(key);
  }
}

function resolveAgent(agentId?: string): { id: string; name: string } | null {
  if (agentId) {
    const agent = agentService.getAgent(agentId);
    if (agent) return { id: agent.id, name: agent.name };
    // Explicit-but-unknown id: fall through to a default so a stale id in the
    // extension config doesn't silently black-hole every error.
    log.warn(`Configured agentId "${agentId}" not found, falling back to first agent`);
  }
  const all = agentService.getAllAgents();
  if (all.length === 0) return null;
  return { id: all[0].id, name: all[0].name };
}

function fmtTime(ts?: number): string {
  if (!ts) return 'n/a';
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

function buildBrief(p: BrowserErrorPayload, screenshotPath?: string): string {
  const lines: string[] = [];
  lines.push('🌐 **Browser error captured** — auto-routed by the Tide Commander Error Trigger.');
  lines.push('');
  lines.push('A console/network error fired in the live UI and was sent to you to investigate.');
  lines.push('');
  lines.push(`- **Type:** \`${p.kind}${p.subtype ? '/' + p.subtype : ''}\``);
  if (typeof p.status === 'number' && p.status > 0) lines.push(`- **HTTP status:** \`${p.status}\``);
  if (p.method || p.url) lines.push(`- **Request:** \`${p.method || 'GET'} ${p.url || ''}\``.trim());
  if (p.pageUrl) lines.push(`- **Page:** ${p.pageUrl}`);
  if (p.currentUrl) lines.push(`- **Current location:** ${p.currentTitle ? `${p.currentTitle} — ` : ''}${p.currentUrl}`);
  lines.push(`- **Message:** ${p.message}`);
  lines.push(
    `- **Occurrences:** ${p.occurrenceCount ?? 1}` +
      ` (first ${fmtTime(p.firstSeen)}, last ${fmtTime(p.lastSeen)})`,
  );
  lines.push(`- **Fingerprint:** \`${p.fingerprint}\``);
  if (p.requestBody) {
    lines.push('');
    lines.push('**Request payload (sent):**');
    lines.push('```');
    lines.push(p.requestBody.slice(0, 4000));
    lines.push('```');
  }
  if (p.responseBody) {
    lines.push('');
    lines.push('**Response payload (received):**');
    lines.push('```');
    lines.push(p.responseBody.slice(0, 4000));
    lines.push('```');
  }
  if (p.stack) {
    lines.push('');
    lines.push('**Stack:**');
    lines.push('```');
    lines.push(p.stack.slice(0, 4000));
    lines.push('```');
  }
  if (screenshotPath) {
    lines.push('');
    lines.push(`**Screenshot at error time:** \`${screenshotPath}\``);
    lines.push('Use the Read tool on that path to see the UI state when it failed.');
  }
  lines.push('');
  lines.push('**Pull more context yourself** with the chrome-devtools MCP tools:');
  lines.push('- `list_network_requests` — every request the page made (locate the failing one + related calls)');
  lines.push('- `get_network_request` — full request/response headers + body for a specific URL');
  lines.push('- `list_console_messages` — console output around the error');
  lines.push('- `take_screenshot` — capture the current UI state fresh');
  lines.push('- `evaluate_script` — inspect page state or reproduce');
  lines.push('');
  lines.push('Find the root cause and report it. If it is actionable in this codebase, propose or apply a fix.');
  return lines.join('\n');
}

/**
 * Handle one browser-error brief: rate-limit, persist screenshot, deliver to an
 * agent. Never throws for the "expected" cases (no agent, rate-limited, bad
 * payload) — those come back as a structured result the route turns into a
 * non-500 response.
 */
export async function handleBrowserError(
  payload: BrowserErrorPayload,
): Promise<BrowserErrorResult> {
  if (!payload || typeof payload !== 'object') {
    return { delivered: false, status: 400, reason: 'Missing body' };
  }
  if (!payload.message || !payload.fingerprint) {
    return { delivered: false, status: 400, reason: 'message and fingerprint are required' };
  }

  if (isBenignMessage(payload.message)) {
    return {
      delivered: false,
      ignored: true,
      reason: 'Ignored known-benign browser notice',
      fingerprint: payload.fingerprint,
    };
  }

  const agent = resolveAgent(payload.agentId);
  if (!agent) {
    return { delivered: false, status: 409, reason: 'No agents available to route the error to' };
  }

  const now = Date.now();
  const rlKey = `${agent.id}:${payload.fingerprint}`;
  const last = lastDeliveredAt.get(rlKey);
  if (last !== undefined && now - last < MIN_RESEND_INTERVAL_MS) {
    return {
      delivered: false,
      deduped: true,
      reason: 'Rate-limited (recently delivered to this agent)',
      agentId: agent.id,
      agentName: agent.name,
      fingerprint: payload.fingerprint,
    };
  }

  const screenshotPath = payload.screenshot
    ? saveScreenshot(payload.screenshot, payload.fingerprint)
    : undefined;

  const brief = buildBrief(payload, screenshotPath);

  try {
    await sendCommand(agent.id, brief);
  } catch (err) {
    log.error(`Failed to deliver browser-error brief to ${agent.id}:`, err);
    return {
      delivered: false,
      status: 500,
      reason: err instanceof Error ? err.message : 'sendCommand failed',
      agentId: agent.id,
      agentName: agent.name,
    };
  }

  lastDeliveredAt.set(rlKey, now);
  pruneRateLimitMap(now);
  log.log(
    `Routed ${payload.kind}/${payload.subtype ?? ''} error (${payload.fingerprint}) to ${agent.name} (${agent.id})`,
  );

  return {
    delivered: true,
    agentId: agent.id,
    agentName: agent.name,
    fingerprint: payload.fingerprint,
    screenshotPath,
  };
}
