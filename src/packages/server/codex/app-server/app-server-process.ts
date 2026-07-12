/**
 * CodexAppServerProcess
 *
 * Manages a DETACHED, restart-surviving `codex app-server` listening on a
 * localhost WebSocket (`--listen ws://127.0.0.1:PORT`) and speaks its
 * "JSON-RPC lite" protocol (standard JSON-RPC 2.0 shape, `"jsonrpc":"2.0"`
 * omitted on the wire) over that WebSocket.
 *
 * Why WebSocket + detached:
 *  - `codex exec` never streams; the app-server emits `item/agentMessage/delta`
 *    tokens (word-by-word).
 *  - A stdio child dies with the commander. A detached process bound to a TCP
 *    port survives commander restarts, and the app-server keeps running any
 *    in-flight turn independently. On restart the commander reconnects the
 *    WebSocket and `thread/resume` re-subscribes — the server even replays the
 *    turn's remaining deltas (verified empirically).
 *  - The raw `unix://` transport uses an undocumented framing; the `ws://`
 *    transport uses standard WebSocket framing (the commander already depends on
 *    `ws`) and exposes `/readyz` for health probes.
 *
 * One process multiplexes every Codex agent: each agent owns a `threadId`, and
 * notifications carry that id so the runner can fan them back out.
 */

import { spawn } from 'child_process';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import { WebSocket } from 'ws';
import { createLogger } from '../../utils/logger.js';
import {
  loadDaemonInfo,
  saveDaemonInfo,
  clearDaemonInfo,
  APP_SERVER_LOG_FILE,
  type DaemonInfo,
} from './app-server-recovery-store.js';

const log = createLogger('CodexAppServer');

const INITIALIZE_TIMEOUT_MS = 15000;
const READYZ_TIMEOUT_MS = 20000;
const READYZ_POLL_MS = 250;

