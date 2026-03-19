/**
 * Trigger Routes
 * CRUD endpoints + webhook ingestion + test-match for triggers.
 *
 * Routes:
 *   GET    /api/triggers                    - List all triggers
 *   GET    /api/triggers/:id                - Get single trigger
 *   POST   /api/triggers                    - Create trigger
 *   PATCH  /api/triggers/:id                - Update trigger
 *   DELETE /api/triggers/:id                - Delete trigger
 *   POST   /api/triggers/webhook/:triggerId - Webhook ingestion (no auth)
 *   POST   /api/triggers/:id/fire           - Manual fire (test)
 *   POST   /api/triggers/:id/test-match     - Dry-run match pipeline
 *   POST   /api/triggers/validate-cron      - Validate cron expression
 *   GET    /api/triggers/:id/events         - Get trigger fire history
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import * as triggerService from '../services/trigger-service.js';
import * as cronService from '../services/cron-service.js';
import type { ServerMessage } from '../../shared/types.js';
import type { ExternalEvent } from '../../shared/trigger-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TriggerRoutes');
const router = Router();

let broadcastFn: ((message: ServerMessage) => void) | null = null;

export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

// ─── CRUD ───

// List all triggers
router.get('/', (_req: Request, res: Response) => {
  const triggers = triggerService.getAllTriggers();
  res.json(triggers);
});

// Get single trigger
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const trigger = triggerService.getTrigger(req.params.id);
  if (!trigger) {
    res.status(404).json({ error: 'Trigger not found' });
    return;
  }
  res.json(trigger);
});

// Create trigger
router.post('/', (req: Request, res: Response) => {
  try {
    const trigger = triggerService.createTrigger(req.body);

    if (broadcastFn) {
      broadcastFn({ type: 'trigger_created', payload: trigger } as ServerMessage);
    }

    res.status(201).json(trigger);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create trigger';
    res.status(400).json({ error: message });
  }
});

// Update trigger
router.patch('/:id', (req: Request<{ id: string }>, res: Response) => {
  const trigger = triggerService.updateTrigger(req.params.id, req.body);
  if (!trigger) {
    res.status(404).json({ error: 'Trigger not found' });
    return;
  }

  if (broadcastFn) {
    broadcastFn({ type: 'trigger_updated', payload: trigger } as ServerMessage);
  }

  res.json(trigger);
});

// Delete trigger
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  const success = triggerService.deleteTrigger(req.params.id);
  if (!success) {
    res.status(404).json({ error: 'Trigger not found' });
    return;
  }

  if (broadcastFn) {
    broadcastFn({ type: 'trigger_deleted', payload: { id: req.params.id } } as ServerMessage);
  }

  res.json({ deleted: true });
});

// ─── Webhook Ingestion ───

// No auth required — uses per-trigger secret for validation
router.post('/webhook/:triggerId', async (req: Request<{ triggerId: string }>, res: Response) => {
  const { triggerId } = req.params;
  const trigger = triggerService.getTrigger(triggerId);

  if (!trigger) {
    res.status(404).json({ error: 'Trigger not found' });
    return;
  }

  if (!trigger.enabled) {
    res.status(400).json({ error: 'Trigger is disabled' });
    return;
  }

  if (trigger.type !== 'webhook') {
    res.status(400).json({ error: 'Not a webhook trigger' });
    return;
  }

  // Validate HMAC secret if configured
  if (trigger.config.secret) {
    const signature = req.headers['x-hub-signature-256'] as string
      || req.headers['x-webhook-secret'] as string;

    if (!signature) {
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    // GitHub-style HMAC-SHA256 validation
    if (req.headers['x-hub-signature-256']) {
      const hmac = crypto.createHmac('sha256', trigger.config.secret);
      hmac.update(JSON.stringify(req.body));
      const expectedSig = `sha256=${hmac.digest('hex')}`;

      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSig)
      )) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      // Direct comparison for X-Webhook-Secret
      if (signature !== trigger.config.secret) {
        res.status(401).json({ error: 'Invalid secret' });
        return;
      }
    }
  }

  // Build event and extract variables
  const event: ExternalEvent = {
    source: 'webhook',
    type: 'webhook_received',
    data: req.body,
    timestamp: Date.now(),
  };

  // Extract fields from payload
  const variables: Record<string, string> = {
    'trigger.name': trigger.name,
    timestamp: new Date().toISOString(),
    payload: JSON.stringify(req.body),
  };

  if (trigger.config.extractFields && req.body) {
    for (const fieldPath of trigger.config.extractFields) {
      const value = getNestedValue(req.body, fieldPath);
      if (value !== undefined) {
        variables[fieldPath] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }
  }

  try {
    await triggerService.fireTrigger(triggerId, variables, {
      rawPayload: req.body,
    });

    res.json({ fired: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fire trigger';
    log.error(`Webhook trigger ${triggerId} failed:`, err);
    res.status(500).json({ error: message });
  }
});

// ─── Manual Fire ───

router.post('/:id/fire', async (req: Request<{ id: string }>, res: Response) => {
  const trigger = triggerService.getTrigger(req.params.id);
  if (!trigger) {
    res.status(404).json({ error: 'Trigger not found' });
    return;
  }

  const variables = req.body.variables || {};

  try {
    await triggerService.fireTrigger(req.params.id, variables, {
      rawPayload: req.body.payload,
    });

    res.json({ fired: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fire trigger';
    res.status(500).json({ error: message });
  }
});

// ─── Test Match (dry-run) ───

router.post('/:id/test-match', async (req: Request<{ id: string }>, res: Response) => {
  const trigger = triggerService.getTrigger(req.params.id);
  if (!trigger) {
    res.status(404).json({ error: 'Trigger not found' });
    return;
  }

  const event: ExternalEvent = req.body.event || {
    source: trigger.type,
    type: 'test',
    data: req.body.payload || {},
    timestamp: Date.now(),
  };

  try {
    const result = await triggerService.testMatch(req.params.id, event);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Test match failed';
    res.status(500).json({ error: message });
  }
});

// ─── Cron Validation ───

router.post('/validate-cron', (req: Request, res: Response) => {
  const { expression, timezone } = req.body;

  if (!expression) {
    res.status(400).json({ error: 'Missing expression' });
    return;
  }

  const valid = cronService.validate(expression);
  if (!valid) {
    res.json({ valid: false, error: 'Invalid cron expression' });
    return;
  }

  const nextFires = cronService.getNextFireTimes(expression, timezone || 'UTC', 5);
  res.json({
    valid: true,
    nextFires: nextFires.map(d => d.toISOString()),
  });
});

// ─── Trigger Event History ───

router.get('/:id/events', (req: Request<{ id: string }>, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const events = triggerService.getTriggerEvents(req.params.id, limit);
  res.json(events);
});

// ─── Helper ───

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

export default router;
