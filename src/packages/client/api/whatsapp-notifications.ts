/**
 * WhatsApp Notifications API Client
 * Wraps /api/whatsapp/notification-config for the per-event-type toggle UI.
 */

import { getAuthToken, getApiBaseUrl } from '../utils/storage';

export type WhatsAppNotificationEventType =
  | 'messages'
  | 'statusChanges'
  | 'taskComplete'
  | 'errors'
  | 'planReady'
  | 'agentSpawned'
  | 'agentStopped';

export const WHATSAPP_NOTIFICATION_EVENT_TYPES: WhatsAppNotificationEventType[] = [
  'messages',
  'statusChanges',
  'taskComplete',
  'errors',
  'planReady',
  'agentSpawned',
  'agentStopped',
];

export type WhatsAppNotificationFilter = Record<WhatsAppNotificationEventType, boolean>;

export interface WhatsAppNotificationConfig {
  filter: WhatsAppNotificationFilter;
  recipient: string;
  updatedAt: number;
  version: string;
}

function authHeaders(json = false): HeadersInit {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function parseError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (data && typeof data.error === 'string') return data.error;
    if (data && typeof data.message === 'string') return data.message;
  } catch {
    /* ignore */
  }
  return `${fallback}: ${response.statusText}`;
}

export async function fetchWhatsAppNotificationConfig(): Promise<WhatsAppNotificationConfig> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/notification-config`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to fetch WhatsApp notification config'));
  }
  return response.json();
}

export async function updateWhatsAppNotificationConfig(
  partial: { filter?: Partial<WhatsAppNotificationFilter>; recipient?: string },
): Promise<WhatsAppNotificationConfig> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/notification-config`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify(partial),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to update WhatsApp notification config'));
  }
  return response.json();
}

export async function clearWhatsAppNotificationConfig(): Promise<WhatsAppNotificationConfig> {
  const response = await fetch(`${getApiBaseUrl()}/api/whatsapp/notification-config`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, 'Failed to reset WhatsApp notification config'));
  }
  return response.json();
}
