/**
 * AgentResponseModal
 *
 * Modal component that displays a specific agent response as plain
 * markdown source text. Allows users to view and copy the raw markdown.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '../../../shared/types';
import { useModalClose } from '../../hooks';
import { ModalPortal } from '../shared/ModalPortal';
import { Icon } from '../Icon';

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
  const { t } = useTranslation(['tools', 'common', 'terminal']);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  }, [content]);

  useEffect(() => {
    if (copyStatus === 'idle') return;
    const id = setTimeout(() => setCopyStatus('idle'), 1500);
    return () => clearTimeout(id);
  }, [copyStatus]);

  useEffect(() => {
    if (!isOpen) setCopyStatus('idle');
  }, [isOpen]);

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="modal agent-response-modal">
        <div className="modal-header agent-response-modal-header">
          <div className="agent-response-modal-title">
            <span className="agent-response-modal-icon"><Icon name="edit" size={16} /></span>
            <span>{agent.name} - {t('terminal:modals.rawOutput')}</span>
          </div>
          <button
            className="agent-response-modal-close"
            onClick={onClose}
            title={t('common:buttons.close')}
          >
            &times;
          </button>
        </div>

        <div className="modal-body agent-response-modal-body">
          {content ? (
            <pre className="agent-response-raw">{content}</pre>
          ) : (
            <div className="agent-response-empty">
              <span className="agent-response-empty-icon"><Icon name="envelope" size={20} /></span>
              <span>{t('tools:response.noContent')}</span>
            </div>
          )}
        </div>

        <div className="modal-footer agent-response-modal-footer">
          <button
            className={`btn btn-primary agent-response-copy-btn agent-response-copy-btn--${copyStatus}`}
            onClick={handleCopy}
            disabled={!content}
          >
            <Icon
              name={copyStatus === 'copied' ? 'check' : copyStatus === 'error' ? 'cross' : 'copy'}
              size={14}
            />
            <span>
              {copyStatus === 'copied'
                ? t('common:buttons.copied', { defaultValue: 'Copied' })
                : copyStatus === 'error'
                  ? t('common:buttons.copyFailed', { defaultValue: 'Copy failed' })
                  : t('common:buttons.copy')}
            </span>
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common:buttons.close')}
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
