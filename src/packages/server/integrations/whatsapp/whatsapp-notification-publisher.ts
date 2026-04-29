/**
 * WhatsApp Notification Publisher
 * Forwards selected agent events to WhatsApp via the local Baileys server.
 *
 * Each call site passes an event type; the publisher consults the per-type
 * filter config (see whatsapp-notification-config-service) and skips silently
 * when the toggle is off, when the WhatsApp integration is disabled, when the
 * API key is missing, or when no recipient JID is configured.
 */

import { WhatsAppClient } from './whatsapp-client.js';
import { loadConfig as loadWhatsAppConfig, WHATSAPP_API_KEY_SECRET } from './whatsapp-config.js';
import {
  getConfig as getNotificationConfig,
  type WhatsAppNotificationEventType,
} from '../../services/whatsapp-notification-config-service.js';
import { secretsService } from '../../services/secrets-service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('WhatsAppNotificationPublisher');

export interface PublishResult {
  sent: boolean;
  reason?: string;
}

export async function publishNotification(
  event: WhatsAppNotificationEventType,
  title: string,
  message: string,
): Promise<PublishResult> {
  const notifConfig = getNotificationConfig();
  if (notifConfig.filter[event] === false) {
    return { sent: false, reason: `event "${event}" disabled by filter` };
  }

  const recipient = notifConfig.recipient.trim();
  if (!recipient) {
    return { sent: false, reason: 'no recipient configured' };
  }

  const waConfig = loadWhatsAppConfig();
  if (!waConfig.enabled) {
    return { sent: false, reason: 'WhatsApp integration disabled' };
  }

  const apiKey = secretsService.getSecretByKey(WHATSAPP_API_KEY_SECRET)?.value;
  if (!apiKey) {
    return { sent: false, reason: 'WhatsApp API key not configured' };
  }

  const sessionId = waConfig.defaultSessionId;
  if (!sessionId) {
    return { sent: false, reason: 'no defaultSessionId configured' };
  }

  const body = title ? `*${title}*\n${message}` : message;

  try {
    const client = new WhatsAppClient(waConfig.baseUrl, apiKey);
    await client.sendMessage(sessionId, recipient, body);
    return { sent: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn(`WhatsApp publish failed (${event}): ${detail}`);
    return { sent: false, reason: detail };
  }
}
