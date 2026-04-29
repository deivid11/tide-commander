import type { ClientMessage } from '../../../shared/types.js';
import { agentService } from '../../services/index.js';
import { logger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';
import { publishNotification } from '../../integrations/whatsapp/whatsapp-notification-publisher.js';
import type { WhatsAppNotificationEventType } from '../../services/whatsapp-notification-config-service.js';

const log = logger.ws;

type SendNotificationPayload = Extract<ClientMessage, { type: 'send_notification' }>['payload'];

export function handleSendNotification(
  ctx: HandlerContext,
  payload: SendNotificationPayload
): void {
  const { agentId, title, message, iconUrl, imageUrl } = payload;
  const agent = agentService.getAgent(agentId);

  if (!agent) {
    log.error(`[Notification] Agent not found: ${agentId}`);
    return;
  }

  const notification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    agentId,
    agentName: agent.name,
    agentClass: agent.class,
    title,
    message,
    timestamp: Date.now(),
    ...(iconUrl ? { iconUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };

  log.log(`[Notification] Agent ${agent.name} sent notification: "${title}"`);
  ctx.broadcast({
    type: 'agent_notification',
    payload: notification,
  });

  void publishNotification(
    classifyNotificationEventType(title),
    `${agent.name}: ${title}`,
    message,
  ).catch((err) => log.warn(`WhatsApp publish skipped: ${err}`));
}

function classifyNotificationEventType(title: string): WhatsAppNotificationEventType {
  const t = title.toLowerCase();
  if (t.includes('plan ready') || t.includes('plan')) return 'planReady';
  if (t.includes('error') || t.includes('failed') || t.includes('blocked')) return 'errors';
  if (t.includes('task complete') || t.includes('completed') || t.includes('done')) return 'taskComplete';
  return 'messages';
}
