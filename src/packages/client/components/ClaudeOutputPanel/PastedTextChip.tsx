/**
 * PastedTextChip - Clickable chip component for displaying pasted text placeholders
 *
 * Shows a compact chip that can be clicked to view the full pasted content in a modal.
 */

import React, { useState } from 'react';
import { useModalClose } from '../../hooks';

interface PastedTextChipProps {
  id: number;
  lineCount: number;
  fullText: string;
  onRemove: () => void;
}

export function PastedTextChip({ id, lineCount, fullText, onRemove }: PastedTextChipProps) {
  const [showModal, setShowModal] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(true);
  };

  return (
    <>
      <span
        className="pasted-text-chip"
        onClick={handleClick}
        title="Click to view full content"
      >
        <span className="pasted-text-chip-icon">📋</span>
        <span className="pasted-text-chip-label">Pasted #{id}</span>
        <span className="pasted-text-chip-count">+{lineCount} lines</span>
        <button
          className="pasted-text-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove"
        >
          ×
        </button>
      </span>

      {showModal && (
        <PastedTextModal
          id={id}
          lineCount={lineCount}
          content={fullText}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

interface PastedTextModalProps {
  id: number;
  lineCount: number;
  content: string;
  onClose: () => void;
}

function PastedTextModal({ id, lineCount, content, onClose }: PastedTextModalProps) {
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div
      className="modal-overlay visible pasted-text-modal-overlay"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div className="modal pasted-text-modal">
        <div className="pasted-text-modal-header">
          <div className="pasted-text-modal-title">
            <span className="pasted-text-modal-icon">📋</span>
            <span>Pasted Text #{id}</span>
            <span className="pasted-text-modal-count">{lineCount} lines</span>
          </div>
          <div className="pasted-text-modal-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleCopy}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button className="pasted-text-modal-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="pasted-text-modal-body">
          <pre className="pasted-text-content">{content}</pre>
        </div>
      </div>
    </div>
  );
}
