import { getAuthToken, getApiBaseUrl } from '../utils/storage';
import type {
  WhatsAppChatsResponse,
  WhatsAppMessagesResponse,
  WhatsAppMessagesQuery,
} from '../../shared/whatsapp-types';

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function parseError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (data && typeof data.error === 'string') return data.error;
    if (data && typeof data.message === 'string') return data.message;
  } catch {
    /* ignore parse errors */
  }
  return `${fallback}: ${response.statusText}`;
}

export async function fetchWhatsAppChats(sessionId: string): Promise<WhatsAppChatsResponse> {
  const url = `${getApiBaseUrl()}/api/whatsapp/chats/${encodeURIComponent(sessionId)}`;
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to fetch WhatsApp chats'));
  }
  return response.json();
}

export async function fetchWhatsAppMessages(
  sessionId: string,
  chatId: string,
  query: WhatsAppMessagesQuery = {},
): Promise<WhatsAppMessagesResponse> {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (query.direction) params.set('direction', query.direction);
  if (query.type) params.set('type', query.type);

  const qs = params.toString();
  const url = `${getApiBaseUrl()}/api/whatsapp/chats/${encodeURIComponent(sessionId)}/${encodeURIComponent(chatId)}/messages${qs ? `?${qs}` : ''}`;
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to fetch WhatsApp messages'));
  }
  return response.json();
}
