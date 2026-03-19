/**
 * Slack Client
 * Manages Slack Web API + Socket Mode connection, message sending/receiving,
 * channel/user lookup, and long-poll reply waiting.
 */

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

    if (!event || !event.text || event.subtype) return;

    // Skip bot's own messages
    const config = loadConfig();
    if (event.user === config.botUserId) return;

    // Resolve username
    const user = await resolveUser(event.user);
    const userName = user?.displayName || user?.name || event.user;

    const message: SlackMessage = {
      ts: event.ts,
      threadTs: event.thread_ts,
      channel: event.channel,
      userId: event.user,
      userName,
      text: event.text,
      timestamp: parseSlackTs(event.ts),
    };

    // Log to SQLite
    ctx?.eventDb.logSlackMessage({
      ts: event.ts,
      threadTs: event.thread_ts,
      channelId: event.channel,
      channelName: channelNameCache.get(event.channel),
      userId: event.user,
      userName,
      text: event.text,
      direction: 'inbound',
      rawEvent: event,
      receivedAt: Date.now(),
    } satisfies SlackMessageEvent);

    // Broadcast to WS clients
    ctx?.broadcast({
      type: 'slack_message_received',
      payload: { channel: event.channel, userName, text: event.text, ts: event.ts },
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

  return {
    ts: msg.ts as string,
    threadTs: msg.thread_ts as string | undefined,
    channel,
    userId,
    userName,
    text: (msg.text as string) || '',
    timestamp: parseSlackTs(msg.ts as string),
  };
}
