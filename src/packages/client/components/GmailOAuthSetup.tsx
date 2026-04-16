/**
 * Gmail Auth Setup Component
 *
 * Custom settings component for the Gmail integration.
 * Supports two authentication methods:
 *  - OAuth2: Browser-based consent flow with Client ID/Secret
 *  - Service Account: Domain-wide delegation with service account JSON
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
  lastChecked?: number;
  error?: string;
}

type AuthMethod = 'oauth2' | 'service_account';

export function GmailOAuthSetup({ integration, onSave, onCancel }: GmailOAuthSetupProps) {
  const [authMethod, setAuthMethod] = useState<AuthMethod>(
    (integration.values.authMethod as AuthMethod) || 'oauth2'
  );

  // OAuth2 fields
  const [clientId, setClientId] = useState(
    (integration.values.clientId as string) || ''
  );
  const [clientSecret, setClientSecret] = useState('');

  // Service Account fields
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [impersonateEmail, setImpersonateEmail] = useState(
    (integration.values.impersonateEmail as string) || ''
  );

  // Shared fields
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
  const [togglingPolling, setTogglingPolling] = useState(false);
  const [showManualEdit, setShowManualEdit] = useState(false);
  const [step, setStep] = useState<'credentials' | 'authorize' | 'connected'>(
    integration.status.connected ? 'connected' : 'credentials'
  );

  // Detect credentials already saved in the shared secrets store (e.g. from Calendar/Drive).
  // Backend returns '********' when the shared OAuth secret is present.
  const hasSharedCredentials =
    authMethod === 'oauth2' &&
    integration.values.clientId === '********' &&
    integration.values.clientSecret === '********';

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasConnectedRef = useRef(integration.status.connected);

  // Fetch current Gmail auth status
  const fetchStatus = useCallback(async () => {
    try {
      const resp = await authFetch(apiUrl('/api/email/status'));
      if (resp.ok) {
        const data = (await resp.json()) as GmailAuthStatus;
        setAuthStatus(data);
        if (data.authenticated) {
          setStep('connected');
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch Gmail status:', err);
    }
  }, []);

  // Update step only when connection status actually changes
  useEffect(() => {
    const isNowConnected = integration.status.connected;
    const wasConnected = wasConnectedRef.current;

    if (isNowConnected && !wasConnected && step !== 'connected') {
      setStep('connected');
    } else if (!isNowConnected && wasConnected && step === 'connected') {
      setStep('credentials');
    }

    wasConnectedRef.current = isNowConnected;
  }, [integration.status.connected]);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [fetchStatus]);

  // Fetch OAuth consent URL and start polling for auth completion.
  const fetchAuthUrlAndStart = async () => {
    const resp = await authFetch(apiUrl('/api/email/auth/url'));
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as { url: string };
    if (!data.url) {
      throw new Error('OAuth URL is empty');
    }
    setAuthUrl(data.url);
    setError(null);
    setStep('authorize');

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    pollTimerRef.current = setInterval(fetchStatus, 3000);
  };

  // One-click authorize using OAuth credentials already saved in the shared secrets store.
  const handleUseSharedCredentials = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchAuthUrlAndStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get OAuth URL');
    } finally {
      setLoading(false);
    }
  };

  // Save OAuth2 credentials and get OAuth URL
  const handleSaveOAuth = async () => {
    if (!clientId.trim()) {
      setError('Client ID is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const config: Record<string, unknown> = {
        authMethod: 'oauth2',
        pollingIntervalMs: parseInt(pollingInterval) || 30000,
        defaultApprovalKeywords: approvalKeywords,
      };
      // Only send Client ID if it was actually changed (not the '********' placeholder)
      if (clientId.trim() && clientId.trim() !== '********') {
        config.clientId = clientId.trim();
      }
      if (clientSecret.trim() && clientSecret.trim() !== '********') {
        config.clientSecret = clientSecret.trim();
      }
      await onSave(config);

      await fetchAuthUrlAndStart();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get OAuth URL';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Save Service Account credentials
  const handleSaveServiceAccount = async () => {
    if (!serviceAccountJson.trim()) {
      setError('Service Account JSON is required');
      return;
    }
    if (!impersonateEmail.trim()) {
      setError('Impersonate Email is required');
      return;
    }

    // Validate JSON
    try {
      const parsed = JSON.parse(serviceAccountJson.trim());
      if (!parsed.client_email || !parsed.private_key) {
        setError('Service Account JSON must contain client_email and private_key');
        return;
      }
    } catch {
      setError('Invalid JSON in Service Account field');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onSave({
        authMethod: 'service_account',
        serviceAccountJson: serviceAccountJson.trim(),
        impersonateEmail: impersonateEmail.trim(),
        pollingIntervalMs: parseInt(pollingInterval) || 30000,
        defaultApprovalKeywords: approvalKeywords,
      });

      // Check status after save (reinit happens server-side)
      await new Promise(resolve => setTimeout(resolve, 1000));
      await fetchStatus();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save service account';
      setError(errorMsg);
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

  // Toggle automatic polling on/off
  const handleTogglePolling = async () => {
    const shouldEnable = !authStatus?.pollingActive;
    setTogglingPolling(true);
    setError(null);
    try {
      const endpoint = shouldEnable ? '/api/email/polling/start' : '/api/email/polling/stop';
      const body = shouldEnable ? { intervalMs: parseInt(pollingInterval) || 30000 } : {};
      const resp = await authFetch(apiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `HTTP ${resp.status}`);
      }
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle polling');
    } finally {
      setTogglingPolling(false);
    }
  };

  // Disconnect / revoke
  const handleDisconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await onSave({ refreshToken: '', serviceAccountJson: '', impersonateEmail: '' });
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

  const hasServiceAccountSaved = Boolean(integration.values.serviceAccountJson);

  return (
    <div className="gmail-oauth-setup">
      {error && (
        <div className="gmail-oauth-error">{error}</div>
      )}

      {/* Step 1: Choose auth method & enter credentials */}
      {step === 'credentials' && (
        <div className="gmail-oauth-section">
          {/* Auth Method Selector */}
          <div className="gmail-oauth-field" style={{ marginBottom: 24 }}>
            <label className="integration-field-label">Authentication Method</label>
            <div className="gmail-auth-method-selector">
              <button
                type="button"
                className={`gmail-auth-method-btn ${authMethod === 'oauth2' ? 'active' : ''}`}
                onClick={() => { setAuthMethod('oauth2'); setError(null); }}
              >
                <span className="gmail-auth-method-icon">🔑</span>
                <span className="gmail-auth-method-label">OAuth 2.0</span>
                <span className="gmail-auth-method-desc">Browser login flow</span>
              </button>
              <button
                type="button"
                className={`gmail-auth-method-btn ${authMethod === 'service_account' ? 'active' : ''}`}
                onClick={() => { setAuthMethod('service_account'); setError(null); }}
              >
                <span className="gmail-auth-method-icon">🤖</span>
                <span className="gmail-auth-method-label">Service Account</span>
                <span className="gmail-auth-method-desc">Domain-wide delegation</span>
              </button>
            </div>
          </div>

          {/* OAuth2 — shared-credentials shortcut */}
          {authMethod === 'oauth2' && hasSharedCredentials && !showManualEdit && (
            <>
              <h4 className="gmail-oauth-section-title">Google OAuth Credentials</h4>
              <div className="gmail-oauth-shared-banner">
                <div className="gmail-oauth-shared-title">
                  <span>{'\u2713'}</span>
                  <span>Credentials already configured</span>
                </div>
                <div className="gmail-oauth-shared-body">
                  Existing Google OAuth credentials (Client ID and Secret) are saved in your secrets store —
                  they&apos;re shared between Gmail, Calendar, and Drive. You may still need to re-authorize
                  once so the refresh token grants Gmail access.
                </div>
              </div>
            </>
          )}

          {/* OAuth2 — manual credentials form */}
          {authMethod === 'oauth2' && (!hasSharedCredentials || showManualEdit) && (
            <>
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
            </>
          )}

          {/* Service Account Fields */}
          {authMethod === 'service_account' && (
            <>
              <h4 className="gmail-oauth-section-title">Service Account Credentials</h4>
              <p className="gmail-oauth-help">
                Use a Google service account with{' '}
                <a
                  href="https://admin.google.com/ac/owl/domainwidedelegation"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gmail-oauth-link"
                >
                  domain-wide delegation
                </a>
                {' '}enabled. The service account must be authorized for Gmail scopes in Google Workspace Admin.
              </p>

              <div className="gmail-oauth-field">
                <label className="integration-field-label">
                  Service Account JSON <span className="integration-field-required">*</span>
                </label>
                <textarea
                  className="integration-field-input integration-field-textarea"
                  value={serviceAccountJson}
                  placeholder={hasServiceAccountSaved ? '(saved — paste new JSON to replace)' : 'Paste the full service account JSON key file contents'}
                  onChange={(e) => setServiceAccountJson(e.target.value)}
                  rows={6}
                  spellCheck={false}
                />
                <span className="integration-field-description">
                  The JSON key file downloaded from Google Cloud Console containing client_email and private_key.
                </span>
              </div>

              <div className="gmail-oauth-field">
                <label className="integration-field-label">
                  Impersonate Email <span className="integration-field-required">*</span>
                </label>
                <input
                  type="email"
                  className="integration-field-input"
                  value={impersonateEmail}
                  placeholder="user@yourdomain.com"
                  onChange={(e) => setImpersonateEmail(e.target.value)}
                />
                <span className="integration-field-description">
                  The email address to impersonate via domain-wide delegation. Must be a user in your Google Workspace domain.
                </span>
              </div>
            </>
          )}

          {/* Shared fields */}
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
            {authMethod === 'oauth2' && hasSharedCredentials && !showManualEdit ? (
              <>
                <button
                  type="button"
                  className="integration-btn secondary"
                  onClick={() => setShowManualEdit(true)}
                  disabled={loading}
                >
                  Edit credentials
                </button>
                <button
                  type="button"
                  className="integration-btn save"
                  onClick={handleUseSharedCredentials}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Authorize with existing credentials'}
                </button>
              </>
            ) : authMethod === 'oauth2' ? (
              <button
                type="button"
                className="integration-btn save"
                onClick={handleSaveOAuth}
                disabled={loading || !clientId.trim()}
              >
                {loading ? 'Saving...' : 'Save & Authorize'}
              </button>
            ) : (
              <button
                type="button"
                className="integration-btn save"
                onClick={handleSaveServiceAccount}
                disabled={loading || !impersonateEmail.trim() || (!serviceAccountJson.trim() && !hasServiceAccountSaved)}
              >
                {loading ? 'Connecting...' : 'Save & Connect'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 2: OAuth Authorization (OAuth2 only) */}
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
            <span className="gmail-oauth-auth-type">
              {authMethod === 'service_account' ? 'Service Account' : 'OAuth 2.0'}
            </span>
          </div>

          <div className="gmail-polling-toggle-row">
            <div className="gmail-polling-toggle-info">
              <div className="gmail-polling-toggle-label">Automatic Polling</div>
              <div className="gmail-polling-toggle-status">
                {authStatus?.pollingActive ? (
                  <>
                    <span className="gmail-polling-dot active" />
                    Active
                    {authStatus.lastChecked && (
                      <span className="gmail-polling-last">
                        — last checked {new Date(authStatus.lastChecked).toLocaleTimeString()}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="gmail-polling-dot paused" />
                    Paused — new emails will not be ingested
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!authStatus?.pollingActive}
              aria-label="Toggle automatic polling"
              className={`gmail-polling-switch ${authStatus?.pollingActive ? 'on' : 'off'}`}
              onClick={handleTogglePolling}
              disabled={togglingPolling}
            >
              <span className="gmail-polling-switch-thumb" />
            </button>
          </div>

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
          padding: 0;
        }
        .gmail-oauth-error {
          background: linear-gradient(135deg, rgba(243, 139, 168, 0.2) 0%, rgba(243, 139, 168, 0.08) 100%);
          border-left: 3px solid #f38ba8;
          color: #f38ba8;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 18px;
          font-size: 13px;
          font-weight: 500;
        }
        .gmail-oauth-section {
          background: linear-gradient(180deg, rgba(45, 49, 69, 0.4) 0%, rgba(30, 30, 46, 0.2) 100%);
          border: 1px solid rgba(137, 180, 250, 0.15);
          border-radius: 12px;
          padding: 28px;
          backdrop-filter: blur(10px);
        }
        .gmail-oauth-section-title {
          margin: 0 0 16px 0;
          color: #cdd6f4;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .gmail-oauth-help {
          color: #a6adc8;
          font-size: 13px;
          line-height: 1.6;
          margin: 0 0 20px 0;
          font-weight: 400;
        }
        .gmail-oauth-link {
          color: #89b4fa;
          text-decoration: none;
          border-bottom: 1.5px solid rgba(137, 180, 250, 0.4);
          transition: all 0.2s ease;
          font-weight: 500;
        }
        .gmail-oauth-link:hover {
          color: #a8c5ff;
          border-bottom-color: #89b4fa;
        }
        .gmail-oauth-code {
          background: rgba(137, 180, 250, 0.15);
          color: #89b4fa;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          word-break: break-all;
          font-weight: 500;
          font-family: 'Monaco', 'Menlo', monospace;
        }
        .gmail-oauth-field {
          margin-bottom: 18px;
        }
        .gmail-auth-method-selector {
          display: flex;
          gap: 12px;
        }
        .gmail-auth-method-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 16px 12px;
          background: rgba(30, 30, 46, 0.6);
          border: 2px solid rgba(137, 180, 250, 0.15);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .gmail-auth-method-btn:hover {
          border-color: rgba(137, 180, 250, 0.35);
          background: rgba(30, 30, 46, 0.8);
        }
        .gmail-auth-method-btn.active {
          border-color: #89b4fa;
          background: rgba(137, 180, 250, 0.1);
          box-shadow: 0 0 0 3px rgba(137, 180, 250, 0.1);
        }
        .gmail-auth-method-icon {
          font-size: 22px;
        }
        .gmail-auth-method-label {
          color: #cdd6f4;
          font-size: 14px;
          font-weight: 600;
        }
        .gmail-auth-method-desc {
          color: #7f849c;
          font-size: 11px;
          font-weight: 400;
        }
        .gmail-oauth-auth-type {
          color: #7f849c;
          font-size: 12px;
          font-weight: 500;
          margin-left: auto;
          background: rgba(137, 180, 250, 0.1);
          padding: 4px 10px;
          border-radius: 6px;
        }
        .integration-field-label {
          display: block;
          margin-bottom: 8px;
          color: #cdd6f4;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .integration-field-required {
          color: #f38ba8;
        }
        .integration-field-input {
          width: 100%;
          background: rgba(30, 30, 46, 0.6);
          border: 1.5px solid rgba(137, 180, 250, 0.2);
          color: #cdd6f4;
          padding: 11px 14px;
          border-radius: 8px;
          font-size: 13px;
          transition: all 0.2s ease;
          font-weight: 500;
        }
        .integration-field-input:focus {
          outline: none;
          border-color: #89b4fa;
          background: rgba(30, 30, 46, 0.8);
          box-shadow: 0 0 0 3px rgba(137, 180, 250, 0.15);
        }
        .integration-field-input::placeholder {
          color: #6c7086;
        }
        .integration-field-textarea {
          resize: vertical;
          min-height: 80px;
          font-family: 'Monaco', 'Menlo', monospace;
          font-size: 12px;
        }
        .integration-field-description {
          display: block;
          margin-top: 7px;
          color: #7f849c;
          font-size: 12px;
          font-weight: 400;
        }
        .gmail-oauth-authorize-btn {
          display: inline-block;
          background: linear-gradient(135deg, #89b4fa 0%, #7aa3f0 100%);
          color: #1e1e2e;
          padding: 12px 32px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 700;
          font-size: 14px;
          margin-bottom: 20px;
          transition: all 0.25s ease;
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(137, 180, 250, 0.25);
          letter-spacing: 0.3px;
        }
        .gmail-oauth-authorize-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(137, 180, 250, 0.35);
          background: linear-gradient(135deg, #a8c5ff 0%, #8eb8ff 100%);
        }
        .gmail-oauth-authorize-btn:active {
          transform: translateY(0);
        }
        .gmail-oauth-waiting {
          display: flex;
          align-items: center;
          gap: 12px;
          color: #a6adc8;
          font-size: 13px;
          margin-bottom: 20px;
          background: rgba(137, 180, 250, 0.08);
          padding: 14px 16px;
          border-radius: 8px;
          border-left: 3px solid #89b4fa;
          font-weight: 500;
        }
        .gmail-oauth-spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2.5px solid rgba(137, 180, 250, 0.25);
          border-top-color: #89b4fa;
          border-radius: 50%;
          animation: gmail-spin 0.8s linear infinite;
          flex-shrink: 0;
        }
        @keyframes gmail-spin {
          to { transform: rotate(360deg); }
        }
        .gmail-oauth-connected-info {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 20px;
          background: rgba(166, 227, 161, 0.08);
          padding: 16px;
          border-radius: 10px;
          border-left: 3px solid #a6e3a1;
        }
        .gmail-oauth-connected-badge {
          background: linear-gradient(135deg, rgba(166, 227, 161, 0.3) 0%, rgba(166, 227, 161, 0.15) 100%);
          color: #a6e3a1;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          border: 1px solid rgba(166, 227, 161, 0.3);
          flex-shrink: 0;
        }
        .gmail-oauth-email {
          color: #cdd6f4;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.2px;
        }
        .gmail-polling-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin: 0 0 20px 0;
          padding: 14px 16px;
          background: rgba(30, 30, 46, 0.6);
          border: 1px solid rgba(137, 180, 250, 0.15);
          border-radius: 10px;
        }
        .gmail-polling-toggle-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .gmail-polling-toggle-label {
          color: #cdd6f4;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.2px;
        }
        .gmail-polling-toggle-status {
          color: #a6adc8;
          font-size: 12px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .gmail-polling-last {
          color: #7f849c;
          font-weight: 400;
        }
        .gmail-polling-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .gmail-polling-dot.active {
          background: #a6e3a1;
          box-shadow: 0 0 6px rgba(166, 227, 161, 0.6);
        }
        .gmail-polling-dot.paused {
          background: #fab387;
        }
        .gmail-polling-switch {
          position: relative;
          width: 44px;
          height: 24px;
          border-radius: 12px;
          border: none;
          cursor: pointer;
          transition: background 0.2s ease;
          flex-shrink: 0;
          padding: 0;
        }
        .gmail-polling-switch.on {
          background: linear-gradient(135deg, #a6e3a1 0%, #94d38f 100%);
        }
        .gmail-polling-switch.off {
          background: rgba(108, 112, 134, 0.5);
        }
        .gmail-polling-switch:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .gmail-polling-switch-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: #ffffff;
          border-radius: 50%;
          transition: transform 0.2s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }
        .gmail-polling-switch.on .gmail-polling-switch-thumb {
          transform: translateX(20px);
        }
        .integration-form-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid rgba(137, 180, 250, 0.1);
        }
        .integration-btn {
          padding: 10px 24px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 13px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          letter-spacing: 0.3px;
        }
        .integration-btn.save {
          background: linear-gradient(135deg, #89b4fa 0%, #7aa3f0 100%);
          color: #1e1e2e;
          box-shadow: 0 4px 12px rgba(137, 180, 250, 0.25);
        }
        .integration-btn.save:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(137, 180, 250, 0.35);
        }
        .integration-btn.cancel {
          background: rgba(137, 180, 250, 0.1);
          color: #89b4fa;
          border: 1.5px solid rgba(137, 180, 250, 0.2);
        }
        .integration-btn.cancel:hover:not(:disabled) {
          background: rgba(137, 180, 250, 0.15);
          border-color: #89b4fa;
        }
        .integration-btn.secondary {
          background: rgba(249, 226, 175, 0.1);
          color: #f9e2af;
          border: 1.5px solid rgba(249, 226, 175, 0.25);
        }
        .integration-btn.secondary:hover:not(:disabled) {
          background: rgba(249, 226, 175, 0.18);
          border-color: #f9e2af;
        }
        .integration-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .gmail-oauth-shared-banner {
          background: linear-gradient(135deg, rgba(166, 227, 161, 0.15) 0%, rgba(166, 227, 161, 0.05) 100%);
          border: 1px solid rgba(166, 227, 161, 0.3);
          border-left: 3px solid #a6e3a1;
          border-radius: 10px;
          padding: 16px 18px;
          margin-bottom: 8px;
        }
        .gmail-oauth-shared-title {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #a6e3a1;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.2px;
          margin-bottom: 8px;
        }
        .gmail-oauth-shared-body {
          color: #a6adc8;
          font-size: 13px;
          line-height: 1.6;
          font-weight: 400;
        }
      `}</style>
    </div>
  );
}
