/**
 * WhatsAppNotificationsModal - Per-event-type toggle UI for WhatsApp notifications.
 *
 * Mirrors SystemPromptModal scaffolding: ModalPortal, dirty-state tracking,
 * Escape-to-close with unsaved-changes warning, alerts, and footer buttons.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from './shared/ModalPortal';
import { ConfirmModal } from './shared/ConfirmModal';
import { Icon } from './Icon';
import {
  fetchWhatsAppNotificationConfig,
  updateWhatsAppNotificationConfig,
  clearWhatsAppNotificationConfig,
  WHATSAPP_NOTIFICATION_EVENT_TYPES,
  type WhatsAppNotificationFilter,
  type WhatsAppNotificationEventType,
} from '../api/whatsapp-notifications';
import '../styles/components/whatsapp-notifications-modal.scss';

export interface WhatsAppNotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Draft {
  filter: WhatsAppNotificationFilter;
  recipient: string;
}

const EMPTY_FILTER: WhatsAppNotificationFilter = {
  messages: true,
  statusChanges: true,
  taskComplete: true,
  errors: true,
  planReady: true,
  agentSpawned: true,
  agentStopped: true,
};

const EMPTY_DRAFT: Draft = {
  filter: { ...EMPTY_FILTER },
  recipient: '',
};

function draftEquals(a: Draft, b: Draft): boolean {
  if (a.recipient !== b.recipient) return false;
  for (const key of WHATSAPP_NOTIFICATION_EVENT_TYPES) {
    if (a.filter[key] !== b.filter[key]) return false;
  }
  return true;
}

export function WhatsAppNotificationsModal({ isOpen, onClose }: WhatsAppNotificationsModalProps) {
  const { t } = useTranslation(['config']);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [original, setOriginal] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const isDirty = !draftEquals(draft, original);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      const cfg = await fetchWhatsAppNotificationConfig();
      const next: Draft = {
        filter: { ...EMPTY_FILTER, ...cfg.filter },
        recipient: cfg.recipient ?? '',
      };
      setDraft(next);
      setOriginal(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsappNotifications.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      void loadConfig();
    }
  }, [isOpen, loadConfig]);

  const handleToggle = (event: WhatsAppNotificationEventType, value: boolean) => {
    setDraft((prev) => ({ ...prev, filter: { ...prev.filter, [event]: value } }));
    setError(null);
    setSuccess(null);
  };

  const handleRecipientChange = (value: string) => {
    setDraft((prev) => ({ ...prev, recipient: value }));
    setError(null);
    setSuccess(null);
  };

  const handleSave = async () => {
    try {
      setError(null);
      setSuccess(null);
      const updated = await updateWhatsAppNotificationConfig({
        filter: draft.filter,
        recipient: draft.recipient.trim(),
      });
      const next: Draft = {
        filter: { ...EMPTY_FILTER, ...updated.filter },
        recipient: updated.recipient ?? '',
      };
      setDraft(next);
      setOriginal(next);
      setSuccess(t('config:whatsappNotifications.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsappNotifications.errors.saveFailed'));
    }
  };

  const handleReset = () => {
    setDraft(original);
    setError(null);
    setSuccess(null);
  };

  const performResetToDefaults = async () => {
    try {
      setError(null);
      setSuccess(null);
      const cfg = await clearWhatsAppNotificationConfig();
      const next: Draft = {
        filter: { ...EMPTY_FILTER, ...cfg.filter },
        recipient: cfg.recipient ?? '',
      };
      setDraft(next);
      setOriginal(next);
      setSuccess(t('config:whatsappNotifications.resetDone'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config:whatsappNotifications.errors.resetFailed'));
    }
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

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={requestClose}>
        <div
          className="whatsapp-notifications-modal"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <div className="modal-header">
            <h2>{t('config:whatsappNotifications.title')}</h2>
            <button className="modal-close" onClick={requestClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="modal-body">
            {loading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>{t('config:whatsappNotifications.loading')}</p>
              </div>
            ) : (
              <>
                <p className="modal-description">{t('config:whatsappNotifications.description')}</p>

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

                <section className="wan-section">
                  <h3 className="wan-section-title">{t('config:whatsappNotifications.sections.recipient')}</h3>
                  <div className="wan-field">
                    <label htmlFor="wan-recipient" className="wan-label">
                      {t('config:whatsappNotifications.recipientLabel')}
                    </label>
                    <input
                      id="wan-recipient"
                      type="text"
                      className="wan-input"
                      placeholder={t('config:whatsappNotifications.recipientPlaceholder')}
                      value={draft.recipient}
                      onChange={(e) => handleRecipientChange(e.target.value)}
                    />
                    <span className="wan-hint">{t('config:whatsappNotifications.recipientHint')}</span>
                  </div>
                </section>

                <section className="wan-section">
                  <h3 className="wan-section-title">{t('config:whatsappNotifications.sections.events')}</h3>
                  <p className="wan-section-hint">{t('config:whatsappNotifications.eventsHint')}</p>

                  {WHATSAPP_NOTIFICATION_EVENT_TYPES.map((event) => (
                    <div key={event} className="wan-toggle-row">
                      <div className="wan-toggle-info">
                        <span className="wan-toggle-title">
                          {t(`config:whatsappNotifications.events.${event}.title`)}
                        </span>
                        <span className="wan-toggle-help">
                          {t(`config:whatsappNotifications.events.${event}.help`)}
                        </span>
                      </div>
                      <label className="wan-toggle">
                        <input
                          type="checkbox"
                          checked={draft.filter[event]}
                          onChange={(e) => handleToggle(event, e.target.checked)}
                        />
                        <span className="wan-toggle-track"><span className="wan-toggle-thumb" /></span>
                      </label>
                    </div>
                  ))}
                </section>
              </>
            )}
          </div>

          <div className="modal-footer">
            <div className="footer-buttons-left">
              <button
                className="btn btn-danger"
                onClick={() => setResetConfirmOpen(true)}
                disabled={loading}
              >
                {t('config:whatsappNotifications.resetToDefaults')}
              </button>
            </div>
            <div className="footer-buttons-right">
              <button className="btn btn-secondary" onClick={requestClose}>
                {t('config:whatsappNotifications.close')}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleReset}
                disabled={!isDirty || loading}
              >
                {t('config:whatsappNotifications.reset')}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!isDirty || loading}
              >
                {t('config:whatsappNotifications.save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={unsavedConfirmOpen}
        title={t('config:whatsappNotifications.unsavedTitle')}
        message={t('config:whatsappNotifications.unsavedMessage')}
        confirmLabel={t('config:whatsappNotifications.closeAnyway')}
        cancelLabel={t('config:whatsappNotifications.keepEditing')}
        variant="danger"
        onConfirm={() => { setUnsavedConfirmOpen(false); onClose(); }}
        onClose={() => setUnsavedConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={resetConfirmOpen}
        title={t('config:whatsappNotifications.resetToDefaults')}
        message={t('config:whatsappNotifications.confirmReset')}
        confirmLabel={t('config:whatsappNotifications.resetToDefaults')}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => { void performResetToDefaults(); setResetConfirmOpen(false); }}
        onClose={() => setResetConfirmOpen(false)}
      />
    </ModalPortal>
  );
}
