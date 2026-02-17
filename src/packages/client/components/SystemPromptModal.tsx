/**
 * SystemPromptModal - Modal for editing the global system prompt
 *
 * Opens from Settings > System Prompt
 * Provides large editor with better UX than inline component
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from './shared/ModalPortal';
import { fetchSystemPrompt, updateSystemPrompt, clearSystemPrompt } from '../api/system-settings';
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

  const handleClear = async () => {
    if (!window.confirm(t('config:systemPrompt.confirmClear'))) {
      return;
    }

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (isDirty) {
        if (!window.confirm('You have unsaved changes. Close anyway?')) {
          e.preventDefault();
          return;
        }
      }
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={onClose}>
        <div className="system-prompt-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
          <div className="modal-header">
            <h2>{t('config:systemPrompt.title')}</h2>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ✕
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
                    <span className="alert-icon">⚠️</span>
                    {error}
                  </div>
                )}

                {success && (
                  <div className="alert alert-success">
                    <span className="alert-icon">✓</span>
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
                onClick={onClose}
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
    </ModalPortal>
  );
}
