/**
 * Focus Agent Routes
 * REST endpoint to focus an agent in already-open Tide Commander clients.
 */

import { Router, Request, Response } from 'express';
import type { ServerMessage } from '../../shared/types.js';
import { agentService } from '../services/index.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('FocusAgent');
const router = Router();

let broadcastFn: ((message: ServerMessage) => void) | null = null;

export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

/**
 * POST /api/focus-agent
 *
 * Body:
 * - agentId: string (required)
 * - openTerminal: boolean (optional, default true)
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { agentId, openTerminal } = req.body as {
      agentId?: string;
      openTerminal?: boolean;
    };

    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'Missing required field: agentId' });
      return;
    }

    const agent = agentService.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent not found: ${agentId}` });
      return;
    }

    const shouldOpenTerminal = typeof openTerminal === 'boolean' ? openTerminal : true;

    if (broadcastFn) {
      broadcastFn({
        type: 'focus_agent',
        payload: {
          agentId,
          openTerminal: shouldOpenTerminal,
        },
      });
    } else {
      log.warn('Broadcast function not set - focus event not sent to clients');
    }

    res.status(200).json({
      success: true,
      agentId,
      openTerminal: shouldOpenTerminal,
    });
  } catch (err: any) {
    log.error('Failed to focus agent:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
