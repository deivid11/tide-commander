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

import type {
  DownloadedAttachment,
  IntegrationContext,
  TriggerHandler,
  TriggerDefinition,
  ExternalEvent,
  SkippedAttachment,
} from '../../../shared/integration-types.js';
import { loadConfig, WHATSAPP_API_KEY_SECRET } from './whatsapp-config.js';
import { WhatsAppWsClient, type WhatsAppUpstreamEvent } from './whatsapp-ws-client.js';
import { MessageDedupeCache } from './message-dedupe.js';
import { ContactNameCache } from './contact-name-cache.js';
import { GroupNameCache } from './group-name-cache.js';
import { WhatsAppClient } from './whatsapp-client.js';
import { createLogger } from '../../utils/logger.js';
import { downloadAttachment, formatAttachmentLine, MAX_ATTACHMENT_BYTES } from '../../services/attachment-downloader.js';
import * as crypto from 'crypto';

const log = createLogger('WhatsAppTrigger');

export interface WhatsAppMessageBridge {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface NormalizedWhatsAppMessage {
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
  /**
   * Original chat JID before participant override. For 1:1 DMs equals `from`.
   * For groups, it's the @g.us JID. For status updates, it's `status@broadcast`.
   * Used by the trigger handler to filter out non-message events (statuses,
   * broadcasts) without consulting the upstream payload.
   */
  chatId: string;
  /** Stable Baileys-side message id (`key.id` or top-level `id`). Needed to
   *  build the upstream media-download URL. */
  messageId?: string;
  /** MIME type extracted from the matched Baileys media proto, when present. */
  mediaMimetype?: string;
  /** Size in bytes reported by Baileys (`fileLength`). */
  mediaSize?: number;
  /** Original filename (documents only — Baileys sets `fileName`). */
  mediaFilename?: string;
  /** Absolute path on disk after the media bytes were fetched via the upstream
   *  proxy. Set by `handleEvent` AFTER `normalizeBaileysMessage` returns. */
  mediaPath?: string;
  /** Local copy of the downloaded media bytes, with metadata. Set alongside
   *  `mediaPath` when the download succeeded. */
  attachment?: DownloadedAttachment;
  /** Reason the media was NOT downloaded (size cap, fetch failure). Surfaced
   *  to triggers as an `[attachment-skipped: …]` line so the agent still gets
   *  context. */
  skippedAttachment?: SkippedAttachment;
}

// Module-level subscriber set fed by the in-process bridge whenever a normalized
// WhatsApp message is broadcast. The trigger-service-facing handler below
// registers its callback here, so subscribers stay attached even when the bridge
// restarts (e.g. on config change).
const triggerSubscribers = new Set<(msg: NormalizedWhatsAppMessage) => void>();

function notifyTriggerSubscribers(payload: NormalizedWhatsAppMessage): void {
  for (const cb of triggerSubscribers) {
    try {
      cb(payload);
    } catch {
      // Subscriber errors must not break the bridge — swallow.
    }
  }
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
const CONTACT_NAME_TTL_MS = 10 * 60_000;

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
  //
  // syncContacts() runs first because the upstream's default /contacts only
  // exposes a small "blocked + recently active" subset (~39 entries observed).
  // syncContacts pulls every WhatsApp address-book tier (critical_unblock_low,
  // regular_high, regular_low, critical_block, regular) — without it, most DM
  // JIDs miss the cache and bubbles fall back to formatted phone. The cache's
  // 10-min TTL throttles the sync to at most once per session per window;
  // upstream returns added:0 quickly when nothing's new.
  const contactNames = new ContactNameCache({
    ttlMs: CONTACT_NAME_TTL_MS,
    fetchContacts: async (sessionId) => {
      const cfg = loadConfig();
      const apiKey = ctx.secrets.get(WHATSAPP_API_KEY_SECRET);
      if (!apiKey) return [];
      const wac = new WhatsAppClient(cfg.baseUrl, apiKey);
      try {
        await wac.syncContacts(sessionId);
      } catch (err) {
        ctx.log.warn(`WhatsApp syncContacts failed (continuing with cached list): ${err}`);
      }
      return wac.getContacts(sessionId);
    },
  });

  // Same idea but for group subjects: per-message webhook payloads from the
  // upstream don't carry the group name, so we fetch the groups list once per
  // session and cache it. See group-name-cache.ts header for the why.
  const groupNames = new GroupNameCache({
    ttlMs: CONTACT_NAME_TTL_MS,
    fetchGroups: async (sessionId) => {
      const cfg = loadConfig();
      const apiKey = ctx.secrets.get(WHATSAPP_API_KEY_SECRET);
      if (!apiKey) return [];
      const wac = new WhatsAppClient(cfg.baseUrl, apiKey);
      return wac.getGroups(sessionId);
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
    groupNames.clear();
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

      // Enrich inbound DMs/groups in parallel:
      //  - fromName from the upstream contacts list (pushName is stripped from
      //    webhook payloads — see whatsapp-api/src/webhookHandler.js)
      //  - groupName from the upstream groups list (group subject is also
      //    absent from per-message webhooks — confirmed in trigger_events for
      //    the Bolba group: groupName=NULL on every stored event)
      const enrichContactCfg = config.enrichContactName !== false;
      // For DMs, `payload.from` is the OTHER party's JID regardless of
      // direction (Baileys sets key.remoteJid to the chat counterparty), so
      // looking it up in contacts gives the right name in both inbound and
      // outbound bubbles. Skipped for outbound groups because `payload.from`
      // there is the group JID itself, not a participant — the lookup would
      // be a guaranteed miss.
      const needsContactEnrich =
        enrichContactCfg &&
        !payload.fromName &&
        !!payload.from &&
        !(payload.isGroup && payload.direction === 'outbound');
      const needsGroupEnrich =
        enrichContactCfg &&
        payload.isGroup &&
        !payload.groupName &&
        !!payload.chatId;

      // Media → download bytes via the upstream proxy (NOT the raw Baileys
      // `mediaUrl`, which points at an encrypted Meta CDN). The upstream
      // exposes `/api/sessions/<sid>/messages/<mid>/media?download=true`.
      //
      // We download for BOTH directions:
      //  - inbound (`fromMe=false`): a contact sent media into our number.
      //  - outbound (`fromMe=true`): the WhatsApp account itself originated
      //    the media — this is the real-world case where David sends an
      //    attachment from his own WA so Bolba can process it. The fact that
      //    Baileys reports `fromMe=true` on messages we ourselves typed in
      //    the WA app is exactly why filtering on direction was wrong.
      //
      // The only case where this is wasteful is Tide Commander itself sending
      // media via `/api/whatsapp/send-media-url` (upstream echoes back the
      // `message_create` with `fromMe=true` + mediaType). That's a localhost
      // self-fetch that costs almost nothing, so we don't bother
      // distinguishing it from the user-typing case.
      const needsMediaDownload =
        !!payload.mediaType &&
        !!payload.messageId;

      if (!needsContactEnrich && !needsGroupEnrich && !needsMediaDownload) {
        ctx.broadcast({ type: 'whatsapp_message', payload });
        notifyTriggerSubscribers(payload);
        return;
      }

      const contactPromise = needsContactEnrich
        ? contactNames.lookup(msg.sessionId, payload.from).then((name) => {
            const sanitized = sanitizeFromName(name, payload.from);
            if (sanitized) payload.fromName = sanitized;
            log.debug(`whatsapp.enrich kind=contact resolved=${sanitized ? 'Y' : 'N'} jid=${hashJid(payload.from)}`);
          }).catch((err) => {
            ctx.log.warn(`WhatsApp contact lookup failed: ${err}`);
          })
        : Promise.resolve();
      const groupPromise = needsGroupEnrich
        ? groupNames.lookup(msg.sessionId, payload.chatId).then((name) => {
            const trimmed = typeof name === 'string' ? name.trim() : '';
            if (trimmed) payload.groupName = trimmed;
            log.debug(`whatsapp.enrich kind=group resolved=${trimmed ? 'Y' : 'N'} jid=${hashJid(payload.chatId)}`);
          }).catch((err) => {
            ctx.log.warn(`WhatsApp group lookup failed: ${err}`);
          })
        : Promise.resolve();

      const mediaPromise = needsMediaDownload
        ? (async () => {
            const apiKey = ctx.secrets.get(WHATSAPP_API_KEY_SECRET);
            if (!apiKey) {
              payload.skippedAttachment = {
                reason: 'fetch-failed',
                filename: payload.mediaFilename,
                size: payload.mediaSize,
                detail: 'whatsapp.apiKey secret missing',
              };
              return;
            }
            const base = config.baseUrl.replace(/\/+$/, '');
            const downloadUrl = `${base}/api/sessions/${encodeURIComponent(payload.sessionId)}/messages/${encodeURIComponent(payload.messageId!)}/media?download=true`;
            if (typeof payload.mediaSize === 'number' && payload.mediaSize > MAX_ATTACHMENT_BYTES) {
              payload.skippedAttachment = {
                reason: 'too-large',
                filename: payload.mediaFilename,
                size: payload.mediaSize,
                sourceUrl: downloadUrl,
              };
              return;
            }
            try {
              const result = await downloadAttachment({
                source: 'whatsapp',
                messageId: payload.messageId!,
                url: downloadUrl,
                headers: { 'X-API-Key': apiKey },
                suggestedFilename: payload.mediaFilename,
                mimetype: payload.mediaMimetype,
                sizeHintBytes: payload.mediaSize,
              });
              if (result) {
                payload.mediaPath = result.path;
                payload.attachment = result;
              } else {
                payload.skippedAttachment = {
                  reason: 'fetch-failed',
                  filename: payload.mediaFilename,
                  size: payload.mediaSize,
                  sourceUrl: downloadUrl,
                };
              }
            } catch (err) {
              ctx.log.warn(`WhatsApp media download threw: ${err}`);
              payload.skippedAttachment = {
                reason: 'fetch-failed',
                filename: payload.mediaFilename,
                size: payload.mediaSize,
                sourceUrl: downloadUrl,
                detail: String(err),
              };
            }
          })()
        : Promise.resolve();

      void Promise.all([contactPromise, groupPromise, mediaPromise]).then(() => {
        ctx.broadcast({ type: 'whatsapp_message', payload });
        notifyTriggerSubscribers(payload);
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
  const { body, mediaType, mediaUrl: rawMediaUrl, mediaMimetype, mediaSize, mediaFilename } = extractContent(d, message);

  // Resolve relative mediaUrl against baseUrl
  const mediaUrl = rawMediaUrl ? resolveMediaUrl(rawMediaUrl, baseUrl) : undefined;

  // Stable Baileys message id — needed to ask the upstream for the decrypted bytes.
  const messageId =
    pickString(d.id) ??
    (key ? pickString(key.id) : undefined);

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
    chatId: remoteJid ?? from,
    messageId,
    mediaMimetype,
    mediaSize,
    mediaFilename,
  };
}

interface ContentSlice {
  body?: string;
  mediaType?: MediaType;
  mediaUrl?: string;
  mediaMimetype?: string;
  mediaSize?: number;
  mediaFilename?: string;
}

function extractContent(envelope: Record<string, unknown>, message: Record<string, unknown> | undefined): ContentSlice {
  // 1. Top-level normalized fields (whatsapp-api may emit these directly).
  const directBody = pickString(envelope.body) ?? pickString(envelope.text) ?? pickString(envelope.message);
  const directMediaType = normalizeMediaType(pickString(envelope.mediaType) ?? pickString(envelope.type));
  const directMediaUrl =
    pickString(envelope.mediaUrl) ??
    pickString((envelope.media as Record<string, unknown> | undefined)?.url);

  // 1a. The Baileys upstream we ship today emits a *flat* event shape where
  // the media signal lives at `data.type` (e.g. "imageMessage") with no
  // nested `message.imageMessage` proto, no `mediaUrl`, and `media: null`.
  // Detect that case and surface mediaType so the downloader's
  // `${baseUrl}/api/sessions/<sid>/messages/<mid>/media?download=true` URL
  // gets constructed from sessionId+messageId. mimetype/filename/size are
  // intentionally left undefined here — the downloader fills them from the
  // proxy's response headers (Content-Type, Content-Disposition).
  //
  // Trigger conditions, in priority order:
  //   1. `data.type` matches `*Message` (image/video/audio/document/sticker
  //      and all known variants like pttMessage, documentWithCaptionMessage,
  //      videoNoteMessage, etc.)
  //   2. `data.hasMedia === true` regardless of how `data.type` is spelled.
  // We default unknown variants to `document` (the catch-all "it's a file"
  // category) so the download proceeds; the UI chip picks an icon from the
  // mimetype the downloader fills in.
  const flatType = pickString(envelope.type);
  const flatHasMedia = pickBoolean(envelope.hasMedia) === true;
  const flatTypeIsMessage = !!flatType && /Message$/i.test(flatType);
  if (flatTypeIsMessage || (flatHasMedia && !directMediaType && !directMediaUrl)) {
    return {
      body: directBody,
      mediaType: classifyFlatType(flatType),
      mediaUrl: undefined,
      mediaMimetype: undefined,
      mediaFilename: undefined,
      mediaSize: undefined,
    };
  }

  // Short-circuit ONLY when the upstream pre-normalized actual media metadata
  // at the top level. Earlier this branch also fired on `directBody` alone,
  // which meant a Baileys envelope carrying `body='caption text'` + a real
  // `message.imageMessage` proto was returned as text-only — the media
  // extraction below was skipped and downstream `payload.mediaType` came back
  // undefined. Fall through when only the body is set so the Baileys proto
  // gets a chance to provide the media info.
  if (directMediaType || directMediaUrl) {
    const mediaObj = envelope.media as Record<string, unknown> | undefined;
    return {
      body: directBody,
      mediaType: directMediaType,
      mediaUrl: directMediaUrl,
      mediaMimetype: pickString(envelope.mediaMimetype) ?? pickString(envelope.mimetype) ?? pickString(mediaObj?.mimetype),
      mediaSize: pickNumber(envelope.mediaSize) ?? pickNumber(envelope.fileLength) ?? pickNumber(mediaObj?.size),
      mediaFilename: pickString(envelope.mediaFilename) ?? pickString(envelope.fileName) ?? pickString(mediaObj?.fileName),
    };
  }

  // 2. Baileys `message` proto shape.
  if (!message) {
    // No proto to inspect but we may still have a plain text body at the top
    // level. Return it so the trigger gets *something*; mediaType remains
    // unset which is correct.
    return directBody !== undefined ? { body: directBody } : {};
  }

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
      body: pickString(image.caption) ?? directBody ?? '',
      mediaType: 'image',
      mediaUrl: pickString(image.url),
      mediaMimetype: pickString(image.mimetype),
      mediaSize: pickNumber(image.fileLength),
    };
  }

  const video = message.videoMessage as Record<string, unknown> | undefined;
  if (video) {
    return {
      body: pickString(video.caption) ?? directBody ?? '',
      mediaType: 'video',
      mediaUrl: pickString(video.url),
      mediaMimetype: pickString(video.mimetype),
      mediaSize: pickNumber(video.fileLength),
    };
  }

  const audio = message.audioMessage as Record<string, unknown> | undefined;
  if (audio) {
    return {
      body: directBody ?? '',
      mediaType: 'audio',
      mediaUrl: pickString(audio.url),
      mediaMimetype: pickString(audio.mimetype),
      mediaSize: pickNumber(audio.fileLength),
    };
  }

  const doc = message.documentMessage as Record<string, unknown> | undefined;
  if (doc) {
    return {
      body: pickString(doc.fileName) ?? pickString(doc.caption) ?? directBody ?? '',
      mediaType: 'document',
      mediaUrl: pickString(doc.url),
      mediaMimetype: pickString(doc.mimetype),
      mediaSize: pickNumber(doc.fileLength),
      mediaFilename: pickString(doc.fileName) ?? pickString(doc.title),
    };
  }

  const sticker = message.stickerMessage as Record<string, unknown> | undefined;
  if (sticker) {
    return {
      body: directBody ?? '',
      mediaType: 'sticker',
      mediaUrl: pickString(sticker.url),
      mediaMimetype: pickString(sticker.mimetype),
      mediaSize: pickNumber(sticker.fileLength),
    };
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

  // Unknown proto shape (reaction, protocol, etc.) — preserve the top-level
  // body so the trigger still receives the text.
  return directBody !== undefined ? { body: directBody } : {};
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

/**
 * Map an upstream `data.type` (Baileys-style, suffixed `Message`) to one of
 * the supported MediaType buckets. Known variants:
 *   - imageMessage → image
 *   - videoMessage, videoNoteMessage → video
 *   - audioMessage, pttMessage → audio
 *   - documentMessage, documentWithCaptionMessage → document
 *   - stickerMessage → sticker
 *   - any other `*Message` or unknown signal → document (catch-all "it's a file")
 * Returns `'document'` as a safe default rather than `undefined` so the
 * download predicate (`!!payload.mediaType && !!payload.messageId`) stays
 * true and the proxy is given a chance to deliver the bytes.
 */
function classifyFlatType(type: string | undefined): MediaType {
  const t = (type ?? '').toLowerCase();
  if (t.startsWith('image')) return 'image';
  if (t.startsWith('video')) return 'video';
  if (t.startsWith('audio') || t.startsWith('ptt') || t.startsWith('voice')) return 'audio';
  if (t.startsWith('sticker')) return 'sticker';
  // documentMessage, documentWithCaptionMessage, and ANY other `*Message`
  // variant we don't explicitly know about. Better to attempt the download
  // and let the proxy decide than to silently skip an unknown media kind.
  return 'document';
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

/**
 * Format a WhatsApp JID as a phone-style string when no display name is
 * available. Strips the JID domain and any group-participant tag, then groups
 * the digit run for Mexican mobiles (+52 1 NNN NNN NNNN), generic 12-digit
 * MX (+52 NNN NNN NNNN), 11-digit US (+1 NNN NNN NNNN). Anything else falls
 * back to '+<digits>'. Empty / unparseable input returns ''.
 *
 * Exported for unit testing.
 */
export function humanizeWhatsAppJid(jid: string | undefined): string {
  if (!jid) return '';
  const stripped = jid.replace(/@.*$/, '').split('-')[0];
  const digits = stripped.replace(/\D/g, '');
  if (!digits) return '';
  if (/^521(\d{3})(\d{3})(\d{4})$/.test(digits)) {
    const m = digits.match(/^521(\d{3})(\d{3})(\d{4})$/)!;
    return `+52 1 ${m[1]} ${m[2]} ${m[3]}`;
  }
  if (digits.length === 12 && digits.startsWith('52')) {
    return `+52 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

/**
 * Best-effort label for a group chat when the upstream payload does not carry
 * the group subject. Renders as `Grupo <last4>` so the user gets *something*
 * stable to recognize across messages from the same group.
 *
 * Exported for unit testing.
 */
export function humanizeGroupJid(chatId: string | undefined): string {
  if (!chatId) return '';
  const stripped = chatId.replace(/@.*$/, '');
  const digits = stripped.replace(/\D/g, '');
  if (!digits) return '';
  return `Grupo ${digits.slice(-4)}`;
}

/**
 * Short opaque hash of a JID for debug logging — keeps the JID off disk while
 * still letting us correlate enrichment outcomes across log lines for the
 * same chat. Uses 8 hex chars of SHA-1; cryptographic strength is not the
 * point, just that it's not the JID itself.
 */
function hashJid(jid: string | undefined): string {
  if (!jid) return '_';
  return crypto.createHash('sha1').update(jid).digest('hex').slice(0, 8);
}

// ─── Trigger Service Handler ───
// Real TriggerHandler that the trigger-service registers at boot. Subscribes to
// the in-process bridge's notifyTriggerSubscribers stream so it keeps receiving
// events across bridge restarts (config-change driven).

interface WhatsAppTriggerConfig {
  fromFilter?: string[];
  bodyPattern?: string;
  direction?: 'inbound' | 'outbound' | 'any';
  groupOnly?: boolean;
  dmOnly?: boolean;
  sessionId?: string;
  includeStatuses?: boolean;
}

// Chat IDs that represent non-message channels (status updates, broadcast
// lists). The bridge surfaces them as messages because Baileys delivers
// status posts via `messages.upsert`, but they're not 1:1 / group chats and
// most triggers shouldn't fire on them.
function isStatusOrBroadcastChat(chatId: string): boolean {
  if (!chatId) return false;
  if (chatId === 'status@broadcast') return true;
  if (chatId.endsWith('@broadcast')) return true;
  return false;
}

// Drop presence/typing/group-system events that arrive through the bridge
// with no body and no media — they fire the agent for nothing. Emoji-only
// bodies and media-with-empty-caption are real content and pass through.
export function isEmptyContentMessage(msg: NormalizedWhatsAppMessage): boolean {
  const bodyEmpty = !msg.body || msg.body.trim().length === 0;
  const noMedia = !msg.mediaType && !msg.mediaUrl;
  return bodyEmpty && noMedia;
}

let triggerUnsubscribe: (() => void) | null = null;

export const whatsappTriggerHandler: TriggerHandler = {
  triggerType: 'whatsapp',

  async startListening(onEvent) {
    const cb = (msg: NormalizedWhatsAppMessage) => {
      onEvent({
        source: 'whatsapp',
        type: 'message',
        data: msg,
        timestamp: msg.timestamp,
      });
    };
    triggerSubscribers.add(cb);
    triggerUnsubscribe = () => triggerSubscribers.delete(cb);
  },

  async stopListening() {
    if (triggerUnsubscribe) {
      triggerUnsubscribe();
      triggerUnsubscribe = null;
    }
  },

  structuralMatch(trigger: TriggerDefinition, event: ExternalEvent): boolean {
    const msg = event.data as NormalizedWhatsAppMessage;
    const cfg = trigger.config as WhatsAppTriggerConfig;

    // Drop status updates and broadcast-list messages by default — they're
    // surfaced through the same bridge as real messages but represent stories /
    // broadcasts, not conversations. Opt-in via includeStatuses.
    if (!cfg.includeStatuses && isStatusOrBroadcastChat(msg.chatId)) return false;

    if (isEmptyContentMessage(msg)) {
      log.debug(`whatsapp.trigger.skipped reason=empty_content session=${msg.sessionId}`);
      return false;
    }

    if (cfg.direction && cfg.direction !== 'any' && msg.direction !== cfg.direction) return false;
    if (cfg.groupOnly && !msg.isGroup) return false;
    if (cfg.dmOnly && msg.isGroup) return false;
    if (cfg.sessionId && msg.sessionId !== cfg.sessionId) return false;

    if (cfg.fromFilter?.length) {
      const fromLower = msg.from.toLowerCase();
      if (!cfg.fromFilter.some(f => fromLower.includes(f.toLowerCase()))) return false;
    }

    if (cfg.bodyPattern) {
      try {
        if (!new RegExp(cfg.bodyPattern, 'i').test(msg.body)) return false;
      } catch {
        return false;
      }
    }

    return true;
  },

  extractVariables(trigger: TriggerDefinition, event: ExternalEvent): Record<string, string> {
    const msg = event.data as NormalizedWhatsAppMessage;
    void trigger;
    const fromName = msg.fromName?.trim() || humanizeWhatsAppJid(msg.from);
    const groupName = msg.isGroup
      ? (msg.groupName?.trim() || humanizeGroupJid(msg.chatId))
      : '';

    // Build the attachments block (single line — WA messages carry at most one
    // media payload). Use the downloaded local path when present; otherwise
    // emit a `[attachment-skipped: …]` marker if we tried and failed.
    let attachmentsBlock = '';
    if (msg.attachment) {
      attachmentsBlock = formatAttachmentLine(msg.attachment);
    } else if (msg.skippedAttachment) {
      const sk = msg.skippedAttachment;
      const sizeMb = typeof sk.size === 'number' ? `${Math.round(sk.size / (1024 * 1024))}MB` : 'unknown';
      attachmentsBlock = `[attachment-skipped: ${sk.reason} name=${sk.filename ?? 'unknown'} size=${sizeMb}${sk.detail ? ` detail=${sk.detail}` : ''}]`;
    }

    return {
      'whatsapp.from': msg.from,
      'whatsapp.fromName': fromName,
      'whatsapp.body': msg.body,
      'whatsapp.sessionId': msg.sessionId,
      'whatsapp.chatId': msg.chatId,
      'whatsapp.isGroup': String(msg.isGroup),
      'whatsapp.groupName': groupName,
      'whatsapp.direction': msg.direction,
      'whatsapp.mediaType': msg.mediaType ?? '',
      'whatsapp.mediaUrl': msg.mediaUrl ?? '',
      // New: local path + metadata for inbound media, plus a ready-to-paste
      // attachments block. Additive — old templates ignore these.
      'whatsapp.attachmentPath': msg.attachment?.path ?? '',
      'whatsapp.attachmentMime': msg.attachment?.mimetype ?? msg.mediaMimetype ?? '',
      'whatsapp.attachmentName': msg.attachment?.filename ?? msg.mediaFilename ?? '',
      'whatsapp.attachmentSize': msg.attachment ? String(msg.attachment.size) : (msg.mediaSize !== undefined ? String(msg.mediaSize) : ''),
      'whatsapp.attachmentsBlock': attachmentsBlock,
      'whatsapp.timestamp': new Date(msg.timestamp).toISOString(),
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as NormalizedWhatsAppMessage;
    const sender = msg.fromName ? `${msg.fromName} (${msg.from})` : msg.from;
    const channel = msg.isGroup ? `group "${msg.groupName ?? msg.from}"` : 'DM';
    const verb = msg.direction === 'outbound' ? 'sent' : 'received';
    // If we downloaded the media, surface the local path as the agent-facing
    // attachment marker (it supersedes the raw mediaUrl). If we tried but
    // failed, surface that explicitly so the agent doesn't silently miss it.
    let mediaSuffix = '';
    if (msg.attachment) {
      mediaSuffix = `\n\n${formatAttachmentLine(msg.attachment)}`;
    } else if (msg.skippedAttachment) {
      const sk = msg.skippedAttachment;
      const sizeMb = typeof sk.size === 'number' ? `${Math.round(sk.size / (1024 * 1024))}MB` : 'unknown';
      mediaSuffix = `\n\n[attachment-skipped: ${sk.reason} name=${sk.filename ?? 'unknown'} size=${sizeMb}${sk.detail ? ` detail=${sk.detail}` : ''}]`;
    } else if (msg.mediaType) {
      mediaSuffix = `\n[${msg.mediaType} attachment${msg.mediaUrl ? ` ${msg.mediaUrl}` : ''}]`;
    }
    return `WhatsApp message ${verb} in ${channel}\nFrom: ${sender}\nSession: ${msg.sessionId}\nTime: ${new Date(msg.timestamp).toISOString()}\n\n${msg.body}${mediaSuffix}`;
  },
};
