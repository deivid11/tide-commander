/**
 * Slack Client
 * Manages Slack Web API + Socket Mode connection, message sending/receiving,
 * channel/user lookup, and long-poll reply waiting.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import type { IntegrationContext, IntegrationStatus } from '../../../shared/integration-types.js';
import type { SlackMessageEvent } from '../../../shared/event-types.js';
import { loadConfig, updateConfig } from './slack-config.js';

// ─── Types ───

export interface SlackMessage {
  ts: string;
  threadTs?: string;
  channel: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  /** Files attached to this message (only populated when Slack returns a files[] array). */
  files?: SlackFile[];
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  topic?: string;
  purpose?: string;
}

export interface SlackUser {
  id: string;
  name: string;
  realName: string;
  displayName: string;
  email?: string;
  isBot: boolean;
}

export interface SlackFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  size?: number;
  permalink?: string;
  permalink_public?: string;
  url_private?: string;
  url_private_download?: string;
}

// Subtypes we never want to trigger on: edits, deletions, channel housekeeping, bot echoes.
// NOTE: `file_share` (legacy) and undefined (modern file-share) MUST NOT be in this set.
const SKIP_MESSAGE_SUBTYPES = new Set<string>([
  'bot_message',
  'message_changed',
  'message_deleted',
  'message_replied',
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
  'group_topic',
  'group_purpose',
  'group_name',
  'group_archive',
  'group_unarchive',
  'pinned_item',
  'unpinned_item',
]);

// ─── State ───

let webClient: WebClient | null = null;
let socketClient: SocketModeClient | null = null;
let ctx: IntegrationContext | null = null;

// Caches
const userCache = new Map<string, SlackUser>();
const channelNameCache = new Map<string, string>();

// Message listeners (for trigger system)
const messageListeners = new Set<(message: SlackMessage) => void>();

// Pending reply waiters (for wait-for-reply long-poll)
interface ReplyWaiter {
  channel: string;
  threadTs: string;
  fromUsers?: string[];
  messagePattern?: string;
  resolve: (message: SlackMessage | null) => void;
  timer: ReturnType<typeof setTimeout>;
}
const replyWaiters = new Set<ReplyWaiter>();

// ─── Init / Shutdown ───

export async function init(integrationCtx: IntegrationContext): Promise<void> {
  ctx = integrationCtx;

  const botToken = ctx.secrets.get('SLACK_BOT_TOKEN');
  const appToken = ctx.secrets.get('SLACK_APP_TOKEN');
  const config = loadConfig();

  if (!config.enabled || !botToken || !appToken) {
    ctx.log.info('Slack integration disabled or missing tokens, skipping connection');
    return;
  }

  await connect(botToken, appToken);
}

export async function shutdown(): Promise<void> {
  await disconnect();
  userCache.clear();
  channelNameCache.clear();
  messageListeners.clear();

  // Cancel all pending waiters
  for (const waiter of replyWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(null);
  }
  replyWaiters.clear();
}

// ─── Connection Management ───

