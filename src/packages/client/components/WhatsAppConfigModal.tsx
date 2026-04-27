/**
 * WhatsAppConfigModal - Settings modal for the local WhatsApp (Baileys) integration.
 *
 * Mirrors SystemPromptModal's structure: ModalPortal scaffolding, dirty-state tracking,
 * Escape-to-close with unsaved-changes warning, alerts, loading spinner, and footer buttons.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from './shared/ModalPortal';
import { ConfirmModal } from './shared/ConfirmModal';
import { Icon } from './Icon';
import {
  fetchWhatsAppStatus,
  fetchWhatsAppConfig,
  updateWhatsAppConfig,
  setWhatsAppApiKey,
  clearWhatsAppApiKey,
  listWhatsAppSessions,
  createWhatsAppSession,
  deleteWhatsAppSession,
  fetchWhatsAppSessionQr,
  sendWhatsAppTestMessage,
  type WhatsAppConfig,
  type WhatsAppSession,
} from '../api/whatsapp-settings';
import '../styles/components/whatsapp-config-modal.scss';

export interface WhatsAppConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DraftConfig {
  enabled: boolean;
  baseUrl: string;
  defaultSessionId: string;
  webhookVerifyToken: string;
  showIncomingToasts: boolean;
}

const EMPTY_DRAFT: DraftConfig = {
  enabled: false,
  baseUrl: '',
  defaultSessionId: '',
  webhookVerifyToken: '',
  showIncomingToasts: true,
};

const QR_POLL_INTERVAL_MS = 2500;
const QR_POLL_TIMEOUT_MS = 120_000;

function configToDraft(cfg: WhatsAppConfig): DraftConfig {
  return {
    enabled: cfg.enabled ?? false,
    baseUrl: cfg.baseUrl ?? '',
    defaultSessionId: cfg.defaultSessionId ?? '',
    webhookVerifyToken: cfg.webhookVerifyToken ?? '',
    showIncomingToasts: cfg.showIncomingToasts ?? true,
  };
}

function draftEquals(a: DraftConfig, b: DraftConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.baseUrl === b.baseUrl &&
    a.defaultSessionId === b.defaultSessionId &&
    a.webhookVerifyToken === b.webhookVerifyToken &&
    a.showIncomingToasts === b.showIncomingToasts
  );
}

export function WhatsAppConfigModal({ isOpen, onClose }: WhatsAppConfigModalProps) {
  const { t } = useTranslation(['config']);

  const [draft, setDraft] = useState<DraftConfig>(EMPTY_DRAFT);
  const [original, setOriginal] = useState<DraftConfig>(EMPTY_DRAFT);
  const [configured, setConfigured] = useState(false);
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // API key input (write-only)
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Add-session input + active QR
  const [newSessionId, setNewSessionId] = useState('');
  const [pairingSessionId, setPairingSessionId] = useState<string | null>(null);
  const [pairingQr, setPairingQr] = useState<string | null>(null);
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  // Test message
  const [testTo, setTestTo] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testStatus, setTestStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [testSending, setTestSending] = useState(false);

  // Confirm dialogs
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false);
  const [clearKeyConfirmOpen, setClearKeyConfirmOpen] = useState(false);
  const [deleteSessionConfirmOpen, setDeleteSessionConfirmOpen] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);

  const isDirty = !draftEquals(draft, original);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      const [cfg, status] = await Promise.all([
        fetchWhatsAppConfig(),
        fetchWhatsAppStatus(),
      ]);
      const nextDraft = configToDraft(cfg);
      setDraft(nextDraft);
      setOriginal(nextDraft);
      setConfigured(Boolean(status.configured));

      // The /status endpoint returns a count (number) when configured and an
      // array when unconfigured/erroring, so it can't be used for the list.
      // When configured, fetch the authoritative list from /sessions; when
      // not, default to an empty array.
      if (status.configured) {
        try {
          const list = await listWhatsAppSessions();
          setSessions(Array.isArray(list) ? list : []);
        } catch {
          setSessions([]);
        }
      } else {
        setSessions([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsapp.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await listWhatsAppSessions();
      setSessions(Array.isArray(list) ? list : []);
    } catch {
      /* ignore — surfaced via session-specific errors */
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadAll();
    } else {
      stopPolling();
      setPairingSessionId(null);
      setPairingQr(null);
      setPairingMessage(null);
      setApiKeyInput('');
      setShowApiKey(false);
      setTestStatus(null);
    }
    return () => {
      stopPolling();
    };
  }, [isOpen, loadAll, stopPolling]);

  const handleDraftChange = <K extends keyof DraftConfig>(key: K, value: DraftConfig[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSuccess(null);
  };

  const handleSave = async () => {
    try {
      setError(null);
      setSuccess(null);
      const updated = await updateWhatsAppConfig({
        enabled: draft.enabled,
        baseUrl: draft.baseUrl.trim(),
        defaultSessionId: draft.defaultSessionId.trim(),
        webhookVerifyToken: draft.webhookVerifyToken,
        showIncomingToasts: draft.showIncomingToasts,
      });
      window.dispatchEvent(new CustomEvent('tide:whatsapp-config-updated'));
      const nextDraft = configToDraft(updated);
      setDraft(nextDraft);
      setOriginal(nextDraft);
      setSuccess(t('config:whatsapp.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsapp.errors.saveFailed'));
    }
  };

  const handleReset = () => {
    setDraft(original);
    setError(null);
    setSuccess(null);
  };

  const requestClose = () => {
    if (isDirty) {
      setUnsavedConfirmOpen(true);
      return;
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
    }
  };

  const handleSaveApiKey = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    try {
      setError(null);
      setSuccess(null);
      await setWhatsAppApiKey(trimmed);
      setApiKeyInput('');
      setShowApiKey(false);
      setConfigured(true);
      setSuccess(t('config:whatsapp.apiKeySaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsapp.errors.apiKeySaveFailed'));
    }
  };

  const handleClearApiKey = () => {
    setClearKeyConfirmOpen(true);
  };

  const performClearApiKey = async () => {
    try {
      setError(null);
      setSuccess(null);
      await clearWhatsAppApiKey();
      setConfigured(false);
      setSuccess(t('config:whatsapp.apiKeyCleared'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsapp.errors.apiKeyClearFailed'));
    }
  };

  const pollSessionQr = useCallback(async (sessionId: string) => {
    if (Date.now() > pollDeadlineRef.current) {
      setPairingMessage(t('config:whatsapp.pairingTimeout'));
      setPairingSessionId(null);
      setPairingQr(null);
      stopPolling();
      void refreshSessions();
      return;
    }
    try {
      const result = await fetchWhatsAppSessionQr(sessionId);
      const isPaired = result.status && ['connected', 'paired', 'open', 'ready'].includes(result.status.toLowerCase());
      if (isPaired) {
        setPairingMessage(t('config:whatsapp.pairingSuccess'));
        setPairingSessionId(null);
        setPairingQr(null);
        stopPolling();
        void refreshSessions();
        return;
      }
      const qr = result.qrUrl ?? result.qr ?? null;
      if (qr) setPairingQr(qr);
    } catch (err) {
      setPairingMessage(err instanceof Error ? err.message : t('config:whatsapp.errors.qrFetchFailed'));
    }
    pollTimerRef.current = setTimeout(() => {
      void pollSessionQr(sessionId);
    }, QR_POLL_INTERVAL_MS);
  }, [refreshSessions, stopPolling, t]);

  const handleAddSession = async () => {
    const trimmed = newSessionId.trim();
    if (!trimmed) return;
    try {
      setError(null);
      setSuccess(null);
      setPairingMessage(null);
      setPairingQr(null);
      stopPolling();
      await createWhatsAppSession(trimmed);
      setNewSessionId('');
      setPairingSessionId(trimmed);
      pollDeadlineRef.current = Date.now() + QR_POLL_TIMEOUT_MS;
      void pollSessionQr(trimmed);
      void refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsapp.errors.sessionCreateFailed'));
    }
  };

  const handleCancelPairing = () => {
    stopPolling();
    setPairingSessionId(null);
    setPairingQr(null);
    setPairingMessage(null);
  };

  const handleDeleteSession = (sessionId: string) => {
    setPendingDeleteSessionId(sessionId);
    setDeleteSessionConfirmOpen(true);
  };

  const performDeleteSession = async () => {
    if (!pendingDeleteSessionId) return;
    try {
      setError(null);
      setSuccess(null);
      await deleteWhatsAppSession(pendingDeleteSessionId);
      if (pairingSessionId === pendingDeleteSessionId) handleCancelPairing();
      void refreshSessions();
      setSuccess(t('config:whatsapp.sessionDeleted'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsapp.errors.sessionDeleteFailed'));
    } finally {
      setPendingDeleteSessionId(null);
    }
  };

  const handleSendTest = async () => {
    const to = testTo.trim();
    const msg = testMessage.trim();
    if (!to || !msg) return;
    try {
      setTestSending(true);
      setTestStatus(null);
      const sessionId = draft.defaultSessionId.trim() || undefined;
      await sendWhatsAppTestMessage(to, msg, sessionId);
      setTestStatus({ kind: 'success', text: t('config:whatsapp.testSent') });
    } catch (err) {
      setTestStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : t('config:whatsapp.errors.testSendFailed'),
      });
    } finally {
      setTestSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={requestClose}>
        <div
          className="whatsapp-config-modal"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <div className="modal-header">
            <h2>{t('config:whatsapp.title')}</h2>
            <button className="modal-close" onClick={requestClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="modal-body">
            {loading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>{t('config:whatsapp.loading')}</p>
              </div>
            ) : (
              <>
                <p className="modal-description">{t('config:whatsapp.description')}</p>

                {error && (
                  <div className="alert alert-error">
                    <span className="alert-icon"><Icon name="warn" size={14} /></span>
                    {error}
                  </div>
                )}

                {success && (
                  <div className="alert alert-success">
                    <span className="alert-icon"><Icon name="check" size={14} /></span>
                    {success}
                  </div>
                )}

                {/* General */}
                <section className="wa-section">
                  <h3 className="wa-section-title">{t('config:whatsapp.sections.general')}</h3>

                  <div className="wa-field wa-field-row">
                    <label htmlFor="wa-enabled" className="wa-label">{t('config:whatsapp.enabled')}</label>
                    <label className="wa-toggle">
                      <input
                        id="wa-enabled"
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => handleDraftChange('enabled', e.target.checked)}
                      />
                      <span className="wa-toggle-track"><span className="wa-toggle-thumb" /></span>
                    </label>
                  </div>

                  <div className="wa-field wa-field-row">
                    <label htmlFor="wa-show-toasts" className="wa-label">{t('config:whatsapp.showIncomingToasts')}</label>
                    <label className="wa-toggle">
                      <input
                        id="wa-show-toasts"
                        type="checkbox"
                        checked={draft.showIncomingToasts}
                        onChange={(e) => handleDraftChange('showIncomingToasts', e.target.checked)}
                      />
                      <span className="wa-toggle-track"><span className="wa-toggle-thumb" /></span>
                    </label>
                  </div>
                  <span className="wa-hint">{t('config:whatsapp.showIncomingToastsHelp')}</span>

                  <div className="wa-field">
                    <label htmlFor="wa-base-url" className="wa-label">{t('config:whatsapp.baseUrl')}</label>
                    <input
                      id="wa-base-url"
                      type="text"
                      className="wa-input"
                      placeholder="http://localhost:3007"
                      value={draft.baseUrl}
                      onChange={(e) => handleDraftChange('baseUrl', e.target.value)}
                    />
                  </div>

                  <div className="wa-field">
                    <label htmlFor="wa-default-session" className="wa-label">{t('config:whatsapp.defaultSessionId')}</label>
                    <input
                      id="wa-default-session"
                      type="text"
                      className="wa-input"
                      placeholder={t('config:whatsapp.defaultSessionIdPlaceholder')}
                      value={draft.defaultSessionId}
                      onChange={(e) => handleDraftChange('defaultSessionId', e.target.value)}
                    />
                  </div>

                  <div className="wa-field">
                    <label htmlFor="wa-webhook-token" className="wa-label">{t('config:whatsapp.webhookVerifyToken')}</label>
                    <input
                      id="wa-webhook-token"
                      type="text"
                      className="wa-input"
                      placeholder={t('config:whatsapp.webhookVerifyTokenPlaceholder')}
                      value={draft.webhookVerifyToken}
                      onChange={(e) => handleDraftChange('webhookVerifyToken', e.target.value)}
                    />
                  </div>
                </section>

                {/* API Key */}
                <section className="wa-section">
                  <h3 className="wa-section-title">{t('config:whatsapp.sections.apiKey')}</h3>

                  <div className="wa-key-status">
                    {configured ? (
                      <span className="wa-status wa-status-ok">
                        <Icon name="check" size={12} /> {t('config:whatsapp.configured')}
                      </span>
                    ) : (
                      <span className="wa-status wa-status-warn">
                        <Icon name="warn" size={12} /> {t('config:whatsapp.notConfigured')}
                      </span>
                    )}
                  </div>

                  <div className="wa-field wa-field-inline">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      className="wa-input"
                      placeholder={t('config:whatsapp.apiKeyPlaceholder')}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowApiKey((s) => !s)}
                      title={showApiKey ? t('config:whatsapp.hideKey') : t('config:whatsapp.showKey')}
                    >
                      <Icon name={showApiKey ? 'eye-closed' : 'eye'} size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSaveApiKey}
                      disabled={!apiKeyInput.trim()}
                    >
                      {t('config:whatsapp.saveKey')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleClearApiKey}
                      disabled={!configured}
                    >
                      {t('config:whatsapp.clearKey')}
                    </button>
                  </div>
                  <span className="wa-hint">{t('config:whatsapp.apiKeyHint')}</span>
                </section>

                {/* Sessions */}
                <section className="wa-section">
                  <h3 className="wa-section-title">{t('config:whatsapp.sections.sessions')}</h3>

                  <div className="wa-sessions-list">
                    {!Array.isArray(sessions) || sessions.length === 0 ? (
                      <div className="wa-empty">{t('config:whatsapp.noSessions')}</div>
                    ) : (
                      sessions.map((s) => (
                        <div key={s.id} className="wa-session-row">
                          <div className="wa-session-info">
                            <span className="wa-session-id">{s.id}</span>
                            <span className={`wa-session-status status-${(s.status ?? 'unknown').toLowerCase()}`}>
                              {s.status || '—'}
                            </span>
                            {s.pairedNumber && (
                              <span className="wa-session-paired">{s.pairedNumber}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteSession(s.id)}
                          >
                            {t('config:whatsapp.deleteSession')}
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="wa-field wa-field-inline">
                    <input
                      type="text"
                      className="wa-input"
                      placeholder={t('config:whatsapp.addSessionPlaceholder')}
                      value={newSessionId}
                      onChange={(e) => setNewSessionId(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAddSession(); }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleAddSession}
                      disabled={!newSessionId.trim() || pairingSessionId !== null}
                    >
                      {t('config:whatsapp.addSession')}
                    </button>
                  </div>

                  {pairingSessionId && (
                    <div className="wa-qr-panel">
                      <div className="wa-qr-header">
                        <span>{t('config:whatsapp.qrPrompt', { id: pairingSessionId })}</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={handleCancelPairing}>
                          {t('config:whatsapp.cancelPairing')}
                        </button>
                      </div>
                      {pairingQr ? (
                        <div className="wa-qr-image">
                          <img src={pairingQr} alt="WhatsApp pairing QR code" />
                        </div>
                      ) : (
                        <div className="wa-qr-loading">
                          <div className="spinner"></div>
                          <p>{t('config:whatsapp.waitingForQr')}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {pairingMessage && !pairingSessionId && (
                    <div className="wa-pairing-message">{pairingMessage}</div>
                  )}
                </section>

                {/* Test message */}
                <section className="wa-section">
                  <h3 className="wa-section-title">{t('config:whatsapp.sections.testMessage')}</h3>

                  <div className="wa-field">
                    <label htmlFor="wa-test-to" className="wa-label">{t('config:whatsapp.testTo')}</label>
                    <input
                      id="wa-test-to"
                      type="text"
                      className="wa-input"
                      placeholder={t('config:whatsapp.testToPlaceholder')}
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                    />
                  </div>

                  <div className="wa-field">
                    <label htmlFor="wa-test-message" className="wa-label">{t('config:whatsapp.testMessageBody')}</label>
                    <textarea
                      id="wa-test-message"
                      className="wa-textarea"
                      rows={4}
                      placeholder={t('config:whatsapp.testMessageBodyPlaceholder')}
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                    />
                  </div>

                  <div className="wa-field-inline wa-field-end">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSendTest}
                      disabled={!testTo.trim() || !testMessage.trim() || testSending}
                    >
                      {testSending ? t('config:whatsapp.sending') : t('config:whatsapp.sendTest')}
                    </button>
                  </div>

                  {testStatus && (
                    <div className={`alert ${testStatus.kind === 'success' ? 'alert-success' : 'alert-error'}`}>
                      <span className="alert-icon">
                        <Icon name={testStatus.kind === 'success' ? 'check' : 'warn'} size={14} />
                      </span>
                      {testStatus.text}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          <div className="modal-footer">
            <div className="footer-buttons-left" />
            <div className="footer-buttons-right">
              <button className="btn btn-secondary" onClick={requestClose}>
                {t('config:whatsapp.close')}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleReset}
                disabled={!isDirty || loading}
              >
                {t('config:whatsapp.reset')}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!isDirty || loading}
              >
                {t('config:whatsapp.save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={unsavedConfirmOpen}
        title={t('config:whatsapp.unsavedTitle')}
        message={t('config:whatsapp.unsavedMessage')}
        confirmLabel={t('config:whatsapp.closeAnyway')}
        cancelLabel={t('config:whatsapp.keepEditing')}
        variant="danger"
        onConfirm={() => { setUnsavedConfirmOpen(false); onClose(); }}
        onClose={() => setUnsavedConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={clearKeyConfirmOpen}
        title={t('config:whatsapp.clearKey')}
        message={t('config:whatsapp.confirmClearKey')}
        confirmLabel={t('config:whatsapp.clearKey')}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => { void performClearApiKey(); }}
        onClose={() => setClearKeyConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={deleteSessionConfirmOpen}
        title={t('config:whatsapp.deleteSession')}
        message={t('config:whatsapp.confirmDeleteSession', { id: pendingDeleteSessionId ?? '' })}
        confirmLabel={t('config:whatsapp.deleteSession')}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => { void performDeleteSession(); }}
        onClose={() => { setDeleteSessionConfirmOpen(false); setPendingDeleteSessionId(null); }}
      />
    </ModalPortal>
  );
}
