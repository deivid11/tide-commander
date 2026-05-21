import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WhatsAppChatSummary } from '../../../shared/whatsapp-types';
import { formatChatId, formatRelativeTime, messageTypeIcon, truncate } from './format';

interface ChatListProps {
  chats: WhatsAppChatSummary[];
  selectedChatId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (chatId: string) => void;
  onRefresh: () => void;
  now: number;
}

export function ChatList({
  chats,
  selectedChatId,
  loading,
  error,
  onSelect,
  onRefresh,
  now,
}: ChatListProps) {
  const { t } = useTranslation(['config', 'common']);

  return (
    <div className="whatsapp-history-chatlist">
      <div className="whatsapp-history-chatlist__header">
        <span className="whatsapp-history-chatlist__title">
          {t('config:whatsappHistory.chats')}
        </span>
        <button
          type="button"
          className="whatsapp-history-chatlist__refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label={t('config:whatsappHistory.refresh')}
          title={t('config:whatsappHistory.refresh')}
        >
          ⟳
        </button>
      </div>

      {error && (
        <div className="whatsapp-history-chatlist__error">{error}</div>
      )}

      {loading && chats.length === 0 && (
        <div className="whatsapp-history-chatlist__loading">
          <span className="spinner" />
          <span>{t('config:whatsappHistory.loadingChats')}</span>
        </div>
      )}

      {!loading && !error && chats.length === 0 && (
        <div className="whatsapp-history-chatlist__empty">
          {t('config:whatsappHistory.emptyChats')}
        </div>
      )}

      <ul className="whatsapp-history-chatlist__items">
        {chats.map((chat) => {
          const icon = messageTypeIcon(chat.lastMessageType);
          const previewBase = chat.lastMessagePreview || `[${chat.lastMessageType}]`;
          const isSelected = chat.chatId === selectedChatId;
          return (
            <li
              key={chat.chatId}
              className={`whatsapp-history-chatlist__item ${isSelected ? 'is-selected' : ''}`}
            >
              <button
                type="button"
                className="whatsapp-history-chatlist__button"
                onClick={() => onSelect(chat.chatId)}
              >
                <div className="whatsapp-history-chatlist__row">
                  <span className="whatsapp-history-chatlist__name">
                    {formatChatId(chat.chatId)}
                  </span>
                  <span className="whatsapp-history-chatlist__time">
                    {formatRelativeTime(chat.lastTimestamp, now)}
                  </span>
                </div>
                <div className="whatsapp-history-chatlist__row whatsapp-history-chatlist__row--secondary">
                  <span className="whatsapp-history-chatlist__preview">
                    {chat.lastDirection === 'outbound' && (
                      <span className="whatsapp-history-chatlist__direction">↗ </span>
                    )}
                    {icon && <span className="whatsapp-history-chatlist__preview-icon">{icon} </span>}
                    {truncate(previewBase, 40)}
                  </span>
                  {chat.unreadCount > 0 && (
                    <span className="whatsapp-history-chatlist__unread">{chat.unreadCount}</span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
