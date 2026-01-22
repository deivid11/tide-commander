/**
 * Notification Routes
 * REST API endpoints for agent notifications
 *
 * Agents can send notifications to users via HTTP POST requests.
 * This allows agents to notify users of important events without
 * requiring WebSocket communication.
 */

import { Router, Request, Response } from 'express';
import { agentService } from '../services/index.js';
import { createLogger, generateId } from '../utils/index.js';
import type { AgentNotification, ServerMessage } from '../../shared/types.js';

const log = createLogger('Notifications');

const router = Router();

// Store for broadcasting notifications via WebSocket
// This will be set by the WebSocket handler
let broadcastFn: ((message: ServerMessage) => void) | null = null;

/**
 * Set the broadcast function for sending notifications to all clients
 */
export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

/**
 * POST /api/notify - Send a notification from an agent
 *
 * Body:
 * - agentId: string (required) - The ID of the agent sending the notification
 * - title: string (required) - Notification title
 * - message: string (required) - Notification message
 *
 * This endpoint is designed to be called by agents via curl or similar tools.
 * The notification will be broadcast to all connected clients via WebSocket.
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { agentId, title, message } = req.body;

    // Validate required fields
    if (!agentId || !title || !message) {
      res.status(400).json({
        error: 'Missing required fields: agentId, title, message'
      });
      return;
    }

    // Get agent info for the notification
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent not found: ${agentId}` });
      return;
    }

    // Create the notification
    const notification: AgentNotification = {
      id: generateId(),
      agentId: agent.id,
      agentName: agent.name,
      agentClass: agent.class,
      title,
      message,
      timestamp: Date.now(),
    };

    log.log(`Notification from ${agent.name}: "${title}" - ${message}`);

    // Broadcast to all connected clients
    if (broadcastFn) {
      broadcastFn({
        type: 'agent_notification',
        payload: notification,
      } as ServerMessage);
    } else {
      log.warn('Broadcast function not set - notification not sent to clients');
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
