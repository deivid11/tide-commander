/**
 * WhatsApp Routes
 * Express Router for managing WhatsApp sessions and sending messages via the
 * local WhatsApp API server. Mounted at /api/whatsapp/ by the integration registry.
 *
 * Phase 1: outbound + session management only. Webhooks/incoming messages live in Phase 2.
 */

import { Router, Request, Response } from 'express';
import type { IntegrationContext } from '../../../shared/integration-types.js';
import { createLogger } from '../../utils/logger.js';
import { WhatsAppClient } from './whatsapp-client.js';
import {
  loadConfig,
  updateConfig,
  WHATSAPP_API_KEY_SECRET,
  type WhatsAppConfig,
} from './whatsapp-config.js';
import { syncBridge } from './index.js';

const log = createLogger('WhatsAppRoutes');

/** Build the router. Closes over the integration context for secret access. */
export function createWhatsAppRoutes(ctx: IntegrationContext): Router {
  const router = Router();

  function getApiKey(): string | undefined {
    return ctx.secrets.get(WHATSAPP_API_KEY_SECRET);
  }

  function getClient(): { client: WhatsAppClient; config: WhatsAppConfig } | { error: string; status: number } {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { error: 'WhatsApp API key is not configured', status: 503 };
    }
    const config = loadConfig();
    return { client: new WhatsAppClient(config.baseUrl, apiKey), config };
  }

  function publicConfig(config: WhatsAppConfig): Omit<WhatsAppConfig, 'webhookVerifyToken'> & {
    webhookVerifyToken?: string;
  } {
    return {
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      defaultSessionId: config.defaultSessionId,
      enrichContactName: config.enrichContactName !== false,
      showIncomingToasts: config.showIncomingToasts !== false,
      // Mask the verify token — never echo it back to clients.
      webhookVerifyToken: config.webhookVerifyToken ? '********' : undefined,
      updatedAt: config.updatedAt,
      version: config.version,
    };
  }

  // ─── GET /status — Connection / configuration health ───
  router.get('/status', async (_req: Request, res: Response) => {
    const config = loadConfig();
    const apiKey = getApiKey();
    const base = {
      enabled: config.enabled,
      configured: !!apiKey,
      baseUrl: config.baseUrl,
      defaultSessionId: config.defaultSessionId,
    };
    if (!apiKey) {
      res.json({ ...base, sessions: [] });
      return;
    }
    try {
      const client = new WhatsAppClient(config.baseUrl, apiKey);
      const sessions = await client.listSessions();
      res.json({ ...base, sessions: sessions.length });
    } catch (err) {
      res.json({
        ...base,
        sessions: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ─── GET /config — Read non-secret config ───
  router.get('/config', (_req: Request, res: Response) => {
    res.json(publicConfig(loadConfig()));
  });

  // ─── PATCH /config — Update non-secret config ───
  router.patch('/config', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<WhatsAppConfig>;
    const updates: Partial<WhatsAppConfig> = {};
    if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
    if (typeof body.baseUrl === 'string' && body.baseUrl) updates.baseUrl = body.baseUrl;
    if (typeof body.defaultSessionId === 'string') {
      updates.defaultSessionId = body.defaultSessionId || undefined;
    }
    if (typeof body.webhookVerifyToken === 'string' && body.webhookVerifyToken !== '********') {
      updates.webhookVerifyToken = body.webhookVerifyToken || undefined;
    }
    if (typeof body.enrichContactName === 'boolean') updates.enrichContactName = body.enrichContactName;
    if (typeof body.showIncomingToasts === 'boolean') updates.showIncomingToasts = body.showIncomingToasts;
    const next = updateConfig(updates);
    // syncBridge() compares the WS-relevant fields (enabled, baseUrl, apiKey)
    // and only restarts the bridge when one of those changes. UI flags like
    // showIncomingToasts and enrichContactName fall through as no-ops. See
    // ./index.ts:syncBridge.
    syncBridge(ctx);
    res.json(publicConfig(next));
  });

  // ─── POST /api-key — Set the X-API-Key secret ───
  router.post('/api-key', (req: Request, res: Response) => {
    const apiKey = (req.body as { apiKey?: unknown })?.apiKey;
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      res.status(400).json({ error: 'apiKey is required' });
      return;
    }
    ctx.secrets.set(WHATSAPP_API_KEY_SECRET, apiKey.trim());
    syncBridge(ctx);
    res.json({ success: true, configured: true });
  });

  // ─── DELETE /api-key — Clear the secret ───
  router.delete('/api-key', (_req: Request, res: Response) => {
    ctx.secrets.set(WHATSAPP_API_KEY_SECRET, '');
    syncBridge(ctx);
    res.json({ success: true, configured: false });
  });

  // ─── GET /sessions — List Baileys sessions ───
  router.get('/sessions', async (_req: Request, res: Response) => {
    const built = getClient();
    if ('error' in built) {
      res.status(built.status).json({ error: built.error });
      return;
    }
    try {
      const sessions = await built.client.listSessions();
      res.json({ sessions });
    } catch (err) {
      log.error(`WhatsApp listSessions error: ${err}`);
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── POST /sessions — Create a session (returns pairing QR via /qr) ───
  router.post('/sessions', async (req: Request, res: Response) => {
    const sessionId = (req.body as { sessionId?: unknown })?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    const built = getClient();
    if ('error' in built) {
      res.status(built.status).json({ error: built.error });
      return;
    }
    try {
      const session = await built.client.createSession(sessionId.trim());
      res.json({ session });
    } catch (err) {
      log.error(`WhatsApp createSession error: ${err}`);
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── DELETE /sessions/:id — Tear down a session ───
  router.delete('/sessions/:id', async (req: Request<{ id: string }>, res: Response) => {
    const built = getClient();
    if ('error' in built) {
      res.status(built.status).json({ error: built.error });
      return;
    }
    try {
      const result = await built.client.deleteSession(req.params.id);
      res.json({ success: true, result });
    } catch (err) {
      log.error(`WhatsApp deleteSession error: ${err}`);
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── GET /sessions/:id/status ───
  router.get('/sessions/:id/status', async (req: Request<{ id: string }>, res: Response) => {
    const built = getClient();
    if ('error' in built) {
      res.status(built.status).json({ error: built.error });
      return;
    }
    try {
      const status = await built.client.getSessionStatus(req.params.id);
      res.json(status);
    } catch (err) {
      log.error(`WhatsApp getSessionStatus error: ${err}`);
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── GET /sessions/:id/qr ───
  router.get('/sessions/:id/qr', async (req: Request<{ id: string }>, res: Response) => {
    const built = getClient();
    if ('error' in built) {
      res.status(built.status).json({ error: built.error });
      return;
    }
    try {
      const qr = await built.client.getSessionQr(req.params.id);
      res.json(qr);
    } catch (err) {
      log.error(`WhatsApp getSessionQr error: ${err}`);
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── POST /send-message — Send a text message via Baileys ───
  router.post('/send-message', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { sessionId?: unknown; to?: unknown; message?: unknown };
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const message = typeof body.message === 'string' ? body.message : '';
    if (!to || !message) {
      res.status(400).json({ error: 'to and message are required' });
      return;
    }

    const built = getClient();
    if ('error' in built) {
      res.status(built.status).json({ error: built.error });
      return;
    }

    const explicitSessionId =
      typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined;
    const sessionId = explicitSessionId ?? built.config.defaultSessionId;
    if (!sessionId) {
      res.status(400).json({
        error: 'sessionId is required (none provided and no defaultSessionId configured)',
      });
      return;
    }

    try {
      const result = await built.client.sendMessage(sessionId, to, message);
      res.json({ success: true, sessionId, result });
    } catch (err) {
      log.error(`WhatsApp sendMessage error: ${err}`);
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── POST /send-media-url — Send media (image/video/audio/document) by public URL ───
  // Upstream fetches the URL server-side (50MB / 60s cap), auto-detects the
  // mimetype from the response Content-Type, and pushes it via Baileys.
  router.post('/send-media-url', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      sessionId?: unknown;
      to?: unknown;
      mediaUrl?: unknown;
      caption?: unknown;
      type?: unknown;
      filename?: unknown;
    };
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const mediaUrl = typeof body.mediaUrl === 'string' ? body.mediaUrl.trim() : '';
    if (!to || !mediaUrl) {
      res.status(400).json({ error: 'to and mediaUrl are required' });
      return;
    }

    const built = getClient();
    if ('error' in built) {
      res.status(built.status).json({ error: built.error });
      return;
    }

    const explicitSessionId =
      typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined;
    const sessionId = explicitSessionId ?? built.config.defaultSessionId;
    if (!sessionId) {
      res.status(400).json({
        error: 'sessionId is required (none provided and no defaultSessionId configured)',
      });
      return;
    }

    const caption = typeof body.caption === 'string' ? body.caption : undefined;
    const filename = typeof body.filename === 'string' && body.filename ? body.filename : undefined;
    const rawType = typeof body.type === 'string' ? body.type.toLowerCase() : '';
    const type = (['image', 'video', 'audio', 'document'] as const).find((t) => t === rawType);

    try {
      const result = await built.client.sendMediaUrl(sessionId, to, mediaUrl, caption, {
        type,
        filename,
      });
      res.json({ success: true, sessionId, result });
    } catch (err) {
      log.error(`WhatsApp sendMediaUrl error: ${err}`);
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}

export default createWhatsAppRoutes;
