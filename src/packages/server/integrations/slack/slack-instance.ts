/**
 * SlackInstance — encapsulates the connection + state for ONE Slack
 * workspace/account. All slack-client functionality lives here as instance
 * methods. The single-instance public surface in `slack-client.ts` is a thin
 * facade that delegates to the `default` instance.
 *
 * Why this exists: chunk 1 of the multi-instance Slack rollout. We need state
 * (WebClient, SocketModeClient, polling loop, caches, listeners, reply
 * waiters) keyed by instance so two side-by-side connections can run later.
 * In chunk 1 only the `default` instance is used and behavior is unchanged.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { LogLevel, WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import type { IntegrationContext, IntegrationStatus } from '../../../shared/integration-types.js';
import type { SlackMessageEvent } from '../../../shared/event-types.js';
import { instanceSecretKey, loadConfig, resolveAuthMode, updateConfig } from './slack-config.js';
import { SlackPollingClient, asPollingWebClient, type SocketLikeMessageEvent } from './slack-polling-client.js';
import { SlackWatermarkStore } from './slack-watermark-store.js';

// ─── Public types (re-exported through slack-client.ts) ───

export interface SlackMessage {
  ts: string;
  threadTs?: string;
  channel: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  files?: SlackFile[];
  /** True when the message was sent by this instance's bot/user (outbound). */
  isOwnMessage?: boolean;
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

