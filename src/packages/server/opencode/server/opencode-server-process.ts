/**
 * OpencodeServerProcess
 *
 * Manages a DETACHED, restart-surviving `opencode serve` HTTP server and speaks
 * its API: one SSE stream (`GET /event`) carries every session's events
 * (word-by-word `message.part.delta`), and prompts/sessions/aborts go over plain
 * HTTP. One server multiplexes every OpenCode agent — each agent owns a
 * `sessionID`, and every event carries `properties.sessionID` so the runner can
 * fan them back out.
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
    if (this.connected) return;
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

  /** Open the single global SSE stream and parse `data:` frames. */
  private openSse(): void {
    if (this.stopped) return;
    const req = http.get(`${this.baseUrl}/event`, { headers: { Accept: 'text/event-stream' } }, (res) => {
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
      res.on('end', () => this.handleSseClosed());
    });
    this.sseReq = req;
    req.on('error', (err) => {
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
    this.opts.onEvent(evt);
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
      if (method !== 'GET' || !isTransportError(err)) throw err;
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

  /** Session IDs currently generating (busy), used to detect turns still in flight. */
  async activeSessionIds(): Promise<Set<string>> {
    try {
      const resp = await this.httpJson('GET', '/api/session/active');
      const list = (resp?.data ?? resp) as Array<{ id?: string; sessionID?: string } | string> | undefined;
      const ids = new Set<string>();
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === 'string') ids.add(item);
          else if (item?.id) ids.add(item.id);
          else if (item?.sessionID) ids.add(item.sessionID);
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

  /** Disconnect AND kill the daemon (used on explicit full shutdown). */
  killDaemon(): void {
    this.disconnect();
    const info = loadDaemonInfo();
    if (info && isPidAlive(info.pid)) {
      try {
        process.kill(info.pid, 'SIGTERM');
      } catch { /* ignore */ }
    }
    clearDaemonInfo();
  }
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
function isTransportError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const code = (cause as { code?: string } | undefined)?.code;
  if (code && ['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET', 'EPIPE', 'ETIMEDOUT'].includes(code)) {
    return true;
  }
  // Fall back to the message: undici surfaces the generic "fetch failed" here.
  return /fetch failed/i.test(err.message);
}

function describeError(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  const code = (cause as { code?: string } | undefined)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return code ? `${msg} [${code}]` : msg;
}
