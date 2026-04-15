import React, { useState, useCallback, useEffect, useRef } from 'react';
import { store, useIsConnected } from '../store';
import { reconnect } from '../websocket/connection';
import { getBackendUrl, setBackendUrl, subscribeBackendUrlChange } from '../utils/storage';
import { validateBackendUrlInput, checkBackendReachability } from '../utils/backendConnection';

const CONNECT_TIMEOUT_MS = 4000;

export function NotConnectedOverlay() {
  const isConnected = useIsConnected();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [gracePeriod, setGracePeriod] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [backendUrlDraft, setBackendUrlDraft] = useState(() => getBackendUrl());
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const wasConnectedRef = useRef(false);

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

  // Reconnection grace period: when connection drops after being connected,
  // show a small "Reconnecting..." toast for 10 seconds before showing the full overlay.
  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      setReconnecting(false);
      return;
    }
    // Connection just dropped and we were previously connected
    if (wasConnectedRef.current) {
      setGracePeriod(true);
      setReconnecting(true);
      const timer = setTimeout(() => {
        setGracePeriod(false);
        setReconnecting(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [isConnected]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return subscribeBackendUrlChange((nextUrl) => {
      setBackendUrlDraft(nextUrl);
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

    setBackendUrl(validation.normalizedUrl);
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
  }, [backendUrlDraft, isConnecting, waitForWsConnected]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isConnecting) {
      void handleConnect();
    }
  }, [handleConnect, isConnecting]);

  const handleExplore = useCallback(() => {
    setDismissed(true);
  }, []);

  if (isConnected || dismissed) return null;

  // During reconnection grace period, show a small non-blocking toast
  if (gracePeriod && reconnecting) {
    return (
      <div className="reconnecting-toast">
        <span className="reconnecting-spinner" />
        Reconnecting...
      </div>
    );
  }

  if (gracePeriod) return null;

  return (
    <div className="not-connected-overlay">
      <div className="not-connected-panel">
        <h2 className="not-connected-title">Tide Commander</h2>
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
            <span className="not-connected-copy-icon">{copied ? '✓' : '⧉'}</span>
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
          {connectStatus && !connectError && (
            <div className="not-connected-status" aria-live="polite">{connectStatus}</div>
          )}
          {connectError && (
            <div className="not-connected-error" aria-live="assertive">{connectError}</div>
          )}
        </div>
        <div className="not-connected-actions">
          <button className="not-connected-btn not-connected-btn-retry" onClick={() => { void handleConnect(); }} disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : '↻ Connect'}
          </button>
          <button className="not-connected-btn not-connected-btn-explore" onClick={handleExplore}>
            Explore
          </button>
        </div>
      </div>
    </div>
  );
}
