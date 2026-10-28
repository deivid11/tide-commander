/**
 * Agent notifications raised by the server itself (not by an agent's curl to
 * POST /api/notify): same payload, same fan-out — WebSocket broadcast to every
 * client, WhatsApp publisher, native push. The HTTP route delegates here so
 * both paths stay identical.
 *
 * First server-side user (2026-10-27): a resumed Claude session whose
 * transcript was deleted. Before that the agent went idle in silence.
 */

import * as agentService from './agent-service.js';
import { createLogger, generateId } from '../utils/index.js';
import type { AgentNotification, ServerMessage } from '../../shared/types.js';
import { publishNotification } from '../integrations/whatsapp/whatsapp-notification-publisher.js';
import type { WhatsAppNotificationEventType } from './whatsapp-notification-config-service.js';
import { sendAgentPush } from './push-service.js';

const log = createLogger('AgentNotifications');

let broadcastFn: ((message: ServerMessage) => void) | null = null;

/** Set once by the websocket layer; until then notifications are only logged. */
export function setAgentNotificationBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

export interface NotifyAgentOptions {
  iconUrl?: string;
  imageUrl?: string;
}

/**
 * Build, broadcast and fan out a notification on behalf of an agent. Returns
 * null when the agent does not exist (nothing was sent).
 */
export function notifyAgent(
  agentId: string,
  title: string,
  message: string,
  opts: NotifyAgentOptions = {},
): AgentNotification | null {
  const agent = agentService.getAgent(agentId);
  if (!agent) {
    log.warn(`Notification for unknown agent ${agentId} dropped: "${title}"`);
    return null;
  }

  const notification: AgentNotification = {
    id: generateId(),
    agentId: agent.id,
    agentName: agent.name,
    agentClass: agent.class,
    title,
    message,
    timestamp: Date.now(),
    ...(opts.iconUrl ? { iconUrl: opts.iconUrl } : {}),
    ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
  };

  log.log(`Notification from ${agent.name}: "${title}" - ${message}`);

  if (broadcastFn) {
    broadcastFn({
      type: 'agent_notification',
      payload: notification,
    } as ServerMessage);
  } else {
    log.warn('Broadcast function not set - notification not sent to clients');
  }

  void publishNotification(
    classifyNotificationEventType(title),
    `${agent.name}: ${title}`,
    message,
  ).catch((err) => log.warn(`WhatsApp publish skipped: ${err}`));

  // Native push: reaches phones whose app is closed (and whose battery-hungry
  // WebSocket foreground service is therefore off). No-op until a Firebase
  // service account is installed — see services/push-service.ts.
  void sendAgentPush(notification).catch((err) => log.warn(`Push delivery skipped: ${err}`));

  return notification;
}

export function classifyNotificationEventType(title: string): WhatsAppNotificationEventType {
  const t = title.toLowerCase();
  if (t.includes('plan ready') || t.includes('plan')) return 'planReady';
  if (t.includes('error') || t.includes('failed') || t.includes('blocked') || t.includes('lost')) return 'errors';
  if (t.includes('task complete') || t.includes('completed') || t.includes('done')) return 'taskComplete';
  return 'messages';
}
