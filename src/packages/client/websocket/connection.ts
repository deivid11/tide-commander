/**
 * WebSocket connection lifecycle – connect, disconnect, reconnect, and page-unload cleanup.
 */

import type { ServerMessage } from '../../shared/types';
import { store } from '../store';
import { agentDebugger } from '../services/agentDebugger';
import {
  getBackendUrls,
  getActiveBackendUrl,
  setActiveBackendUrl,
  getAuthToken,
} from '../utils/storage';
import { syncConnectionToNative } from '../utils/notifications';
import { resyncGitWatch } from '../services/gitWatch';
import {
  getWs, setWs,
  getIsConnecting, setIsConnecting,
  getReconnectAttempts, setReconnectAttempts,
  getReconnectTimeout, setReconnectTimeout,
  failingThresholdAttempts,
  getHasConnectedBefore, setHasConnectedBefore,
  clearSessionState,
  setConnectFn,
} from './state';
import { cb } from './callbacks';
import { handleServerMessage } from './handlers';
import { sendMessage, extractAgentId, flushPendingMessages } from './send';

// Register connect() so send.ts can trigger it without a circular import
setConnectFn(() => connect());

// Track if we've added the beforeunload listener
let beforeUnloadListenerAdded = false;

// ─── Background parking (native app) ────────────────────────────────────────
// While the Capacitor app is backgrounded, the Android foreground service
// delivers notifications through its own native socket, so keeping THIS
// socket open only burns CPU/battery: every broadcast message (including all
// agents' streaming output) would be parsed, stored, and re-rendered by React
// with nothing on screen. Parking the socket stops all of that; the existing
// reconnect + post-reconnect resync flow restores full state on resume.
let backgroundSuspended = false;
// Skip the "Reconnected" toast for resumes from an intentional park — the
// connection never "failed", so the warning/success pair would just be noise.
let suppressNextReconnectToast = false;

/** True while the socket is intentionally parked because the app is hidden. */
export function isBackgroundSuspended(): boolean {
  return backgroundSuspended;
}

/** Park the socket while the native app is backgrounded (notifications keep
 * flowing through the Android foreground service's own socket). */
export function suspendForBackground(): void {
  if (backgroundSuspended) return;
  backgroundSuspended = true;

  const timeout = getReconnectTimeout();
  if (timeout) {
    clearTimeout(timeout);
    setReconnectTimeout(null);
  }

  const ws = getWs();
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close(1000, 'App backgrounded');
  }
  setIsConnecting(false);
  store.setConnected(false);
  store.stopStatusPolling();
}

/** Reconnect after a background park (no-op reconnect if never parked). */
export function resumeFromBackground(): void {
  if (backgroundSuspended) {
    backgroundSuspended = false;
    suppressNextReconnectToast = true;
    setReconnectAttempts(0);
  }
  connect();
}

// Clean up WebSocket on page unload (actual refresh/close, not HMR)
function handleBeforeUnload(): void {
  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, 'Page unloading');
  }
  const timeout = getReconnectTimeout();
  if (timeout) {
    clearTimeout(timeout);
  }
  if (window.__tideWsState) {
    window.__tideWsState.ws = null;
    window.__tideWsState.reconnectTimeout = null;
    window.__tideWsState.isConnecting = false;
    window.__tideWsState.reconnectAttempts = 0;
  }
  clearSessionState();
}

// Add beforeunload listener once (idempotent)
function ensureBeforeUnloadListener(): void {
  if (!beforeUnloadListenerAdded) {
    window.addEventListener('beforeunload', handleBeforeUnload);
    beforeUnloadListenerAdded = true;
  }
}

/** Disconnect and clean up all WebSocket state. */
export function disconnect(): void {
  handleBeforeUnload();
  store.setConnected(false);
  store.stopStatusPolling();
}

/** Disconnect then reconnect with potentially new backend URL. */
export function reconnect(): void {
  disconnect();
  setReconnectAttempts(0);
  setTimeout(() => connect(), 100);
}

/** Probe a single backend by hitting `/api/health` with an abort timeout. */
async function probeBackend(httpUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${httpUrl.replace(/\/$/, '')}/api/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick the first reachable URL from the configured priority list.
 * Tries the previously-active URL first if it's still in the list, then walks the rest in order.
 */
async function pickReachableUrl(candidates: string[], timeoutPerProbeMs: number): Promise<string | null> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const previouslyActive = getActiveBackendUrl();
  if (previouslyActive && candidates.includes(previouslyActive)) {
    ordered.push(previouslyActive);
    seen.add(previouslyActive);
  }
  for (const u of candidates) {
    if (!seen.has(u)) {
      ordered.push(u);
      seen.add(u);
    }
  }
  for (const candidate of ordered) {
    if (await probeBackend(candidate, timeoutPerProbeMs)) {
      return candidate;
    }
  }
  return null;
}