async function connect(botToken: string, appToken: string): Promise<void> {
  updateConfig({ status: 'connecting', lastError: undefined });

  try {
    webClient = new WebClient(botToken);
    socketClient = new SocketModeClient({ appToken });

    // Test auth and get bot info
    const authResult = await webClient.auth.test();
    const botUserId = authResult.user_id as string;
    const botName = (authResult.user as string) || 'tide-bot';

    updateConfig({
      status: 'connected',
      botUserId,
      botName,
      connectedAt: Date.now(),
    });

    // Set up Socket Mode event handling
    setupSocketHandlers();

    // Start Socket Mode connection
    await socketClient.start();

    ctx?.log.info(`Slack connected as @${botName} (${botUserId})`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateConfig({ status: 'error', lastError: errorMsg });
    ctx?.log.error(`Slack connection failed: ${errorMsg}`);
    webClient = null;
    socketClient = null;
    throw err;
  }
}

export async function reconnect(): Promise<void> {
  if (!ctx) throw new Error('Slack not initialized');

  await disconnect();

  const botToken = ctx.secrets.get('SLACK_BOT_TOKEN');
  const appToken = ctx.secrets.get('SLACK_APP_TOKEN');

  if (!botToken || !appToken) {
    throw new Error('Missing Slack tokens');
  }

  await connect(botToken, appToken);
}

export async function disconnect(): Promise<void> {
  if (socketClient) {
    try {
      await socketClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    socketClient = null;
  }
  webClient = null;
  updateConfig({ status: 'disconnected', connectedAt: undefined });
}

function setupSocketHandlers(): void {
  if (!socketClient) return;

  socketClient.on('message', async ({ event, ack }) => {
    await ack();

    if (!event) return;

    // Drop non-trigger-worthy subtypes (edits, joins, bot echoes, topic changes, etc.).
    // Modern file-share messages have NO subtype; legacy ones use `file_share` — both must pass.
    if (event.subtype && SKIP_MESSAGE_SUBTYPES.has(event.subtype as string)) return;

    const hasFiles = Array.isArray(event.files) && event.files.length > 0;
    const text = (event.text as string | undefined) ?? '';

    // Require either text or attached files — otherwise there's nothing useful to trigger on.
    if (!text && !hasFiles) return;

    // Skip bot's own messages
    const config = loadConfig();
    if (event.user === config.botUserId) return;

    // Resolve username
    const user = await resolveUser(event.user);
    const userName = user?.displayName || user?.name || event.user;

    const files = hasFiles
      ? (event.files as SlackFile[]).map((f) => normalizeSlackFile(f))
      : undefined;

    const message: SlackMessage = {
      ts: event.ts,
      threadTs: event.thread_ts,
      channel: event.channel,
      userId: event.user,
      userName,
      text,
      timestamp: parseSlackTs(event.ts),
      files,
    };

    // Log to SQLite
    ctx?.eventDb.logSlackMessage({
      ts: event.ts,
      threadTs: event.thread_ts,
      channelId: event.channel,
      channelName: channelNameCache.get(event.channel),
      userId: event.user,
      userName,
      text,
      direction: 'inbound',
      rawEvent: event,
      receivedAt: Date.now(),
    } satisfies SlackMessageEvent);

    // Broadcast to WS clients
    ctx?.broadcast({
      type: 'slack_message_received',
      payload: {
        channel: event.channel,
        userName,
        text,
        ts: event.ts,
        fileCount: files?.length ?? 0,
      },
    });

    // Notify trigger listeners
    for (const listener of messageListeners) {
      try {
        listener(message);
      } catch (err) {
        ctx?.log.error(`Slack message listener error: ${err}`);
      }
    }

    // Check reply waiters
    for (const waiter of replyWaiters) {
      if (waiter.channel !== message.channel) continue;
      if (waiter.threadTs !== message.threadTs && waiter.threadTs !== message.ts) continue;
      if (waiter.fromUsers?.length && !waiter.fromUsers.includes(message.userId)) continue;
      if (waiter.messagePattern && !new RegExp(waiter.messagePattern).test(message.text)) continue;

      clearTimeout(waiter.timer);
      replyWaiters.delete(waiter);
      waiter.resolve(message);
    }
  });

  socketClient.on('disconnect', () => {
    ctx?.log.warn('Slack Socket Mode disconnected');
    updateConfig({ status: 'disconnected' });
  });

  socketClient.on('unable_to_socket_mode_start', (err) => {
    ctx?.log.error(`Slack Socket Mode start failed: ${err}`);
    updateConfig({ status: 'error', lastError: String(err) });
  });
}

// ─── Sending ───

export interface SendMessageParams {
  channel: string;
  text: string;
  threadTs?: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export async function sendMessage(params: SendMessageParams): Promise<{ ts: string; channel: string }> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.chat.postMessage({
    channel: params.channel,
    text: params.text,
    thread_ts: params.threadTs,
  });

  const ts = result.ts as string;
  const channel = result.channel as string;
  const config = loadConfig();

  // Log outbound message to SQLite
  ctx?.eventDb.logSlackMessage({
    ts,
    threadTs: params.threadTs,
    channelId: channel,
    channelName: channelNameCache.get(channel),
    userId: config.botUserId || '',
    userName: config.botName || 'tide-bot',
    text: params.text,
    direction: 'outbound',
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    receivedAt: Date.now(),
  } satisfies SlackMessageEvent);

  return { ts, channel };
}

// ─── Reactions ───

export interface AddReactionParams {
  channel: string;
  /** Slack message timestamp. */
  ts: string;
  /** Emoji slug without colons (e.g. "eyes"). Raw eye emoji chars are normalized to "eyes". */
  name: string;
}

/**
 * Add an emoji reaction to a message. Requires `reactions:write`.
 * `already_reacted` responses are swallowed silently.
 */
export async function addReaction(params: AddReactionParams): Promise<void> {
  if (!webClient) throw new Error('Slack not connected');

  const name = normalizeEmojiName(params.name);
  try {
    await webClient.reactions.add({
      channel: params.channel,
      timestamp: params.ts,
      name,
    });
  } catch (err) {
    const slackErr = (err as { data?: { error?: string } }).data?.error;
    if (slackErr === 'already_reacted') return;
    throw err;
  }
}

/** Map raw emoji chars to Slack slugs; strip surrounding colons if caller passed `:eyes:`. */
function normalizeEmojiName(input: string): string {
  const trimmed = input.trim().replace(/^:|:$/g, '');
  // Any eye-related emoji char collapses to the common `eyes` slug.
  if (trimmed === '👁' || trimmed === '👁️' || trimmed === '👀') return 'eyes';
  return trimmed;
}

// ─── Reading ───

export interface GetMessagesParams {
  channel: string;
  limit?: number;
  oldest?: string;
  latest?: string;
}

export async function getChannelMessages(params: GetMessagesParams): Promise<SlackMessage[]> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.conversations.history({
    channel: params.channel,
    limit: params.limit || 20,
    oldest: params.oldest,
    latest: params.latest,
  });

  return Promise.all(
    (result.messages || []).map((msg) => slackApiMessageToSlackMessage(msg as Record<string, unknown>, params.channel))
  );
}

export interface GetThreadParams {
  channel: string;
  threadTs: string;
  limit?: number;
}

export async function getThreadReplies(params: GetThreadParams): Promise<SlackMessage[]> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.conversations.replies({
    channel: params.channel,
    ts: params.threadTs,
    limit: params.limit || 50,
  });

  return Promise.all(
    (result.messages || []).map((msg) => slackApiMessageToSlackMessage(msg as Record<string, unknown>, params.channel))
  );
}

