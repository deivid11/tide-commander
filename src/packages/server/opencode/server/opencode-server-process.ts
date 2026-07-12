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
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`${method} ${path} → ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
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

  /** Send a prompt to a session. Fire-and-forget: streaming arrives via SSE. */
  sendPrompt(sessionId: string, text: string, model?: { providerID: string; modelID: string }): Promise<void> {
    const body: Record<string, unknown> = { parts: [{ type: 'text', text }] };
    if (model) body.model = model;
    return this.httpJson('POST', `/session/${sessionId}/message`, body).then(() => undefined);
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
