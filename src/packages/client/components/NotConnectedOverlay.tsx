import React, { useState, useCallback, useEffect } from 'react';
import { useIsConnected } from '../store/selectors';
import { reconnect } from '../websocket/connection';
import { STORAGE_KEYS, getStorageString, setStorageString } from '../utils/storage';

export function NotConnectedOverlay() {
  const isConnected = useIsConnected();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [gracePeriod, setGracePeriod] = useState(true);
  const [backendUrl, setBackendUrl] = useState(() => getStorageString(STORAGE_KEYS.BACKEND_URL, ''));

  useEffect(() => {
    const timer = setTimeout(() => setGracePeriod(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText('bunx tide-commander').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, []);

  const handleConnect = useCallback(() => {
    setStorageString(STORAGE_KEYS.BACKEND_URL, backendUrl);
    reconnect();
  }, [backendUrl]);

  const handleExplore = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setStorageString(STORAGE_KEYS.BACKEND_URL, backendUrl);
      reconnect();
    }
  }, [backendUrl]);

  if (isConnected || dismissed || gracePeriod) return null;

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
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className="not-connected-actions">
          <button className="not-connected-btn not-connected-btn-retry" onClick={handleConnect}>
            ↻ Connect
          </button>
          <button className="not-connected-btn not-connected-btn-explore" onClick={handleExplore}>
            Explore
          </button>
        </div>
      </div>
    </div>
  );
}
