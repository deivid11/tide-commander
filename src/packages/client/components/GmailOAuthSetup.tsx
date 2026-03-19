/**
 * Gmail OAuth Setup Component
 *
 * Custom settings component for the Gmail integration.
 * Handles the OAuth2 consent flow:
 *  1. User enters OAuth Client ID and Client Secret (or they're pre-filled from config)
 *  2. Component fetches the consent URL from the server
 *  3. User clicks the link to authorize in Google
 *  4. OAuth callback saves the refresh token on the server
 *  5. Component polls for status until authentication is confirmed
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { IntegrationInfo } from '../../shared/integration-types.js';
import { apiUrl, authFetch } from '../utils/storage';

interface GmailOAuthSetupProps {
  integration: IntegrationInfo;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

interface GmailAuthStatus {
  configured: boolean;
  authenticated: boolean;
  emailAddress?: string;
  pollingActive?: boolean;
  lastPollAt?: number;
  lastError?: string;
}

export function GmailOAuthSetup({ integration, onSave, onCancel }: GmailOAuthSetupProps) {
  const [clientId, setClientId] = useState(
    (integration.values.clientId as string) || ''
  );
  const [clientSecret, setClientSecret] = useState('');
  const [pollingInterval, setPollingInterval] = useState(
    String(integration.values.pollingIntervalMs ?? 30000)
  );
  const [approvalKeywords, setApprovalKeywords] = useState(
    (integration.values.defaultApprovalKeywords as string) || 'approved,aprobado,autorizado,yes,ok'
  );

  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<GmailAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'credentials' | 'authorize' | 'connected'>(
    integration.status.connected ? 'connected' : 'credentials'
  );

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch current Gmail auth status
  const fetchStatus = useCallback(async () => {
    try {
      const resp = await authFetch(apiUrl('/api/integrations/gmail/status'));
      if (resp.ok) {
        const data = (await resp.json()) as GmailAuthStatus;
        setAuthStatus(data);
        if (data.authenticated) {
          setStep('connected');
          // Stop polling once connected
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      }
    } catch {
      // Status check is best-effort
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [fetchStatus]);

  // Save credentials and get OAuth URL
  const handleSaveCredentials = async () => {
    if (!clientId.trim()) {
      setError('Client ID is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Save credentials first
      const config: Record<string, unknown> = {
        clientId: clientId.trim(),
        pollingIntervalMs: parseInt(pollingInterval) || 30000,
        defaultApprovalKeywords: approvalKeywords,
      };
      if (clientSecret.trim()) {
        config.clientSecret = clientSecret.trim();
      }
      await onSave(config);

      // Fetch the OAuth consent URL
      const resp = await authFetch(apiUrl('/api/email/auth/url'));
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { url: string };
      setAuthUrl(data.url);
      setStep('authorize');

      // Start polling for auth completion
      pollTimerRef.current = setInterval(fetchStatus, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get OAuth URL');
    } finally {
      setLoading(false);
    }
  };

  // Save non-credential settings
  const handleSaveSettings = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        pollingIntervalMs: parseInt(pollingInterval) || 30000,
        defaultApprovalKeywords: approvalKeywords,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Disconnect / revoke
  const handleDisconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await onSave({ refreshToken: '' });
      setAuthStatus(null);
      setAuthUrl(null);
      setStep('credentials');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="gmail-oauth-setup">
      {error && (
        <div className="gmail-oauth-error">{error}</div>
      )}

      {/* Step 1: Enter OAuth Credentials */}
      {step === 'credentials' && (
        <div className="gmail-oauth-section">
          <h4 className="gmail-oauth-section-title">Google OAuth Credentials</h4>
          <p className="gmail-oauth-help">
            Create OAuth2 credentials in the{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="gmail-oauth-link"
            >
              Google Cloud Console
            </a>
            . Enable the Gmail API and (optionally) the Calendar API. Set the redirect URI to:{' '}
            <code className="gmail-oauth-code">
              {apiUrl('/api/email/auth/callback')}
            </code>
          </p>

          <div className="gmail-oauth-field">
            <label className="integration-field-label">
              OAuth Client ID <span className="integration-field-required">*</span>
            </label>
            <input
              type="text"
              className="integration-field-input"
              value={clientId}
              placeholder="xxxx.apps.googleusercontent.com"
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>

          <div className="gmail-oauth-field">
            <label className="integration-field-label">
              OAuth Client Secret <span className="integration-field-required">*</span>
            </label>
            <input
              type="password"
              className="integration-field-input"
              value={clientSecret}
              placeholder={integration.values.clientSecret ? '(saved)' : 'Enter client secret'}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="gmail-oauth-field">
            <label className="integration-field-label">Polling Interval (ms)</label>
            <input
              type="number"
              className="integration-field-input"
              value={pollingInterval}
              onChange={(e) => setPollingInterval(e.target.value)}
            />
            <span className="integration-field-description">
              How often to check for new emails. Default: 30000 (30s).
            </span>
          </div>

          <div className="gmail-oauth-field">
            <label className="integration-field-label">Approval Keywords</label>
            <textarea
              className="integration-field-input integration-field-textarea"
              value={approvalKeywords}
              onChange={(e) => setApprovalKeywords(e.target.value)}
              rows={2}
            />
            <span className="integration-field-description">
              Comma-separated keywords that indicate email approval.
            </span>
          </div>

          <div className="integration-form-actions">
            <button type="button" className="integration-btn cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="integration-btn save"
              onClick={handleSaveCredentials}
              disabled={loading || !clientId.trim()}
            >
              {loading ? 'Saving...' : 'Save & Authorize'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: OAuth Authorization */}
      {step === 'authorize' && (
        <div className="gmail-oauth-section">
          <h4 className="gmail-oauth-section-title">Authorize Gmail Access</h4>
          <p className="gmail-oauth-help">
            Click the link below to authorize Tide Commander to access your Gmail account.
            After granting access, you will be redirected back and the connection will be established automatically.
          </p>

          {authUrl && (
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="gmail-oauth-authorize-btn"
            >
              Authorize with Google
            </a>
          )}

          <div className="gmail-oauth-waiting">
            <span className="gmail-oauth-spinner" />
            <span>Waiting for authorization to complete...</span>
          </div>

          <div className="integration-form-actions">
            <button
              type="button"
              className="integration-btn cancel"
              onClick={() => {
                if (pollTimerRef.current) {
                  clearInterval(pollTimerRef.current);
                  pollTimerRef.current = null;
                }
                setStep('credentials');
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Connected */}
      {step === 'connected' && (
        <div className="gmail-oauth-section">
          <h4 className="gmail-oauth-section-title">Gmail Connected</h4>

          <div className="gmail-oauth-connected-info">
            <span className="gmail-oauth-connected-badge">Connected</span>
            {authStatus?.emailAddress && (
              <span className="gmail-oauth-email">{authStatus.emailAddress}</span>
            )}
          </div>

          {authStatus?.pollingActive && (
            <p className="gmail-oauth-help">
              Email polling is active.
              {authStatus.lastPollAt && (
                <> Last checked: {new Date(authStatus.lastPollAt).toLocaleTimeString()}</>
              )}
            </p>
          )}

          <div className="gmail-oauth-field">
            <label className="integration-field-label">Polling Interval (ms)</label>
            <input
              type="number"
              className="integration-field-input"
              value={pollingInterval}
              onChange={(e) => setPollingInterval(e.target.value)}
            />
          </div>

          <div className="gmail-oauth-field">
            <label className="integration-field-label">Approval Keywords</label>
            <textarea
              className="integration-field-input integration-field-textarea"
              value={approvalKeywords}
              onChange={(e) => setApprovalKeywords(e.target.value)}
              rows={2}
            />
          </div>

          <div className="integration-form-actions">
            <button type="button" className="integration-btn cancel" onClick={onCancel}>
              Close
            </button>
            <button
              type="button"
              className="integration-btn"
              style={{ backgroundColor: '#f38ba8', color: '#1e1e2e' }}
              onClick={handleDisconnect}
              disabled={loading}
            >
              {loading ? 'Disconnecting...' : 'Disconnect'}
            </button>
            <button
              type="button"
              className="integration-btn save"
              onClick={handleSaveSettings}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .gmail-oauth-setup {
          padding: 4px 0;
        }
        .gmail-oauth-error {
          background: rgba(243, 139, 168, 0.15);
          color: #f38ba8;
          padding: 8px 12px;
          border-radius: 6px;
          margin-bottom: 12px;
          font-size: 13px;
        }
        .gmail-oauth-section-title {
          margin: 0 0 8px 0;
          color: #cdd6f4;
          font-size: 14px;
          font-weight: 600;
        }
        .gmail-oauth-help {
          color: #a6adc8;
          font-size: 12px;
          line-height: 1.5;
          margin: 0 0 12px 0;
        }
        .gmail-oauth-link {
          color: #89b4fa;
          text-decoration: underline;
        }
        .gmail-oauth-code {
          background: rgba(137, 180, 250, 0.1);
          color: #89b4fa;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          word-break: break-all;
        }
        .gmail-oauth-field {
          margin-bottom: 12px;
        }
        .gmail-oauth-authorize-btn {
          display: inline-block;
          background: #89b4fa;
          color: #1e1e2e;
          padding: 10px 20px;
          border-radius: 6px;
          text-decoration: none;
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 16px;
          transition: opacity 0.15s;
        }
        .gmail-oauth-authorize-btn:hover {
          opacity: 0.9;
        }
        .gmail-oauth-waiting {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #a6adc8;
          font-size: 12px;
          margin-bottom: 16px;
        }
        .gmail-oauth-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(137, 180, 250, 0.3);
          border-top-color: #89b4fa;
          border-radius: 50%;
          animation: gmail-spin 0.8s linear infinite;
        }
        @keyframes gmail-spin {
          to { transform: rotate(360deg); }
        }
        .gmail-oauth-connected-info {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .gmail-oauth-connected-badge {
          background: rgba(166, 227, 161, 0.2);
          color: #a6e3a1;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }
        .gmail-oauth-email {
          color: #cdd6f4;
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}