// ─── Wait For Reply (Long-Poll) ───

export interface WaitForReplyParams {
  channel: string;
  threadTs: string;
  fromUsers?: string[];
  timeoutMs?: number;
  messagePattern?: string;
}

export function waitForReply(params: WaitForReplyParams): Promise<SlackMessage | null> {
  const timeout = params.timeoutMs || 300000; // 5 min default

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      replyWaiters.delete(waiter);
      resolve(null);
    }, timeout);

    const waiter: ReplyWaiter = {
      channel: params.channel,
      threadTs: params.threadTs,
      fromUsers: params.fromUsers,
      messagePattern: params.messagePattern,
      resolve,
      timer,
    };

    replyWaiters.add(waiter);
  });
}

// ─── Channel Management ───

export async function joinChannel(channel: string): Promise<{ id: string; name: string }> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.conversations.join({ channel });
  const ch = result.channel as { id: string; name: string } | undefined;
  if (!ch) throw new Error(`Failed to join channel ${channel}`);

  // Update cache
  channelNameCache.set(ch.id, ch.name);

  return { id: ch.id, name: ch.name };
}

// ─── Lookup ───

export async function listChannels(): Promise<SlackChannel[]> {
  if (!webClient) throw new Error('Slack not connected');

  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const result = await webClient.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    });

    for (const ch of result.channels || []) {
      const channel: SlackChannel = {
        id: ch.id as string,
        name: ch.name as string,
        isPrivate: ch.is_private as boolean,
        isMember: ch.is_member as boolean,
        topic: (ch.topic as { value?: string })?.value,
        purpose: (ch.purpose as { value?: string })?.value,
      };
      channels.push(channel);
      channelNameCache.set(channel.id, channel.name);
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return channels;
}

