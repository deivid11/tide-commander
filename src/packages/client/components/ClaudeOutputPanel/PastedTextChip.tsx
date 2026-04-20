/**
 * PastedTextChip - Clickable chip component for displaying pasted text placeholders
 *
 * Shows a compact chip that can be clicked to view the full pasted content in a modal.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalClose } from '../../hooks';
import { Icon } from '../Icon';

interface PastedTextChipProps {
  id: number;
  lineCount: number;
  fullText: string;
  onRemove: () => void;
}

export function PastedTextChip({ id, lineCount, fullText, onRemove }: PastedTextChipProps) {
  const { t } = useTranslation(['tools', 'common']);
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
        title={t('tools:pastedText.clickToView')}
      >
        <span className="pasted-text-chip-icon"><Icon name="clipboard" size={12} /></span>
        <span className="pasted-text-chip-label">{t('tools:pastedText.pastedNumber', { id })}</span>
        <span className="pasted-text-chip-count">{t('tools:pastedText.lineCount', { count: lineCount })}</span>
        <button
          className="pasted-text-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={t('common:buttons.remove')}
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
  const { t } = useTranslation(['tools', 'common']);
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
            <span className="pasted-text-modal-icon"><Icon name="clipboard" size={14} /></span>
            <span>{t('tools:pastedText.pastedTextTitle', { id })}</span>
            <span className="pasted-text-modal-count">{t('tools:pastedText.lineCountFull', { count: lineCount })}</span>
          </div>
          <div className="pasted-text-modal-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleCopy}
            >
              {copied ? <><Icon name="check" size={12} /> {t('common:toast.copied')}</> : t('common:buttons.copy')}
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
