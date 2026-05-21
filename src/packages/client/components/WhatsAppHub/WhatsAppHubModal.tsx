import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from '../shared/ModalPortal';
import { Icon } from '../Icon';
import '../../styles/components/whatsapp-hub-modal.scss';

export interface WhatsAppHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenConfig: () => void;
  onOpenNotifications: () => void;
  onOpenHistory: () => void;
}

export function WhatsAppHubModal({
  isOpen,
  onClose,
  onOpenConfig,
  onOpenNotifications,
  onOpenHistory,
}: WhatsAppHubModalProps) {
  const { t } = useTranslation(['config']);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const pick = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onClick={onClose}>
        <div className="whatsapp-hub-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>
              <span className="whatsapp-hub-modal__icon">📱</span>
              {t('config:whatsappHub.title', { defaultValue: 'WhatsApp' })}
            </h2>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="modal-body">
            <p className="whatsapp-hub-modal__intro">
              {t('config:whatsappHub.intro', { defaultValue: 'Pick what you want to manage for the WhatsApp integration.' })}
            </p>

            <div className="whatsapp-hub-modal__options">
              <button
                type="button"
                className="whatsapp-hub-modal__option"
                onClick={() => pick(onOpenConfig)}
              >
                <span className="whatsapp-hub-modal__option-icon"><Icon name="gear" size={18} /></span>
                <span className="whatsapp-hub-modal__option-text">
                  <span className="whatsapp-hub-modal__option-title">
                    {t('config:whatsappHub.config', { defaultValue: 'Integration config' })}
                  </span>
                  <span className="whatsapp-hub-modal__option-desc">
                    {t('config:whatsappHub.configDesc', { defaultValue: 'Server URL, API key, sessions and pairing.' })}
                  </span>
                </span>
              </button>

              <button
                type="button"
                className="whatsapp-hub-modal__option"
                onClick={() => pick(onOpenNotifications)}
              >
                <span className="whatsapp-hub-modal__option-icon"><Icon name="bell" size={18} /></span>
                <span className="whatsapp-hub-modal__option-text">
                  <span className="whatsapp-hub-modal__option-title">
                    {t('config:whatsappHub.notifications', { defaultValue: 'Notifications' })}
                  </span>
                  <span className="whatsapp-hub-modal__option-desc">
                    {t('config:whatsappHub.notificationsDesc', { defaultValue: 'Which agent events get forwarded and to whom.' })}
                  </span>
                </span>
              </button>

              <button
                type="button"
                className="whatsapp-hub-modal__option"
                onClick={() => pick(onOpenHistory)}
              >
                <span className="whatsapp-hub-modal__option-icon"><Icon name="hourglass" size={18} /></span>
                <span className="whatsapp-hub-modal__option-text">
                  <span className="whatsapp-hub-modal__option-title">
                    {t('config:whatsappHub.history', { defaultValue: 'History' })}
                  </span>
                  <span className="whatsapp-hub-modal__option-desc">
                    {t('config:whatsappHub.historyDesc', { defaultValue: 'Browse persisted chats and messages.' })}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
