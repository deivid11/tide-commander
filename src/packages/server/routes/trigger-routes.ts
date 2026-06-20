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
import * as browserErrorService from '../services/browser-error-service.js';
import type { ServerMessage } from '../../shared/types.js';
import type { ExternalEvent } from '../../shared/trigger-types.js';
import { createLogger } from '../utils/logger.js';
import {
  detectWebhookProvider,
  verifyHmacSignature,
  getWebhookHmacPayload,
  GITHUB_SIGNATURE_HEADER,
  BITBUCKET_SIGNATURE_HEADER,
  BITBUCKET_EVENT_HEADER,
  JIRA_SIGNATURE_HEADER,
} from './webhook-signatures.js';
import { WebhookDedupeCache } from './webhook-dedupe.js';
import { isBitbucketAuthorLoop } from './bitbucket-author-loop.js';
import { jiraTriggerHandler } from '../integrations/jira/jira-trigger-handler.js';

const log = createLogger('TriggerRoutes');
const router = Router();

// Process-wide dedupe cache for webhook deliveries. Bitbucket retries reuse
// the same X-Request-UUID across attempts; the cache short-circuits retries
// before they hit triggerService.fireTrigger.
const webhookDedupeCache = new WebhookDedupeCache({
  maxEntries: 1024,
  ttlMs: 10 * 60_000,
});

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

