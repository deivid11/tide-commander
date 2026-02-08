/**
 * WebSocket connection lifecycle – connect, disconnect, reconnect, and page-unload cleanup.
 */

import type { ServerMessage } from '../../shared/types';
import { store } from '../store';
import { agentDebugger } from '../services/agentDebugger';
import { STORAGE_KEYS, getStorageString, getAuthToken } from '../utils/storage';
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
import { sendMessage, extractAgentId } from './send';

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

  // Get configured backend URL or use defaults
  const configuredUrl = getStorageString(STORAGE_KEYS.BACKEND_URL, '');
  const authToken = getAuthToken();

  // Build WebSocket URL
  const defaultPort = typeof __SERVER_PORT__ !== 'undefined' ? __SERVER_PORT__ : 5174;
  let wsUrl: string;
  if (configuredUrl) {
    const wsConfigured = configuredUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
    wsUrl = wsConfigured.endsWith('/ws') ? wsConfigured : `${wsConfigured.replace(/\/$/, '')}/ws`;
  } else {
    wsUrl = `ws://127.0.0.1:${defaultPort}/ws`;
  }

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
  };

  newSocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      // Capture for agent-specific debugger if message has agentId
      const isDebuggerEnabled = agentDebugger.isEnabled();
      if (isDebuggerEnabled) {
        const agentId = extractAgentId(message);
        console.log('[AgentDebugger] RECEIVED - type:', message.type, 'agentId:', agentId, 'payload:', message.payload);
        if (agentId) {
          agentDebugger.captureReceived(agentId, event.data);
        }
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
