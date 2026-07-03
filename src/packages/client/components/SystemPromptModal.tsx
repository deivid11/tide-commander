/**
 * SystemPromptModal - Modal for editing custom system prompts
 *
 * Opens from Settings > System Prompt. The picker at the top selects the scope:
 * "All Agents (Global)" edits the commander-wide prompt (stored server-side via
 * system-prompt-service and injected into every agent's instructions), while a
 * specific agent edits that agent's own prompt (`agent.customPrompt`). The
 * global prompt is injected before the per-agent one by the server's
 * buildAppendedProjectInstructions().
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from './shared/ModalPortal';
import { ConfirmModal } from './shared/ConfirmModal';
import { store, useAgentsArray } from '../store';
import { AgentIcon } from './AgentIcon';
import { Icon } from './Icon';
import {
  fetchSystemPrompt,
  updateSystemPrompt,
  clearSystemPrompt as clearGlobalSystemPrompt,
} from '../api/system-settings';
import '../styles/components/system-prompt-modal.scss';

/** Sentinel picker value for the commander-wide (all agents) prompt scope. */
const GLOBAL_SCOPE_ID = '__global__';

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
  const [globalPrompt, setGlobalPrompt] = useState('');
  const [globalLoaded, setGlobalLoaded] = useState(false);
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

  const isGlobal = selectedAgentId === GLOBAL_SCOPE_ID;

  // Pick the initial scope when the modal opens and fetch the global prompt
  // (for the picker marker and so switching scopes is instant).
  useEffect(() => {
    if (!isOpen) return;
    const validInitial = initialAgentId && agents.some((a) => a.id === initialAgentId)
      ? initialAgentId
      : GLOBAL_SCOPE_ID;
    setSelectedAgentId(validInitial);
    setGlobalLoaded(false);
    fetchSystemPrompt()
      .then((content) => setGlobalPrompt(content))
      .catch(() => setGlobalPrompt(''))
      .finally(() => setGlobalLoaded(true));
    // Intentionally only re-run when the modal opens.
  }, [isOpen]);

  // Load the selected scope's prompt whenever the selection changes (and once
  // the global prompt arrives, since the fetch resolves after open).
  useEffect(() => {
    const content = selectedAgentId === GLOBAL_SCOPE_ID
      ? globalPrompt
      : (selectedAgent?.customPrompt ?? '');
    setPrompt(content);
    setOriginalPrompt(content);
    setIsDirty(false);
    setError(null);
    setSuccess(null);
  }, [selectedAgentId, globalLoaded]);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newPrompt = e.target.value;
    setPrompt(newPrompt);
    setIsDirty(newPrompt !== originalPrompt);
    setError(null);
    setSuccess(null);
  };

  const handleSave = async () => {
    if (!selectedAgentId) return;
    try {
      setError(null);
      setSuccess(null);
      if (isGlobal) {
        await updateSystemPrompt(prompt);
        setGlobalPrompt(prompt);
        setSuccess(t('config:systemPrompt.savedGlobal'));
      } else {
        store.updateAgentProperties(selectedAgentId, { customPrompt: prompt });
        setSuccess(t('config:systemPrompt.saved'));
      }
      setOriginalPrompt(prompt);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save system prompt');
    }
  };

  const handleClear = () => {
    setClearConfirmOpen(true);
  };

  const performClear = async () => {
    if (!selectedAgentId) return;
    try {
      setError(null);
      setSuccess(null);
      if (isGlobal) {
        await clearGlobalSystemPrompt();
        setGlobalPrompt('');
        setSuccess(t('config:systemPrompt.clearedGlobal'));
      } else {
        store.updateAgentProperties(selectedAgentId, { customPrompt: '' });
        setSuccess(t('config:systemPrompt.cleared'));
      }
      setPrompt('');
      setOriginalPrompt('');
      setIsDirty(false);
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
            <p className="modal-description">{t('config:systemPrompt.description')}</p>

            {/* Scope picker — the global (all agents) prompt or a specific agent's. */}
            <div className="agent-picker">
              <label htmlFor="system-prompt-agent" className="editor-label">
                {t('config:systemPrompt.agentLabel')}
              </label>
              <div className="agent-picker-row">
                {isGlobal ? (
                  <Icon name="globe" size={20} className="agent-picker-icon" />
                ) : (
                  selectedAgent && (
                    <AgentIcon classId={selectedAgent.class} size={20} className="agent-picker-icon" />
                  )
                )}
                <select
                  id="system-prompt-agent"
                  className="agent-picker-select"
                  value={selectedAgentId}
                  onChange={(e) => switchAgent(e.target.value)}
                >
                  <option value={GLOBAL_SCOPE_ID}>
                    {t('config:systemPrompt.globalOption')}{globalPrompt ? ' • ✦' : ''}
                  </option>
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
                disabled={isGlobal && !globalLoaded}
                autoFocus
              />

              <div className="editor-hint">
                {t(isGlobal ? 'config:systemPrompt.hintGlobal' : 'config:systemPrompt.hint')}
              </div>
            </div>
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
        message={t(isGlobal ? 'config:systemPrompt.confirmClearGlobal' : 'config:systemPrompt.confirmClear')}
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
