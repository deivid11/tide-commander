import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useIsConnected, useResyncInProgress, useConnectionFailing, useAuthRejected } from '../store';
import { reconnect } from '../websocket/connection';
import { hasPendingMessages } from '../websocket/send';
import {
  getBackendUrl,
  getBackendUrls,
  setBackendUrls,
  subscribeBackendUrlChange,
  getAuthToken,
  setStorageString,
  setStorageBoolean,
  getStorageBoolean,
  STORAGE_KEYS,
} from '../utils/storage';
import { validateBackendUrlInput, checkBackendReachability } from '../utils/backendConnection';
import { Icon } from './Icon';

const CONNECT_TIMEOUT_MS = 4000;
// How long a fresh drop stays in the quiet "Reconnecting…" state before the
// status bar escalates to the louder "Can't reach server" styling. The window is
// (re)started from scratch whenever the app returns to the foreground, so a
// reopen always gets the full grace — a blip never escalates.
const RECONNECT_GRACE_MS = 15000;

type BarTone = 'reconnecting' | 'offline' | 'auth';

interface ConnectionStatusBarProps {
  tone: BarTone;
  retrying: boolean;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onDismiss?: () => void;
}

/**
 * Slim, non-blocking connection banner. It sits at the top of the viewport and
 * never covers the app: reading a conversation or typing a prompt keeps working
 * through a connection blip, and outbound messages are queued and flushed on
 * reconnect (see websocket/send.ts), so the only thing the user needs is to
 * *know* the link is down — not to be interrupted by a modal.
 */
function ConnectionStatusBar({ tone, retrying, onRetry, onOpenSettings, onDismiss }: ConnectionStatusBarProps) {
  const queued = tone !== 'reconnecting' && hasPendingMessages();

  const label =
    tone === 'auth' ? 'Auth token rejected'
    : tone === 'offline' ? "Can't reach server"
    : 'Reconnecting…';

  const detail =
    tone === 'auth' ? 'Update the token to reconnect.'
    : tone === 'offline' ? (queued ? 'Retrying — your messages will send once back.' : 'Retrying in the background.')
    : null;

  return (
    <div className={`connection-bar connection-bar-${tone}`} role="status" aria-live="polite">
      <span className="connection-bar-icon">
        {tone === 'reconnecting' || retrying
          ? <span className="reconnecting-spinner" />
          : <Icon name={tone === 'auth' ? 'warn' : 'plug'} size={13} />}
      </span>
      <span className="connection-bar-text">
        <span className="connection-bar-label">{label}</span>
        {detail && <span className="connection-bar-detail">{detail}</span>}
      </span>
      <span className="connection-bar-actions">
        {onRetry && (
          <button
            type="button"
            className="connection-bar-btn"
            onClick={onRetry}
            disabled={retrying}
            title="Retry now"
          >
            <Icon name="refresh" size={11} /> {retrying ? 'Retrying' : 'Retry'}
          </button>
        )}
        {onOpenSettings && (
          <button
            type="button"
            className="connection-bar-btn"
            onClick={onOpenSettings}
            title="Connection settings"
          >
            <Icon name="gear" size={11} /> Settings
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="connection-bar-close"
            onClick={onDismiss}
            title="Hide until the connection changes"
            aria-label="Hide connection banner"
          >
            <Icon name="close" size={11} />
          </button>
        )}
      </span>
    </div>
  );
}

