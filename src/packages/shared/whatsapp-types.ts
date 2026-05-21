import type { MessageDirection } from './event-types';
import type { WhatsAppMessageEvent, WhatsAppMessageType } from './event-types';

export interface WhatsAppChatSummary {
  chatId: string;
  lastTimestamp: number;
  lastMessagePreview: string;
  lastMessageType: WhatsAppMessageType;
  lastDirection: MessageDirection;
  messageCount: number;
  unreadCount: number;
}

export interface WhatsAppChatsResponse {
  chats: WhatsAppChatSummary[];
}

export interface WhatsAppMessagesResponse {
  messages: WhatsAppMessageEvent[];
  nextCursor: string | null;
}

export interface WhatsAppMessagesQuery {
  cursor?: string;
  limit?: number;
  direction?: MessageDirection;
  type?: WhatsAppMessageType;
}
