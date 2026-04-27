/**
 * WhatsAppMessageToast - In-app toast for inbound WhatsApp messages.
 *
 * Mirrors the AgentNotificationToast Provider pattern:
 *  - exposes `useWhatsAppMessage()` -> `showWhatsAppMessage(payload)`
 *  - the WS handler (`onWhatsAppMessage` callback) feeds it
 *  - filters: only `direction === 'inbound'` are toasted (outbound echoes are ignored)
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { WhatsAppMessagePayload } from '../websocket/callbacks';
import { fetchWhatsAppConfig } from '../api/whatsapp-settings';
import '../styles/components/whatsapp-message-toast.scss';

interface WhatsAppMessageContextType {
  showWhatsAppMessage: (payload: WhatsAppMessagePayload) => void;
}

const WhatsAppMessageContext = createContext<WhatsAppMessageContextType | null>(null);

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 8000;
const PREVIEW_MAX_CHARS = 140;
const COPY_RESET_MS = 1500;
const CONFIG_REVALIDATE_MS = 30_000;
const CONFIG_UPDATED_EVENT = 'tide:whatsapp-config-updated';

interface QueuedToast extends WhatsAppMessagePayload {
  toastId: string;
}

interface ToastProps {
  toast: QueuedToast;
  onDismiss: (id: string) => void;
}

function formatRelativeTime(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function mediaIcon(mediaType: WhatsAppMessagePayload['mediaType']): string {
  switch (mediaType) {
    case 'image': return '🖼';
    case 'video': return '🎬';
    case 'audio': return '🎙';
    case 'document': return '📄';
    case 'sticker': return '🩹';
    default: return '';
  }
}

// Strip the WhatsApp jid suffix and prefix a '+' on numeric local-parts.
// '5215532967210@s.whatsapp.net' -> '+5215532967210'
// '5215555555555@g.us'           -> '+5215555555555'
// 'someone@lid'                  -> 'someone'
function formatJid(from: string): string {
  if (!from) return '';
  const at = from.indexOf('@');
  const local = at >= 0 ? from.slice(0, at) : from;
  if (/^\d+$/.test(local)) return `+${local}`;
  return local;
}

function WhatsAppToastItem({ toast, onDismiss }: ToastProps) {
  const { t } = useTranslation(['config']);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  // Refresh relative time every 15s while visible
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const formattedPhone = formatJid(toast.from);
  const trimmedName = toast.fromName?.trim() ?? '';
  const hasName = trimmedName.length > 0 && trimmedName !== toast.from && trimmedName !== formattedPhone;
  const trimmedGroup = toast.groupName?.trim() ?? '';
  const hasGroup = toast.isGroup && trimmedGroup.length > 0;

  // Header: name (with optional group), or group, or formatted phone.
  // Subtitle: phone (with 'Unknown sender' prefix in the group-no-name case), or omitted.
  let headerPrimary: string;
  let headerGroupSuffix: string | null = null;
  let subtitle: string | null = null;
  if (hasName) {
    headerPrimary = trimmedName;
    headerGroupSuffix = hasGroup ? ` • ${trimmedGroup}` : null;
    subtitle = formattedPhone || null;
  } else if (hasGroup) {
    headerPrimary = trimmedGroup;
    subtitle = formattedPhone
      ? `${t('config:whatsapp.toast.unknownSender')} · ${formattedPhone}`
      : t('config:whatsapp.toast.unknownSender');
  } else {
    headerPrimary = formattedPhone || toast.from;
    subtitle = null;
  }

  const bodyPreview = truncate(toast.body || '', PREVIEW_MAX_CHARS);
  const mediaLabel = toast.mediaType ? `${mediaIcon(toast.mediaType)} ${t(`config:whatsapp.toast.mediaLabel.${toast.mediaType}`)}` : null;

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(toast.from).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_RESET_MS);
    }).catch(() => { /* ignore clipboard failures */ });
  }, [toast.from]);

  return (
    <div
      className="whatsapp-toast"
      onClick={() => onDismiss(toast.toastId)}
      role="alert"
    >
      <span className="whatsapp-toast-icon" aria-hidden="true">💬</span>
      <div className="whatsapp-toast-content">
        <div className="whatsapp-toast-header">
          <span className="whatsapp-toast-name" title={toast.from}>{headerPrimary}</span>
          {headerGroupSuffix && (
            <span className="whatsapp-toast-group">{headerGroupSuffix}</span>
          )}
          <span className="whatsapp-toast-time">{formatRelativeTime(toast.timestamp, now)}</span>
        </div>
        {subtitle && (
          <div className="whatsapp-toast-subtitle">{subtitle}</div>
        )}
        {bodyPreview && (
          <div className="whatsapp-toast-body">{bodyPreview}</div>
        )}
        <div className="whatsapp-toast-meta">
          {mediaLabel && <span className="whatsapp-toast-media">{mediaLabel}</span>}
          <button
            type="button"
            className={`whatsapp-toast-copy${copied ? ' copied' : ''}`}
            onClick={handleCopy}
            title={t('config:whatsapp.toast.copyFrom')}
          >
            {copied ? t('config:whatsapp.toast.copied') : t('config:whatsapp.toast.copyFrom')}
          </button>
        </div>
      </div>
      <button
        className="whatsapp-toast-close"
        onClick={(e) => { e.stopPropagation(); onDismiss(toast.toastId); }}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}

