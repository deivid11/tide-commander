/**
 * TerminalModals - Modal components for the terminal panel
 *
 * Includes: ImageModal, BashModal, ContextConfirmModal
 */

import React from 'react';
import { store, useContextModalAgentId, useFileViewerPath, useFileViewerEditData, useAgents } from '../../store';
import { ContextViewModal } from '../ContextViewModal';
import { FileViewerModal } from '../FileViewerModal';
import { AgentResponseModal } from './AgentResponseModal';
import { ansiToHtml } from '../../utils/ansiToHtml';
import type { Agent } from '../../../shared/types';
import { useModalClose } from '../../hooks';

// Image modal props
export interface ImageModalProps {
  url: string;
  name: string;
  onClose: () => void;
}

export function ImageModal({ url, name, onClose }: ImageModalProps) {
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  return (
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
