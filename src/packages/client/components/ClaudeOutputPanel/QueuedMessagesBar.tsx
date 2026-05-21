import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from '../shared/ModalPortal';
import { Tooltip } from '../shared/Tooltip';
import { Icon } from '../Icon';
import type { QueuedMessage } from '../../hooks/useMessageQueue';

interface QueuedMessagesBarProps {
  queue: QueuedMessage[];
  isWorking: boolean;
  onShow?: (id: string) => void;
  onEnforce: (id: string) => void;
  onDelete: (id: string) => void;
}

const PILL_TRUNCATE = 40;

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1).trimEnd() + '…';
}

export function QueuedMessagesBar({
  queue,
  isWorking,
  onEnforce,
  onDelete,
}: QueuedMessagesBarProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [shownId, setShownId] = useState<string | null>(null);

  useEffect(() => {
    if (shownId && !queue.find((m) => m.id === shownId)) {
      setShownId(null);
    }
  }, [queue, shownId]);

  if (queue.length === 0) return null;

  const shown = shownId ? queue.find((m) => m.id === shownId) ?? null : null;

  return (
    <>
      <div className={`queued-messages-bar ${isWorking ? 'is-working' : 'is-idle'}`}>
        <span className="queued-messages-bar__label" title={t('terminal:queue.tooltip', { count: queue.length, defaultValue: `${queue.length} message(s) queued — will send when agent is idle` })}>
          <span className="queued-messages-bar__indicator" />
          <span className="queued-messages-bar__count">{queue.length}</span>
          <span className="queued-messages-bar__hint">{t('terminal:queue.queued', { defaultValue: 'queued' })}</span>
        </span>
        <div className="queued-messages-bar__pills">
          {queue.map((msg) => {
            const preview = truncate(msg.text, PILL_TRUNCATE);
            return (
              <Tooltip key={msg.id} content={msg.text} position="top" maxWidth={420} delay={200}>
                <div className={`queued-pill ${msg.error ? 'has-error' : ''}`}>
                  {msg.error && (
                    <span className="queued-pill__error" title={msg.error}>⚠️</span>
                  )}
                  <span className="queued-pill__icon">📨</span>
                  <span className="queued-pill__text" onClick={() => setShownId(msg.id)} role="button">
                    {preview}
                  </span>
                  <button
                    type="button"
                    className="queued-pill__action queued-pill__action--show"
                    title={t('terminal:queue.show', { defaultValue: 'Show' })}
                    onClick={(e) => { e.stopPropagation(); setShownId(msg.id); }}
                  >
                    <Icon name="eye" size={11} />
                  </button>
                  <button
                    type="button"
                    className="queued-pill__action queued-pill__action--enforce"
                    title={t('terminal:queue.enforce', { defaultValue: 'Send now' })}
                    onClick={(e) => { e.stopPropagation(); onEnforce(msg.id); }}
                  >
                    🚀
                  </button>
                  <button
                    type="button"
                    className="queued-pill__action queued-pill__action--delete"
                    title={t('terminal:queue.delete', { defaultValue: 'Delete' })}
                    onClick={(e) => { e.stopPropagation(); onDelete(msg.id); }}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {shown && (
        <ModalPortal>
          <div className="modal-overlay visible" onClick={() => setShownId(null)}>
            <div className="queued-message-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{t('terminal:queue.modal.title', { defaultValue: 'Queued message' })}</h2>
                <button className="modal-close" onClick={() => setShownId(null)} aria-label="Close">
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="modal-body">
                <pre className="queued-message-modal__text">{shown.text}</pre>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShownId(null)}
                >
                  {t('common:buttons.close', { defaultValue: 'Close' })}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { onEnforce(shown.id); setShownId(null); }}
                >
                  {t('terminal:queue.enforce', { defaultValue: 'Send now' })}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
