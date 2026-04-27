/**
 * WhatsApp In-Process Trigger Bridge
 * Subscribes to the upstream whatsapp-api WS, normalizes incoming Baileys
 * payloads, and rebroadcasts them as `whatsapp_message` ServerMessages on the
 * Tide Commander client WS.
 *
 * NOTE: this is NOT the TriggerHandler interface from
 * src/packages/shared/integration-types.ts (that one is for the trigger
 * service). The plugin's getTriggerHandler() still returns null.
 */

import type { IntegrationContext } from '../../../shared/integration-types.js';
import { loadConfig, WHATSAPP_API_KEY_SECRET } from './whatsapp-config.js';
import { WhatsAppWsClient, type WhatsAppUpstreamEvent } from './whatsapp-ws-client.js';
import { MessageDedupeCache } from './message-dedupe.js';
import { ContactNameCache } from './contact-name-cache.js';
import { WhatsAppClient } from './whatsapp-client.js';

export interface WhatsAppMessageBridge {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker';

interface NormalizedWhatsAppMessage {
  sessionId: string;
  from: string;
  fromName?: string;
  body: string;
  timestamp: number;
  isGroup: boolean;
  groupName?: string;
  mediaType?: MediaType;
  mediaUrl?: string;
  direction: 'inbound' | 'outbound';
}

// Dedupe cache config. The upstream whatsapp-api fires BOTH `message` and
// `message_create` for the same Baileys event on inbound DMs (see
// providers/baileysSessionManager.js around the `messages.upsert` handler — it
// calls sendBaileysMessageCreateWebhook unconditionally, then
// sendBaileysMessageWebhook when `!fromMe && type==='notify'`). Without this
// cache the bridge would broadcast both as `whatsapp_message`, producing
// duplicate toasts on the frontend.
const DEDUPE_MAX_ENTRIES = 256;
const DEDUPE_TTL_MS = 60_000;
const CONTACT_NAME_TTL_MS = 5 * 60_000;

export function createWhatsAppTriggerHandler(ctx: IntegrationContext): WhatsAppMessageBridge {
  let client: WhatsAppWsClient | null = null;

  // Per-bridge instance — restarting the plugin clears it.
  const dedupe = new MessageDedupeCache({
    maxEntries: DEDUPE_MAX_ENTRIES,
    ttlMs: DEDUPE_TTL_MS,
  });

  // Lazily build a fetcher that picks up live config + secrets each call.
  // The upstream contacts list is what carries pushName — see the file header
  // for why this enrichment exists.
  const contactNames = new ContactNameCache({
    ttlMs: CONTACT_NAME_TTL_MS,
    fetchContacts: async (sessionId) => {
      const cfg = loadConfig();
      const apiKey = ctx.secrets.get(WHATSAPP_API_KEY_SECRET);
      if (!apiKey) return [];
      const wac = new WhatsAppClient(cfg.baseUrl, apiKey);
      return wac.getContacts(sessionId);
    },
  });

  function start(): void {
    if (client) return;

    const config = loadConfig();
    const apiKey = ctx.secrets.get(WHATSAPP_API_KEY_SECRET);

    if (!config.enabled) {
      ctx.log.info('WhatsApp message bridge: integration disabled, not connecting');
      return;
    }
    if (!apiKey) {
      ctx.log.warn('WhatsApp message bridge: missing API key, not connecting');
      return;
    }

    client = new WhatsAppWsClient(config.baseUrl, apiKey, handleEvent, ctx.log);
    client.connect();
  }

  function stop(): void {
    if (client) {
      client.close();
      client = null;
    }
    dedupe.clear();
    contactNames.clear();
  }

  function isRunning(): boolean {
    return client !== null;
  }

  function extractMessageId(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'string' && d.id.length > 0) return d.id;
    const key = d.key && typeof d.key === 'object' ? (d.key as Record<string, unknown>) : undefined;
    if (key && typeof key.id === 'string' && key.id.length > 0) return key.id;
    return undefined;
  }

  function handleEvent(msg: WhatsAppUpstreamEvent): void {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'event' && (msg.event === 'message' || msg.event === 'message_create')) {
      const messageId = extractMessageId(msg.data);
      if (dedupe.isDuplicate(msg.sessionId, messageId)) {
        // Silent drop — duplicates are expected (upstream dual-fire).
        return;
      }
      const config = loadConfig();
      const payload = normalizeBaileysMessage(msg.sessionId, msg.event, msg.data, msg.ts, config.baseUrl);
      if (!payload) return;

      // Enrich inbound DMs/groups whose fromName is still null. The upstream
      // webhook payload doesn't include pushName (verified in
      // whatsapp-api/src/webhookHandler.js sendBaileysMessage*Webhook), so
      // we look it up via the contacts API. Async + cached + best-effort.
      const needsEnrichment =
        config.enrichContactName !== false &&
        payload.direction === 'inbound' &&
        !payload.fromName &&
        !!payload.from;

      if (!needsEnrichment) {
        ctx.broadcast({ type: 'whatsapp_message', payload });
        return;
      }

      void contactNames.lookup(msg.sessionId, payload.from).then((name) => {
        const sanitized = sanitizeFromName(name, payload.from);
        if (sanitized) payload.fromName = sanitized;
        ctx.broadcast({ type: 'whatsapp_message', payload });
      }, (err) => {
        ctx.log.warn(`WhatsApp contact lookup failed: ${err}`);
        ctx.broadcast({ type: 'whatsapp_message', payload });
      });
    }
    // Other event types (message_ack, group_join, group_leave, hello, error) are
    // logged by the WS client itself; we don't surface them to the UI yet.
  }

  return { start, stop, isRunning };
}

