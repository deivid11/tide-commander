/**
 * Google OAuth Setup Component
 * Shared OAuth component for Gmail and Google Calendar integrations.
 * Handles the OAuth2 consent flow for Google services.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { IntegrationInfo } from '../../shared/integration-types.js';
import { apiUrl, authFetch } from '../utils/storage';

interface GoogleOAuthSetupProps {
  integration: IntegrationInfo;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

interface GoogleAuthStatus {
  configured: boolean;
  authenticated: boolean;
  emailAddress?: string;
}

export function GoogleOAuthSetup({ integration, onSave, onCancel }: GoogleOAuthSetupProps) {
  const [clientId, setClientId] = useState(
    (integration.values.GOOGLE_CLIENT_ID as string) || ''
  );
  const [clientSecret, setClientSecret] = useState('');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManualEdit, setShowManualEdit] = useState(false);

  // Detect credentials already saved in the shared secrets store (e.g. from Gmail/Calendar)
  const hasSharedCredentials =
    integration.values.GOOGLE_CLIENT_ID === '********' &&
    integration.values.GOOGLE_CLIENT_SECRET === '********';

  const [step, setStep] = useState<'credentials' | 'authorize' | 'connected'>(
    integration.status.connected ? 'connected' : 'credentials'
  );

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch current Google auth status
  const fetchStatus = useCallback(async () => {
    try {
      const statusEndpoints: Record<string, string> = {
        'gmail': '/api/email/status',
        'google-calendar': '/api/calendar/status',
        'google-drive': '/api/drive/status',
      };
      const endpoint = statusEndpoints[integration.id] || '/api/calendar/status';
      const resp = await authFetch(apiUrl(endpoint));
      if (resp.ok) {
        const data = (await resp.json()) as GoogleAuthStatus;
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
      console.error('Failed to fetch Google auth status:', err);
    }
  }, [integration.id]);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [fetchStatus]);

  const fetchAuthUrlAndStart = async () => {
    const authUrlEndpoints: Record<string, string> = {
      'gmail': '/api/email/auth/url',
      'google-calendar': '/api/calendar/auth/url',
      'google-drive': '/api/drive/auth/url',
    };
    const endpoint = authUrlEndpoints[integration.id] || '/api/calendar/auth/url';
    const resp = await authFetch(apiUrl(endpoint));
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

    // Start polling for auth completion
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    pollTimerRef.current = setInterval(fetchStatus, 3000);
  };

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

  const handleSaveCredentials = async () => {
    if (!clientId.trim()) {
      setError('Client ID is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const config: Record<string, unknown> = {};
      // Only send the Client ID if it was changed (not the '********' placeholder)
      if (clientId.trim() && clientId.trim() !== '********') {
        config.GOOGLE_CLIENT_ID = clientId.trim();
      }
      if (clientSecret.trim()) {
        config.GOOGLE_CLIENT_SECRET = clientSecret.trim();
      }

      console.log('Saving Google OAuth config...', config);
      await onSave(config);
      console.log('Config saved successfully');

      // Fetch the OAuth consent URL and start polling
      await fetchAuthUrlAndStart();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get OAuth URL';
      console.error('Error in handleSaveCredentials:', errorMsg, err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="google-oauth-setup">
      {error && (
        <div className="google-oauth-error">{error}</div>
      )}

      {step === 'credentials' && (
        <div className="google-oauth-section">
          <h4 className="google-oauth-section-title">Google OAuth Credentials</h4>

          {hasSharedCredentials && !showManualEdit ? (
            <>
              <div className="google-oauth-shared-banner">
                <div className="google-oauth-shared-title">
                  <span>{'\u2713'}</span>
                  <span>Credentials already configured</span>
                </div>
                <div className="google-oauth-shared-body">
                  Existing Google OAuth credentials (Client ID and Secret) are saved in your secrets store —
                  they&apos;re shared between Gmail, Calendar, and Drive. You may still need to re-authorize
                  once so the refresh token grants access to this service.
                </div>
              </div>

              <div className="integration-form-actions">
                <button type="button" className="integration-btn cancel" onClick={onCancel}>
                  Cancel
                </button>
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
              </div>
            </>
          ) : (
            <>
              <p className="google-oauth-help">
                Create OAuth2 credentials in the{' '}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="google-oauth-link"
                >
                  Google Cloud Console
                </a>
                . Enable the relevant API (Gmail, Calendar, or Drive). Set the redirect URI to:{' '}
                <code className="google-oauth-code">
                  {apiUrl(
                    integration.id === 'gmail' ? '/api/email/auth/callback' :
                    integration.id === 'google-drive' ? '/api/drive/auth/callback' :
                    '/api/calendar/auth/callback'
                  )}
                </code>
              </p>

              <div className="google-oauth-field">
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

              <div className="google-oauth-field">
                <label className="integration-field-label">
                  OAuth Client Secret <span className="integration-field-required">*</span>
                </label>
                <input
                  type="password"
                  className="integration-field-input"
                  value={clientSecret}
                  placeholder={integration.values.GOOGLE_CLIENT_SECRET ? '(saved)' : 'Enter client secret'}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="off"
                />
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
            </>
          )}
        </div>
      )}

      {step === 'authorize' && (
        <div className="google-oauth-section">
          <h4 className="google-oauth-section-title">Authorize Google Access</h4>
          <p className="google-oauth-help">
            Click the link below to authorize Tide Commander to access your Google account.
            After granting access, you will be redirected back and the connection will be established automatically.
          </p>

          {authUrl && (
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="google-oauth-authorize-btn"
            >
              Authorize with Google
            </a>
          )}

          <div className="google-oauth-waiting">
            <span className="google-oauth-spinner" />
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

      {step === 'connected' && (
        <div className="google-oauth-section">
          <h4 className="google-oauth-section-title">Google Connected</h4>

          <div className="google-oauth-connected-info">
            <span className="google-oauth-connected-badge">Connected</span>
            {authStatus?.emailAddress && (
              <span className="google-oauth-email">{authStatus.emailAddress}</span>
            )}
          </div>

          <p className="google-oauth-help">
            Your Google account has been successfully connected.
          </p>

          <div className="integration-form-actions">
            <button
              type="button"
              className="integration-btn cancel"
              onClick={async () => {
                // Refresh parent panel before closing
                await onSave({});
                onCancel();
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <style>{`
        .google-oauth-setup {
          padding: 0;
        }
        .google-oauth-error {
          background: linear-gradient(135deg, rgba(243, 139, 168, 0.2) 0%, rgba(243, 139, 168, 0.08) 100%);
          border-left: 3px solid #f38ba8;
          color: #f38ba8;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 18px;
          font-size: 13px;
          font-weight: 500;
        }
        .google-oauth-section {
          background: linear-gradient(180deg, rgba(45, 49, 69, 0.4) 0%, rgba(30, 30, 46, 0.2) 100%);
          border: 1px solid rgba(137, 180, 250, 0.15);
          border-radius: 12px;
          padding: 28px;
          backdrop-filter: blur(10px);
        }
        .google-oauth-section-title {
          margin: 0 0 16px 0;
          color: #cdd6f4;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .google-oauth-help {
          color: #a6adc8;
          font-size: 13px;
          line-height: 1.6;
          margin: 0 0 20px 0;
          font-weight: 400;
        }
        .google-oauth-link {
          color: #89b4fa;
          text-decoration: none;
          border-bottom: 1.5px solid rgba(137, 180, 250, 0.4);
          transition: all 0.2s ease;
          font-weight: 500;
        }
        .google-oauth-link:hover {
          color: #a8c5ff;
          border-bottom-color: #89b4fa;
        }
        .google-oauth-code {
          background: rgba(137, 180, 250, 0.15);
          color: #89b4fa;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          word-break: break-all;
          font-weight: 500;
          font-family: 'Monaco', 'Menlo', monospace;
        }
        .google-oauth-field {
          margin-bottom: 18px;
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
        .google-oauth-authorize-btn {
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
        .google-oauth-authorize-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(137, 180, 250, 0.35);
          background: linear-gradient(135deg, #a8c5ff 0%, #8eb8ff 100%);
        }
        .google-oauth-waiting {
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
        .google-oauth-spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2.5px solid rgba(137, 180, 250, 0.25);
          border-top-color: #89b4fa;
          border-radius: 50%;
          animation: google-spin 0.8s linear infinite;
          flex-shrink: 0;
        }
        @keyframes google-spin {
          to { transform: rotate(360deg); }
        }
        .google-oauth-connected-info {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 20px;
          background: rgba(166, 227, 161, 0.08);
          padding: 16px;
          border-radius: 10px;
          border-left: 3px solid #a6e3a1;
        }
        .google-oauth-connected-badge {
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
        .google-oauth-email {
          color: #cdd6f4;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.2px;
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
        .google-oauth-shared-banner {
          background: linear-gradient(135deg, rgba(166, 227, 161, 0.15) 0%, rgba(166, 227, 161, 0.05) 100%);
          border: 1px solid rgba(166, 227, 161, 0.3);
          border-left: 3px solid #a6e3a1;
          border-radius: 10px;
          padding: 16px 18px;
          margin-bottom: 8px;
        }
        .google-oauth-shared-title {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #a6e3a1;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.2px;
          margin-bottom: 8px;
        }
        .google-oauth-shared-body {
          color: #a6adc8;
          font-size: 13px;
          line-height: 1.6;
          font-weight: 400;
        }
      `}</style>
    </div>
  );
}