interface AppServerProcessOptions {
  executablePath: string;
  cwd: string;
  extraEnv: Record<string, string>;
  onNotification: (method: string, params: Record<string, unknown>) => void;
  /** The connection to the daemon dropped (daemon crash/kill), not a clean stop. */
  onExit: () => void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

type InboundMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export class CodexAppServerProcess {
  private ws: WebSocket | null = null;
  private port: number | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readyPromise: Promise<void> | null = null;
  private stopped = false;
  /** True when the last ensureStarted() rejoined an already-running daemon. */
  private reconnectedToExisting = false;

  constructor(private readonly opts: AppServerProcessOptions) {}

  isAlive(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && !this.stopped;
  }

  /** Did the current connection rejoin a daemon that survived a prior commander? */
  didReconnect(): boolean {
    return this.reconnectedToExisting;
  }

  ensureStarted(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.boot();
    return this.readyPromise;
  }

  private async boot(): Promise<void> {
    this.stopped = false;

    // 1. Rejoin an already-running daemon if one is healthy.
    const existing = loadDaemonInfo();
    if (existing && (await this.isDaemonHealthy(existing))) {
      log.log(`🔗 Rejoining existing app-server daemon pid=${existing.pid} port=${existing.port}`);
      this.port = existing.port;
      this.reconnectedToExisting = true;
      await this.connectAndInitialize(existing.port);
      return;
    }

    // 2. Spawn a fresh detached daemon.
    this.reconnectedToExisting = false;
    const port = await findFreePort();
    const pid = this.spawnDaemon(port);
    saveDaemonInfo({ port, pid, startedAt: Date.now() });
    this.port = port;

    await this.waitForReadyz(port);
    await this.connectAndInitialize(port);
  }

  private spawnDaemon(port: number): number {
    const { executablePath, cwd, extraEnv } = this.opts;
    const logFd = (() => {
      try {
        return fs.openSync(APP_SERVER_LOG_FILE, 'a');
      } catch {
        return 'ignore' as const;
      }
    })();
    log.log(`🚀 Spawning detached app-server: ${executablePath} app-server --listen ws://127.0.0.1:${port}`);
    const child = spawn(executablePath, ['app-server', '--listen', `ws://127.0.0.1:${port}`], {
      cwd,
      env: { ...process.env, ...extraEnv },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    child.on('error', (err) => log.error(`app-server spawn error: ${err.message}`));
    return child.pid ?? -1;
  }

  private async isDaemonHealthy(info: DaemonInfo): Promise<boolean> {
    if (!isPidAlive(info.pid)) return false;
    return probeReadyz(info.port, 1500);
  }

  private async waitForReadyz(port: number): Promise<void> {
    const deadline = Date.now() + READYZ_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probeReadyz(port, 1000)) return;
      await sleep(READYZ_POLL_MS);
    }
    throw new Error('app-server /readyz never became healthy');
  }

  private connectAndInitialize(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      this.ws = ws;
      let settled = false;

      const initTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('app-server initialize timed out'));
        }
      }, INITIALIZE_TIMEOUT_MS);

      ws.on('open', () => {
        this.request('initialize', {
          clientInfo: { name: 'tide-commander', title: 'Tide Commander', version: '1.0.0' },
          capabilities: { experimentalApi: true },
        })
          .then(() => {
            this.notify('initialized', {});
            clearTimeout(initTimer);
            if (!settled) {
              settled = true;
              log.log('✅ app-server WebSocket initialized');
              resolve();
            }
          })
          .catch((err) => {
            clearTimeout(initTimer);
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
      });

      ws.on('message', (data) => this.handleLine(data.toString()));
      ws.on('error', (err) => {
        log.warn(`app-server WebSocket error: ${err.message}`);
        if (!settled) {
          settled = true;
          clearTimeout(initTimer);
          reject(err);
        }
      });
      ws.on('close', () => this.handleDisconnect());
    });
  }

  private handleDisconnect(): void {
    const wasConnected = this.ws !== null;
    this.ws = null;
    this.readyPromise = null;
    for (const [, p] of this.pending) p.reject(new Error('app-server connection closed'));
    this.pending.clear();
    if (wasConnected && !this.stopped) {
      log.warn('app-server connection closed unexpectedly');
      this.opts.onExit();
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: InboundMessage;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log.warn(`Non-JSON message from app-server: ${trimmed.slice(0, 200)}`);
      return;
    }

    if (msg.id !== undefined && msg.method === undefined) {
      const id = typeof msg.id === 'number' ? msg.id : Number(msg.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.error) pending.reject(new Error(msg.error.message || `app-server error on ${pending.method}`));
      else pending.resolve(msg.result);
      return;
    }

    if (msg.method !== undefined && msg.id !== undefined) {
      this.handleServerRequest(msg.id, msg.method);
      return;
    }

    if (msg.method !== undefined) {
      this.opts.onNotification(msg.method, msg.params || {});
    }
  }

  /**
   * Auto-answer server-initiated requests. Agents run approvalPolicy:'never' +
   * danger-full-access, so approvals shouldn't fire — but approve rather than
   * hang if one does.
   */
  private handleServerRequest(id: number | string, method: string): void {
    if (/approval/i.test(method)) {
      this.respond(id, { decision: 'approved' });
      return;
    }
    log.warn(`Unhandled app-server request '${method}' — responding empty`);
    this.respond(id, {});
  }

  private respond(id: number | string, result: unknown): void {
    this.sendRaw({ id, result });
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('app-server not connected'));
    }
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
    this.sendRaw({ id, method, params });
    return promise;
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.sendRaw({ method, params });
  }

  private sendRaw(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot send to app-server: WebSocket not open');
      return;
    }
    this.ws.send(JSON.stringify(obj));
  }

  /** Disconnect our client but LEAVE the daemon running (survives restart). */
  disconnect(): void {
    this.stopped = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
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

function probeReadyz(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/readyz', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500);
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
