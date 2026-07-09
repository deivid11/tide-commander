/**
 * HMR-persisted WebSocket state and session storage helpers.
 * Keeps WebSocket connection state on `window` so it survives Vite hot reloads.
 */

interface HmrWebSocketState {
  ws: WebSocket | null;
  isConnecting: boolean;
  reconnectAttempts: number;
  reconnectTimeout: NodeJS.Timeout | null;
  // Heartbeat / liveness state MUST live here, not module-scoped in
  // connection.ts: Vite HMR re-executes that module while the socket (and its
  // onmessage closure) belong to a previous instance. A module-scoped
  // lastInboundAt would stay frozen at 0 for every instance that didn't
  // create the socket, and its heartbeat would kill a perfectly healthy
  // connection every cycle ("Connection Stale" loop).
  lastInboundAt: number;
  livenessProbeTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
}

declare global {
  interface Window {
    __tideWsState?: HmrWebSocketState;
  }
}

// Initialize or restore HMR state
if (!window.__tideWsState) {
  window.__tideWsState = {
    ws: null,
    isConnecting: false,
    reconnectAttempts: 0,
    reconnectTimeout: null,
    lastInboundAt: 0,
    livenessProbeTimer: null,
    heartbeatTimer: null,
  };
}

// Backfill fields added after a page already stored an older-shaped state
// object (survives HMR without a full reload).
if (window.__tideWsState.lastInboundAt === undefined) window.__tideWsState.lastInboundAt = 0;
if (window.__tideWsState.livenessProbeTimer === undefined) window.__tideWsState.livenessProbeTimer = null;
if (window.__tideWsState.heartbeatTimer === undefined) window.__tideWsState.heartbeatTimer = null;

// Use window state instead of module-level variables for HMR persistence
export const getWs = () => window.__tideWsState!.ws;
export const setWs = (socket: WebSocket | null) => { window.__tideWsState!.ws = socket; };
export const getIsConnecting = () => window.__tideWsState!.isConnecting;
export const setIsConnecting = (v: boolean) => { window.__tideWsState!.isConnecting = v; };
export const getReconnectAttempts = () => window.__tideWsState!.reconnectAttempts;
export const setReconnectAttempts = (v: number) => { window.__tideWsState!.reconnectAttempts = v; };
export const getReconnectTimeout = () => window.__tideWsState!.reconnectTimeout;
export const setReconnectTimeout = (v: NodeJS.Timeout | null) => { window.__tideWsState!.reconnectTimeout = v; };
export const getLastInboundAt = () => window.__tideWsState!.lastInboundAt;
/** Record that a frame arrived on the current socket (any type counts as liveness proof). */
export const noteInboundFrame = () => { window.__tideWsState!.lastInboundAt = Date.now(); };
export const getLivenessProbeTimer = () => window.__tideWsState!.livenessProbeTimer;
export const setLivenessProbeTimer = (v: NodeJS.Timeout | null) => { window.__tideWsState!.livenessProbeTimer = v; };
export const getHeartbeatTimer = () => window.__tideWsState!.heartbeatTimer;
export const setHeartbeatTimer = (v: NodeJS.Timeout | null) => { window.__tideWsState!.heartbeatTimer = v; };

export const maxReconnectAttempts = 10;
export const failingThresholdAttempts = 5;

// Use sessionStorage to persist connection state across HMR reloads
const SESSION_STORAGE_KEY = 'tide_ws_has_connected';

export function getHasConnectedBefore(): boolean {
  return sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true';
}

export function setHasConnectedBefore(value: boolean): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, value ? 'true' : 'false');
}

export function clearSessionState(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

// Registration slot so send.ts can trigger connect() without importing connection.ts directly
let connectFn: (() => void) | null = null;
export const setConnectFn = (fn: () => void) => { connectFn = fn; };
export const getConnectFn = () => connectFn;
