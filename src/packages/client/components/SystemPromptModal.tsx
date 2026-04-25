/**
 * SystemPromptModal - Modal for editing the global system prompt
 *
 * Opens from Settings > System Prompt
 * Provides large editor with better UX than inline component
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from './shared/ModalPortal';
import { ConfirmModal } from './shared/ConfirmModal';
import { fetchSystemPrompt, updateSystemPrompt, clearSystemPrompt } from '../api/system-settings';
import { Icon } from './Icon';
import '../styles/components/system-prompt-modal.scss';

export interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SystemPromptModal({ isOpen, onClose }: SystemPromptModalProps) {
  const { t } = useTranslation(['config']);

  const [prompt, setPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false);

  // Load system prompt when modal opens
  useEffect(() => {
    if (isOpen) {
      loadSystemPrompt();
    }
  }, [isOpen]);

  const loadSystemPrompt = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      const content = await fetchSystemPrompt();
      setPrompt(content);
      setOriginalPrompt(content);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system prompt');
    } finally {
      setLoading(false);
    }
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newPrompt = e.target.value;
    setPrompt(newPrompt);
    setIsDirty(newPrompt !== originalPrompt);
    setError(null);
    setSuccess(null);
  };

  const handleSave = async () => {
    try {
      setError(null);
      setSuccess(null);
      await updateSystemPrompt(prompt);
      setOriginalPrompt(prompt);
      setIsDirty(false);
      setSuccess(t('config:systemPrompt.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save system prompt');
    }
  };

  const handleClear = () => {
    setClearConfirmOpen(true);
  };

  const performClear = async () => {
    try {
      setError(null);
      setSuccess(null);
      await clearSystemPrompt();
      setPrompt('');
      setOriginalPrompt('');
      setIsDirty(false);
      setSuccess(t('config:systemPrompt.cleared'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear system prompt');
    }
  };

  const handleReset = () => {
    setPrompt(originalPrompt);
    setIsDirty(false);
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

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={requestClose}>
        <div className="system-prompt-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
          <div className="modal-header">
            <h2>{t('config:systemPrompt.title')}</h2>
            <button className="modal-close" onClick={requestClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="modal-body">
            {loading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Loading system prompt...</p>
              </div>
            ) : (
              <>
                <p className="modal-description">{t('config:systemPrompt.description')}</p>

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

                <div className="editor-wrapper">
                  <div className="editor-header">
                    <label htmlFor="prompt-input" className="editor-label">
                      {t('config:systemPrompt.editPrompt')}
                    </label>
                    <span className="char-count">
                      {prompt.length} {t('config:systemPrompt.characters')}
                    </span>
                  </div>

                  <textarea
                    id="prompt-input"
                    className="prompt-editor"
                    value={prompt}
                    onChange={handlePromptChange}
                    placeholder={t('config:systemPrompt.placeholder')}
                    rows={18}
                    autoFocus
                  />

                  <div className="editor-hint">
                    {t('config:systemPrompt.hint')}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="modal-footer">
            <div className="footer-buttons-left">
              <button
                className="btn btn-danger"
                onClick={handleClear}
                disabled={!prompt || loading}
              >
                {t('config:systemPrompt.clear')}
              </button>
            </div>

            <div className="footer-buttons-right">
              <button
                className="btn btn-secondary"
                onClick={requestClose}
              >
                Close
              </button>

              <button
                className="btn btn-secondary"
                onClick={handleReset}
                disabled={!isDirty || loading}
              >
                {t('config:systemPrompt.reset')}
              </button>

              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!isDirty || loading}
              >
                {t('config:systemPrompt.save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={clearConfirmOpen}
        title={t('config:systemPrompt.clear')}
        message={t('config:systemPrompt.confirmClear')}
        confirmLabel={t('config:systemPrompt.clear')}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => { void performClear(); }}
        onClose={() => setClearConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={unsavedConfirmOpen}
        title="Unsaved Changes"
        message="You have unsaved changes. Close anyway?"
        confirmLabel="Close anyway"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={onClose}
        onClose={() => setUnsavedConfirmOpen(false)}
      />
    </ModalPortal>
  );
}