/** Build the WS URL to connect to given a chosen HTTP base URL (or null for defaults). */
function buildWsUrl(httpUrl: string | null): string {
  const defaultPort = typeof __SERVER_PORT__ !== 'undefined' ? __SERVER_PORT__ : 6200;
  if (httpUrl) {
    const wsConfigured = httpUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
    return wsConfigured.endsWith('/ws') ? wsConfigured : `${wsConfigured.replace(/\/$/, '')}/ws`;
  }
  if (import.meta.env.DEV) {
    const browserHost = window.location.hostname;
    const wsHost = (browserHost === 'localhost' || browserHost === '127.0.0.1' || browserHost === '::1')
      ? '127.0.0.1'
      : browserHost;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProtocol}://${wsHost}:${defaultPort}/ws`;
  }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/ws`;
}

/** Establish (or re-use) a WebSocket connection to the backend. */
export function connect(): void {
  // Parked for background — resumeFromBackground() is the only way back.
  if (backgroundSuspended) return;

  ensureBeforeUnloadListener();

  // Clear any pending reconnect
  const pendingTimeout = getReconnectTimeout();
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    setReconnectTimeout(null);
  }

  const ws = getWs();

  // Prevent duplicate connection attempts
  if (getIsConnecting() || (ws && ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    if (getHasConnectedBefore() && cb.onReconnect) {
      cb.onReconnect();
    }
    return;
  }

  setReconnectAttempts(getReconnectAttempts() + 1);
  setIsConnecting(true);

  void openSocket();
}

async function openSocket(): Promise<void> {
  const candidates = getBackendUrls();
  const authToken = getAuthToken();

  // Resolve which HTTP base URL to use. With a configured list, probe in priority
  // order (last successful first) and pick the first reachable host.
  let chosenHttpUrl: string | null = null;
  if (candidates.length > 0) {
    chosenHttpUrl = await pickReachableUrl(candidates, 3000);
    if (!chosenHttpUrl) {
      setIsConnecting(false);
      const attempts = getReconnectAttempts();
      if (attempts === 1) {
        cb.onToast?.('warning', 'Disconnected', 'No backend URL reachable. Retrying…');
      }
      if (attempts >= failingThresholdAttempts) {
        store.setConnectionFailing(true);
      }
      handleReconnectDelay();
      return;
    }
    setActiveBackendUrl(chosenHttpUrl);
  } else {
    // No configured URL — use built-in defaults exactly as before.
    setActiveBackendUrl('');
  }

  const wsUrl = buildWsUrl(chosenHttpUrl);

  let newSocket: WebSocket | null = null;
  try {
    if (authToken) {
      newSocket = new WebSocket(wsUrl, [`auth-${authToken}`]);
    } else {
      newSocket = new WebSocket(wsUrl);
    }
  } catch {
    setIsConnecting(false);
    handleReconnectDelay();
    return;
  }

  setWs(newSocket);

  newSocket.onopen = () => {
    const isReconnection = getHasConnectedBefore();
    setIsConnecting(false);
    setReconnectAttempts(0);
    setHasConnectedBefore(true);
    store.setConnected(true);
    store.startStatusPolling();
    store.clearAllPermissions();

    if (isReconnection) {
      if (!suppressNextReconnectToast) {
        cb.onToast?.('success', 'Reconnected', 'Connection restored - refreshing data...');
      }
      // Always resync — a background park still misses whatever happened while parked.
      cb.onReconnect?.();
    } else {
      cb.onToast?.('success', 'Connected', 'Connected to Tide Commander server');
    }
    suppressNextReconnectToast = false;

    // Sync the URL we actually connected to so background services align.
    syncConnectionToNative(chosenHttpUrl ?? '', authToken);

    // Flush any messages that were queued while disconnected
    flushPendingMessages();

    // Server-side git watch subscriptions live on the socket — re-declare
    // the watch list on every (re)connect.
    resyncGitWatch();
  };

  newSocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      // Capture for agent-specific debugger if message has an extractable agent id.
      // NOTE: no console.log here — this is the hottest path in the client
      // (every streamed chunk of every agent) and logging full payloads burns
      // CPU/memory, especially on mobile where it also runs in the background.
      const agentId = extractAgentId(message);
      if (agentId) {
        agentDebugger.captureReceived(agentId, event.data);
      }

      handleServerMessage(message);
    } catch (err) {
      const preview = event.data.substring(0, 200);
      console.error(`[WS] Failed to parse message:`, err);
      console.error(`[WS] Raw data (first 200 chars):`, preview);
      console.error(`[WS] Full data length:`, event.data.length);
      if (event.data.length < 5000) {
        console.error(`[WS] Full malformed message:`, event.data);
      }
    }
  };

  newSocket.onclose = () => {
    setIsConnecting(false);
    setWs(null);
    store.setConnected(false);
    store.stopStatusPolling();

    // Intentional background park: stay quiet and do NOT schedule reconnects —
    // resumeFromBackground() reconnects when the app comes back.
    if (backgroundSuspended) {
      return;
    }

    const attempts = getReconnectAttempts();
    if (attempts === 1) {
      cb.onToast?.('warning', 'Disconnected', 'Connection lost. Reconnecting…');
    }
    if (attempts >= failingThresholdAttempts) {
      store.setConnectionFailing(true);
    }
    handleReconnectDelay();
  };

  newSocket.onerror = () => {
    setIsConnecting(false);
  };

  // Set up store to use this connection
  store.setSendMessage(sendMessage);
}

/** Schedule a reconnection with exponential backoff (250ms→8s). */
function handleReconnectDelay(): void {
  const attempts = getReconnectAttempts();
  const delay = Math.min(250 * Math.pow(2, Math.max(0, attempts - 1)), 8000);
  setReconnectTimeout(setTimeout(connect, delay));
}
