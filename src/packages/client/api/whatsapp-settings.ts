/**
 * WhatsApp Settings API Client
 * Wraps /api/whatsapp/* endpoints for the local WhatsApp (Baileys) integration.
 */

import { getAuthToken, getApiBaseUrl } from '../utils/storage';

export interface WhatsAppConfig {
  enabled: boolean;
  baseUrl: string;
  defaultSessionId: string;
  webhookVerifyToken?: string;
  showIncomingToasts?: boolean;
}

export interface WhatsAppSession {
  id: string;
  status: string;
  pairedNumber?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface WhatsAppSessionStatus {
  id: string;
  status: string;
  pairedNumber?: string;
  qrAvailable?: boolean;
  updatedAt?: number;
}

export interface WhatsAppSessionQr {
  qr?: string;
  qrUrl?: string;
  status?: string;
}

export interface WhatsAppStatus {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  defaultSessionId: string;
  // Server reality: GET /api/whatsapp/status returns either a session array
  // (unconfigured / listSessions error path) or just the count number
  // (configured + listSessions success). Treat as an opaque summary value;
  // for the actual session list, call listWhatsAppSessions() instead.
  sessions: WhatsAppSession[] | number;
  error?: string;
}

function authHeaders(json = false): HeadersInit {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (json) {
    headers['Content-Type'] = 'application/json';
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

export async function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/status`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to fetch WhatsApp status'));
  }
  return response.json();
}

export async function fetchWhatsAppConfig(): Promise<WhatsAppConfig> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/config`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to fetch WhatsApp config'));
  }
  return response.json();
}

export async function updateWhatsAppConfig(partial: Partial<WhatsAppConfig>): Promise<WhatsAppConfig> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/config`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify(partial),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to update WhatsApp config'));
  }
  return response.json();
}

export async function setWhatsAppApiKey(apiKey: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/api-key`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to save WhatsApp API key'));
  }
}

export async function clearWhatsAppApiKey(): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/api-key`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to clear WhatsApp API key'));
  }
}

export async function listWhatsAppSessions(): Promise<WhatsAppSession[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/sessions`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to list WhatsApp sessions'));
  }
  const data = await response.json();
  return Array.isArray(data) ? data : (data.sessions ?? []);
}

export async function createWhatsAppSession(sessionId: string): Promise<WhatsAppSession> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/sessions`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to create WhatsApp session'));
  }
  return response.json();
}

export async function deleteWhatsAppSession(sessionId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to delete WhatsApp session'));
  }
}

export async function fetchWhatsAppSessionStatus(id: string): Promise<WhatsAppSessionStatus> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/sessions/${encodeURIComponent(id)}/status`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to fetch WhatsApp session status'));
  }
  return response.json();
}

export async function fetchWhatsAppSessionQr(id: string): Promise<WhatsAppSessionQr> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/sessions/${encodeURIComponent(id)}/qr`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to fetch WhatsApp session QR'));
  }
  return response.json();
}

export async function sendWhatsAppTestMessage(
  to: string,
  message: string,
  sessionId?: string,
): Promise<{ ok: boolean; messageId?: string }> {
  const body: Record<string, string> = { to, message };
  if (sessionId) body.sessionId = sessionId;
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/send-message`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to send WhatsApp message'));
  }
  return response.json();
}