export async function resolveUser(userId: string): Promise<SlackUser> {
  // Check cache
  const cached = userCache.get(userId);
  if (cached) return cached;

  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.users.info({ user: userId });
  const u = result.user;
  if (!u) throw new Error(`User not found: ${userId}`);

  const user: SlackUser = {
    id: u.id as string,
    name: u.name as string,
    realName: (u.real_name as string) || '',
    displayName: (u.profile as { display_name?: string })?.display_name || u.name as string,
    email: (u.profile as { email?: string })?.email,
    isBot: u.is_bot as boolean,
  };

  userCache.set(userId, user);
  return user;
}

export async function findUserByEmail(email: string): Promise<SlackUser | null> {
  if (!webClient) throw new Error('Slack not connected');

  try {
    const result = await webClient.users.lookupByEmail({ email });
    const u = result.user;
    if (!u) return null;

    const user: SlackUser = {
      id: u.id as string,
      name: u.name as string,
      realName: (u.real_name as string) || '',
      displayName: (u.profile as { display_name?: string })?.display_name || u.name as string,
      email: (u.profile as { email?: string })?.email,
      isBot: u.is_bot as boolean,
    };

    userCache.set(user.id, user);
    return user;
  } catch {
    return null;
  }
}

export async function findUserByName(displayName: string): Promise<SlackUser | null> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.users.list({ limit: 500 });
  const lower = displayName.toLowerCase();

  for (const u of result.members || []) {
    const profile = u.profile as { display_name?: string } | undefined;
    if (
      (u.name as string)?.toLowerCase() === lower ||
      (u.real_name as string)?.toLowerCase() === lower ||
      profile?.display_name?.toLowerCase() === lower
    ) {
      const user: SlackUser = {
        id: u.id as string,
        name: u.name as string,
        realName: (u.real_name as string) || '',
        displayName: profile?.display_name || u.name as string,
        email: (u.profile as { email?: string })?.email,
        isBot: u.is_bot as boolean,
      };
      userCache.set(user.id, user);
      return user;
    }
  }

  return null;
}

// ─── Direct Messages ───

export async function openDmChannel(userId: string): Promise<string> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.conversations.open({ users: userId });
  const channelId = (result.channel as { id: string })?.id;
  if (!channelId) throw new Error(`Failed to open DM channel with user ${userId}`);
  return channelId;
}

