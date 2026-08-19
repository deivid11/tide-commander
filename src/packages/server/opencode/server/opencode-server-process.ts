/**
 * OpencodeServerProcess
 *
 * Manages a DETACHED, restart-surviving `opencode serve` HTTP server and speaks
 * its API: one SSE stream (`GET /global/event`) carries every session's events
 * (word-by-word `message.part.delta`), and prompts/sessions/aborts go over plain
 * HTTP. One server multiplexes every OpenCode agent — each agent owns a
 * `sessionID`, and every event carries `properties.sessionID` so the runner can
 * fan them back out.
 *
 * The stream MUST be `/global/event`: the plain `/event` endpoint is
 * PROJECT-SCOPED (resolved from the request's directory, defaulting to the
 * daemon's cwd), so a subscription there silently drops every event from
 * sessions living in any other working directory — those agents then get no
 * deltas and no `session.idle`, wedging them in 'working' forever.
 *
 * Why detached + HTTP/SSE (vs `opencode run` per turn): `opencode run --format
 * json` emits one full assistant message (no token deltas), and a child process
 * dies with the commander. A detached server bound to a localhost port survives
 * commander restarts and keeps running any in-flight turn; on restart the runner
 * reconnects the SSE stream and OpenCode's persisted sessions resume seamlessly.
 */

import { spawn } from 'child_process';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import { createLogger } from '../../utils/logger.js';
import {
  loadDaemonInfo,
  saveDaemonInfo,
  clearDaemonInfo,
  OPENCODE_SERVER_LOG_FILE,
} from './opencode-server-recovery-store.js';

const log = createLogger('OpencodeServer');

const HEALTH_TIMEOUT_MS = 25000;
const HEALTH_POLL_MS = 300;
const SSE_RECONNECT_MS = 1000;

interface OpencodeServerOptions {
  executablePath: string;
  cwd: string;
  extraEnv: Record<string, string>;
  /** Every SSE event (already JSON-parsed). */
  onEvent: (event: Record<string, unknown>) => void;
  /** The SSE stream dropped and could not be re-established (server gone). */
  onDisconnect: () => void;
}

export class OpencodeServerProcess {
  private port: number | null = null;
  private sseReq: http.ClientRequest | null = null;
  private stopped = false;
  private connected = false;
  private reconnectedToExisting = false;
  /** Set once `/global/event` came back non-200 (older opencode) — stick to the
   *  legacy project-scoped `/event` stream from then on. */
  private legacyEventStream = false;

  constructor(private readonly opts: OpencodeServerOptions) {}

  isAlive(): boolean {
    return this.connected && !this.stopped;
  }

