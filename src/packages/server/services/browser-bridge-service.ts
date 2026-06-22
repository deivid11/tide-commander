/**
 * browser-bridge-service.ts
 *
 * Relays commands from server-side agents to a connected browser extension side
 * panel (the user's live, logged-in browser session) and awaits the result.
 *
 * Transport: the extension's WebSocket registers itself via `browser_register`;
 * the server sends `browser_command` to that socket and the extension replies
 * with `browser_result` (correlated by reqId) — the same request/await pattern
 * the permission + agent-prompt services use.
 *
 * This is the READ path (DOM / console / network / errors / screenshot in the
 * live session). Page INTERACTION (click / type / navigate) goes through the
 * CDP service instead — see cdp-service.ts.
 */

import type { WebSocket } from 'ws';
import { createLogger } from '../utils/logger.js';

const log = createLogger('BrowserBridge');

const DEFAULT_TIMEOUT_MS = 15000;

// Registered extension sockets, most-recently-registered first (a freshly opened
// panel takes precedence when several are connected).
const sockets: WebSocket[] = [];

/** Who opened a bridge socket — captured from the WS upgrade (see handler.ts). */
export interface BrowserClientInfo {
  ip: string; // remote address; ::1/127.0.0.1 when the browser is on this host
  userAgent: string; // browser User-Agent (OS + browser version)
  origin: string; // chrome-extension://<id> for the extension side panel
  host?: string; // server hostname — equals the client machine name iff `local`
  local: boolean; // true when the peer is loopback (same machine as the server)
  connectedAt: number;
}
// Set by the WS layer on the socket object at connection time.
type WithClient = WebSocket & { __tcClient?: BrowserClientInfo };
const clientInfo = new Map<WebSocket, BrowserClientInfo>();

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}
const pending = new Map<string, Pending>();
let seq = 0;

/** Mark a socket as a browser-command target; auto-unregisters on close. */
export function registerBrowserSocket(ws: WebSocket): void {
  if (!sockets.includes(ws)) {
    sockets.unshift(ws);
    log.log(`Browser extension registered (total: ${sockets.length})`);
  }
  const info = (ws as WithClient).__tcClient;
  if (info) clientInfo.set(ws, info);
  log.log(`Browser client: ${info ? `${info.origin || '?'} @ ${info.ip || '?'}${info.host ? ` (${info.host})` : ''}` : 'unknown'}`);
  ws.on('close', () => unregisterBrowserSocket(ws));
}

export function unregisterBrowserSocket(ws: WebSocket): void {
  const i = sockets.indexOf(ws);
  if (i >= 0) {
    sockets.splice(i, 1);
    log.log(`Browser extension unregistered (remaining: ${sockets.length})`);
  }
  clientInfo.delete(ws);
}

/** True when at least one extension side panel is connected + open. */
export function browserConnected(): boolean {
  return sockets.some((w) => w.readyState === 1 /* OPEN */);
}

/** Identify the connected bridge clients (IP / User-Agent / extension origin / host). */
export function getBrowserClients(): Array<BrowserClientInfo & { open: boolean }> {
  return sockets.map((w) => {
    const info = clientInfo.get(w) || { ip: '', userAgent: '', origin: '', local: false, connectedAt: 0 };
    return { ...info, open: w.readyState === 1 };
  });
}

/** Resolve a pending command with the extension's reply. */
export function resolveBrowserResult(reqId: string, ok: boolean, result?: unknown, error?: string): void {
  const p = pending.get(reqId);
  if (!p) return;
  clearTimeout(p.timeout);
  pending.delete(reqId);
  if (ok) p.resolve(result);
  else p.reject(new Error(error || 'browser command failed'));
}

/**
 * Send a command to the live browser and await its result. Rejects when no panel
 * is connected, on timeout, or when the extension reports an error.
 */
export function runBrowserCommand(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const ws = sockets.find((w) => w.readyState === 1);
  if (!ws) {
    return Promise.reject(
      new Error('No browser connected — open the Tide Commander side panel in your browser, then retry.'),
    );
  }
  const reqId = `b_${Date.now()}_${++seq}`;
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`Browser command "${cmd}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(reqId, { resolve, reject, timeout });
    try {
      ws.send(JSON.stringify({ type: 'browser_command', payload: { reqId, cmd, args: args || {} } }));
    } catch (err) {
      clearTimeout(timeout);
      pending.delete(reqId);
      reject(err instanceof Error ? err : new Error('failed to send browser command'));
    }
  });
}