// ─── Baileys Normalizer ───

/**
 * Normalize a Baileys-shaped event payload into the pinned ServerMessage shape.
 * Be defensive — Baileys versions and the upstream wrapper vary in field naming.
 * Returns `null` for payloads we cannot make sense of (caller drops them).
 */
function normalizeBaileysMessage(
  sessionId: string,
  eventName: string,
  data: unknown,
  ts: number | undefined,
  baseUrl: string,
): NormalizedWhatsAppMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  // The whatsapp-api server may give us:
  //   - the raw Baileys IWebMessageInfo (key/message/messageTimestamp/pushName)
  //   - a wrapped envelope with normalized fields at top level (from/body/etc)
  // Try the wrapped form first, fall back to Baileys structure.

  const key = (d.key && typeof d.key === 'object' ? (d.key as Record<string, unknown>) : undefined);
  const message = (d.message && typeof d.message === 'object'
    ? (d.message as Record<string, unknown>)
    : undefined);

  // Direction
  const fromMe =
    pickBoolean(d.fromMe) ??
    (key ? pickBoolean(key.fromMe) : undefined) ??
    (eventName === 'message_create');
  const direction: 'inbound' | 'outbound' = fromMe ? 'outbound' : 'inbound';

  // JID resolution
  const remoteJid =
    pickString(d.remoteJid) ??
    pickString(d.chatId) ??
    (key ? pickString(key.remoteJid) : undefined) ??
    pickString(d.from);
  const participant =
    pickString(d.participant) ??
    (key ? pickString(key.participant) : undefined);

  if (!remoteJid && !participant) return null;
  const isGroup = (remoteJid?.endsWith('@g.us') ?? false) || pickBoolean(d.isGroup) === true;

  // For groups, prefer the actual sender (participant). For DMs, the remote jid
  // IS the sender. If we're outbound, the "from" still refers to the chat for
  // UI consumers — keep it consistent.
  const from = isGroup
    ? (participant ?? remoteJid ?? '')
    : (remoteJid ?? participant ?? '');
  if (!from) return null;

  // Display name. Extraction order:
  //  1. Top-level normalized fields the upstream MIGHT supply (today it does
  //     not — see whatsapp-api/src/webhookHandler.js — but we cover the
  //     common spellings so a future upstream patch lights up automatically).
  //  2. Sender/contact sub-objects, if present.
  //  3. Raw Baileys IWebMessageInfo fields when the upstream forwards them
  //     (`message.pushName`, `key.pushName`, `verifiedBizName`).
  // Whatever we extract is sanitized at the end (strip @s.whatsapp.net suffix,
  // null out values that just echo the phone number).
  const sender = (d.sender && typeof d.sender === 'object'
    ? (d.sender as Record<string, unknown>)
    : undefined);
  const contact = (d.contact && typeof d.contact === 'object'
    ? (d.contact as Record<string, unknown>)
    : undefined);

  const rawName =
    pickString(d.pushName) ??
    pickString(d.notifyName) ??
    pickString(d.senderName) ??
    pickString(d.fromName) ??
    pickString(d.notify) ??
    pickString(d.verifiedName) ??
    pickString(d.verifiedBizName) ??
    (sender ? pickString(sender.name) ?? pickString(sender.pushname) : undefined) ??
    (contact ? pickString(contact.name) ?? pickString(contact.pushname) : undefined) ??
    (message ? pickString(message.pushName) : undefined) ??
    (key ? pickString(key.pushName) : undefined);

  const fromName = sanitizeFromName(rawName, from);

  // Group name — only meaningful when isGroup is true
  const groupName = isGroup
    ? (pickString(d.groupName) ?? pickString(d.subject) ?? pickString(d.chatName))
    : undefined;

  // Body / media extraction
  const { body, mediaType, mediaUrl: rawMediaUrl } = extractContent(d, message);

  // Resolve relative mediaUrl against baseUrl
  const mediaUrl = rawMediaUrl ? resolveMediaUrl(rawMediaUrl, baseUrl) : undefined;

  // Timestamp resolution. Baileys messageTimestamp is in seconds; envelope `ts`
  // might already be ms. Heuristic: anything < 10^12 is treated as seconds.
  const rawTs =
    pickNumber(d.timestamp) ??
    pickNumber(d.messageTimestamp) ??
    pickNumber(ts) ??
    Date.now();
  const timestamp = rawTs < 1_000_000_000_000 ? rawTs * 1000 : rawTs;

  return {
    sessionId,
    from,
    fromName,
    body: body ?? '',
    timestamp,
    isGroup,
    groupName,
    mediaType,
    mediaUrl,
    direction,
  };
}

