/**
 * WhatsApp Routes
 * Express Router for managing WhatsApp sessions and sending messages via the
 * local WhatsApp API server. Mounted at /api/whatsapp/ by the integration registry.
 *
 * Phase 1: outbound + session management only. Webhooks/incoming messages live in Phase 2.
 */

import { Router, Request, Response } from 'express';
import type { IntegrationContext } from '../../../shared/integration-types.js';
import type {
  WhatsAppChatsResponse,
  WhatsAppMessagesResponse,
  WhatsAppMessageType,
} from '../../../shared/event-types.js';
import { createLogger } from '../../utils/logger.js';
import { WhatsAppClient, type WhatsAppContact } from './whatsapp-client.js';
import {
  loadConfig,
  updateConfig,
  WHATSAPP_API_KEY_SECRET,
  type WhatsAppConfig,
} from './whatsapp-config.js';
import { syncBridge } from './index.js';
import {
  getWhatsAppChatsList,
  getWhatsAppMessagesByChatPaged,
} from '../../data/event-queries.js';
import {
  getConfig as getNotificationConfig,
  updateConfig as updateNotificationConfig,
  clearConfig as clearNotificationConfig,
  getDefaultConfig as getDefaultNotificationConfig,
  WHATSAPP_NOTIFICATION_EVENT_TYPES,
  type WhatsAppNotificationEventType,
  type WhatsAppNotificationFilter,
} from '../../services/whatsapp-notification-config-service.js';

const log = createLogger('WhatsAppRoutes');

export function parseWhatsAppMentions(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error('mentions must be an array of WhatsApp JIDs');
  if (value.length > 50) throw new Error('mentions cannot contain more than 50 JIDs');
  const mentions: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error('mentions must contain only non-empty WhatsApp JIDs');
    }
    const jid = entry.trim();
    if (!mentions.includes(jid)) mentions.push(jid);
  }
  return mentions.length ? mentions : undefined;
}

function normalizeMentionText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2066-\u2069]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsMentionLabel(message: string, label: string): boolean {
  const haystack = normalizeMentionText(message);
  const needle = `@${normalizeMentionText(label)}`;
  if (needle.length <= 1) return false;
  let offset = 0;
  while (offset < haystack.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) return false;
    const before = index > 0 ? haystack[index - 1] : '';
    const after = haystack[index + needle.length] ?? '';
    const startsAtBoundary = !before || /\s/.test(before);
    const endsAtBoundary = !after || !/[\p{L}\p{N}_]/u.test(after);
    if (startsAtBoundary && endsAtBoundary) return true;
    offset = index + needle.length;
  }
  return false;
}

export function hasVisibleWhatsAppMention(message: string): boolean {
  const normalized = normalizeMentionText(message);
  return /(^|\s)@[\p{L}\p{N}]/u.test(normalized);
}

