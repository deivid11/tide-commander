/**
 * TerminalModals - Modal components for the terminal panel
 *
 * Includes: ImageModal, BashModal, ContextConfirmModal
 */

import React from 'react';
import {
  store,
  useContextModalAgentId,
  useFileViewerPath,
  useFileViewerEditData,
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
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  return (
    <ModalPortal>
      <div className="bash-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="bash-modal">
          <div className="bash-modal-header">
            <span className="bash-modal-icon">$</span>
            <span className="bash-modal-title">Terminal Output</span>
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
    if (action === 'collapse') return 'Collapse Context';
    if (action === 'clear-subordinates') return 'Clear All Subordinates Context';
    return 'Clear Context';
  };

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="modal confirm-modal">
          <div className="modal-header">{getTitle()}</div>
          <div className="modal-body confirm-modal-body">
            {action === 'collapse' ? (
              <>
                <p>Collapse the conversation context?</p>
                <p className="confirm-modal-note">
                  This will summarize the conversation to save tokens while preserving important information.
                </p>
              </>
            ) : action === 'clear-subordinates' ? (
              <>
                <p>Clear context for all {subordinateCount} subordinate agent{subordinateCount !== 1 ? 's' : ''}?</p>
                <p className="confirm-modal-note">
                  This will start fresh sessions for all subordinate agents. All their conversation history will be lost.
                </p>
              </>
            ) : (
              <>
                <p>Clear all context for this agent?</p>
                <p className="confirm-modal-note">
                  This will start a fresh session on the next command. All conversation history will be lost.
                </p>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className={`btn ${action === 'clear' || action === 'clear-subordinates' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleConfirm}
              autoFocus
            >
              {action === 'collapse' ? 'Collapse' : action === 'clear-subordinates' ? 'Clear All' : 'Clear Context'}
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
          store.sendCommand(contextModalAgentId, '/context');
        }
      }}
    />
  );
}

// File viewer modal wrapper
export function FileViewerFromGuake() {
  const fileViewerPath = useFileViewerPath();
  const editData = useFileViewerEditData();

  if (!fileViewerPath) return null;

  return (
    <FileViewerModal
      isOpen={!!fileViewerPath}
      onClose={() => store.clearFileViewerPath()}
      filePath={fileViewerPath}
      action={editData ? 'modified' : 'read'}
      editData={editData || undefined}
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
              <span>{agent.name} Agent Info</span>
            </div>
            <button className="agent-info-modal-close" onClick={onClose}>×</button>
          </div>

          <div className="agent-info-modal-body">
            <section className="agent-info-section">
              <h4>Runtime</h4>
              <div className="agent-info-grid">
                <div className="agent-info-item"><span>Backend</span><strong>{agent.provider}</strong></div>
                <div className="agent-info-item"><span>Model</span><strong>{model}</strong></div>
                <div className="agent-info-item"><span>Status</span><strong>{agent.status}</strong></div>
                <div className="agent-info-item"><span>Class</span><strong>{agent.class}</strong></div>
                <div className="agent-info-item"><span>Permission</span><strong>{agent.permissionMode}</strong></div>
                <div className="agent-info-item"><span>Session</span><strong>{agent.sessionId || 'Not started'}</strong></div>
              </div>
            </section>

            <section className="agent-info-section">
              <h4>Prompt and Instructions</h4>
              <div className="agent-info-prompts">
                {showCombinedPrompt && (
                  <div className="agent-info-prompt-block">
                    <span>Custom prompt</span>
                    <pre>{combinedPrompt}</pre>
                  </div>
                )}
                {!hasCustomPrompt && (
                  <div className="agent-info-prompt-block">
                    <span>Custom prompt</span>
                    <strong className="warn">Not configured</strong>
                  </div>
                )}
                <div className="agent-info-prompt-block">
                  <span>Class prompt</span>
                  {hasClassInstructions ? (
                    <pre>{classInstructions}</pre>
                  ) : (
                    <strong>None</strong>
                  )}
                </div>
                <div className="agent-info-prompt-block">
                  <span>Agent prompt</span>
                  {hasAgentInstructions ? (
                    <pre>{agentInstructions}</pre>
                  ) : (
                    <strong>None</strong>
                  )}
                </div>
              </div>
            </section>

            <section className="agent-info-section">
              <h4>Skills ({skills.length})</h4>
              {skills.length === 0 ? (
                <div className="agent-info-empty">No enabled skills assigned</div>
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
              <h4>Diagnostics</h4>
              <div className="agent-info-grid">
                <div className="agent-info-item"><span>Context</span><strong>{usedTokens.toLocaleString()} / {contextWindow.toLocaleString()} ({usedPercent}%)</strong></div>
                <div className="agent-info-item"><span>Tasks sent</span><strong>{agent.taskCount}</strong></div>
                <div className="agent-info-item"><span>Working dir</span><strong>{agent.cwd}</strong></div>
                <div className="agent-info-item"><span>Last activity</span><strong>{formatDateTime(agent.lastActivity)}</strong></div>
                <div className="agent-info-item"><span>Created</span><strong>{formatDateTime(agent.createdAt)}</strong></div>
                <div className="agent-info-item"><span>Detached</span><strong>{agent.isDetached ? 'Yes' : 'No'}</strong></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
