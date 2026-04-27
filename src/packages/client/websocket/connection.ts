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
import {
  getWs, setWs,
  getIsConnecting, setIsConnecting,
  getReconnectAttempts, setReconnectAttempts,
  getReconnectTimeout, setReconnectTimeout,
  maxReconnectAttempts,
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
  const defaultPort = typeof __SERVER_PORT__ !== 'undefined' ? __SERVER_PORT__ : 6200;

  // Resolve which HTTP base URL to use. With a configured list, probe in priority
  // order (last successful first) and pick the first reachable host.
  let chosenHttpUrl: string | null = null;
  if (candidates.length > 0) {
    chosenHttpUrl = await pickReachableUrl(candidates, 3000);
    if (!chosenHttpUrl) {
      // None of the configured URLs answered. Surface a toast and back off.
      setIsConnecting(false);
      const attempts = getReconnectAttempts();
      if (attempts < maxReconnectAttempts) {
        cb.onToast?.(
          'warning',
          'Disconnected',
          `No backend URL reachable. Retrying… (attempt ${attempts}/${maxReconnectAttempts})`,
        );
        handleReconnectDelay();
      } else {
        cb.onToast?.(
          'error',
          'Connection Failed',
          'None of the configured backend URLs are reachable.',
        );
      }
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
      cb.onToast?.('success', 'Reconnected', 'Connection restored - refreshing data...');
      cb.onReconnect?.();
    } else {
      cb.onToast?.('success', 'Connected', 'Connected to Tide Commander server');
    }

    // Sync the URL we actually connected to so background services align.
    syncConnectionToNative(chosenHttpUrl ?? '', authToken);

    // Flush any messages that were queued while disconnected
    flushPendingMessages();
  };

  newSocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      // Capture for agent-specific debugger if message has an extractable agent id.
      const agentId = extractAgentId(message);
      console.log('[AgentDebugger] RECEIVED - type:', message.type, 'agentId:', agentId, 'payload:', message.payload);
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

    const attempts = getReconnectAttempts();
    if (attempts < maxReconnectAttempts) {
      cb.onToast?.('warning', 'Disconnected', `Connection lost. Reconnecting... (attempt ${attempts + 1}/${maxReconnectAttempts})`);
      handleReconnectDelay();
    } else {
      cb.onToast?.('error', 'Connection Failed', `Could not connect to server. Please check if the backend is running on port ${defaultPort}.`);
    }
  };

  newSocket.onerror = () => {
    setIsConnecting(false);
  };

  // Set up store to use this connection
  store.setSendMessage(sendMessage);
}

/** Schedule a reconnection with exponential backoff. */
function handleReconnectDelay(): void {
  const attempts = getReconnectAttempts();
  const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
  setReconnectTimeout(setTimeout(connect, delay));
}