// All matchers evaluated against a specific source message (must be before /:id)
router.get('/matchers/by-source/:sourceType/:sourceId', (req: Request<{ sourceType: string; sourceId: string }>, res: Response) => {
  const matchers = triggerService.getMatchersBySource(req.params.sourceType, req.params.sourceId);
  res.json({ matchers });
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

// ─── Browser Console Error Trigger ───

// Ingestion endpoint for the companion browser extension (see browser-extension/).
// Auth is the standard X-Auth-Token (applied globally to /api). The extension
// POSTs a deduped error brief; we route it to an agent for investigation.
router.post('/browser-error', async (req: Request, res: Response) => {
  try {
    const result = await browserErrorService.handleBrowserError(req.body);

    if (result.deduped) {
      res.json({ deduped: true, agentId: result.agentId, fingerprint: result.fingerprint });
      return;
    }
    if (result.ignored) {
      res.json({ ignored: true, reason: result.reason, fingerprint: result.fingerprint });
      return;
    }
    if (!result.delivered) {
      res.status(result.status ?? 400).json({ error: result.reason ?? 'Not delivered' });
      return;
    }

    res.json({
      delivered: true,
      agentId: result.agentId,
      agentName: result.agentName,
      fingerprint: result.fingerprint,
      screenshotSaved: Boolean(result.screenshotPath),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to handle browser error';
    log.error('browser-error handler failed:', err);
    res.status(500).json({ error: message });
  }
});

// Save a cropped screenshot of a DOM element (extension "Screenshot" button) so
// the agent can Read it. Returns the absolute path the agent should open.
router.post('/element-screenshot', (req: Request, res: Response) => {
  const { image, selector } = req.body || {};
  if (!image || typeof image !== 'string') {
    res.status(400).json({ error: 'image (data URL) required' });
    return;
  }
  const result = browserErrorService.saveElementScreenshot(image, typeof selector === 'string' ? selector : undefined);
  if (!result.ok) {
    res.status(400).json({ error: result.error ?? 'Failed to save image' });
    return;
  }
  res.json({ ok: true, path: result.path });
});

// Save an arbitrary document the user attached in the extension composer (any
// mime type) so the agent can Read it. Returns the absolute path.
router.post('/attachment', (req: Request, res: Response) => {
  const { dataUrl, filename } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    res.status(400).json({ error: 'dataUrl (data URL) required' });
    return;
  }
  const result = browserErrorService.saveAttachment(dataUrl, typeof filename === 'string' ? filename : undefined);
  if (!result.ok) {
    res.status(400).json({ error: result.error ?? 'Failed to save attachment' });
    return;
  }
  res.json({ ok: true, path: result.path });
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

  if (trigger.type !== 'webhook' && trigger.type !== 'bitbucket' && trigger.type !== 'jira') {
    res.status(400).json({ error: 'Not a webhook-receivable trigger', triggerType: trigger.type });
    return;
  }

  // Jira fails closed when no secret is configured: classic Cloud webhooks are
  // unsigned, so the `?secret=<shared>` query-string is the only auth path —
  // leaving it empty would let anyone fire the trigger by URL guess.
  if (trigger.type === 'jira' && !trigger.config.secret) {
    log.warn(`Webhook trigger ${triggerId} rejected: Jira trigger has no secret configured`);
    res.status(401).json({ error: 'Jira trigger requires a configured secret' });
    return;
  }

  if (trigger.config.secret) {
    const provider = detectWebhookProvider(req.headers as Record<string, unknown>);
    const githubSig = req.headers[GITHUB_SIGNATURE_HEADER] as string | undefined;
    const bitbucketSig = req.headers[BITBUCKET_SIGNATURE_HEADER] as string | undefined;
    const jiraSig = req.headers[JIRA_SIGNATURE_HEADER] as string | undefined;
    const plainSecret = req.headers['x-webhook-secret'] as string | undefined;
    const querySecret = typeof req.query.secret === 'string' ? req.query.secret : undefined;

    const hmacSig = provider === 'bitbucket' ? bitbucketSig
      : provider === 'github' ? githubSig
        : provider === 'jira' ? jiraSig
          : (githubSig || bitbucketSig || jiraSig);

    if (!hmacSig && !plainSecret && !querySecret) {
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    if (hmacSig) {
      const { payload, usedFallback } = getWebhookHmacPayload(
        req as Request<{ triggerId: string }> & { rawBody?: Buffer },
      );
      if (usedFallback) {
        log.warn(`Webhook trigger ${triggerId}: rawBody unavailable, falling back to JSON.stringify — signature may not match`);
      }
      const valid = verifyHmacSignature(trigger.config.secret, hmacSig, payload);
      if (!valid) {
        log.warn(`Webhook trigger ${triggerId} rejected: invalid HMAC signature (provider=${provider ?? 'unknown'})`);
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      const candidate = plainSecret ?? querySecret ?? '';
      if (!constantTimeEqual(candidate, trigger.config.secret)) {
        res.status(401).json({ error: 'Invalid secret' });
        return;
      }
      if (querySecret && trigger.type === 'jira') {
        log.warn(`Webhook trigger ${triggerId}: Jira ?secret= fallback used (no HMAC) — Cloud classic webhooks are unsigned, prefer Cloud Signed Webhooks when possible`);
      }
    }
  }

  // Idempotency: short-circuit Bitbucket retry deliveries (same X-Request-UUID
  // is reused across attempts). GitHub uses X-GitHub-Delivery for the same
  // purpose — we accept either header so the cache covers both providers.
  const requestUuid = (req.headers['x-request-uuid']
    || req.headers['x-github-delivery']) as string | undefined;
  if (webhookDedupeCache.isDuplicate(triggerId, requestUuid)) {
    const attempt = req.headers['x-attempt-number'] as string | undefined;
    log.log(`Webhook trigger ${triggerId} deduped: requestUuid=${requestUuid} attempt=${attempt ?? 'n/a'}`);
    res.json({ deduped: true });
    return;
  }

  // Author-loop guard: when the bot itself acted on a PR, Bitbucket fires a
  // matching webhook back to us. Skip the route to avoid an agent reviewing
  // its own activity. Only applies to Bitbucket events where the actor is
  // separable from the PR author (comments, approvals, change requests).
  const eventKey = req.headers[BITBUCKET_EVENT_HEADER] as string | undefined;
  const botIdentifier = process.env.BITBUCKET_BOT_USERNAME;
  if (isBitbucketAuthorLoop(eventKey, req.body, botIdentifier)) {
    log.log(`Webhook trigger ${triggerId} skipped by author-loop-guard: eventKey=${eventKey} bot=${botIdentifier}`);
    res.json({ skipped: 'author-loop-guard' });
    return;
  }

  const variables: Record<string, string> = {
    'trigger.name': trigger.name,
    timestamp: new Date().toISOString(),
    payload: JSON.stringify(req.body),
  };

  if (trigger.type === 'jira') {
    const event: ExternalEvent = {
      source: 'jira',
      type: (req.body && typeof req.body === 'object' && 'webhookEvent' in req.body
        ? String((req.body as Record<string, unknown>).webhookEvent ?? 'jira')
        : 'jira'),
      data: normalizeJiraPayload(req.body),
      timestamp: Date.now(),
    };

    if (!jiraTriggerHandler.structuralMatch(trigger, event)) {
      res.json({ fired: false, reason: 'structural-mismatch' });
      return;
    }

    Object.assign(variables, jiraTriggerHandler.extractVariables(trigger, event));

    try {
      await triggerService.fireTrigger(triggerId, variables, { rawPayload: event.data });
      res.json({ fired: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fire trigger';
      log.error(`Webhook trigger ${triggerId} failed:`, err);
      res.status(500).json({ error: message });
    }
    return;
  }

  // `extractFields` is declared on WebhookTrigger.config but is conceptually
  // generic: same-shape JSON-path extraction works for any header-receivable
  // type. Read through the union via a structural cast (mirrors the fallback
  // handler in trigger-service.ts) so a `bitbucket` trigger configured with
  // `extractFields` still gets its fields interpolated.
  const extractFields = (trigger.config as { extractFields?: unknown }).extractFields;
  if (Array.isArray(extractFields) && req.body) {
    for (const fieldPath of extractFields as string[]) {
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

// ─── Matcher Execution Debugging ───

// List all matchers that ran for a specific trigger event
router.get('/events/:eventId/matchers', (req: Request<{ eventId: string }>, res: Response) => {
  const eventId = parseInt(req.params.eventId);
  if (isNaN(eventId)) {
    res.status(400).json({ error: 'Invalid eventId' });
    return;
  }
  const matchers = triggerService.getMatchersByEvent(eventId);
  res.json({ matchers });
});

// Matcher history for a trigger (across all events)
router.get('/:triggerId/matcher-history', (req: Request<{ triggerId: string }>, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const matchers = triggerService.getMatcherHistoryByTrigger(req.params.triggerId, limit);
  res.json({ matchers });
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

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Reshape Jira Server / Data Center payloads into the Cloud shape the trigger
 * handler reads. Server fires events like `issue_updated` via
 * `issue_event_type_name`; Cloud uses `webhookEvent: "jira:issue_updated"`.
 * Cloud nests the issue under `issue`; Server does too, so no key rewrite —
 * we just synthesize a `webhookEvent` when missing so the handler's filter
 * by event type works against both variants without per-shape branching.
 */
function normalizeJiraPayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const src = body as Record<string, unknown>;
  if (src.webhookEvent || !src.issue_event_type_name) return src;
  const eventName = String(src.issue_event_type_name);
  const synthesized = eventName.startsWith('comment_')
    ? eventName
    : `jira:${eventName.startsWith('issue_') ? eventName : `issue_${eventName}`}`;
  return { ...src, webhookEvent: synthesized };
}

export default router;
