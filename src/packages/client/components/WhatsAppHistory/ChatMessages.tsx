import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { WhatsAppMessageEvent } from '../../../shared/event-types';
import { MessageBubble } from './MessageBubble';
import { ChatFilters, type DirectionFilter, type TypeFilter } from './ChatFilters';
import { formatChatId } from './format';

const AUTO_LOAD_THRESHOLD_PX = 80;

interface ChatMessagesProps {
  chatId: string | null;
  messages: WhatsAppMessageEvent[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  direction: DirectionFilter;
  type: TypeFilter;
  onDirectionChange: (next: DirectionFilter) => void;
  onTypeChange: (next: TypeFilter) => void;
  onLoadMore: () => void;
}

export function ChatMessages({
  chatId,
  messages,
  loading,
  loadingMore,
  error,
  hasMore,
  direction,
  type,
  onDirectionChange,
  onTypeChange,
  onLoadMore,
}: ChatMessagesProps) {
  const { t } = useTranslation(['config']);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastChatIdRef = useRef<string | null>(null);
  const initialScrolledRef = useRef(false);
  const prependAnchorRef = useRef<number | null>(null);

  // Reset the "first scroll-to-bottom done" flag whenever chat changes.
  useEffect(() => {
    if (lastChatIdRef.current !== chatId) {
      lastChatIdRef.current = chatId;
      initialScrolledRef.current = false;
    }
  }, [chatId]);

  // After messages first arrive for a chat, scroll to the bottom (newest).
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    if (initialScrolledRef.current) return;
    if (messages.length === 0) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    initialScrolledRef.current = true;
  }, [chatId, messages.length]);

  // When older messages are prepended via Load-more, preserve the visual
  // anchor so the viewport doesn't jump.
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    if (prependAnchorRef.current === null) return;
    const diff = scrollRef.current.scrollHeight - prependAnchorRef.current;
    prependAnchorRef.current = null;
    if (diff > 0) scrollRef.current.scrollTop += diff;
  }, [messages.length]);

  const triggerLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    if (scrollRef.current) {
      prependAnchorRef.current = scrollRef.current.scrollHeight;
    }
    onLoadMore();
  }, [hasMore, loadingMore, loading, onLoadMore]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!initialScrolledRef.current) return;
    const el = e.currentTarget;
    if (el.scrollTop <= AUTO_LOAD_THRESHOLD_PX) triggerLoadMore();
  }, [triggerLoadMore]);

  if (!chatId) {
    return (
      <div className="whatsapp-history-messages whatsapp-history-messages--empty">
        <div className="whatsapp-history-messages__placeholder">
          {t('config:whatsappHistory.selectChat')}
        </div>
      </div>
    );
  }

  return (
    <div className="whatsapp-history-messages">
      <div className="whatsapp-history-messages__header">
        <div className="whatsapp-history-messages__title">{formatChatId(chatId)}</div>
        <ChatFilters
          direction={direction}
          type={type}
          onDirectionChange={onDirectionChange}
          onTypeChange={onTypeChange}
          disabled={loading}
        />
      </div>

      <div
        className="whatsapp-history-messages__scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {hasMore && (
          <div className="whatsapp-history-messages__load-more-row">
            <button
              type="button"
              className="whatsapp-history-messages__load-more"
              onClick={triggerLoadMore}
              disabled={loadingMore || loading}
            >
              {loadingMore
                ? t('config:whatsappHistory.loadingOlder')
                : t('config:whatsappHistory.loadOlder')}
            </button>
          </div>
        )}

        {error && (
          <div className="whatsapp-history-messages__error">{error}</div>
        )}

        {loading && messages.length === 0 && (
          <div className="whatsapp-history-messages__loading">
            <span className="spinner" />
            <span>{t('config:whatsappHistory.loadingMessages')}</span>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="whatsapp-history-messages__empty">
            {t('config:whatsappHistory.emptyMessages')}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={messageKey(msg)} message={msg} />
        ))}
      </div>
    </div>
  );
}

function messageKey(msg: WhatsAppMessageEvent): string {
  if (typeof msg.id === 'number') return `id:${msg.id}`;
  if (msg.messageId) return `mid:${msg.messageId}`;
  return `t:${msg.timestamp}:${msg.fromJid}:${(msg.body ?? '').slice(0, 16)}`;
}
