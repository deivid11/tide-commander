import type { ClientMessage } from '../../../shared/types.js';
import { agentService } from '../../services/index.js';
import { logger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

const log = logger.ws;

type SendNotificationPayload = Extract<ClientMessage, { type: 'send_notification' }>['payload'];

export function handleSendNotification(
  ctx: HandlerContext,
  payload: SendNotificationPayload
): void {
  const { agentId, title, message } = payload;
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
  };

  log.log(`[Notification] Agent ${agent.name} sent notification: "${title}"`);
  ctx.broadcast({
    type: 'agent_notification',
    payload: notification,
  });
}