export function WhatsAppMessageProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<QueuedToast[]>([]);
  const timeoutRefs = useRef<Map<string, number>>(new Map());
  // Default to true so we don't silently swallow messages before the first
  // config fetch completes; flips to whatever the server says afterward.
  const showIncomingToastsRef = useRef<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetchWhatsAppConfig()
        .then((cfg) => {
          if (cancelled) return;
          showIncomingToastsRef.current = cfg.showIncomingToasts ?? true;
        })
        .catch(() => { /* keep prior value on transient errors */ });
    };

    refresh();
    const intervalId = window.setInterval(refresh, CONFIG_REVALIDATE_MS);
    const handleConfigUpdated = () => refresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener(CONFIG_UPDATED_EVENT, handleConfigUpdated);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener(CONFIG_UPDATED_EVENT, handleConfigUpdated);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((id) => clearTimeout(id));
      timeoutRefs.current.clear();
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.toastId !== id));
    const timeout = timeoutRefs.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutRefs.current.delete(id);
    }
  }, []);

  const showWhatsAppMessage = useCallback((payload: WhatsAppMessagePayload) => {
    if (payload.direction !== 'inbound') return;
    if (!showIncomingToastsRef.current) {
      console.debug('[WhatsApp] toast suppressed (showIncomingToasts=false):', payload.from, payload.body?.slice(0, 60));
      return;
    }

    const toastId = `wa-${payload.sessionId}-${payload.timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const next: QueuedToast = { ...payload, toastId };

    setToasts((prev) => {
      const list = [...prev, next];
      while (list.length > MAX_VISIBLE) {
        const removed = list.shift();
        if (removed) {
          const timeout = timeoutRefs.current.get(removed.toastId);
          if (timeout) {
            clearTimeout(timeout);
            timeoutRefs.current.delete(removed.toastId);
          }
        }
      }
      return list;
    });

    const timeout = window.setTimeout(() => removeToast(toastId), AUTO_DISMISS_MS);
    timeoutRefs.current.set(toastId, timeout);
  }, [removeToast]);

  return (
    <WhatsAppMessageContext.Provider value={{ showWhatsAppMessage }}>
      {children}
      <div id="whatsapp-toast-container">
        {toasts.map((toast) => (
          <WhatsAppToastItem
            key={toast.toastId}
            toast={toast}
            onDismiss={removeToast}
          />
        ))}
      </div>
    </WhatsAppMessageContext.Provider>
  );
}

export function useWhatsAppMessage(): WhatsAppMessageContextType {
  const ctx = useContext(WhatsAppMessageContext);
  if (!ctx) {
    throw new Error('useWhatsAppMessage must be used within WhatsAppMessageProvider');
  }
  return ctx;
}