export interface SendDmParams {
  userId: string;
  text: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export async function sendDm(params: SendDmParams): Promise<{ ts: string; channel: string }> {
  const dmChannel = await openDmChannel(params.userId);
  return sendMessage({
    channel: dmChannel,
    text: params.text,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
  });
}

// ─── File Upload (new two-step flow; files.upload is deprecated Nov 2025) ───

export interface UploadFileParams {
  filename: string;
  bytes: Buffer | Uint8Array;
  /** If omitted, the file is uploaded to Slack but not posted to any channel. */
  channelId?: string;
  title?: string;
  initialComment?: string;
  threadTs?: string;
}

/**
 * Upload a file to Slack via the new two-step flow:
 *   1. files.getUploadURLExternal (filename, length) → { upload_url, file_id }
 *   2. PUT raw bytes to upload_url
 *   3. files.completeUploadExternal (files[], channel_id?, initial_comment?, thread_ts?)
 * Requires the bot token to have the `files:write` scope.
 */
export async function uploadFile(params: UploadFileParams): Promise<{ fileId: string; file: SlackFile }> {
  if (!webClient) throw new Error('Slack not connected');

  const length = params.bytes instanceof Buffer ? params.bytes.length : params.bytes.byteLength;
  if (!length) throw new Error('uploadFile: bytes is empty');

  // Step 1: get an external upload URL
  const step1 = await webClient.files.getUploadURLExternal({
    filename: params.filename,
    length,
  });
  if (!step1.ok || !step1.upload_url || !step1.file_id) {
    throw new Error(`Slack files.getUploadURLExternal failed: ${step1.error ?? 'unknown error'}`);
  }

  // Step 2: POST the raw bytes to the signed upload URL (no Slack auth on this call).
  // Node's global fetch accepts Buffer/Uint8Array at runtime; BodyInit types require a cast.
  const bodyBytes = params.bytes instanceof Buffer
    ? new Uint8Array(params.bytes.buffer, params.bytes.byteOffset, params.bytes.byteLength)
    : params.bytes;
  const putResp = await fetch(step1.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bodyBytes as unknown as BodyInit,
  });
  if (!putResp.ok) {
    const detail = await putResp.text().catch(() => '');
    throw new Error(`Slack upload_url POST failed (${putResp.status}): ${detail}`);
  }

  // Step 3: finalize and (optionally) share
  const files: [{ id: string; title: string }] = [
    { id: step1.file_id, title: params.title ?? params.filename },
  ];
  const step3 = params.channelId
    ? await webClient.files.completeUploadExternal({
        files,
        channel_id: params.channelId,
        initial_comment: params.initialComment,
        thread_ts: params.threadTs,
      })
    : await webClient.files.completeUploadExternal({ files });
  if (!step3.ok) {
    throw new Error(`Slack files.completeUploadExternal failed: ${step3.error ?? 'unknown error'}`);
  }

  const file = (step3.files?.[0] ?? { id: step1.file_id }) as SlackFile;
  return { fileId: step1.file_id, file };
}

// ─── File Read / Download ───

export interface ListFilesParams {
  channelId?: string;
  userId?: string;
  tsFrom?: string;
  tsTo?: string;
  /** Comma-separated Slack file types (e.g. "images,pdfs"). */
  types?: string;
  count?: number;
  page?: number;
}

/**
 * List files visible to the bot, optionally filtered by channel/user/time/type.
 * Requires the bot token to have `files:read`.
 */
export async function listFiles(params: ListFilesParams = {}): Promise<SlackFile[]> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.files.list({
    channel: params.channelId,
    user: params.userId,
    ts_from: params.tsFrom,
    ts_to: params.tsTo,
    types: params.types,
    count: params.count ?? 50,
    page: params.page,
  });

  return ((result.files ?? []) as unknown as SlackFile[]).map((f) => normalizeSlackFile(f));
}

/** Fetch metadata for a single file (title, permalink, url_private, mimetype, size, ...). */
export async function getFileInfo(fileId: string): Promise<SlackFile> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.files.info({ file: fileId });
  if (!result.ok || !result.file) {
    throw new Error(`Slack files.info failed for ${fileId}: ${result.error ?? 'unknown error'}`);
  }
  return normalizeSlackFile(result.file as unknown as SlackFile);
}

/**
 * Fetch a file's raw bytes using the bot token Bearer auth.
 * Slack's `url_private` redirects to the CDN but requires the bot token on the initial request.
 */
