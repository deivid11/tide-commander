/**
 * SystemPromptModal - Modal for editing a per-agent custom system prompt
 *
 * Opens from Settings > System Prompt. The prompt is now scoped to a single
 * agent (picked at the top of the modal) instead of being global — it is stored
 * on the agent (`agent.customPrompt`) and injected into that agent's system
 * prompt by the server's buildAppendedProjectInstructions().
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from './shared/ModalPortal';
import { ConfirmModal } from './shared/ConfirmModal';
import { store, useAgentsArray } from '../store';
import { AgentIcon } from './AgentIcon';
import { Icon } from './Icon';
import '../styles/components/system-prompt-modal.scss';

export interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optionally open the modal pre-targeted at a specific agent. */
  initialAgentId?: string;
}

export function SystemPromptModal({ isOpen, onClose, initialAgentId }: SystemPromptModalProps) {
  const { t } = useTranslation(['config']);
  const agents = useAgentsArray();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false);
  // When set, a confirmed discard switches to this agent; otherwise it closes.
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents]
  );

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId),
    [agents, selectedAgentId]
  );

  // Pick an initial agent when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    const validInitial = initialAgentId && agents.some((a) => a.id === initialAgentId)
      ? initialAgentId
      : (sortedAgents[0]?.id ?? '');
    setSelectedAgentId(validInitial);
    // Intentionally only re-run when the modal opens.
  }, [isOpen]);

  // Load the selected agent's prompt whenever the selection changes.
  useEffect(() => {
    const content = selectedAgent?.customPrompt ?? '';
    setPrompt(content);
    setOriginalPrompt(content);
    setIsDirty(false);
    setError(null);
    setSuccess(null);
  }, [selectedAgentId]);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newPrompt = e.target.value;
    setPrompt(newPrompt);
    setIsDirty(newPrompt !== originalPrompt);
    setError(null);
    setSuccess(null);
  };

  const handleSave = () => {
    if (!selectedAgentId) return;
    try {
      setError(null);
      setSuccess(null);
      store.updateAgentProperties(selectedAgentId, { customPrompt: prompt });
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

  const performClear = () => {
    if (!selectedAgentId) return;
    try {
      setError(null);
      setSuccess(null);
      store.updateAgentProperties(selectedAgentId, { customPrompt: '' });
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

  // Switch the active agent, guarding unsaved edits.
  const switchAgent = (id: string) => {
    if (id === selectedAgentId) return;
    if (isDirty) {
      setPendingAgentId(id);
      setUnsavedConfirmOpen(true);
      return;
    }
    setSelectedAgentId(id);
  };

  const requestClose = () => {
    if (isDirty) {
      setPendingAgentId(null);
      setUnsavedConfirmOpen(true);
      return;
    }
    onClose();
  };

  // Confirmed "discard unsaved changes": either switch agents or close.
  const confirmDiscard = () => {
    setUnsavedConfirmOpen(false);
    if (pendingAgentId) {
      const id = pendingAgentId;
      setPendingAgentId(null);
      setSelectedAgentId(id); // load effect resets prompt + dirty
    } else {
      onClose();
    }
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
            {sortedAgents.length === 0 ? (
              <div className="loading-state">
                <p>{t('config:systemPrompt.noAgents')}</p>
              </div>
            ) : (
              <>
                <p className="modal-description">{t('config:systemPrompt.description')}</p>

                {/* Agent picker — the prompt is scoped to the chosen agent. */}
                <div className="agent-picker">
                  <label htmlFor="system-prompt-agent" className="editor-label">
                    {t('config:systemPrompt.agentLabel')}
                  </label>
                  <div className="agent-picker-row">
                    {selectedAgent && (
                      <AgentIcon classId={selectedAgent.class} size={20} className="agent-picker-icon" />
                    )}
                    <select
                      id="system-prompt-agent"
                      className="agent-picker-select"
                      value={selectedAgentId}
                      onChange={(e) => switchAgent(e.target.value)}
                    >
                      {sortedAgents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.customPrompt ? ' • ✦' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

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
                disabled={!prompt || !selectedAgentId}
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
                disabled={!isDirty}
              >
                {t('config:systemPrompt.reset')}
              </button>

              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!isDirty || !selectedAgentId}
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
        onConfirm={() => { performClear(); }}
        onClose={() => setClearConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={unsavedConfirmOpen}
        title="Unsaved Changes"
        message="You have unsaved changes for this agent. Discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={confirmDiscard}
        onClose={() => { setUnsavedConfirmOpen(false); setPendingAgentId(null); }}
      />
    </ModalPortal>
  );
}
