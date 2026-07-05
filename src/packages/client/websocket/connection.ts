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

// ─── Connection generations ──────────────────────────────────────────────────
// openSocket() awaits network probes before it creates a socket, so a
// reconnect()/park/unload can supersede a run that is still probing. Each run
// captures the generation at start and bails after the await if it no longer
// owns it; socket handlers additionally check the ws slot so an abandoned
// socket can never feed the store alongside its replacement.
let connectGeneration = 0;

// One "Disconnected" toast per offline episode (reset when a socket opens).
let disconnectToastShown = false;

// How long a handshake may sit in CONNECTING before we abort it and let the
// normal retry path take over — browsers can hang there for a long time after
// a mobile network switch, and connect() refuses to act while one is pending.
const WS_HANDSHAKE_TIMEOUT_MS = 10_000;

// ─── WS-handshake demotion ───────────────────────────────────────────────────
// A URL whose /api/health answers but whose /ws upgrade keeps dying (e.g. a
// proxy without WebSocket support) must not be re-picked forever just because
// the probe likes it. After N consecutive handshake failures the URL is
// ordered after the other candidates until the demotion expires.
const WS_FAILURES_TO_DEMOTE = 2;
const WS_DEMOTION_TTL_MS = 5 * 60_000;
const wsHandshakeFailures = new Map<string, { count: number; lastAt: number }>();

function recordWsHandshakeFailure(url: string): void {
  const prev = wsHandshakeFailures.get(url);
  wsHandshakeFailures.set(url, { count: (prev?.count ?? 0) + 1, lastAt: Date.now() });
}

function isWsDemoted(url: string): boolean {
  const failures = wsHandshakeFailures.get(url);
  if (!failures || failures.count < WS_FAILURES_TO_DEMOTE) return false;
  if (Date.now() - failures.lastAt > WS_DEMOTION_TTL_MS) {
    wsHandshakeFailures.delete(url);
    return false;
  }
  return true;
}

// ─── Failback to a higher-priority URL ───────────────────────────────────────
// The prober is sticky (keeps the URL that last worked), so without this a
// client that failed over to a secondary URL would stay there forever. While
// connected to anything but the top-priority candidate, periodically probe the
// candidates ranked above it and switch back when one answers.
const FAILBACK_PROBE_INTERVAL_MS = 60_000;
let failbackTimer: ReturnType<typeof setInterval> | null = null;
let failbackProbeInFlight = false;

function stopFailbackWatch(): void {
  if (failbackTimer) {
    clearInterval(failbackTimer);
    failbackTimer = null;
  }
}

function startFailbackWatch(activeUrl: string): void {
  stopFailbackWatch();
  const candidates = getBackendUrls();
  const activeIndex = candidates.indexOf(activeUrl);
  if (activeIndex <= 0) return; // already on the top-priority URL (or unlisted)
  const higherPriority = candidates.slice(0, activeIndex);
  failbackTimer = setInterval(() => {
    if (failbackProbeInFlight || backgroundSuspended) return;
    failbackProbeInFlight = true;
    void (async () => {
      try {
        for (const url of higherPriority) {
          if (isWsDemoted(url)) continue;
          if (await probeBackend(url, 2000)) {
            stopFailbackWatch();
            // Point the sticky preference at the recovered URL, then
            // reconnect — the prober will try it first.
            setActiveBackendUrl(url);
            reconnect();
            return;
          }
        }
      } finally {
        failbackProbeInFlight = false;
      }
    })();
  }, FAILBACK_PROBE_INTERVAL_MS);
}

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
  connectGeneration++; // invalidate any openSocket() still probing
  stopFailbackWatch();

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
  connectGeneration++; // invalidate any openSocket() still probing
  stopFailbackWatch();
  const ws = getWs();
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
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
  // disconnect() clears the has-connected flag as part of unload cleanup, but
  // a programmatic reconnect should still resync on reopen like any other
  // reconnection — losing the flag would silently skip cb.onReconnect().
  const wasConnected = getHasConnectedBefore();
  disconnect();
  if (wasConnected) {
    setHasConnectedBefore(true);
  }
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
 * Candidate order for probing: last successful URL first (sticky), then the
 * configured priority order, with WS-demoted URLs pushed to the back.
 */
function orderCandidates(candidates: string[]): string[] {
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
  const healthy = ordered.filter((u) => !isWsDemoted(u));
  const demoted = ordered.filter((u) => isWsDemoted(u));
  return [...healthy, ...demoted];
}

