import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from '../shared/ModalPortal';
import { Icon } from '../Icon';
import { ChatList } from './ChatList';
import { ChatMessages } from './ChatMessages';
import type { DirectionFilter, TypeFilter } from './ChatFilters';
import type { WhatsAppChatSummary, WhatsAppMessagesQuery } from '../../../shared/whatsapp-types';
import type { WhatsAppMessageEvent } from '../../../shared/event-types';
import { fetchWhatsAppChats, fetchWhatsAppMessages } from '../../api/whatsapp-history';
import { listWhatsAppSessions, fetchWhatsAppConfig, type WhatsAppSession } from '../../api/whatsapp-settings';
import '../../styles/components/whatsapp-history.scss';

const PAGE_SIZE = 50;

export interface WhatsAppHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WhatsAppHistoryPanel({ isOpen, onClose }: WhatsAppHistoryPanelProps) {
  const { t } = useTranslation(['config']);

  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [chats, setChats] = useState<WhatsAppChatSummary[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatsError, setChatsError] = useState<string | null>(null);

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessageEvent[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesLoadingMore, setMessagesLoadingMore] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');

  const [now, setNow] = useState(() => Date.now());
  const messagesRequestRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    (async () => {
      try {
        setSessionsError(null);
        const [list, config] = await Promise.all([
          listWhatsAppSessions().catch(() => [] as WhatsAppSession[]),
          fetchWhatsAppConfig().catch(() => null),
        ]);
        if (cancelled) return;
        setSessions(list);
        const fallback = config?.defaultSessionId || list[0]?.id || null;
        setSessionId((prev) => prev ?? fallback);
      } catch (err) {
        if (cancelled) return;
        setSessionsError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen]);

  const loadChats = useCallback(async (sid: string) => {
    setChatsLoading(true);
    setChatsError(null);
    try {
      const res = await fetchWhatsAppChats(sid);
      setChats(res.chats);
    } catch (err) {
      setChatsError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !sessionId) return;
    setSelectedChatId(null);
    setMessages([]);
    setNextCursor(null);
    void loadChats(sessionId);
  }, [isOpen, sessionId, loadChats]);

  const filterQuery = useMemo<WhatsAppMessagesQuery>(() => {
    const q: WhatsAppMessagesQuery = { limit: PAGE_SIZE };
    if (direction !== 'all') q.direction = direction;
    if (type !== 'all') q.type = type;
    return q;
  }, [direction, type]);

  const loadInitialMessages = useCallback(async (sid: string, chatId: string, query: WhatsAppMessagesQuery) => {
    const reqId = ++messagesRequestRef.current;
    setMessagesLoading(true);
    setMessagesError(null);
    setMessages([]);
    setNextCursor(null);
    try {
      const res = await fetchWhatsAppMessages(sid, chatId, query);
      if (reqId !== messagesRequestRef.current) return;
      setMessages([...res.messages].reverse());
      setNextCursor(res.nextCursor);
    } catch (err) {
      if (reqId !== messagesRequestRef.current) return;
      setMessagesError(err instanceof Error ? err.message : String(err));
    } finally {
      if (reqId === messagesRequestRef.current) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !sessionId || !selectedChatId) return;
    void loadInitialMessages(sessionId, selectedChatId, filterQuery);
  }, [isOpen, sessionId, selectedChatId, filterQuery, loadInitialMessages]);

  const loadMore = useCallback(async () => {
    if (!sessionId || !selectedChatId || !nextCursor) return;
    setMessagesLoadingMore(true);
    setMessagesError(null);
    try {
      const res = await fetchWhatsAppMessages(sessionId, selectedChatId, {
        ...filterQuery,
        cursor: nextCursor,
      });
      setMessages((prev) => [...[...res.messages].reverse(), ...prev]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : String(err));
    } finally {
      setMessagesLoadingMore(false);
    }
  }, [sessionId, selectedChatId, nextCursor, filterQuery]);

  const refreshChats = useCallback(() => {
    if (!sessionId) return;
    void loadChats(sessionId);
  }, [sessionId, loadChats]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onClick={onClose}>
        <div
          className="whatsapp-history-modal"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <div className="modal-header">
            <h2>{t('config:whatsappHistory.title')}</h2>
            <div className="whatsapp-history-modal__session">
              <label>
                <span>{t('config:whatsappHistory.session')}</span>
                <select
                  value={sessionId ?? ''}
                  onChange={(e) => setSessionId(e.target.value || null)}
                  disabled={sessions.length === 0}
                >
                  {sessions.length === 0 && <option value="">{t('config:whatsappHistory.noSessions')}</option>}
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>{s.id}{s.pairedNumber ? ` (${s.pairedNumber})` : ''}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>

          {sessionsError && (
            <div className="whatsapp-history-modal__alert">{sessionsError}</div>
          )}

          <div className="whatsapp-history-modal__body">
            <ChatList
              chats={chats}
              selectedChatId={selectedChatId}
              loading={chatsLoading}
              error={chatsError}
              onSelect={setSelectedChatId}
              onRefresh={refreshChats}
              now={now}
            />
            <ChatMessages
              chatId={selectedChatId}
              messages={messages}
              loading={messagesLoading}
              loadingMore={messagesLoadingMore}
              error={messagesError}
              hasMore={nextCursor !== null}
              direction={direction}
              type={type}
              onDirectionChange={setDirection}
              onTypeChange={setType}
              onLoadMore={loadMore}
            />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