export function NotConnectedOverlay() {
  const { t } = useTranslation(['config']);
  const isConnected = useIsConnected();
  const resyncInProgress = useResyncInProgress();
  const connectionFailing = useConnectionFailing();
  const authRejected = useAuthRejected();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [gracePeriod, setGracePeriod] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  // True once this device has ever reached the server. From then on a drop is a
  // transient network problem, not a setup problem, so it gets the slim bar.
  const [hasConnectedBefore, setHasConnectedBefore] = useState(
    () => getStorageBoolean(STORAGE_KEYS.HAS_CONNECTED_BEFORE, false),
  );
  // The full setup panel, opened on demand from the bar's "Settings" action.
  const [panelOpen, setPanelOpen] = useState(false);
  // Banner hidden by the user for the current outage; resets on reconnect.
  const [barHidden, setBarHidden] = useState(false);
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

  // (Re)start the "Reconnecting…" grace window: the quiet state is shown for
  // RECONNECT_GRACE_MS before the bar escalates. Held in a ref so both the
  // drop-triggered and the foreground-triggered paths share one timer
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
  // connected, stay in the quiet state before escalating the bar.
  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      setReconnecting(false);
      setBarHidden(false);
      if (!hasConnectedBefore) {
        setHasConnectedBefore(true);
        setStorageBoolean(STORAGE_KEYS.HAS_CONNECTED_BEFORE, true);
      }
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
  }, [isConnected, startReconnectGrace, hasConnectedBefore]);

  // Returning to the foreground restarts the grace window from scratch. The
  // countdown started at drop time may have elapsed while the app was
  // backgrounded (mobile/PWA), which would otherwise show the escalated banner
  // the instant the user reopens Tide Commander. Restarting here gives the
  // fresh reconnect its full window measured from when the user is looking.
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

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false);
    setConnectError(null);
    setConnectStatus(null);
  }, []);

  // Retry straight from the bar: kick the socket and keep the spinner up while
  // the attempt is in flight, without opening anything.
  const [barRetrying, setBarRetrying] = useState(false);
  const handleBarRetry = useCallback(() => {
    if (barRetrying) return;
    setBarRetrying(true);
    startReconnectGrace();
    reconnect();
    void waitForWsConnected(7000).finally(() => {
      if (mountedRef.current) setBarRetrying(false);
    });
  }, [barRetrying, startReconnectGrace, waitForWsConnected]);

  // Escape closes the on-demand panel (never the first-run one, which has
  // nothing behind it to go back to).
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClosePanel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen, handleClosePanel]);

  // Let other fixed top banners (e.g. the update banner) stack below the
  // connection bar instead of overlapping it.
  const barVisible =
    (!isConnected && !panelOpen && !barHidden && (hasConnectedBefore || dismissed || reconnecting))
    || (isConnected && resyncInProgress && !dismissed);
  useEffect(() => {
    document.body.classList.toggle('has-connection-bar', barVisible);
    return () => document.body.classList.remove('has-connection-bar');
  }, [barVisible]);

  // Connected: only the resync hint (no actions — the link is up).
  if (isConnected) {
    if (resyncInProgress && !dismissed) {
      return <ConnectionStatusBar tone="reconnecting" retrying={false} />;
    }
    return null;
  }

  // Someone who has reached the server before (or who chose to explore) never
  // gets the blocking overlay again — a drop shows the slim bar, and the setup
  // panel is one click away behind "Settings".
  if (!panelOpen && (hasConnectedBefore || dismissed)) {
    if (barHidden) return null;
    const tone: BarTone = authRejected ? 'auth' : (reconnecting && !connectionFailing) ? 'reconnecting' : 'offline';
    return (
      <ConnectionStatusBar
        tone={tone}
        retrying={barRetrying}
        onRetry={tone === 'auth' ? undefined : handleBarRetry}
        onOpenSettings={() => setPanelOpen(true)}
        onDismiss={() => setBarHidden(true)}
      />
    );
  }

  // First run, connection dropped before it ever succeeded: stay quiet during
  // the grace window, then show the bar-shaped "Reconnecting…" hint.
  if (!panelOpen && reconnecting) {
    return <ConnectionStatusBar tone="reconnecting" retrying={false} />;
  }

  if (!panelOpen && gracePeriod && !connectionFailing) return null;

  return (
    <div
      className="not-connected-overlay"
      onClick={panelOpen ? (e) => { if (e.target === e.currentTarget) handleClosePanel(); } : undefined}
    >
      <div className="not-connected-panel">
        {panelOpen && (
          <button
            type="button"
            className="not-connected-close"
            onClick={handleClosePanel}
            title="Close"
            aria-label="Close connection settings"
          >
            <Icon name="close" size={14} />
          </button>
        )}
        <h2 className="not-connected-title">Tide Commander</h2>
        {authRejected ? (
          <div className="not-connected-failing" role="alert" aria-live="polite">
            The server rejected the auth token. Enter the correct token below and connect.
          </div>
        ) : connectionFailing && (
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
          <button className="not-connected-btn not-connected-btn-explore" onClick={panelOpen ? handleClosePanel : handleExplore}>
            {panelOpen ? 'Back to app' : 'Explore'}
          </button>
        </div>
      </div>
    </div>
  );
}