/** Pick the first URL (in the given order) whose /api/health answers. */
async function pickReachableUrl(ordered: string[], timeoutPerProbeMs: number): Promise<string | null> {
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
  const generation = ++connectGeneration;
  const candidates = getBackendUrls();
  const authToken = getAuthToken();

  // Resolve which HTTP base URL to use. With a configured list, probe in priority
  // order (last successful first) and pick the first reachable host.
  let chosenHttpUrl: string | null = null;
  let probeVerified = false;
  if (candidates.length > 0) {
    const ordered = orderCandidates(candidates);
    chosenHttpUrl = await pickReachableUrl(ordered, 3000);
    if (generation !== connectGeneration) {
      // Superseded while probing (reconnect()/unload) — the newer run owns the
      // shared connection state now, so drop out without touching it.
      return;
    }
    if (backgroundSuspended) {
      setIsConnecting(false);
      return;
    }
    if (chosenHttpUrl) {
      probeVerified = true;
      setActiveBackendUrl(chosenHttpUrl);
    } else {
      // Nothing answered /api/health, but a blocked probe (proxy, filtered
      // fetch) doesn't prove the WS is down too — try the socket directly on
      // the top candidate instead of never attempting a connection at all.
      chosenHttpUrl = ordered[0] ?? null;
      if (!chosenHttpUrl) {
        setIsConnecting(false);
        handleReconnectDelay();
        return;
      }
      if (!disconnectToastShown) {
        cb.onToast?.('warning', 'Disconnected', 'No backend URL reachable. Retrying…');
        disconnectToastShown = true;
      }
    }
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
  const socket = newSocket;
  let opened = false;

  // Abort a handshake stuck in CONNECTING so the normal retry path takes over.
  const handshakeTimer = setTimeout(() => {
    if (getWs() === socket && socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }, WS_HANDSHAKE_TIMEOUT_MS);

  socket.onopen = () => {
    clearTimeout(handshakeTimer);
    if (getWs() !== socket || backgroundSuspended) {
      // Abandoned while connecting (superseded or app parked) — never let it
      // feed the store next to its replacement.
      socket.close(1000, 'Superseded connection');
      return;
    }
    opened = true;
    if (chosenHttpUrl) {
      wsHandshakeFailures.delete(chosenHttpUrl);
    }
    // The last-resort path skips the optimistic pre-connect write, so record
    // the URL now that the open socket proves it works.
    setActiveBackendUrl(chosenHttpUrl ?? '');
    disconnectToastShown = false;

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

    // Sync the URL we actually connected to (plus the full candidate list so
    // the native socket can fail over on its own while the app is parked).
    syncConnectionToNative(chosenHttpUrl ?? '', authToken, candidates);

    // Flush any messages that were queued while disconnected
    flushPendingMessages();

    // Server-side git watch subscriptions live on the socket — re-declare
    // the watch list on every (re)connect.
    resyncGitWatch();

    // Connected to a lower-priority URL? Watch for the better ones to recover.
    if (chosenHttpUrl) {
      startFailbackWatch(chosenHttpUrl);
    }
  };

  socket.onmessage = (event) => {
    if (getWs() !== socket) return; // abandoned socket
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

  socket.onclose = () => {
    clearTimeout(handshakeTimer);
    if (getWs() !== socket) {
      // Abandoned socket (superseded, or already cleaned up by disconnect()) —
      // its replacement owns the shared state.
      return;
    }
    stopFailbackWatch();
    setIsConnecting(false);
    setWs(null);
    store.setConnected(false);
    store.stopStatusPolling();

    // Health answered but the handshake died — remember it so the prober can
    // prefer candidates whose WS actually works.
    if (!opened && probeVerified && chosenHttpUrl) {
      recordWsHandshakeFailure(chosenHttpUrl);
    }

    // Intentional background park: stay quiet and do NOT schedule reconnects —
    // resumeFromBackground() reconnects when the app comes back.
    if (backgroundSuspended) {
      return;
    }

    if (!disconnectToastShown) {
      cb.onToast?.('warning', 'Disconnected', 'Connection lost. Reconnecting…');
      disconnectToastShown = true;
    }
    if (getReconnectAttempts() >= failingThresholdAttempts) {
      store.setConnectionFailing(true);
    }
    handleReconnectDelay();
  };

  socket.onerror = () => {
    if (getWs() !== socket) return; // abandoned socket
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