export function resolveWhatsAppMentionJids(
  message: string,
  contacts: WhatsAppContact[],
): string[] {
  const labels = new Map<string, { label: string; contacts: WhatsAppContact[] }>();
  for (const contact of contacts) {
    const aliases = [contact.name, contact.pushname, contact.number];
    for (const alias of aliases) {
      if (!alias?.trim()) continue;
      const key = normalizeMentionText(alias);
      const entry = labels.get(key) ?? { label: alias.trim(), contacts: [] };
      entry.contacts.push(contact);
      labels.set(key, entry);
    }
  }

  const resolved: string[] = [];
  const sortedLabels = [...labels.values()].sort((a, b) => b.label.length - a.label.length);
  for (const entry of sortedLabels) {
    if (!containsMentionLabel(message, entry.label)) continue;
    const preferred = entry.contacts.find((contact) => contact.lid)
      ?? entry.contacts.find((contact) => contact.id.endsWith('@lid'))
      ?? entry.contacts[0];
    const jid = preferred.lid?.trim() || preferred.id?.trim();
    if (jid && !jid.endsWith('@g.us') && !resolved.includes(jid)) resolved.push(jid);
  }
  return resolved;
}

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

  // ─── POST /sessions/:sessionId/chats/:chatId/sync-messages — Force on-demand history sync for a chat ───
  router.post(
    '/sessions/:sessionId/chats/:chatId/sync-messages',
    async (req: Request<{ sessionId: string; chatId: string }>, res: Response) => {
      const built = getClient();
      if ('error' in built) {
        res.status(built.status).json({ error: built.error });
        return;
      }
      const rawCount = typeof req.query.count === 'string' ? Number(req.query.count) : NaN;
      const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 50;
      try {
        const result = await built.client.syncChatMessages(
          req.params.sessionId,
          req.params.chatId,
          count,
        );
        res.json({ success: true, data: result });
      } catch (err) {
        log.error(`WhatsApp syncChatMessages error: ${err}`);
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ─── POST /sessions/:sessionId/sync-contacts — Force address-book resync via Baileys app-state ───
  router.post(
    '/sessions/:sessionId/sync-contacts',
    async (req: Request<{ sessionId: string }>, res: Response) => {
      const built = getClient();
      if ('error' in built) {
        res.status(built.status).json({ error: built.error });
        return;
      }
      try {
        const result = await built.client.syncContacts(req.params.sessionId);
        res.json({ success: true, data: result });
      } catch (err) {
        log.error(`WhatsApp syncContacts error: ${err}`);
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ─── GET /sessions/:sessionId/contacts — List contacts for a session ───
  router.get(
    '/sessions/:sessionId/contacts',
    async (req: Request<{ sessionId: string }>, res: Response) => {
      const built = getClient();
      if ('error' in built) {
        res.status(built.status).json({ error: built.error });
        return;
      }
      try {
        const result = await built.client.getContacts(req.params.sessionId);
        res.json({ success: true, data: result });
      } catch (err) {
        log.error(`WhatsApp getContacts error: ${err}`);
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ─── GET /sessions/:sessionId/chats/:chatId/messages — Fetch recent messages for a chat ───
  router.get(
    '/sessions/:sessionId/chats/:chatId/messages',
    async (req: Request<{ sessionId: string; chatId: string }>, res: Response) => {
      const built = getClient();
      if ('error' in built) {
        res.status(built.status).json({ error: built.error });
        return;
      }
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 50;
      try {
        const result = await built.client.getChatMessages(
          req.params.sessionId,
          req.params.chatId,
          limit,
        );
        res.json({ success: true, data: result });
      } catch (err) {
        log.error(`WhatsApp getChatMessages error: ${err}`);
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ─── POST /send-message — Send a text message via Baileys ───
  router.post('/send-message', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      sessionId?: unknown;
      to?: unknown;
      message?: unknown;
      mentions?: unknown;
    };
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const message = typeof body.message === 'string' ? body.message : '';
    if (!to || !message) {
      res.status(400).json({ error: 'to and message are required' });
      return;
    }
    let mentions: string[] | undefined;
    try {
      mentions = parseWhatsAppMentions(body.mentions);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
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
      if (!mentions?.length && to.endsWith('@g.us') && hasVisibleWhatsAppMention(message)) {
        let contacts = await built.client.getContacts(sessionId);
        mentions = resolveWhatsAppMentionJids(message, contacts);
        if (!mentions.length) {
          await built.client.syncContacts(sessionId);
          contacts = await built.client.getContacts(sessionId);
          mentions = resolveWhatsAppMentionJids(message, contacts);
        }
        if (!mentions.length) {
          res.status(400).json({
            error: 'Could not resolve the visible WhatsApp @mention. Pass the participant JID in mentions.',
          });
          return;
        }
        log.log(`Resolved ${mentions.length} WhatsApp mention(s) from visible labels`);
      }

      const result = await built.client.sendMessage(sessionId, to, message, { mentions });
      res.json({ success: true, sessionId, mentions: mentions ?? [], result });
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

  // ─── GET /notification-config — Read per-event-type WhatsApp notification toggles ───
  router.get('/notification-config', (_req: Request, res: Response) => {
    res.json(getNotificationConfig());
  });

  // ─── PATCH /notification-config — Update toggles and/or recipient JID ───
  router.patch('/notification-config', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { filter?: unknown; recipient?: unknown };
    const update: { filter?: Partial<WhatsAppNotificationFilter>; recipient?: string } = {};
    if (body.filter && typeof body.filter === 'object') {
      const inputFilter = body.filter as Record<string, unknown>;
      const cleaned: Partial<WhatsAppNotificationFilter> = {};
      for (const key of WHATSAPP_NOTIFICATION_EVENT_TYPES) {
        const v = inputFilter[key];
        if (typeof v === 'boolean') {
          cleaned[key as WhatsAppNotificationEventType] = v;
        }
      }
      update.filter = cleaned;
    }
    if (typeof body.recipient === 'string') {
      update.recipient = body.recipient;
    }
    try {
      const next = updateNotificationConfig(update);
      res.json(next);
    } catch (err) {
      log.error(`WhatsApp notification-config update error: ${err}`);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── DELETE /notification-config — Reset to defaults (all toggles ON, recipient cleared) ───
  router.delete('/notification-config', (_req: Request, res: Response) => {
    try {
      clearNotificationConfig();
      res.json(getDefaultNotificationConfig());
    } catch (err) {
      log.error(`WhatsApp notification-config clear error: ${err}`);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── GET /chats/:sessionId — chat summaries ───
  router.get('/chats/:sessionId', (req: Request<{ sessionId: string }>, res: Response) => {
    const sessionId = req.params.sessionId.trim();
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    try {
      const chats = getWhatsAppChatsList(sessionId);
      const body: WhatsAppChatsResponse = { chats };
      res.json(body);
    } catch (err) {
      log.error(`WhatsApp chats list error: ${err}`);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── GET /chats/:sessionId/:chatId/messages — paged history ───
  router.get(
    '/chats/:sessionId/:chatId/messages',
    (req: Request<{ sessionId: string; chatId: string }>, res: Response) => {
      const sessionId = req.params.sessionId.trim();
      const chatId = req.params.chatId.trim();
      if (!sessionId || !chatId) {
        res.status(400).json({ error: 'sessionId and chatId are required' });
        return;
      }

      const cursorRaw = req.query.cursor;
      let cursor: number | undefined;
      if (typeof cursorRaw === 'string' && cursorRaw.length > 0) {
        const parsed = Number(cursorRaw);
        if (!Number.isFinite(parsed)) {
          res.status(400).json({ error: 'invalid cursor' });
          return;
        }
        cursor = parsed;
      }

      const limitRaw = req.query.limit;
      let limit: number | undefined;
      if (typeof limitRaw === 'string' && limitRaw.length > 0) {
        const parsed = Number(limitRaw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          res.status(400).json({ error: 'invalid limit' });
          return;
        }
        limit = parsed;
      }

      const directionRaw = req.query.direction;
      let direction: 'inbound' | 'outbound' | undefined;
      if (typeof directionRaw === 'string' && directionRaw.length > 0) {
        if (directionRaw !== 'inbound' && directionRaw !== 'outbound') {
          res.status(400).json({ error: 'invalid direction' });
          return;
        }
        direction = directionRaw;
      }

      const typeRaw = req.query.type;
      const allowedTypes: WhatsAppMessageType[] = [
        'text', 'image', 'audio', 'video', 'document',
        'sticker', 'location', 'contact', 'reaction', 'unknown',
      ];
      let type: WhatsAppMessageType | undefined;
      if (typeof typeRaw === 'string' && typeRaw.length > 0) {
        if (!(allowedTypes as string[]).includes(typeRaw)) {
          res.status(400).json({ error: 'invalid type' });
          return;
        }
        type = typeRaw as WhatsAppMessageType;
      }

      try {
        const page = getWhatsAppMessagesByChatPaged(sessionId, chatId, { cursor, limit, direction, type });
        const body: WhatsAppMessagesResponse = {
          messages: page.messages,
          nextCursor: page.nextCursor === null ? null : String(page.nextCursor),
        };
        res.json(body);
      } catch (err) {
        log.error(`WhatsApp messages page error: ${err}`);
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  return router;
}

export default createWhatsAppRoutes;