export interface SendMessageParams {
  channel: string;
  text: string;
  threadTs?: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export interface AddReactionParams {
  channel: string;
  ts: string;
  name: string;
}

export interface GetMessagesParams {
  channel: string;
  limit?: number;
  oldest?: string;
  latest?: string;
}

export interface GetThreadParams {
  channel: string;
  threadTs: string;
  limit?: number;
}

export interface WaitForReplyParams {
  channel: string;
  threadTs: string;
  fromUsers?: string[];
  timeoutMs?: number;
  messagePattern?: string;
}

export interface SendDmParams {
  userId: string;
  text: string;
  agentId?: string;
  workflowInstanceId?: string;
}

export interface UploadFileParams {
  filename: string;
  bytes: Buffer | Uint8Array;
  channelId?: string;
  title?: string;
  initialComment?: string;
  threadTs?: string;
}

export interface ListFilesParams {
  channelId?: string;
  userId?: string;
  tsFrom?: string;
  tsTo?: string;
  types?: string;
  count?: number;
  page?: number;
}

interface ReplyWaiter {
  channel: string;
  threadTs: string;
  fromUsers?: string[];
  messagePattern?: string;
  resolve: (message: SlackMessage | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Subtypes we never want to trigger on. Modern file-share has NO subtype, legacy uses `file_share` — both must pass.
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

/** The single, well-known instance id used until chunk 2 introduces user-defined ids. */
export const DEFAULT_INSTANCE_ID = 'default';

/** Encapsulates one Slack connection + all its caches/listeners/clients. */
export class SlackInstance {
  readonly id: string;

  private webClient: WebClient | null = null;
  private socketClient: SocketModeClient | null = null;
  private pollingClient: SlackPollingClient | null = null;
  private ctx: IntegrationContext | null = null;

  private readonly userCache = new Map<string, SlackUser>();
  private readonly channelNameCache = new Map<string, string>();
  private readonly messageListeners = new Set<(message: SlackMessage) => void>();
  private readonly replyWaiters = new Set<ReplyWaiter>();

  constructor(id: string) {
    this.id = id;
  }

  setContext(ctx: IntegrationContext): void {
    this.ctx = ctx;
  }

  // ─── Init / Shutdown ───

  async init(): Promise<void> {
    if (!this.ctx) throw new Error('SlackInstance.init: setContext() must be called first');

    const botToken = this.getSecret('SLACK_BOT_TOKEN');
    const appToken = this.getSecret('SLACK_APP_TOKEN');
    const config = loadConfig(this.id);

    if (!config.enabled || !botToken) {
      this.ctx.log.info(`Slack[${this.id}] disabled or missing token, skipping connection`);
      return;
    }

    await this.connect(botToken, appToken);
  }

  /** Read a per-instance secret (e.g. SLACK_BOT_TOKEN). Default instance uses the bare key. */
  private getSecret(logicalKey: 'SLACK_BOT_TOKEN' | 'SLACK_APP_TOKEN'): string | undefined {
    if (!this.ctx) return undefined;
    return this.ctx.secrets.get(instanceSecretKey(logicalKey, this.id));
  }

  async shutdown(): Promise<void> {
    await this.disconnect();
    this.userCache.clear();
    this.channelNameCache.clear();
    this.messageListeners.clear();

    for (const waiter of this.replyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.replyWaiters.clear();
  }

  // ─── Connection Management ───

  private async connect(botToken: string, appToken: string | undefined): Promise<void> {
    const config = loadConfig(this.id);
    const decision = resolveAuthMode({
      authMode: config.authMode,
      botToken,
      appToken,
    });
    if ('error' in decision) {
      updateConfig({ status: 'error', lastError: decision.error, currentMode: 'none' }, this.id);
      this.ctx?.log.error(`Slack[${this.id}] mode resolution failed: ${decision.error}`);
      throw new Error(decision.error);
    }

    updateConfig({ status: 'connecting', lastError: undefined, currentMode: decision.mode }, this.id);

    try {
      // logLevel: ERROR — the library logs every 429 at WARN by default which
      //   double-reports rate limits we already log via our own polling client.
      // rejectRateLimitedCalls: true — surface 429s to our caller immediately
      //   so the polling client's per-channel backoff (which moves on to other
      //   channels) handles them, instead of the library serially retrying and
      //   blocking the whole conversations.history call.
      this.webClient = new WebClient(botToken, {
        logLevel: LogLevel.ERROR,
        rejectRateLimitedCalls: true,
      });

      // auth.test works for both bot and user tokens. For xoxp- it returns the
      // user's own id/handle, used for "skip self" filtering.
      const authResult = await this.webClient.auth.test();
      const botUserId = authResult.user_id as string;
      const botName = (authResult.user as string) || 'tide-bot';

      updateConfig({
        status: 'connected',
        botUserId,
        botName,
        connectedAt: Date.now(),
        currentMode: decision.mode,
      }, this.id);

      if (decision.mode === 'socket') {
        this.socketClient = new SocketModeClient({ appToken: appToken as string });
        this.setupSocketHandlers();
        await this.socketClient.start();
        this.ctx?.log.info(`Slack[${this.id}] connected as @${botName} (${botUserId}) via socket mode`);
      } else {
        await this.startPollingMode();
        this.ctx?.log.info(`Slack[${this.id}] connected as @${botName} (${botUserId}) via polling mode`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      updateConfig({ status: 'error', lastError: errorMsg, currentMode: 'none' }, this.id);
      this.ctx?.log.error(`Slack[${this.id}] connection failed: ${errorMsg}`);
      this.webClient = null;
      this.socketClient = null;
      if (this.pollingClient) {
        await this.pollingClient.stop().catch(() => undefined);
        this.pollingClient = null;
      }
      throw err;
    }
  }

  private async startPollingMode(): Promise<void> {
    if (!this.webClient) throw new Error('Polling mode requires an initialized WebClient');
    const config = loadConfig(this.id);

    const watermarkStore = new SlackWatermarkStore({
      filePath: this.getWatermarkPath(),
    });

    // Parse the allowlist: split on commas / newlines / whitespace, strip empties.
    const allowlistChannelIds = (config.pollingChannelAllowlist ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    this.pollingClient = new SlackPollingClient({
      webClient: asPollingWebClient(this.webClient),
      watermarkStore,
      dispatch: (event) => this.dispatchInboundMessage(event),
      intervalSec: config.pollingIntervalSec ?? 45,
      backfillMessageCap: config.pollingBackfillMessageCap ?? 100,
      backfillSeconds: config.pollingBackfillSeconds ?? 24 * 60 * 60,
      concurrency: config.pollingConcurrency ?? 4,
      channelListRefreshEveryNCycles: 10,
      channelTypes: config.pollingChannelTypes,
      allowlistChannelIds,
      keepAllDms: config.pollingDmsAlways !== false,
      minMsBetweenCalls: config.pollingMinMsBetweenCalls ?? 1500,
    });

    this.pollingClient.setOnFatalError((reason) => {
      updateConfig({ status: 'error', lastError: reason }, this.id);
      this.ctx?.broadcast({
        type: 'slack_polling_halted',
        payload: { instanceId: this.id, reason },
      });
    });

    await this.pollingClient.start();
  }

  /**
   * Backward-compat: the `default` instance keeps the historical filename so
   * existing users don't need migration. Other instances get suffixed names.
   */
  private getWatermarkPath(): string {
    const dataDir = path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
      'tide-commander',
    );
    if (this.id === DEFAULT_INSTANCE_ID) {
      return path.join(dataDir, 'slack-watermarks.json');
    }
    return path.join(dataDir, `slack-watermarks-${this.id}.json`);
  }

  async reconnect(): Promise<void> {
    if (!this.ctx) throw new Error('SlackInstance.reconnect: not initialized');

    await this.disconnect();

    const botToken = this.getSecret('SLACK_BOT_TOKEN');
    const appToken = this.getSecret('SLACK_APP_TOKEN');

    if (!botToken) {
      throw new Error('Missing Slack token');
    }

    await this.connect(botToken, appToken);
  }

  async disconnect(): Promise<void> {
    if (this.socketClient) {
      try {
        await this.socketClient.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.socketClient = null;
    }
    if (this.pollingClient) {
      await this.pollingClient.stop().catch(() => undefined);
      this.pollingClient = null;
    }
    this.webClient = null;
    updateConfig({ status: 'disconnected', connectedAt: undefined, currentMode: 'none' }, this.id);
  }

  private setupSocketHandlers(): void {
    if (!this.socketClient) return;

    this.socketClient.on('message', async ({ event, ack }) => {
      await ack();
      if (!event) return;
      await this.dispatchInboundMessage(event as SocketLikeMessageEvent);
    });

    this.socketClient.on('disconnect', () => {
      this.ctx?.log.warn(`Slack[${this.id}] Socket Mode disconnected`);
      updateConfig({ status: 'disconnected' }, this.id);
    });

    this.socketClient.on('unable_to_socket_mode_start', (err) => {
      this.ctx?.log.error(`Slack[${this.id}] Socket Mode start failed: ${err}`);
      updateConfig({ status: 'error', lastError: String(err) }, this.id);
    });
  }

  /**
   * Single dispatcher pipeline shared by Socket Mode and Polling. Filters
   * subtypes / self / empty messages, logs to SQLite, broadcasts WS, fires
   * trigger listeners, and resolves reply waiters.
   */
  private async dispatchInboundMessage(event: SocketLikeMessageEvent): Promise<void> {
    if (event.subtype && SKIP_MESSAGE_SUBTYPES.has(event.subtype)) return;

    const hasFiles = Array.isArray(event.files) && event.files.length > 0;
    const text = event.text ?? '';

    if (!text && !hasFiles) return;

    const config = loadConfig(this.id);
    const isOwnMessage = !!event.user && event.user === config.botUserId;
    // Skip own messages unless this instance is configured to mirror them.
    if (isOwnMessage && !config.mirrorOwnMessages) return;

    const userId = event.user ?? '';
    let userName = userId;
    if (userId) {
      try {
        const user = await this.resolveUser(userId);
        userName = user?.displayName || user?.name || userId;
      } catch {
        // Use userId as fallback
      }
    }

    const files = hasFiles
      ? (event.files as SlackFile[]).map((f) => normalizeSlackFile(f))
      : undefined;

    const message: SlackMessage = {
      ts: event.ts,
      threadTs: event.thread_ts,
      channel: event.channel,
      userId,
      userName,
      text,
      timestamp: parseSlackTs(event.ts),
      files,
      isOwnMessage,
    };

    const direction: SlackMessageEvent['direction'] = isOwnMessage ? 'outbound' : 'inbound';

    // Heartbeat: one line per dispatched message. PII-safe — only ids, ts,
    // direction, file count. No message text, no usernames, no emails.
    this.ctx?.log.info(
      `Slack[${this.id}] dispatch: channel=${event.channel} user=${userId || '-'} ts=${event.ts} direction=${direction} files=${files?.length ?? 0}${event.thread_ts && event.thread_ts !== event.ts ? ` thread=${event.thread_ts}` : ''}`,
    );

    this.ctx?.eventDb.logSlackMessage({
      ts: event.ts,
      threadTs: event.thread_ts,
      channelId: event.channel,
      channelName: this.channelNameCache.get(event.channel),
      userId,
      userName,
      text,
      direction,
      rawEvent: event,
      receivedAt: Date.now(),
      integrationInstanceId: this.id,
    } satisfies SlackMessageEvent);

    this.ctx?.broadcast({
      type: 'slack_message_received',
      payload: {
        instanceId: this.id,
        channel: event.channel,
        userName,
        text,
        ts: event.ts,
        fileCount: files?.length ?? 0,
        direction,
      },
    });

    // Trigger listeners receive own messages too (tagged with isOwnMessage);
    // the slack trigger handler decides whether to fire based on trigger config.
    for (const listener of this.messageListeners) {
      try {
        listener(message);
      } catch (err) {
        this.ctx?.log.error(`Slack[${this.id}] message listener error: ${err}`);
      }
    }

    // Reply waiters always skip own messages — a wait-for-reply must not
    // resolve on our own outgoing message.
    if (isOwnMessage) return;

    for (const waiter of this.replyWaiters) {
      if (waiter.channel !== message.channel) continue;
      if (waiter.threadTs !== message.threadTs && waiter.threadTs !== message.ts) continue;
      if (waiter.fromUsers?.length && !waiter.fromUsers.includes(message.userId)) continue;
      if (waiter.messagePattern && !new RegExp(waiter.messagePattern).test(message.text)) continue;

      clearTimeout(waiter.timer);
      this.replyWaiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  // ─── Sending ───

  async sendMessage(params: SendMessageParams): Promise<{ ts: string; channel: string }> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.chat.postMessage({
      channel: params.channel,
      text: params.text,
      thread_ts: params.threadTs,
    });

    const ts = result.ts as string;
    const channel = result.channel as string;
    const config = loadConfig(this.id);

    this.ctx?.eventDb.logSlackMessage({
      ts,
      threadTs: params.threadTs,
      channelId: channel,
      channelName: this.channelNameCache.get(channel),
      userId: config.botUserId || '',
      userName: config.botName || 'tide-bot',
      text: params.text,
      direction: 'outbound',
      agentId: params.agentId,
      workflowInstanceId: params.workflowInstanceId,
      receivedAt: Date.now(),
      integrationInstanceId: this.id,
    } satisfies SlackMessageEvent);

    return { ts, channel };
  }

  // ─── Reactions ───

  async addReaction(params: AddReactionParams): Promise<void> {
    if (!this.webClient) throw new Error('Slack not connected');

    const name = normalizeEmojiName(params.name);
    try {
      await this.webClient.reactions.add({
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

  // ─── Reading ───

  async getChannelMessages(params: GetMessagesParams): Promise<SlackMessage[]> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.conversations.history({
      channel: params.channel,
      limit: params.limit || 20,
      oldest: params.oldest,
      latest: params.latest,
    });

    return Promise.all(
      (result.messages || []).map((msg) => this.slackApiMessageToSlackMessage(msg as Record<string, unknown>, params.channel))
    );
  }

  async getThreadReplies(params: GetThreadParams): Promise<SlackMessage[]> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.conversations.replies({
      channel: params.channel,
      ts: params.threadTs,
      limit: params.limit || 50,
    });

    return Promise.all(
      (result.messages || []).map((msg) => this.slackApiMessageToSlackMessage(msg as Record<string, unknown>, params.channel))
    );
  }

  // ─── Wait For Reply (Long-Poll) ───

  waitForReply(params: WaitForReplyParams): Promise<SlackMessage | null> {
    const timeout = params.timeoutMs || 300000;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.replyWaiters.delete(waiter);
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

      this.replyWaiters.add(waiter);
    });
  }

  // ─── Channel Management ───

  async joinChannel(channel: string): Promise<{ id: string; name: string }> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.conversations.join({ channel });
    const ch = result.channel as { id: string; name: string } | undefined;
    if (!ch) throw new Error(`Failed to join channel ${channel}`);

    this.channelNameCache.set(ch.id, ch.name);

    return { id: ch.id, name: ch.name };
  }

  async listChannels(): Promise<SlackChannel[]> {
    if (!this.webClient) throw new Error('Slack not connected');

    const channels: SlackChannel[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.webClient.conversations.list({
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
        this.channelNameCache.set(channel.id, channel.name);
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return channels;
  }

  async resolveUser(userId: string): Promise<SlackUser> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.users.info({ user: userId });
    const u = result.user;
    if (!u) throw new Error(`User not found: ${userId}`);

    const user: SlackUser = {
      id: u.id as string,
      name: u.name as string,
      realName: (u.real_name as string) || '',
      displayName: (u.profile as { display_name?: string })?.display_name || (u.name as string),
      email: (u.profile as { email?: string })?.email,
      isBot: u.is_bot as boolean,
    };

    this.userCache.set(userId, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<SlackUser | null> {
    if (!this.webClient) throw new Error('Slack not connected');

    try {
      const result = await this.webClient.users.lookupByEmail({ email });
      const u = result.user;
      if (!u) return null;

      const user: SlackUser = {
        id: u.id as string,
        name: u.name as string,
        realName: (u.real_name as string) || '',
        displayName: (u.profile as { display_name?: string })?.display_name || (u.name as string),
        email: (u.profile as { email?: string })?.email,
        isBot: u.is_bot as boolean,
      };

      this.userCache.set(user.id, user);
      return user;
    } catch {
      return null;
    }
  }

  async findUserByName(displayName: string): Promise<SlackUser | null> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.users.list({ limit: 500 });
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
          displayName: profile?.display_name || (u.name as string),
          email: (u.profile as { email?: string })?.email,
          isBot: u.is_bot as boolean,
        };
        this.userCache.set(user.id, user);
        return user;
      }
    }

    return null;
  }

  async searchUsers(query: string): Promise<SlackUser[]> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.users.list({ limit: 500 });
    const lower = query.toLowerCase();
    const matches: SlackUser[] = [];

    for (const u of result.members || []) {
      if (u.deleted || u.is_bot) continue;
      const profile = u.profile as { display_name?: string; email?: string } | undefined;
      const name = (u.name as string) || '';
      const realName = (u.real_name as string) || '';
      const dispName = profile?.display_name || '';
      const email = profile?.email || '';

      if (
        name.toLowerCase().includes(lower) ||
        realName.toLowerCase().includes(lower) ||
        dispName.toLowerCase().includes(lower) ||
        email.toLowerCase().includes(lower)
      ) {
        const user: SlackUser = {
          id: u.id as string,
          name,
          realName,
          displayName: dispName || name,
          email,
          isBot: false,
        };
        this.userCache.set(user.id, user);
        matches.push(user);
      }
    }

    return matches;
  }

  // ─── Direct Messages ───

  async openDmChannel(userId: string): Promise<string> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.conversations.open({ users: userId });
    const channelId = (result.channel as { id: string })?.id;
    if (!channelId) throw new Error(`Failed to open DM channel with user ${userId}`);
    return channelId;
  }

  async sendDm(params: SendDmParams): Promise<{ ts: string; channel: string }> {
    const dmChannel = await this.openDmChannel(params.userId);
    return this.sendMessage({
      channel: dmChannel,
      text: params.text,
      agentId: params.agentId,
      workflowInstanceId: params.workflowInstanceId,
    });
  }

  // ─── File Upload ───

  async uploadFile(params: UploadFileParams): Promise<{ fileId: string; file: SlackFile }> {
    if (!this.webClient) throw new Error('Slack not connected');

    const length = params.bytes instanceof Buffer ? params.bytes.length : params.bytes.byteLength;
    if (!length) throw new Error('uploadFile: bytes is empty');

    const step1 = await this.webClient.files.getUploadURLExternal({
      filename: params.filename,
      length,
    });
    if (!step1.ok || !step1.upload_url || !step1.file_id) {
      throw new Error(`Slack files.getUploadURLExternal failed: ${step1.error ?? 'unknown error'}`);
    }

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

    const files: [{ id: string; title: string }] = [
      { id: step1.file_id, title: params.title ?? params.filename },
    ];
    const step3 = params.channelId
      ? await this.webClient.files.completeUploadExternal({
          files,
          channel_id: params.channelId,
          initial_comment: params.initialComment,
          thread_ts: params.threadTs,
        })
      : await this.webClient.files.completeUploadExternal({ files });
    if (!step3.ok) {
      throw new Error(`Slack files.completeUploadExternal failed: ${step3.error ?? 'unknown error'}`);
    }

    const file = (step3.files?.[0] ?? { id: step1.file_id }) as SlackFile;
    return { fileId: step1.file_id, file };
  }

  // ─── File Read / Download ───

  async listFiles(params: ListFilesParams = {}): Promise<SlackFile[]> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.files.list({
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

  async getFileInfo(fileId: string): Promise<SlackFile> {
    if (!this.webClient) throw new Error('Slack not connected');

    const result = await this.webClient.files.info({ file: fileId });
    if (!result.ok || !result.file) {
      throw new Error(`Slack files.info failed for ${fileId}: ${result.error ?? 'unknown error'}`);
    }
    return normalizeSlackFile(result.file as unknown as SlackFile);
  }

  async fetchFileBytes(fileId: string): Promise<{
    buffer: Buffer;
    contentType: string | null;
    contentDisposition: string | null;
    contentLength: string | null;
    filename?: string;
  }> {
    const token = this.getSecret('SLACK_BOT_TOKEN');
    if (!token) throw new Error('Slack bot token is not configured');

    const info = await this.getFileInfo(fileId);
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

  async downloadFile(
    file: string | SlackFile,
    outputPath: string,
  ): Promise<{ path: string; bytes: number; filename?: string; mimeType?: string }> {
    const fileId = typeof file === 'string' ? file : file.id;
    const { buffer, filename, contentType } = await this.fetchFileBytes(fileId);
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, buffer);
    return {
      path: outputPath,
      bytes: buffer.byteLength,
      filename,
      mimeType: contentType ?? undefined,
    };
  }

  // ─── Event Subscription (for triggers) ───

  onMessage(callback: (message: SlackMessage) => void): () => void {
    this.messageListeners.add(callback);
    return () => { this.messageListeners.delete(callback); };
  }

  // ─── Status ───

  getStatus(): IntegrationStatus {
    const config = loadConfig(this.id);
    return {
      connected: config.status === 'connected',
      lastChecked: Date.now(),
      error: config.lastError,
    };
  }

  isConnected(): boolean {
    return loadConfig(this.id).status === 'connected' && this.webClient !== null;
  }

  // ─── Internal helper ───

  private async slackApiMessageToSlackMessage(
    msg: Record<string, unknown>,
    channel: string,
  ): Promise<SlackMessage> {
    const userId = (msg.user as string) || '';
    let userName = userId;

    try {
      if (userId) {
        const user = await this.resolveUser(userId);
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
}

// ─── Module-level helpers (stateless) ───

function parseSlackTs(ts: string): number {
  return Math.floor(parseFloat(ts) * 1000);
}

function normalizeEmojiName(input: string): string {
  const trimmed = input.trim().replace(/^:|:$/g, '');
  if (trimmed === '👁' || trimmed === '👁️' || trimmed === '👀') return 'eyes';
  return trimmed;
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

// ─── Instance Registry ───

const instances = new Map<string, SlackInstance>();

/**
 * Get (or lazily create) the instance with the given id. The registry is
 * seeded from the manifest at boot (slack/index.ts), but unknown ids are
 * created on demand so individual route handlers don't have to special-case
 * "instance was just added but registry isn't reloaded yet".
 */
export function getInstance(id: string = DEFAULT_INSTANCE_ID): SlackInstance {
  let inst = instances.get(id);
  if (!inst) {
    inst = new SlackInstance(id);
    instances.set(id, inst);
  }
  return inst;
}

/** Like getInstance, but returns undefined instead of creating one. */
export function getInstanceOrUndefined(id: string): SlackInstance | undefined {
  return instances.get(id);
}

/** Remove a single instance from the registry (used when deleting an instance). */
export async function removeInstance(id: string): Promise<void> {
  if (id === DEFAULT_INSTANCE_ID) {
    throw new Error('Cannot remove the default Slack instance');
  }
  const inst = instances.get(id);
  if (inst) {
    await inst.shutdown();
    instances.delete(id);
  }
}

/** All currently-loaded instances. */
export function listInstances(): SlackInstance[] {
  return Array.from(instances.values());
}

/** Drop every instance (used by shutdown / tests). */
export function clearInstances(): void {
  instances.clear();
}
