/**
 * AgentResponseModal
 *
 * Modal component that displays a specific agent response as plain
 * markdown source text. Allows users to view and copy the raw markdown.
 */

import React, { useCallback } from 'react';
import type { Agent } from '../../../shared/types';
import { useModalClose } from '../../hooks';
import { ModalPortal } from '../shared/ModalPortal';

interface AgentResponseModalProps {
  agent: Agent;
  content: string;
  isOpen: boolean;
  onClose: () => void;
}

export function AgentResponseModal({
  agent,
  content,
  isOpen,
  onClose,
}: AgentResponseModalProps) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
  }, [content]);

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="modal agent-response-modal">
        <div className="modal-header agent-response-modal-header">
          <div className="agent-response-modal-title">
            <span className="agent-response-modal-icon">📝</span>
            <span>{agent.name} - Raw Markdown</span>
          </div>
          <button
            className="agent-response-modal-close"
            onClick={onClose}
            title="Close (Esc)"
          >
            &times;
          </button>
        </div>

        <div className="modal-body agent-response-modal-body">
          {content ? (
            <pre className="agent-response-raw">{content}</pre>
          ) : (
            <div className="agent-response-empty">
              <span className="agent-response-empty-icon">📭</span>
              <span>No response content available.</span>
            </div>
          )}
        </div>

        <div className="modal-footer agent-response-modal-footer">
          <button className="btn btn-primary" onClick={handleCopy}>
            Copy
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
