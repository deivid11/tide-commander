import type { WhatsAppMessageType } from '../../../shared/event-types';

export function formatChatId(chatId: string): string {
  const stripped = chatId.replace(/@.*$/, '');
  if (!/^\d{10,15}$/.test(stripped)) return chatId;
  if (stripped.startsWith('521') && stripped.length === 13) {
    return `+52 1 ${stripped.slice(3, 5)} ${stripped.slice(5, 9)} ${stripped.slice(9)}`;
  }
  if (stripped.startsWith('52') && stripped.length === 12) {
    return `+52 ${stripped.slice(2, 4)} ${stripped.slice(4, 8)} ${stripped.slice(8)}`;
  }
  if (stripped.startsWith('1') && stripped.length === 11) {
    return `+1 ${stripped.slice(1, 4)} ${stripped.slice(4, 7)} ${stripped.slice(7)}`;
  }
  return `+${stripped}`;
}

export function formatRelativeTime(epochSeconds: number, now = Date.now()): string {
  const ms = epochSeconds * 1000;
  const diffMs = now - ms;
  if (diffMs < 0) return formatAbsoluteDate(ms);

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;

  return formatAbsoluteDate(ms);
}

export function formatAbsoluteDate(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatBubbleTimestamp(epochSeconds: number): string {
  const ms = epochSeconds * 1000;
  const date = new Date(ms);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function messageTypeIcon(type: WhatsAppMessageType): string | null {
  switch (type) {
    case 'image':    return '📷';
    case 'audio':    return '🎤';
    case 'video':    return '📹';
    case 'document': return '📎';
    case 'location': return '📍';
    case 'contact':  return '👤';
    case 'sticker':  return '🌟';
    case 'reaction': return '👍';
    case 'unknown':  return '❓';
    case 'text':
    default:         return null;
  }
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}