  didReconnect(): boolean {
    return this.reconnectedToExisting;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async ensureStarted(): Promise<void> {
    // `connected` reflects the SSE client's last-known state, not necessarily
    // the daemon's current health. A detached daemon can die without the stream
    // delivering an `end` event, leaving every later request pointed at a dead
    // port. Probe before reuse so the next command self-heals immediately.
    if (this.connected && this.port && (await probeHealth(this.port, 1500))) return;
    if (this.connected) {
      log.warn('Cached opencode server connection is unhealthy; replacing daemon');
      this.disconnect();
    }
    this.stopped = false;

    // 1. Rejoin an already-running daemon if healthy.
    const existing = loadDaemonInfo();
    if (existing && isPidAlive(existing.pid) && (await probeHealth(existing.port, 1500))) {
      log.log(`🔗 Rejoining existing opencode server pid=${existing.pid} port=${existing.port}`);
      this.port = existing.port;
      this.reconnectedToExisting = true;
      this.openSse();
      this.connected = true;
      return;
    }

    // Never leave an unresponsive persisted daemon orphaned when replacing it.
    if (existing) OpencodeServerProcess.terminatePersistedDaemon();

    // 2. Spawn a fresh detached daemon.
    this.reconnectedToExisting = false;
    const port = await findFreePort();
    const pid = this.spawnDaemon(port);
    saveDaemonInfo({ port, pid, startedAt: Date.now() });
    this.port = port;
    await this.waitForHealth(port);
    this.openSse();
    this.connected = true;
  }

  private spawnDaemon(port: number): number {
    const { executablePath, cwd, extraEnv } = this.opts;
    const logFd = (() => {
      try {
        return fs.openSync(OPENCODE_SERVER_LOG_FILE, 'a');
      } catch {
        return 'ignore' as const;
      }
    })();
    log.log(`🚀 Spawning detached opencode server: ${executablePath} serve --port ${port}`);
    const child = spawn(executablePath, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd,
      env: { ...process.env, ...extraEnv },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    child.on('error', (err) => log.error(`opencode serve spawn error: ${err.message}`));
    return child.pid ?? -1;
  }

  private async waitForHealth(port: number): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probeHealth(port, 1000)) return;
      await sleep(HEALTH_POLL_MS);
    }
    throw new Error('opencode server /api/health never became healthy');
  }

  /** Open the single all-projects SSE stream (`/global/event`) and parse
   *  `data:` frames. Falls back to the legacy project-scoped `/event` on
   *  daemons too old to serve the global stream. */
  private openSse(): void {
    if (this.stopped) return;
    const path = this.legacyEventStream ? '/event' : '/global/event';
    const req = http.get(`${this.baseUrl}${path}`, { headers: { Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200 && !this.legacyEventStream) {
        log.warn(`GET /global/event → HTTP ${res.statusCode}; falling back to legacy project-scoped /event`);
        this.legacyEventStream = true;
        this.sseReq = null; // guard: the destroyed request's error/end must not trigger a reconnect
        req.destroy();
        this.openSse();
        return;
      }
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', (chunk: string) => {
        buffer += chunk;
        // SSE frames are separated by a blank line.
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleFrame(frame);
        }
      });
      res.on('end', () => {
        if (this.sseReq === req) this.handleSseClosed();
      });
    });
    this.sseReq = req;
    req.on('error', (err) => {
      if (this.sseReq !== req) return;
      log.warn(`SSE connection error: ${err.message}`);
      this.handleSseClosed();
    });
  }

  private handleFrame(frame: string): void {
    // A frame is one or more lines; take the `data:` payload(s).
    const dataLines = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    if (!payload) return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload);
    } catch {
      return;
    }
    this.opts.onEvent(unwrapGlobalSseEvent(evt));
  }

  private handleSseClosed(): void {
    this.sseReq = null;
    if (this.stopped) return;
    // Try to re-establish once; if the server is truly gone, give up and notify.
    log.warn('SSE stream closed; attempting to reconnect');
    setTimeout(async () => {
      if (this.stopped || !this.port) return;
      if (await probeHealth(this.port, 1500)) {
        this.openSse();
      } else {
        this.connected = false;
        this.opts.onDisconnect();
      }
    }, SSE_RECONNECT_MS);
  }

  // ---- HTTP helpers --------------------------------------------------------

  private async httpJson(method: string, path: string, body?: unknown): Promise<any> {
    // Retry ONCE on a transport failure, but ONLY for idempotent GETs. A POST
    // (send message / create session) must NEVER auto-retry: a transport error
    // does NOT prove the request was undelivered. Undici surfaces a stale
    // keep-alive reset AND a `UND_ERR_HEADERS_TIMEOUT` (request delivered, daemon
    // still working the turn) both as `TypeError: fetch failed` — indistinguishable
    // here — so resending a POST can double-post the user's prompt (it did:
    // agents saw the same message twice). GETs carry no such side effect.
    let res: Response;
    try {
      res = await this.doFetch(method, path, body);
    } catch (err) {
      if (method !== 'GET' || !isOpencodeTransportError(err)) throw err;
      log.warn(`GET ${path} transport error (${describeError(err)}); retrying once on a fresh connection`);
      await sleep(100);
      res = await this.doFetch(method, path, body);
    }
    if (!res.ok) {
      throw new Error(`${method} ${path} → ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  private doFetch(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /** Create a session (optionally scoped to a working directory). */
  async createSession(directory?: string): Promise<string> {
    const body: Record<string, unknown> = {};
    if (directory) body.location = { directory };
    const resp = await this.httpJson('POST', '/api/session', body);
    const id = resp?.data?.id ?? resp?.id;
    if (!id) throw new Error('opencode session create returned no id');
    return id;
  }

  /**
   * Send a prompt to a session. opencode holds this POST open for the ENTIRE
   * turn (it doesn't send response headers until the turn finishes) while the
   * output streams over SSE. undici's 300s default headersTimeout would trip
   * `UND_ERR_HEADERS_TIMEOUT` on any turn >5min and falsely error the agent —
   * and that error MUST NOT be retried, because the prompt already landed, so a
   * resend double-posts the user's message. So this one request uses a dedicated
   * Node http request with NO timeout and a fresh (non-pooled) socket: it blocks
   * harmlessly until turn end (SSE drives output + completion), rejects only on a
   * genuine connection failure (surfaced once, never retried), and can't reuse a
   * stale keep-alive socket. Everything else stays on the quick fetch path.
   */
  sendPrompt(sessionId: string, text: string, model?: { providerID: string; modelID: string }): Promise<void> {
    const body: Record<string, unknown> = { parts: [{ type: 'text', text }] };
    if (model) body.model = model;
    return this.postLongLived(`/session/${sessionId}/message`, body).then(() => undefined);
  }

  /** POST with no read timeout on a fresh socket — for the turn-length message send. */
  private postLongLived(path: string, body: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.port == null) {
        reject(new Error('opencode server not connected (no port)'));
        return;
      }
      const payload = JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.port,
          path,
          method: 'POST',
          agent: false, // fresh socket every send — no keep-alive pool to go stale
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { data += c; });
          res.on('aborted', () => reject(new Error(`POST ${path} → connection aborted before completion`)));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(new Error(`POST ${path} → ${status} ${res.statusMessage ?? ''}`.trim()));
              return;
            }
            try {
              resolve(data ? JSON.parse(data) : null);
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  async abort(sessionId: string): Promise<void> {
    try {
      await this.httpJson('POST', `/session/${sessionId}/abort`, {});
    } catch { /* best-effort */ }
  }

  /** Whether this daemon's in-memory provider catalog contains a model. */
  async hasModel(
    providerID: string,
    modelID: string,
    directory?: string,
  ): Promise<boolean | null> {
    try {
      const path = directory
        ? `/provider?directory=${encodeURIComponent(directory)}`
        : '/provider';
      const catalog = await this.httpJson('GET', path);
      return providerCatalogHasModel(catalog, providerID, modelID);
    } catch (err) {
      log.warn(`Could not inspect opencode provider catalog: ${describeError(err)}`);
      return null;
    }
  }

  /** Session IDs currently generating (busy), used to detect turns still in flight. */
  async activeSessionIds(directory?: string): Promise<Set<string>> {
    // OpenCode 1.18 exposes the authoritative map at /session/status. The old
    // /api/session/active compatibility route can return an empty data object
    // while a turn is demonstrably busy, which made recovery finalize live
    // agents and then wedge them when more SSE deltas arrived.
    try {
      const path = directory
        ? `/session/status?directory=${encodeURIComponent(directory)}`
        : '/session/status';
      const status = await this.httpJson('GET', path);
      const ids = busySessionIdsFromStatus(status);
      if (ids !== null) return ids;
    } catch { /* fall through for older OpenCode versions */ }

    try {
      const resp = await this.httpJson('GET', '/api/session/active');
      const raw = resp?.data ?? resp;
      const ids = new Set<string>();
      if (Array.isArray(raw)) {
        for (const item of raw as Array<{ id?: string; sessionID?: string } | string>) {
          if (typeof item === 'string') ids.add(item);
          else if (item?.id) ids.add(item.id);
          else if (item?.sessionID) ids.add(item.sessionID);
        }
      } else if (raw && typeof raw === 'object') {
        for (const key of Object.keys(raw)) {
          if (key.startsWith('ses')) ids.add(key);
        }
      }
      return ids;
    } catch {
      return new Set();
    }
  }

  /** Disconnect our client but LEAVE the daemon running (survives restart). */
  disconnect(): void {
    this.stopped = true;
    this.connected = false;
    if (this.sseReq) {
      try {
        this.sseReq.destroy();
      } catch { /* ignore */ }
      this.sseReq = null;
    }
  }

  /** Kill the daemon recorded by the recovery store, even if no runner is attached. */
  static terminatePersistedDaemon(): boolean {
    const info = loadDaemonInfo();
    const wasRunning = Boolean(info && isPidAlive(info.pid));
    if (info && wasRunning) {
      try {
        process.kill(info.pid, 'SIGTERM');
      } catch { /* ignore */ }
    }
    clearDaemonInfo();
    return wasRunning;
  }

  /** Disconnect AND kill the daemon (used on explicit full shutdown/reload). */
  killDaemon(): boolean {
    this.disconnect();
    return OpencodeServerProcess.terminatePersistedDaemon();
  }
}

/** Parse OpenCode's `GET /session/status` map into currently busy sessions. */
export function busySessionIdsFromStatus(payload: unknown): Set<string> | null {
  const envelope = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : null;
  const raw = envelope?.data && typeof envelope.data === 'object'
    ? envelope.data as Record<string, unknown>
    : envelope;
  if (!raw || Array.isArray(raw)) return null;

  const ids = new Set<string>();
  for (const [sessionId, value] of Object.entries(raw)) {
    if (!sessionId.startsWith('ses')) continue;
    const type = value && typeof value === 'object'
      ? (value as Record<string, unknown>).type
      : value;
    if (type === 'busy' || type === 'processing' || type === 'running') ids.add(sessionId);
  }
  return ids;
}

/**
 * Check a `GET /provider` payload for the model shape used by OpenCode 1.x.
 * Returns null when the payload is not a recognizable provider catalog.
 */
export function providerCatalogHasModel(
  payload: unknown,
  providerID: string,
  modelID: string,
): boolean | null {
  const envelope = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : null;
  const root = envelope?.data && typeof envelope.data === 'object'
    ? envelope.data as Record<string, unknown>
    : envelope;
  if (!root || !Array.isArray(root.all)) return null;

  const provider = root.all.find((candidate) => {
    return candidate && typeof candidate === 'object'
      && (candidate as Record<string, unknown>).id === providerID;
  }) as Record<string, unknown> | undefined;
  if (!provider) return false;

  const models = provider.models;
  if (Array.isArray(models)) {
    return models.some((model) => {
      return model && typeof model === 'object'
        && (model as Record<string, unknown>).id === modelID;
    });
  }
  if (!models || typeof models !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(models, modelID)) return true;
  return Object.values(models).some((model) => {
    return model && typeof model === 'object'
      && (model as Record<string, unknown>).id === modelID;
  });
}

/**
 * `/global/event` wraps every bus event as `{directory, project, payload: {id,
 * type, properties}}`, while the legacy `/event` stream delivers the inner
 * shape directly. Unwrap the envelope so downstream routing sees ONE shape.
 */
export function unwrapGlobalSseEvent(evt: Record<string, unknown>): Record<string, unknown> {
  const payload = evt.payload;
  if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).type === 'string') {
    return payload as Record<string, unknown>;
  }
  return evt;
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function probeHealth(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('could not allocate a free port'))));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * True for a transport/connection failure (no HTTP response was received), as
 * opposed to a rejected request. `fetch` throws a `TypeError` ("fetch failed")
 * whose `cause` carries the undici socket error (ECONNRESET / UND_ERR_SOCKET /
 * ECONNREFUSED) — the dead-keep-alive-socket case we retry.
 */
export function isOpencodeTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const code = (err as { code?: string }).code
    ?? (cause as { code?: string } | undefined)?.code;
  if (code && ['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET', 'EPIPE', 'ETIMEDOUT'].includes(code)) {
    return true;
  }
  // Undici surfaces a generic TypeError("fetch failed") and stores the useful
  // socket code on `cause`; Node's http client often puts it on the error itself.
  return /fetch failed|ECONNRESET|ECONNREFUSED|socket hang up/i.test(err.message);
}

function describeError(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  const code = (cause as { code?: string } | undefined)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return code ? `${msg} [${code}]` : msg;
}