export async function fetchFileBytes(fileId: string): Promise<{
  buffer: Buffer;
  contentType: string | null;
  contentDisposition: string | null;
  contentLength: string | null;
  filename?: string;
}> {
  const token = ctx?.secrets.get('SLACK_BOT_TOKEN');
  if (!token) throw new Error('Slack bot token is not configured');

  const info = await getFileInfo(fileId);
  const url = info.url_private_download || info.url_private;
  if (!url) throw new Error(`Slack file ${fileId} has no url_private`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: '*/*',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Slack file download failed for ${fileId} (${response.status}): ${detail}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
    contentDisposition: response.headers.get('content-disposition'),
    contentLength: response.headers.get('content-length'),
    filename: info.name,
  };
}

/**
 * Download a Slack file to disk. Accepts a file id or a full {@link SlackFile} object.
 * Parent directory is created if missing; filename collisions overwrite.
 */
export async function downloadFile(
  file: string | SlackFile,
  outputPath: string
): Promise<{ path: string; bytes: number; filename?: string; mimeType?: string }> {
  const fileId = typeof file === 'string' ? file : file.id;
  const { buffer, filename, contentType } = await fetchFileBytes(fileId);
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  return {
    path: outputPath,
    bytes: buffer.byteLength,
    filename,
    mimeType: contentType ?? undefined,
  };
}

function normalizeSlackFile(f: SlackFile): SlackFile {
  return {
    id: f.id,
    name: f.name,
    title: f.title,
    mimetype: f.mimetype,
    size: f.size,
    permalink: f.permalink,
    permalink_public: f.permalink_public,
    url_private: f.url_private,
    url_private_download: f.url_private_download,
  };
}

export async function searchUsers(query: string): Promise<SlackUser[]> {
  if (!webClient) throw new Error('Slack not connected');

  const result = await webClient.users.list({ limit: 500 });
  const lower = query.toLowerCase();
  const matches: SlackUser[] = [];

  for (const u of result.members || []) {
    if (u.deleted || u.is_bot) continue;
    const profile = u.profile as { display_name?: string; email?: string } | undefined;
    const name = (u.name as string) || '';
    const realName = (u.real_name as string) || '';
    const displayName = profile?.display_name || '';
    const email = profile?.email || '';

    if (
      name.toLowerCase().includes(lower) ||
      realName.toLowerCase().includes(lower) ||
      displayName.toLowerCase().includes(lower) ||
      email.toLowerCase().includes(lower)
    ) {
      const user: SlackUser = {
        id: u.id as string,
        name,
        realName,
        displayName: displayName || name,
        email,
        isBot: false,
      };
      userCache.set(user.id, user);
      matches.push(user);
    }
  }

  return matches;
}

// ─── Event Subscription (for triggers) ───

export function onMessage(callback: (message: SlackMessage) => void): () => void {
  messageListeners.add(callback);
  return () => { messageListeners.delete(callback); };
}

// ─── Status ───

export function getStatus(): IntegrationStatus {
  const config = loadConfig();
  return {
    connected: config.status === 'connected',
    lastChecked: Date.now(),
    error: config.lastError,
  };
}

export function isConnected(): boolean {
  return loadConfig().status === 'connected' && webClient !== null;
}

// ─── Helpers ───

function parseSlackTs(ts: string): number {
  return Math.floor(parseFloat(ts) * 1000);
}

async function slackApiMessageToSlackMessage(
  msg: Record<string, unknown>,
  channel: string,
): Promise<SlackMessage> {
  const userId = (msg.user as string) || '';
  let userName = userId;

  try {
    if (userId) {
      const user = await resolveUser(userId);
      userName = user.displayName || user.name;
    }
  } catch {
    // Use userId as fallback
  }

  const rawFiles = msg.files as SlackFile[] | undefined;
  const files = rawFiles?.length ? rawFiles.map(normalizeSlackFile) : undefined;

  return {
    ts: msg.ts as string,
    threadTs: msg.thread_ts as string | undefined,
    channel,
    userId,
    userName,
    text: (msg.text as string) || '',
    timestamp: parseSlackTs(msg.ts as string),
    files,
  };
}
