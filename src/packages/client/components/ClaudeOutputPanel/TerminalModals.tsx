/**
 * TerminalModals - Modal components for the terminal panel
 *
 * Includes: ImageModal, BashModal, ContextConfirmModal
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  store,
  useContextModalAgentId,
  useFileViewerPath,
  useFileViewerEditData,
  useFileViewerSearchRoot,
  useAgents,
  useAgentSkills,
  useCustomAgentClass,
} from '../../store';
import { ContextViewModal } from '../ContextViewModal';
import { FileViewerModal } from '../FileViewerModal';
import { AgentResponseModal } from './AgentResponseModal';
import { ansiToHtml } from '../../utils/ansiToHtml';
import type { Agent } from '../../../shared/types';
import { useModalClose } from '../../hooks';
import { ModalPortal } from '../shared/ModalPortal';

// Image modal props
export interface ImageModalProps {
  url: string;
  name: string;
  onClose: () => void;
}

export function ImageModal({ url, name, onClose }: ImageModalProps) {
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  return (
    <ModalPortal>
      <div className="image-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="image-modal">
          <div className="image-modal-header">
            <span className="image-modal-title">{name}</span>
            <button className="image-modal-close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="image-modal-content">
            <img src={url} alt={name} />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// Bash output modal props
export interface BashModalState {
  command: string;
  output: string;
  isLive?: boolean;
}

export interface BashModalProps {
  state: BashModalState;
  onClose: () => void;
}

export function BashModal({ state, onClose }: BashModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  return (
    <ModalPortal>
      <div className="bash-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="bash-modal">
          <div className="bash-modal-header">
            <span className="bash-modal-icon">$</span>
            <span className="bash-modal-title">{t('terminal:modals.terminalOutput')}</span>
            <button className="bash-modal-close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="bash-modal-command">
            <pre>{state.command}</pre>
          </div>
          <div className={`bash-modal-content ${state.isLive ? 'is-loading' : ''}`}>
            <pre dangerouslySetInnerHTML={{ __html: ansiToHtml(state.output) }} />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// Context action confirmation modal
export interface ContextConfirmModalProps {
  action: 'collapse' | 'clear' | 'clear-subordinates';
  selectedAgentId: string | null;
  subordinateCount?: number;
  onClose: () => void;
  onClearHistory: () => void;
}

export function ContextConfirmModal({ action, selectedAgentId, subordinateCount, onClose, onClearHistory }: ContextConfirmModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  const handleConfirm = () => {
    if (selectedAgentId) {
      if (action === 'collapse') {
        store.collapseContext(selectedAgentId);
      } else if (action === 'clear-subordinates') {
        store.clearAllSubordinatesContext(selectedAgentId);
      } else {
        store.clearContext(selectedAgentId);
        onClearHistory();
      }
    }
    onClose();
  };

  const getTitle = () => {
    if (action === 'collapse') return t('terminal:modals.collapseContext');
    if (action === 'clear-subordinates') return t('terminal:modals.clearAllSubordinatesContext');
    return t('terminal:modals.clearContext');
  };

  return (
    <ModalPortal>
      <div className="modal-overlay visible guake-context-confirm-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="modal confirm-modal guake-context-confirm-modal">
          <div className="modal-header">{getTitle()}</div>
          <div className="modal-body confirm-modal-body">
            {action === 'collapse' ? (
              <>
                <p>{t('terminal:modals.collapseConfirm')}</p>
                <p className="confirm-modal-note">
                  {t('terminal:modals.collapseNote')}
                </p>
              </>
            ) : action === 'clear-subordinates' ? (
              <>
                <p>{t('terminal:modals.clearSubordinatesConfirm', { count: subordinateCount })}</p>
                <p className="confirm-modal-note">
                  {t('terminal:modals.clearSubordinatesNote')}
                </p>
              </>
            ) : (
              <>
                <p>{t('terminal:modals.clearConfirm')}</p>
                <p className="confirm-modal-note">
                  {t('terminal:modals.clearNote')}
                </p>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              {t('common:buttons.cancel')}
            </button>
            <button
              className={`btn ${action === 'clear' || action === 'clear-subordinates' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleConfirm}
              autoFocus
            >
              {action === 'collapse' ? t('common:buttons.collapse') : action === 'clear-subordinates' ? t('terminal:modals.clearAll') : t('terminal:modals.clearContext')}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// Context view modal wrapper
export function ContextModalFromGuake() {
  const contextModalAgentId = useContextModalAgentId();
  const agents = useAgents();
  const agent = contextModalAgentId ? agents.get(contextModalAgentId) : null;

  if (!agent) return null;

  return (
    <ContextViewModal
      agent={agent}
      isOpen={!!contextModalAgentId}
      onClose={() => store.closeContextModal()}
      onRefresh={() => {
        if (contextModalAgentId) {
          store.refreshAgentContext(contextModalAgentId);
        }
      }}
    />
  );
}

// File viewer modal wrapper
export function FileViewerFromGuake() {
  const fileViewerPath = useFileViewerPath();
  const editData = useFileViewerEditData();
  const searchRoot = useFileViewerSearchRoot();

  if (!fileViewerPath) return null;

  return (
    <FileViewerModal
      isOpen={!!fileViewerPath}
      onClose={() => store.clearFileViewerPath()}
      filePath={fileViewerPath}
      action={editData ? 'modified' : 'read'}
      editData={editData || undefined}
      searchRoot={searchRoot || undefined}
    />
  );
}

// Agent response modal wrapper
export interface AgentResponseModalWrapperProps {
  agent: Agent | null;
  content: string | null;
  onClose: () => void;
}

export function AgentResponseModalWrapper({ agent, content, onClose }: AgentResponseModalWrapperProps) {
  if (!agent) return null;

  return (
    <AgentResponseModal
      agent={agent}
      content={content || ''}
      isOpen={!!content}
      onClose={onClose}
    />
  );
}

export interface AgentInfoModalProps {
  agent: Agent | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return 'N/A';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return 'N/A';
  }
}

export function AgentInfoModal({ agent, isOpen, onClose }: AgentInfoModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  const skills = useAgentSkills(agent?.id || null);
  const customClass = useCustomAgentClass(agent?.class || null);

  if (!isOpen || !agent) return null;

  const model = agent.provider === 'codex'
    ? (agent.codexModel || 'gpt-5.3-codex')
    : (agent.model || 'sonnet');

  const classInstructions = customClass?.instructions?.trim() || '';
  const agentInstructions = agent.customInstructions?.trim() || '';
  const hasClassInstructions = classInstructions.length > 0;
  const hasAgentInstructions = agentInstructions.length > 0;
  const hasCustomPrompt = hasClassInstructions || hasAgentInstructions;
  const showCombinedPrompt = hasClassInstructions && hasAgentInstructions;
  const combinedPrompt = [classInstructions, agentInstructions].filter(Boolean).join('\n\n');

  const contextWindow = Math.max(1, agent.contextStats?.contextWindow || agent.contextLimit || 200000);
  const usedTokens = agent.contextStats?.totalTokens || agent.contextUsed || 0;
  const usedPercent = agent.contextStats?.usedPercent || Math.round((usedTokens / contextWindow) * 100);

  return (
    <ModalPortal>
      <div className="agent-info-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="agent-info-modal">
          <div className="agent-info-modal-header">
            <div className="agent-info-modal-title">
              <span className="icon">ℹ️</span>
              <span>{t('terminal:agentInfo.title', { name: agent.name })}</span>
            </div>
            <button className="agent-info-modal-close" onClick={onClose}>×</button>
          </div>

          <div className="agent-info-modal-body">
            <section className="agent-info-section">
              <h4>{t('terminal:agentInfo.runtime')}</h4>
              <div className="agent-info-grid">
                <div className="agent-info-item">
                  <span>{t('terminal:agentInfo.backend')}</span>
                  <strong>
                    <img
                      src={agent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
                      alt={agent.provider}
                      className="agent-info-provider-icon"
                      title={agent.provider === 'codex' ? 'Codex Agent' : 'Claude Agent'}
                    />
                    {agent.provider === 'codex' ? 'Codex' : 'Claude'}
                  </strong>
                </div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.model')}</span><strong>{model}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.status')}</span><strong>{agent.status}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.class')}</span><strong>{agent.class}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.permission')}</span><strong>{agent.permissionMode}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.session')}</span><strong>{agent.sessionId || t('terminal:agentInfo.notStarted')}</strong></div>
              </div>
            </section>

            <section className="agent-info-section">
              <h4>{t('terminal:agentInfo.promptAndInstructions')}</h4>
              <div className="agent-info-prompts">
                {showCombinedPrompt && (
                  <div className="agent-info-prompt-block">
                    <span>{t('terminal:agentInfo.customPrompt')}</span>
                    <pre>{combinedPrompt}</pre>
                  </div>
                )}
                {!hasCustomPrompt && (
                  <div className="agent-info-prompt-block">
                    <span>{t('terminal:agentInfo.customPrompt')}</span>
                    <strong className="warn">{t('terminal:agentInfo.notConfigured')}</strong>
                  </div>
                )}
                <div className="agent-info-prompt-block">
                  <span>{t('terminal:agentInfo.classPrompt')}</span>
                  {hasClassInstructions ? (
                    <pre>{classInstructions}</pre>
                  ) : (
                    <strong>{t('terminal:agentInfo.none')}</strong>
                  )}
                </div>
                <div className="agent-info-prompt-block">
                  <span>{t('terminal:agentInfo.agentPrompt')}</span>
                  {hasAgentInstructions ? (
                    <pre>{agentInstructions}</pre>
                  ) : (
                    <strong>{t('terminal:agentInfo.none')}</strong>
                  )}
                </div>
              </div>
            </section>

            <section className="agent-info-section">
              <h4>{t('terminal:agentInfo.skills', { count: skills.length })}</h4>
              {skills.length === 0 ? (
                <div className="agent-info-empty">{t('terminal:agentInfo.noSkills')}</div>
              ) : (
                <div className="agent-info-skills">
                  {skills.map((skill) => (
                    <div key={skill.id} className="agent-info-skill">
                      <div className="agent-info-skill-name">{skill.name}</div>
                      <div className="agent-info-skill-desc">{skill.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="agent-info-section">
              <h4>{t('terminal:agentInfo.diagnostics')}</h4>
              <div className="agent-info-grid">
                <div className="agent-info-item"><span>{t('terminal:agentInfo.context')}</span><strong>{usedTokens.toLocaleString()} / {contextWindow.toLocaleString()} ({usedPercent}%)</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.tasksSent')}</span><strong>{agent.taskCount}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.workingDir')}</span><strong>{agent.cwd}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.lastActivity')}</span><strong>{formatDateTime(agent.lastActivity)}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.created')}</span><strong>{formatDateTime(agent.createdAt)}</strong></div>
                <div className="agent-info-item"><span>{t('terminal:agentInfo.detached')}</span><strong>{agent.isDetached ? t('terminal:agentInfo.yes') : t('terminal:agentInfo.no')}</strong></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
