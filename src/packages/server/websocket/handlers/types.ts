/**
 * Shared types for WebSocket handlers
 */

import { WebSocket } from 'ws';
import type { ServerMessage } from '../../../shared/types.js';

/**
 * Handler context passed to all message handlers
 */
export interface HandlerContext {
  ws: WebSocket;
  broadcast: (message: ServerMessage) => void;
  sendToClient: (message: ServerMessage) => void;
  sendError: (message: string) => void;
  sendActivity: (agentId: string, message: string) => void;
}

/**
 * Type for a message handler function
 */
export type MessageHandler<T = unknown> = (
  ctx: HandlerContext,
  payload: T
) => void | Promise<void>;
