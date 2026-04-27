/**
 * WhatsApp Upstream WS Client
 * Maintains a long-lived WebSocket connection to the whatsapp-api server's
 * /ws/events endpoint. Reconnects with exponential backoff. Mirrors Slack's
 * Socket Mode lifecycle (connect on init, reconnect on drop, close on shutdown).
 *
 * Upstream message contract (whatsapp-api → here):
 *   { type:'hello',   sessions:[{sessionId,status},...] }
 *   { type:'event',   event:'message'|'message_create'|'message_ack'|'group_join'|'group_leave',
 *                     sessionId:string, data:any, ts:number }
 *   { type:'ping' }     // we reply with {type:'pong'}
 *   { type:'error',   message:string }
 */

import { WebSocket } from 'ws';

export type WhatsAppUpstreamEvent =
  | { type: 'hello'; sessions: Array<{ sessionId: string; status?: string }> }
  | {
      type: 'event';
      event: 'message' | 'message_create' | 'message_ack' | 'group_join' | 'group_leave' | string;
      sessionId: string;
      data: unknown;
      ts: number;
    }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'error'; message: string };

export interface WhatsAppWsLogger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000, 30000];

export class WhatsAppWsClient {
  private readonly url: string;
  private readonly onEvent: (msg: WhatsAppUpstreamEvent) => void;
  private readonly log: WhatsAppWsLogger;

  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    baseUrl: string,
    apiKey: string,
    onEvent: (msg: WhatsAppUpstreamEvent) => void,
    logger: WhatsAppWsLogger,
  ) {
    this.url = buildWsUrl(baseUrl, apiKey);
    this.onEvent = onEvent;
    this.log = logger;
  }

  /** Open the connection. Idempotent; safe to call after close() to restart. */
  connect(): void {
    this.closed = false;
    this.openSocket();
  }

  /** Permanently close the connection. Cancels any pending reconnect. */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // best-effort
      }
      this.ws = null;
    }
  }

  // ─── Internals ───

  private openSocket(): void {
    if (this.closed) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      this.log.error(`WhatsApp WS: failed to construct socket: ${err}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.on('open', () => {
      this.reconnectAttempts = 0;
      this.log.info(`WhatsApp WS: connected to ${redact(this.url)}`);
    });

    socket.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf-8');
      let parsed: WhatsAppUpstreamEvent;
      try {
        parsed = JSON.parse(text) as WhatsAppUpstreamEvent;
      } catch (err) {
        this.log.warn(`WhatsApp WS: dropped non-JSON frame (${(err as Error).message})`);
        return;
      }

      // Application-level ping/pong (NOT WS-protocol ping/pong).
      if (parsed && (parsed as { type?: string }).type === 'ping') {
        this.safeSend({ type: 'pong' });
        return;
      }

      if (parsed && (parsed as { type?: string }).type === 'error') {
        this.log.error(
          `WhatsApp WS: upstream error: ${(parsed as { message?: string }).message ?? 'unknown'}`,
        );
        // Fall through so listeners can also see the error envelope if they want.
      }

      try {
        this.onEvent(parsed);
      } catch (err) {
        this.log.error(`WhatsApp WS: onEvent handler threw: ${err}`);
      }
    });

    socket.on('close', (code, reason) => {
      const reasonText = reason?.toString() || '';
      // 1008 = policy violation (commonly used for auth failure). Surface a clear log.
      if (code === 1008 || code === 4001 || code === 4003) {
        this.log.error(
          `WhatsApp WS: connection closed by server (auth?) code=${code} reason="${reasonText}"`,
        );
      } else {
        this.log.warn(`WhatsApp WS: closed code=${code} reason="${reasonText}"`);
      }
      this.ws = null;
      this.scheduleReconnect();
    });

    socket.on('error', (err) => {
      this.log.error(`WhatsApp WS: socket error: ${err.message}`);
      // 'error' is followed by 'close', which schedules the reconnect.
    });
  }

  private safeSend(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        this.log.warn(`WhatsApp WS: send failed: ${err}`);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) return;

    const delay = BACKOFF_SCHEDULE_MS[Math.min(this.reconnectAttempts, BACKOFF_SCHEDULE_MS.length - 1)];
    this.reconnectAttempts += 1;
    this.log.info(`WhatsApp WS: reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
}

// ─── Helpers ───

function buildWsUrl(baseUrl: string, apiKey: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let wsBase: string;
  if (trimmed.startsWith('https://')) {
    wsBase = 'wss://' + trimmed.slice('https://'.length);
  } else if (trimmed.startsWith('http://')) {
    wsBase = 'ws://' + trimmed.slice('http://'.length);
  } else if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) {
    wsBase = trimmed;
  } else {
    // Fallback: assume http for unknown schemes, e.g. when only a host was given.
    wsBase = 'ws://' + trimmed;
  }
  return `${wsBase}/ws/events?apiKey=${encodeURIComponent(apiKey)}`;
}

function redact(url: string): string {
  return url.replace(/apiKey=[^&]+/, 'apiKey=********');
}