interface ContentSlice {
  body?: string;
  mediaType?: MediaType;
  mediaUrl?: string;
}

function extractContent(envelope: Record<string, unknown>, message: Record<string, unknown> | undefined): ContentSlice {
  // 1. Top-level normalized fields (whatsapp-api may emit these directly).
  const directBody = pickString(envelope.body) ?? pickString(envelope.text) ?? pickString(envelope.message);
  const directMediaType = normalizeMediaType(pickString(envelope.mediaType) ?? pickString(envelope.type));
  const directMediaUrl =
    pickString(envelope.mediaUrl) ??
    pickString((envelope.media as Record<string, unknown> | undefined)?.url);
  if (directBody !== undefined || directMediaType || directMediaUrl) {
    return {
      body: directBody,
      mediaType: directMediaType,
      mediaUrl: directMediaUrl,
    };
  }

  // 2. Baileys `message` proto shape.
  if (!message) return {};

  const conversation = pickString(message.conversation);
  if (conversation) return { body: conversation };

  const ext = message.extendedTextMessage as Record<string, unknown> | undefined;
  if (ext) {
    const text = pickString(ext.text);
    if (text) return { body: text };
  }

  const image = message.imageMessage as Record<string, unknown> | undefined;
  if (image) {
    return {
      body: pickString(image.caption) ?? '',
      mediaType: 'image',
      mediaUrl: pickString(image.url),
    };
  }

  const video = message.videoMessage as Record<string, unknown> | undefined;
  if (video) {
    return {
      body: pickString(video.caption) ?? '',
      mediaType: 'video',
      mediaUrl: pickString(video.url),
    };
  }

  const audio = message.audioMessage as Record<string, unknown> | undefined;
  if (audio) {
    return { body: '', mediaType: 'audio', mediaUrl: pickString(audio.url) };
  }

  const doc = message.documentMessage as Record<string, unknown> | undefined;
  if (doc) {
    return {
      body: pickString(doc.fileName) ?? pickString(doc.caption) ?? '',
      mediaType: 'document',
      mediaUrl: pickString(doc.url),
    };
  }

  const sticker = message.stickerMessage as Record<string, unknown> | undefined;
  if (sticker) {
    return { body: '', mediaType: 'sticker', mediaUrl: pickString(sticker.url) };
  }

  // Some Baileys variants nest the actual message under ephemeralMessage / viewOnceMessage.
  const ephemeral = (message.ephemeralMessage as Record<string, unknown> | undefined)?.message as
    | Record<string, unknown>
    | undefined;
  if (ephemeral) return extractContent(envelope, ephemeral);

  const viewOnce = (message.viewOnceMessage as Record<string, unknown> | undefined)?.message as
    | Record<string, unknown>
    | undefined;
  if (viewOnce) return extractContent(envelope, viewOnce);

  return {};
}

function resolveMediaUrl(url: string, baseUrl: string): string {
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(url)) return url;
  if (url.startsWith('//')) {
    // Protocol-relative; pick scheme from baseUrl.
    const scheme = baseUrl.startsWith('https://') ? 'https:' : 'http:';
    return scheme + url;
  }
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${trimmedBase}${path}`;
}

function normalizeMediaType(value: string | undefined): MediaType | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'image' || v === 'video' || v === 'audio' || v === 'document' || v === 'sticker') return v;
  return undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Clean up a candidate display name before exposing it to the frontend.
 *  - undefined/null/empty → undefined
 *  - "5215512345678@s.whatsapp.net" → "5215512345678" (strip JID domain)
 *  - "5215512345678" when `from` resolves to the same digits → undefined
 *    (prevents redundant "from: 5215...\n5215..." display)
 *  - leading/trailing whitespace → trimmed
 *
 * Exported for unit testing.
 */
export function sanitizeFromName(
  name: string | null | undefined,
  fromJid: string,
): string | undefined {
  if (!name) return undefined;
  let trimmed = name.trim();
  if (!trimmed) return undefined;

  // Strip a JID domain if it leaked into the name field.
  const atIdx = trimmed.indexOf('@');
  if (atIdx > 0) {
    trimmed = trimmed.slice(0, atIdx).trim();
    if (!trimmed) return undefined;
  }

  // If the name is just the phone digits that match the from JID, drop it —
  // the frontend already shows the JID/number elsewhere.
  const fromDigits = (fromJid.split('@')[0] ?? '').replace(/\D/g, '');
  const nameDigits = trimmed.replace(/\D/g, '');
  if (
    fromDigits.length > 0 &&
    nameDigits.length > 0 &&
    nameDigits === fromDigits &&
    trimmed.replace(/\D/g, '').length === trimmed.length
  ) {
    return undefined;
  }

  return trimmed;
}
