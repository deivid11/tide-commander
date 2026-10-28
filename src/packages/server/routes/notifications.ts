/**
 * Notification Routes
 * REST API endpoints for agent notifications
 *
 * Agents can send notifications to users via HTTP POST requests.
 * This allows agents to notify users of important events without
 * requiring WebSocket communication. The fan-out itself lives in
 * services/agent-notifications.ts so the server can raise the same
 * notifications on its own (lost sessions, crashes).
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/index.js';
import type { ServerMessage } from '../../shared/types.js';
import { notifyAgent, setAgentNotificationBroadcast } from '../services/agent-notifications.js';

const log = createLogger('Notifications');

const router = Router();

/**
 * Set the broadcast function for sending notifications to all clients
 */
export function setBroadcast(fn: (message: ServerMessage) => void): void {
  setAgentNotificationBroadcast(fn);
}

/**
 * POST /api/notify - Send a notification from an agent
 *
 * Body:
 * - agentId: string (required) - The ID of the agent sending the notification
 * - title: string (required) - Notification title
 * - message: string (required) - Notification message
 * - iconUrl: string (optional) - PNG URL for the large/round icon on Android
 * - imageUrl: string (optional) - PNG URL for the expanded big-picture on Android
 *
 * This endpoint is designed to be called by agents via curl or similar tools.
 * The notification will be broadcast to all connected clients via WebSocket.
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { agentId, title, message, iconUrl, imageUrl } = req.body;

    if (!agentId || !title || !message) {
      res.status(400).json({
        error: 'Missing required fields: agentId, title, message'
      });
      return;
    }

    const notification = notifyAgent(agentId, title, message, {
      ...(typeof iconUrl === 'string' && iconUrl ? { iconUrl } : {}),
      ...(typeof imageUrl === 'string' && imageUrl ? { imageUrl } : {}),
    });
    if (!notification) {
      res.status(404).json({ error: `Agent not found: ${agentId}` });
      return;
    }

    res.status(200).json({
      success: true,
      notification
    });
  } catch (err: any) {
    log.error('Failed to send notification:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
