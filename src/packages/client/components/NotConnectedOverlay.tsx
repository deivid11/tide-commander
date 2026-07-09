import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useIsConnected, useResyncInProgress, useConnectionFailing } from '../store';
import { reconnect } from '../websocket/connection';
import {
  getBackendUrl,
  getBackendUrls,
  setBackendUrls,
  subscribeBackendUrlChange,
  getAuthToken,
  setStorageString,
  STORAGE_KEYS,
} from '../utils/storage';
import { validateBackendUrlInput, checkBackendReachability } from '../utils/backendConnection';
import { Icon } from './Icon';

const CONNECT_TIMEOUT_MS = 4000;
// How long to show the small "Reconnecting…" toast before revealing the full
// overlay. The window is (re)started from scratch whenever the app returns to
// the foreground, so a reopen always gets the full grace — never an instant modal.
const RECONNECT_GRACE_MS = 15000;

export function NotConnectedOverlay() {
  const { t } = useTranslation(['config']);
  const isConnected = useIsConnected();
  const resyncInProgress = useResyncInProgress();
  const connectionFailing = useConnectionFailing();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [gracePeriod, setGracePeriod] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [backendUrlDraft, setBackendUrlDraft] = useState(() => getBackendUrl());
  const [authTokenDraft, setAuthTokenDraft] = useState(() => getAuthToken());
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const wasConnectedRef = useRef(false);
  const graceTimerRef = useRef<number | null>(null);

  const waitForWsConnected = useCallback((timeoutMs: number = 7000): Promise<boolean> => {
    if (store.getState().isConnected) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let done = false;
      const finish = (result: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(result);
      };

      const unsubscribe = store.subscribe(() => {
        if (store.getState().isConnected) {
          finish(true);
        }
      });

      const timeout = setTimeout(() => finish(false), timeoutMs);
    });
  }, []);

  // Initial grace period (3s on first load)
  useEffect(() => {
    const timer = setTimeout(() => setGracePeriod(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // (Re)start the "Reconnecting…" grace window: show the small toast for
  // RECONNECT_GRACE_MS before revealing the full overlay. Held in a ref so both
  // the drop-triggered and the foreground-triggered paths share one timer
  // (restarting cancels any in-flight countdown instead of racing it).
  const startReconnectGrace = useCallback(() => {
    setGracePeriod(true);
    setReconnecting(true);
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = window.setTimeout(() => {
      graceTimerRef.current = null;
      setGracePeriod(false);
      setReconnecting(false);
    }, RECONNECT_GRACE_MS);
  }, []);

  // Reconnection grace period: when the connection drops after having been
  // connected, show the small toast before the full overlay.
  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      setReconnecting(false);
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      return;
    }
    // Connection just dropped and we were previously connected
    if (wasConnectedRef.current) {
      startReconnectGrace();
    }
  }, [isConnected, startReconnectGrace]);

  // Returning to the foreground restarts the grace window from scratch. The
  // countdown started at drop time may have elapsed while the app was
  // backgrounded (mobile/PWA), which would otherwise flash the full overlay the
  // instant the user reopens Tide Commander. Restarting here gives the fresh
  // reconnect its full window measured from when the user is actually looking.
  useEffect(() => {
    const restartIfDisconnected = () => {
      if (store.getState().isConnected) return;
      if (!wasConnectedRef.current) return; // first-run load uses the initial grace
      startReconnectGrace();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') restartIfDisconnected();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('tideAppResume', restartIfDisconnected);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('tideAppResume', restartIfDisconnected);
    };
  }, [startReconnectGrace]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return subscribeBackendUrlChange((nextUrls) => {
      setBackendUrlDraft(nextUrls[0] ?? '');
    });
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText('bunx tide-commander').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, []);

  const handleConnect = useCallback(async () => {
    if (isConnecting) return;

    const startedAt = Date.now();
    const getRemainingMs = () => CONNECT_TIMEOUT_MS - (Date.now() - startedAt);

    setConnectError(null);
    setConnectStatus('Validating URL');

    const effectiveUrl = backendUrlDraft.trim() || 'http://localhost:6200';
    const validation = validateBackendUrlInput(effectiveUrl);
    if (!validation.ok) {
      setConnectStatus(null);
      setConnectError(validation.error || 'Invalid backend URL');
      return;
    }

    setIsConnecting(true);
    setConnectStatus('Checking host reachability');
    const reachabilityTimeout = getRemainingMs();
    if (reachabilityTimeout <= 0) {
      setIsConnecting(false);
      setConnectStatus(null);
      setConnectError('Connection timeout after 4 seconds');
      return;
    }
    const reachability = await checkBackendReachability(validation.normalizedUrl, reachabilityTimeout);
    if (!reachability.ok) {
      if (!mountedRef.current) return;
      setIsConnecting(false);
      setConnectStatus(null);
      if (getRemainingMs() <= 0) {
        setConnectError('Connection timeout after 4 seconds');
      } else {
        setConnectError(reachability.error || 'Failed to reach host');
      }
      return;
    }

    // Promote the typed URL to the top of the list (or insert it). Preserves
    // any other configured URLs the user has set up so multi-network setups
    // (LAN + VPN) survive a manual reconnect from this overlay.
    const existingUrls = getBackendUrls();
    const reorderedUrls = [
      validation.normalizedUrl,
      ...existingUrls.filter((u) => u !== validation.normalizedUrl),
    ];
    setBackendUrls(reorderedUrls);
    setStorageString(STORAGE_KEYS.AUTH_TOKEN, authTokenDraft.trim());
    setConnectStatus('Connecting to server');
    reconnect();

    const wsTimeout = getRemainingMs();
    if (wsTimeout <= 0) {
      setIsConnecting(false);
      setConnectStatus(null);
      setConnectError('Connection timeout after 4 seconds');
      return;
    }

    const connected = await waitForWsConnected(wsTimeout);
    if (!mountedRef.current) return;

    if (!connected) {
      setIsConnecting(false);
      setConnectStatus(null);
      if (getRemainingMs() <= 0) {
        setConnectError('Connection timeout after 4 seconds');
      } else {
        setConnectError('Could not establish WebSocket connection. Verify host and auth token, then retry');
      }
      return;
    }

    setIsConnecting(false);
    setConnectStatus('Connected');
    setConnectError(null);
  }, [backendUrlDraft, authTokenDraft, isConnecting, waitForWsConnected]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isConnecting) {
      void handleConnect();
    }
  }, [handleConnect, isConnecting]);

  const handleExplore = useCallback(() => {
    setDismissed(true);
  }, []);

  if (isConnected && resyncInProgress && !dismissed) {
    return (
      <div className="reconnecting-toast">
        <span className="reconnecting-spinner" />
        Reconnecting…
      </div>
    );
  }

  if (isConnected || dismissed) return null;

  // Active reconnection grace: show the small toast for the whole window, even
  // if a stale `connectionFailing` flag survived from before a background/resume
  // — the fresh reconnect earns its full grace before the full overlay appears.
  if (reconnecting) {
    return (
      <div className="reconnecting-toast">
        <span className="reconnecting-spinner" />
        Reconnecting…
      </div>
    );
  }

  if (gracePeriod && !connectionFailing) return null;

  return (
    <div className="not-connected-overlay">
      <div className="not-connected-panel">
        <h2 className="not-connected-title">Tide Commander</h2>
        {connectionFailing && (
          <div className="not-connected-failing" role="alert" aria-live="polite">
            Cannot reach server — retrying in the background.
          </div>
        )}
        <p className="not-connected-description">
          A visual multi-agent orchestrator for Claude Code and Codex.
          Deploy, control, and monitor your AI team from an RTS-inspired interface.
        </p>
        <p className="not-connected-privacy">
          Tide Commander syncs with Claude Code instances running on your local machine.
          No files or code are sent to this server.
        </p>
        <div className="not-connected-setup">
          <p className="not-connected-setup-label">Get started:</p>
          <div className="not-connected-code" onClick={handleCopy} title="Click to copy">
            <span>bunx tide-commander</span>
            <span className="not-connected-copy-icon"><Icon name={copied ? 'check' : 'copy'} size={12} /></span>
          </div>
        </div>
        <div className="not-connected-url-section">
          <label className="not-connected-url-label" htmlFor="backend-url">Backend URL</label>
          <div className="not-connected-url-row">
            <input
              id="backend-url"
              type="text"
              className="not-connected-url-input"
              placeholder="http://localhost:6200"
              value={backendUrlDraft}
              disabled={isConnecting}
              onChange={(e) => {
                const nextUrl = e.target.value;
                setBackendUrlDraft(nextUrl);
                if (connectError) {
                  setConnectError(null);
                }
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <span className="config-hint">Leave empty for auto-detect</span>
        </div>
        <div className="not-connected-url-section">
          <label className="not-connected-url-label" htmlFor="auth-token">
            {t('config:connection.connectScreen.authTokenLabel')}
          </label>
          <div className="not-connected-url-row">
            <input
              id="auth-token"
              type={showAuthToken ? 'text' : 'password'}
              className="not-connected-url-input"
              placeholder={t('config:connection.connectScreen.authTokenPlaceholder')}
              value={authTokenDraft}
              disabled={isConnecting}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setAuthTokenDraft(e.target.value);
                if (connectError) {
                  setConnectError(null);
                }
              }}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              className="not-connected-token-toggle"
              onClick={() => setShowAuthToken((v) => !v)}
              title={showAuthToken ? t('config:connection.hideToken') : t('config:connection.showToken')}
              aria-label={showAuthToken ? t('config:connection.hideToken') : t('config:connection.showToken')}
              disabled={isConnecting}
            >
              <Icon name={showAuthToken ? 'eye-closed' : 'eye'} size={14} />
            </button>
          </div>
          <span className="config-hint">{t('config:connection.connectScreen.authTokenHint')}</span>
          {connectStatus && !connectError && (
            <div className="not-connected-status" aria-live="polite">{connectStatus}</div>
          )}
          {connectError && (
            <div className="not-connected-error" aria-live="assertive">{connectError}</div>
          )}
        </div>
        <div className="not-connected-actions">
          <button className="not-connected-btn not-connected-btn-retry" onClick={() => { void handleConnect(); }} disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : <><Icon name="refresh" size={12} /> Connect</>}
          </button>
          <button className="not-connected-btn not-connected-btn-explore" onClick={handleExplore}>
            Explore
          </button>
        </div>
      </div>
    </div>
  );
}
