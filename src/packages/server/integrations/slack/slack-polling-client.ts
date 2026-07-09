/**
 * SlackPollingClient
 *
 * Polling-mode inbound transport for Slack USER tokens (xoxp-). User tokens
 * cannot use Socket Mode, so we periodically poll the Web API instead.
 *
 * Pipeline per cycle:
 *   1. (lazy) refresh channel list via `conversations.list` every
 *      `channelListRefreshEveryNCycles` ticks. Includes public/private
 *      channels, IMs, and MPIMs that the user is a member of.
 *   2. For each tracked channel, fetch newer messages via
 *      `conversations.history` with `oldest=lastTs` (exclusive). On the
 *      first sight of a channel apply a backfill cap.
 *   3. Hand each message to `dispatchInboundMessage(event)` shaped exactly
 *      like a Socket-Mode `message` event so the existing dispatcher pipeline
 *      (subtype filter, self-skip, user resolve, SQLite log, WS broadcast,
 *      trigger listeners, reply waiters) works unchanged.
 *   4. Advance the channel's watermark to the newest dispatched ts and
 *      persist via the watermark store (atomic write).
 *
 * Rate-limit handling: on a Slack 429 with `Retry-After`, we wait that many
 * seconds before retrying THAT channel and continue with the rest. The
 * Slack header is authoritative — we don't add jittered backoff on top.
 *
 * Shutdown: `stop()` clears the timer, sets running=false, and awaits any
 * in-flight cycle. The integration's main shutdown calls this.
 *
 * PII safety: never log message bodies, channel names, user names/emails, or
 * DM contents. Logs only carry channel ids, ts values, and cycle metadata.
 */

import type { WebClient } from '@slack/web-api';
import { SlackWatermarkStore } from './slack-watermark-store.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SlackPolling');

/** Tracked threads expire after this much inactivity. */
const THREAD_TTL_MS = 6 * 60 * 60 * 1000;
/** Per-channel cap on tracked threads — oldest activity evicted first. */
const MAX_TRACKED_THREADS_PER_CHANNEL = 10;

// ─── Types ───

/**
 * Shape of a single message row coming from `conversations.history`. We map
 * it to the same envelope Socket Mode delivers so the existing dispatcher
 * accepts it without changes.
 */
interface SlackHistoryMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  subtype?: string;
  files?: unknown[];
  /** Present on thread parents; counts non-self replies. */
  reply_count?: number;
  /** Slack ts of the most recent reply in this thread. Useful for detecting new activity. */
  latest_reply?: string;
}

interface SlackChannelLite {
  id: string;
  is_member?: boolean;
  is_archived?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
}

/** Synthetic Socket-Mode-shaped envelope passed to dispatchInboundMessage. */
export interface SocketLikeMessageEvent {
  ts: string;
  thread_ts?: string;
  channel: string;
  user?: string;
  text?: string;
  subtype?: string;
  files?: unknown[];
}

export type MessageDispatcher = (event: SocketLikeMessageEvent) => void | Promise<void>;

/**
 * Subset of the Slack WebClient surface we use. Defined as an interface so
 * tests can inject a mock without dragging in the full @slack/web-api types.
 */
export interface PollingWebClient {
  conversations: {
    list: (args: {
      types?: string;
      limit?: number;
      cursor?: string;
    }) => Promise<{
      channels?: SlackChannelLite[];
      response_metadata?: { next_cursor?: string };
    }>;
    history: (args: {
      channel: string;
      oldest?: string;
      limit?: number;
      cursor?: string;
    }) => Promise<{
      messages?: SlackHistoryMessage[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    }>;
    replies: (args: {
      channel: string;
      ts: string;
      oldest?: string;
      limit?: number;
      cursor?: string;
    }) => Promise<{
      messages?: SlackHistoryMessage[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    }>;
  };
  /** Optional: only used when `useSearch` is enabled. The runtime
   *  `WebClient` always has this method, but tests can omit it when they
   *  don't exercise the search path. */
  search?: {
    messages: (args: {
      query: string;
      count?: number;
      page?: number;
      sort?: 'score' | 'timestamp';
      sort_dir?: 'asc' | 'desc';
    }) => Promise<SlackSearchResponse>;
  };
}

/** Shape of a single match returned by `search.messages`. The `channel` field
 *  is a nested object (id + flags), unlike `conversations.history` where
 *  channel is just a string id — `pollViaSearch` adapts to that. */
interface SlackSearchMatch {
  type?: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  username?: string;
  text?: string;
  subtype?: string;
  files?: unknown[];
  channel?: {
    id?: string;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
    name?: string;
  };
}

interface SlackSearchResponse {
  ok?: boolean;
  query?: string;
  messages?: {
    total?: number;
    paging?: { count?: number; total?: number; page?: number; pages?: number };
    pagination?: { total_count?: number; page?: number; per_page?: number; page_count?: number };
    matches?: SlackSearchMatch[];
  };
}

export interface SlackPollingClientOptions {
  webClient: PollingWebClient;
  watermarkStore: SlackWatermarkStore;
  /** Called for every new message (shape matches Socket Mode). */
  dispatch: MessageDispatcher;
  /** Default poll interval (seconds). Clamped to [5, 600]. */
  intervalSec: number;
  /** Per-channel backfill cap, in messages, on first sight. */
  backfillMessageCap: number;
  /** Per-channel backfill cap, in seconds (lookback window). */
  backfillSeconds: number;
  /** Concurrency limit for parallel `conversations.history` calls. */
  concurrency: number;
  /**
   * Refresh the channel list every N polling cycles. Also runs once on the
   * first cycle to seed the set.
   */
  channelListRefreshEveryNCycles: number;
  /** Slack `types` for `conversations.list`. Default covers user-visible channels. */
  channelTypes?: string;
  /**
   * If non-empty, restrict polling to channels whose id is in this set
   * (plus 1:1 DMs when `keepAllDms` is true). Empty array = no restriction.
   */
  allowlistChannelIds?: string[];
  /**
   * When `allowlistChannelIds` is non-empty, also keep polling all 1:1 DM
   * channels (channel id starts with `D`). Default true — typical "DMs +
   * a few specific groups" workflow.
   */
  keepAllDms?: boolean;
  /**
   * Minimum milliseconds between any two outbound API calls (history OR
   * replies). Smears the per-cycle burst over time so we don't trigger
   * Slack's Tier 3 rate limit (~50 req/min). Default 0 (no pacing — used by
   * tests). Production default in SlackInstance is 1500ms (~40 req/min).
   */
  minMsBetweenCalls?: number;
  /**
   * When true, replace the per-channel `conversations.history` sweep with a
   * single `search.messages?query=after:<yesterday>` call per cycle. Search
   * returns ALL messages (top-level + thread replies + DMs + group threads)
   * in one shot, fixing the long-standing "thread replies on old parents
   * are silently missed" bug. The allowlist + keepAllDms filter still applies
   * — matches whose channel is not in the allowlist (and not a DM when
   * keepAllDms is true) are dropped post-fetch.
   *
   * Caveat: Slack's search index has ~10-30s indexing lag. For real-time
   * mentions this mode is slightly slower than per-channel history; for
   * "track every conversation" use cases it's strictly better.
   *
   * Requires `search:read` scope on the user (xoxp-) token.
   */
  useSearch?: boolean;
  /** Optional override for tests so we can stub timers. */
  scheduler?: PollingScheduler;
  /** Optional override for tests so we can step "now" manually. */
  now?: () => number;
}

/** Pluggable scheduler so unit tests can drive ticks without real timers. */
export interface PollingScheduler {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const DEFAULT_SCHEDULER: PollingScheduler = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// ─── Slack error helpers ───

interface SlackHttpError extends Error {
  code?: string;
  data?: { error?: string; retry_after?: number };
  /** Some @slack/web-api errors expose Retry-After at the top level. */
  retryAfter?: number;
  headers?: Record<string, string | undefined>;
}

/** Pull a Retry-After value (seconds) from a Slack 429 error, if present. */
function readRetryAfter(err: unknown): number | undefined {
  const e = err as SlackHttpError;
  if (typeof e?.retryAfter === 'number') return e.retryAfter;
  if (typeof e?.data?.retry_after === 'number') return e.data.retry_after;
  const headerVal = e?.headers?.['retry-after'];
  if (typeof headerVal === 'string') {
    const n = parseInt(headerVal, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isRateLimitedError(err: unknown): boolean {
  const e = err as SlackHttpError;
  if (e?.code === 'slack_webapi_rate_limited_error') return true;
  if (e?.data?.error === 'ratelimited') return true;
  return readRetryAfter(err) !== undefined;
}

function isInvalidAuthError(err: unknown): boolean {
  const slackErr = (err as SlackHttpError)?.data?.error;
  return slackErr === 'invalid_auth' || slackErr === 'token_revoked' || slackErr === 'account_inactive';
}

// ─── The client ───

export class SlackPollingClient {
  private readonly webClient: PollingWebClient;
  private readonly watermarkStore: SlackWatermarkStore;
  private readonly dispatch: MessageDispatcher;
  private readonly intervalMs: number;
  private readonly backfillMessageCap: number;
  private readonly backfillSeconds: number;
  private readonly concurrency: number;
  private readonly channelListRefreshEveryNCycles: number;
  private readonly channelTypes: string;
  private readonly allowlistChannelIds: Set<string>;
  private readonly keepAllDms: boolean;
  private readonly minMsBetweenCalls: number;
  private readonly useSearch: boolean;
  private readonly scheduler: PollingScheduler;
  private readonly now: () => number;

  /** Token-bucket rate limiter shared by every paced API call. Concurrent
   *  workers really run in parallel — only the *rate* (tokens/sec) is capped.
   *  Replaces the older serial promise-chain gate which silently nullified
   *  the `concurrency` option (every paced call was forced to run one at a
   *  time spaced by `minMsBetweenCalls`, so `concurrency: 8` behaved like
   *  `concurrency: 1`). */
  private bucket: TokenBucket | null = null;
  /** When > now(), every paced call sleeps until that wall-clock ms. Set on 429. */
  private globalPauseUntil = 0;

  private running = false;
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private cycleCount = 0;
  /** ChannelId → seconds to skip until (epoch ms) after a 429. */
  private channelBackoffUntil = new Map<string, number>();
  /** ChannelId set known from the most recent list refresh. */
  private knownChannels = new Set<string>();
  /**
   * Per-thread watermarks ("option 2" of the parent heuristic): channelId →
   * threadTs → tracking state. `lastTs` is sweep-owned — it only advances as
   * sweepThreads() reads replies in order, so a mid-thread reply the live
   * socket dropped is still fetched on the next sweep (the dispatcher's
   * (channel, ts) dedup drops the ones already delivered). New registrations
   * start at lastTs = threadTs, i.e. the first sweep re-reads the whole
   * thread and recovers any hole.
   */
  private readonly threadRegistry = new Map<string, Map<string, { lastTs: string; lastActivityMs: number }>>();
  /**
   * Search-mode only: the newest message `ts` observed in the previous search
   * cycle (dispatched or not). Lets the next cycle stop paging as soon as it
   * crosses back past this (minus an overlap window) instead of re-paging the
   * full day window every tick. null until the first search cycle completes.
   */
  private lastSearchMaxTs: string | null = null;
  /** Set when we've hit a fatal auth error so the loop self-stops. */
  private fatalError: string | null = null;
  /** Optional callback the wrapper can subscribe to for fatal errors. */
  private onFatalError: ((reason: string) => void) | null = null;

  constructor(opts: SlackPollingClientOptions) {
    this.webClient = opts.webClient;
    this.watermarkStore = opts.watermarkStore;
    this.dispatch = opts.dispatch;
    this.intervalMs = clamp(opts.intervalSec, 5, 600) * 1000;
    this.backfillMessageCap = Math.max(1, opts.backfillMessageCap);
    this.backfillSeconds = Math.max(60, opts.backfillSeconds);
    this.concurrency = clamp(opts.concurrency, 1, 8);
    this.channelListRefreshEveryNCycles = Math.max(1, opts.channelListRefreshEveryNCycles);
    this.channelTypes = opts.channelTypes ?? 'public_channel,private_channel,im,mpim';
    this.allowlistChannelIds = new Set(
      (opts.allowlistChannelIds ?? []).map((s) => s.trim()).filter(Boolean),
    );
    this.keepAllDms = opts.keepAllDms !== false;
    this.minMsBetweenCalls = Math.max(0, opts.minMsBetweenCalls ?? 0);
    this.useSearch = opts.useSearch === true;
    this.scheduler = opts.scheduler ?? DEFAULT_SCHEDULER;
    this.now = opts.now ?? Date.now;
    if (this.minMsBetweenCalls > 0) {
      // Tier 3 spec: ~50/min sustained with bursts up to ~5/sec. Refill rate
      // = minMsBetweenCalls (e.g. 1200ms → 50/min). Burst capacity caps the
      // initial flood from a cycle wake-up without us having to throttle every
      // single call serially.
      this.bucket = new TokenBucket({
        capacity: 5,
        refillIntervalMs: this.minMsBetweenCalls,
        now: this.now,
        globalPauseUntil: () => this.globalPauseUntil,
        isRunning: () => this.running,
      });
    }
  }

  /**
   * Throttle gate for outbound Slack API calls. All calls (history + replies)
   * go through here. With `minMsBetweenCalls > 0` we acquire a token from the
   * shared bucket; multiple workers can hold tokens concurrently up to the
   * burst capacity, so `concurrency: 8` actually parallelizes (unlike the
   * older serial promise-chain gate). With `minMsBetweenCalls === 0` we are
   * in test mode and skip throttling entirely.
   *
   * The bucket honors `globalPauseUntil` set by 429 handlers so the entire
   * client backs off when Slack tells us to.
   */
  private async paceCall<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.running) {
      throw new Error('SlackPollingClient stopped');
    }
    if (!this.bucket) {
      // Test mode: no throttling at all.
      return fn();
    }
    await this.bucket.acquire();
    if (!this.running) {
      throw new Error('SlackPollingClient stopped');
    }
    return fn();
  }

  /** Subscribe to fatal-error notifications (e.g. invalid_auth). */
  setOnFatalError(cb: (reason: string) => void): void {
    this.onFatalError = cb;
  }

  /**
   * Start the polling loop. Returns once the watermark store is loaded and
   * the first cycle is scheduled — does NOT wait for the first cycle to
   * complete (matches Socket Mode's start-then-listen contract).
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.fatalError = null;
    await this.watermarkStore.load();
    log.log(
      `Polling started: interval=${this.intervalMs / 1000}s, concurrency=${this.concurrency}, paceMs=${this.minMsBetweenCalls}, backfillCap=${this.backfillMessageCap}`,
    );
    // Kick the first cycle immediately so we don't wait `intervalMs` to see
    // anything. Subsequent cycles are scheduled at the END of each cycle.
    this.scheduleNextCycle(0);
  }

  /**
   * Stop the loop. Awaits the in-flight cycle so callers don't see ghost
   * dispatches after `stop()` resolves.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      await this.inFlight.catch(() => undefined);
    }
  }

  /** Force one cycle to run NOW. Returns when the cycle finishes. */
  async runOnce(): Promise<void> {
    if (!this.running) return;
    if (this.inFlight) {
      await this.inFlight.catch(() => undefined);
      return;
    }
    await this.runCycleSafely();
  }

  // ─── Internals ───

  private scheduleNextCycle(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer);
    }
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.runCycleSafely();
    }, delayMs);
  }

  private runCycleSafely(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const p = this.runCycle()
      .catch((err) => {
        log.error(`Polling cycle failed: ${describeErr(err)}`);
      })
      .finally(() => {
        this.inFlight = null;
        if (this.running && !this.fatalError) {
          this.scheduleNextCycle(this.intervalMs);
        }
      });
    this.inFlight = p;
    return p;
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    this.cycleCount += 1;
    const cycleStart = this.now();

    // Search-mode: one `search.messages` call replaces the entire per-channel
    // history sweep. Covers thread replies for old parents that history would
    // miss. Done in its own branch so the legacy per-channel path stays
    // intact for tokens without `search:read` scope.
    if (this.useSearch) {
      try {
        const { dispatched, pages } = await this.pollViaSearch();
        const elapsed = this.now() - cycleStart;
        log.log(
          `cycle=${this.cycleCount} via=search pages=${pages} dispatched=${dispatched} elapsedMs=${elapsed}`,
        );
      } catch (err) {
        if (isInvalidAuthError(err)) {
          this.handleFatal(`invalid_auth on search.messages (cycle=${this.cycleCount})`);
          return;
        }
        log.warn(`search-mode cycle failed (cycle=${this.cycleCount}): ${describeErr(err)}`);
      }
      return;
    }

    // Refresh channel list on first cycle and every N cycles after.
    if (this.cycleCount === 1 || this.cycleCount % this.channelListRefreshEveryNCycles === 0) {
      try {
        await this.refreshChannelList();
      } catch (err) {
        if (isInvalidAuthError(err)) {
          this.handleFatal(`invalid_auth on conversations.list (cycle=${this.cycleCount})`);
          return;
        }
        log.warn(`channel list refresh failed (cycle=${this.cycleCount}): ${describeErr(err)}`);
      }
    }

    const channels = Array.from(this.knownChannels);
    if (channels.length === 0) {
      log.log(`cycle=${this.cycleCount}: no channels visible, skipping fetch`);
      return;
    }
    // One-line heartbeat at the start of every cycle so the user can see the
    // poller is ticking even when no new messages are dispatched.
    log.log(
      `cycle=${this.cycleCount} starting: channels=${channels.length} paceMs=${this.minMsBetweenCalls} (~${Math.round(channels.length * this.minMsBetweenCalls / 1000)}s expected)`,
    );

    // First-cycle backfill is gentler: serialize all channels so we don't
    // hit `conversations.history` for hundreds of channels in parallel.
    const effectiveConcurrency = this.cycleCount === 1 ? 1 : this.concurrency;
    let dispatched = 0;
    let skippedBackoff = 0;

    await mapWithConcurrency(channels, effectiveConcurrency, async (channelId) => {
      // Bail mid-cycle if stop() was called. Lets reconnect() be near-instant
      // instead of waiting up to ~5 minutes for a long pace-throttled cycle
      // to drain.
      if (!this.running) return;
      // Skip channels still under 429 backoff.
      const backoffUntil = this.channelBackoffUntil.get(channelId);
      if (backoffUntil && this.now() < backoffUntil) {
        skippedBackoff += 1;
        return;
      }
      try {
        const n = await this.pollChannel(channelId);
        dispatched += n;
      } catch (err) {
        if (isInvalidAuthError(err)) {
          this.handleFatal(`invalid_auth on conversations.history (channel=${channelId})`);
          return;
        }
        if (isRateLimitedError(err)) {
          const seconds = readRetryAfter(err) ?? 60;
          const until = this.now() + seconds * 1000;
          this.channelBackoffUntil.set(channelId, until);
          // Apply a workspace-wide pause too — subsequent paceCall()s wait
          // until the Retry-After window clears so we don't burst more 429s.
          if (until > this.globalPauseUntil) this.globalPauseUntil = until;
          log.warn(`429 on channel=${channelId}, backoff=${seconds}s (cycle=${this.cycleCount})`);
          return;
        }
        log.warn(`history failed channel=${channelId}: ${describeErr(err)}`);
      }
    });

    const elapsed = this.now() - cycleStart;
    // log() not debug() — single line per cycle is the user's heartbeat that
    // polling is alive. ~1 line per pollingIntervalSec is not noisy.
    log.log(
      `cycle=${this.cycleCount} channels=${channels.length} dispatched=${dispatched} skippedBackoff=${skippedBackoff} elapsedMs=${elapsed}`,
    );
  }

  private async refreshChannelList(): Promise<void> {
    const next = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await this.paceCall(() => this.webClient.conversations.list({
        types: this.channelTypes,
        limit: 200,
        cursor,
      }));
      for (const ch of res.channels ?? []) {
        if (!ch?.id) continue;
        if (ch.is_archived) continue;
        // For shared/public channels Slack provides `is_member`; for IM/MPIM
        // membership is implicit (the call only returns DMs you're in).
        const memberOrDm = ch.is_member !== false || ch.is_im || ch.is_mpim;
        if (!memberOrDm) continue;

        // Apply allowlist if any. DMs (id starts with 'D' or is_im) bypass
        // the allowlist when keepAllDms is true.
        if (this.allowlistChannelIds.size > 0) {
          const isDm = !!ch.is_im || ch.id.startsWith('D');
          const allowed = this.allowlistChannelIds.has(ch.id) || (this.keepAllDms && isDm);
          if (!allowed) continue;
        }

        next.add(ch.id);
      }
      cursor = res.response_metadata?.next_cursor || undefined;
      pages += 1;
      if (pages > 10) break; // safety: 10 pages × 200 = 2000 channels max per refresh
    } while (cursor);
    this.knownChannels = next;
    log.log(`channel list refresh: ${next.size} channels visible (cycle=${this.cycleCount})`);
  }

  /**
   * Poll one channel: fetch all messages newer than the watermark (or apply
   * backfill cap on first sight), shape each into a Socket-Mode-like event,
   * dispatch, and advance the watermark to the newest seen ts.
   *
   * Returns the number of messages dispatched.
   */
  /**
   * Register/refresh a tracked thread. Fed by three sources: the parent
   * heuristic in pollChannel, every dispatched message carrying a thread_ts
   * (both transports — the instance dispatcher calls this), and the SQLite
   * seed on startup so tracking survives process restarts.
   *
   * Deliberately does NOT advance `lastTs` for known threads — that stays
   * sweep-owned so a mid-thread reply the socket dropped can't be skipped
   * because a newer reply arrived live first. `activityMs` defaults to now;
   * the startup seed passes the stored time so stale threads still expire.
   */
  noteThreadActivity(channelId: string, threadTs: string, activityMs?: number): void {
    let threads = this.threadRegistry.get(channelId);
    if (!threads) {
      threads = new Map();
      this.threadRegistry.set(channelId, threads);
    }
    const existing = threads.get(threadTs);
    if (existing) {
      existing.lastActivityMs = Math.max(existing.lastActivityMs, activityMs ?? this.now());
      return;
    }
    if (threads.size >= MAX_TRACKED_THREADS_PER_CHANNEL) {
      let oldestKey: string | null = null;
      let oldestMs = Infinity;
      for (const [key, state] of threads) {
        if (state.lastActivityMs < oldestMs) {
          oldestMs = state.lastActivityMs;
          oldestKey = key;
        }
      }
      if (oldestKey) threads.delete(oldestKey);
    }
    threads.set(threadTs, { lastTs: threadTs, lastActivityMs: activityMs ?? this.now() });
  }

  /**
   * Per-thread watermark sweep: fetch new replies for every tracked thread in
   * this channel, independently of whether the parent resurfaces in
   * conversations.history (it never does once the channel watermark passes
   * it — the exact gap that made "thread replies on old parents" invisible
   * to polling). Downstream (channel, ts) dedup makes overlap with the live
   * socket harmless.
   */
  private async sweepThreads(channelId: string): Promise<number> {
    const threads = this.threadRegistry.get(channelId);
    if (!threads || threads.size === 0) return 0;

    let dispatched = 0;
    const nowMs = this.now();
    for (const [threadTs, state] of threads) {
      if (!this.running) break;
      if (nowMs - state.lastActivityMs > THREAD_TTL_MS) {
        threads.delete(threadTs);
        continue;
      }
      try {
        const res = await this.paceCall(() => this.webClient.conversations.replies({
          channel: channelId,
          ts: threadTs,
          oldest: state.lastTs,
          limit: 100,
        }));
        const replies = (res.messages ?? []).filter(
          (r): r is SlackHistoryMessage =>
            !!r && typeof r.ts === 'string' && r.ts !== threadTs && tsGt(r.ts, state.lastTs),
        );
        if (replies.length === 0) continue;
        const ordered = [...replies].sort((a, b) => tsCmp(a.ts, b.ts));
        for (const reply of ordered) {
          const replyEvent: SocketLikeMessageEvent = {
            ts: reply.ts,
            thread_ts: reply.thread_ts ?? threadTs,
            channel: channelId,
            user: reply.user,
            text: reply.text,
            subtype: reply.subtype,
            files: Array.isArray(reply.files) ? reply.files : undefined,
          };
          try {
            await this.dispatch(replyEvent);
            dispatched += 1;
          } catch (err) {
            log.error(`dispatch error (thread sweep) channel=${channelId} ts=${reply.ts}: ${describeErr(err)}`);
          }
          if (tsGt(reply.ts, state.lastTs)) {
            state.lastTs = reply.ts;
            state.lastActivityMs = nowMs;
          }
        }
      } catch (err) {
        if (isInvalidAuthError(err)) throw err;
        if (isRateLimitedError(err)) {
          const seconds = readRetryAfter(err) ?? 60;
          const until = this.now() + seconds * 1000;
          if (until > this.globalPauseUntil) this.globalPauseUntil = until;
          log.warn(`429 on thread sweep channel=${channelId} thread=${threadTs}, deferred ${seconds}s`);
          break; // Remaining threads would hit the same pause — next cycle retries.
        }
        const msg = describeErr(err);
        if (msg.includes('thread_not_found') || msg.includes('message_not_found')) {
          threads.delete(threadTs); // Parent deleted — stop tracking.
        } else {
          log.warn(`thread sweep failed channel=${channelId} thread=${threadTs}: ${msg}`);
        }
      }
    }
    return dispatched;
  }

  private async pollChannel(channelId: string): Promise<number> {
    const wm = this.watermarkStore.get(channelId);
    const isFirstSight = !wm;

    let oldest: string | undefined = wm?.lastTs;
    if (isFirstSight) {
      // Cap lookback to backfillSeconds ago.
      const sinceMs = this.now() - this.backfillSeconds * 1000;
      oldest = (sinceMs / 1000).toFixed(6);
    }

    // Slack returns messages newest-first. We accumulate one page at most for
    // ongoing polling; on first sight we still cap by backfillMessageCap.
    const limit = isFirstSight ? this.backfillMessageCap : 100;
    const res = await this.paceCall(() => this.webClient.conversations.history({
      channel: channelId,
      oldest,
      limit,
    }));

    const messages = (res.messages ?? []).filter((m): m is SlackHistoryMessage => !!m && typeof m.ts === 'string');
    if (messages.length === 0) {
      // No new channel-level messages — but replies on tracked threads never
      // resurface in history, so the thread sweep must still run.
      const swept = await this.sweepThreads(channelId);
      if (this.channelBackoffUntil.has(channelId)) {
        this.channelBackoffUntil.delete(channelId);
      }
      return swept;
    }

    // Slack returns newest-first; dispatch in chronological order so trigger
    // listeners and dedupe see them in real-world order. BigInt sort avoids
    // the precision loss `parseFloat` had on Slack's 16-sig-fig timestamps.
    const ordered = [...messages].sort((a, b) => tsCmp(a.ts, b.ts));

    let dispatched = 0;
    let highestTs = wm?.lastTs ?? '0';

    for (const msg of ordered) {
      // Defense-in-depth: never re-dispatch ts <= watermark even if the
      // server returned an unexpected row.
      if (wm && tsLte(msg.ts, wm.lastTs)) continue;

      const event: SocketLikeMessageEvent = {
        ts: msg.ts,
        thread_ts: msg.thread_ts,
        channel: channelId,
        user: msg.user,
        text: msg.text,
        subtype: msg.subtype,
        files: Array.isArray(msg.files) ? msg.files : undefined,
      };

      try {
        await this.dispatch(event);
        dispatched += 1;
      } catch (err) {
        log.error(`dispatch error channel=${channelId} ts=${msg.ts}: ${describeErr(err)}`);
      }

      if (tsGt(msg.ts, highestTs)) {
        highestTs = msg.ts;
      }

      // ─── Thread tracking ───
      // Any parent with replies gets registered; the per-thread sweep at the
      // end of this cycle (sweepThreads) is the single path that fetches and
      // dispatches replies. Once the channel watermark passes the parent it
      // never resurfaces in history — the registry is what keeps its future
      // replies visible (the old inline "latest_reply" heuristic could not
      // see replies on parents behind the watermark).
      if ((msg.reply_count ?? 0) > 0) {
        this.noteThreadActivity(channelId, msg.ts);
      }
    }

    // Sweep tracked threads too. Thread-reply ts values deliberately do NOT
    // advance the channel watermark here — that stays owned by the history
    // fetch above; the sweep keeps its own per-thread watermarks.
    dispatched += await this.sweepThreads(channelId);

    if (highestTs !== (wm?.lastTs ?? '0')) {
      await this.watermarkStore.set(channelId, highestTs);
    }

    // Clear any prior backoff record on success.
    if (this.channelBackoffUntil.has(channelId)) {
      this.channelBackoffUntil.delete(channelId);
    }

    return dispatched;
  }

  /**
   * Search-mode cycle: pull recent messages (channels + DMs + thread replies)
   * with `search.messages`. Each match is filtered against the allowlist (and
   * keepAllDms for DMs), checked against the per-channel watermark, collected,
   * then dispatched in chronological order. Watermark advances per channel
   * just like the legacy path so a switch back to per-channel polling stays
   * correct.
   *
   * Ordering: results are fetched NEWEST-first (`sort_dir: 'desc'`) so the
   * freshest messages land on page 1 and we can stop paging the instant we
   * cross back into already-seen territory. The previous asc ordering forced
   * every cycle to page through the entire day window to reach the new
   * messages (which sat on the LAST page), and on busy accounts (more than
   * MAX_PAGES×count msgs/day) the newest messages were never reached at all —
   * a latency sink and a silent drop. Because we now page newest→oldest we
   * collect candidates then sort ascending before dispatch so trigger
   * listeners + thread ordering still see real-world order.
   *
   * Early-stop boundary: `after:<yesterday>` (day-precision, the finest Slack
   * search supports) is the absolute floor that bounds a cold-start/first
   * cycle. After the first cycle we additionally stop paging once a page's
   * oldest match is older than (last cycle's newest ts − OVERLAP). The overlap
   * re-scans recent history every tick so messages Slack's search index
   * surfaces late (documented ~10-30s lag) are still caught; the per-channel
   * watermark dedupes the overlap so nothing dispatches twice. Net effect:
   * steady-state cycles cost ~1 page instead of paging the whole day.
   */
  private async pollViaSearch(): Promise<{ dispatched: number; pages: number }> {
    if (!this.webClient.search) {
      log.error('useSearch=true but webClient has no `search.messages` method; bailing.');
      return { dispatched: 0, pages: 0 };
    }
    const searchApi = this.webClient.search;
    // Slack's date operators want YYYY-MM-DD. Use UTC; mismatched local TZ
    // would shift the boundary by ≤1 day which is harmless (watermark filter
    // dedupes anyway).
    const yesterday = new Date(this.now() - 24 * 60 * 60 * 1000);
    const y = yesterday.getUTCFullYear();
    const m = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getUTCDate()).padStart(2, '0');
    const query = `after:${y}-${m}-${d}`;

    // Stop paging once we reach messages older than (last cycle's newest −
    // overlap). 5 min is well above Slack's ~10-30s index lag, so late-indexed
    // messages are still re-scanned; watermark dedup keeps them from
    // re-dispatching. floorBig = 0n on the first cycle ⇒ no early stop ⇒ full
    // backfill of the day window.
    const OVERLAP_MICROS = 5n * 60n * 1_000_000n; // 5 minutes in packed-ts units
    const floorBig = this.lastSearchMaxTs
      ? tsToBigInt(this.lastSearchMaxTs) - OVERLAP_MICROS
      : 0n;

    let page = 1;
    const MAX_PAGES = 10; // ~1000 messages per cycle ceiling
    let cycleMaxTs: string | null = null;
    // Collected new events; dispatched chronologically after paging.
    const pending: SocketLikeMessageEvent[] = [];
    // Track highest seen ts per channel so we advance watermark at the end.
    const highestByChannel = new Map<string, string>();
    // Exact `${channel}:${ts}` keys collected this cycle — defends against the
    // same match appearing on overlapping pages. (Must NOT gate on the running
    // per-channel max: we fetch newest-first, so the max is the FIRST match and
    // a max-based gate would drop every older message in the cycle.)
    const seenKeys = new Set<string>();

    while (page <= MAX_PAGES) {
      if (!this.running) break;
      let res: SlackSearchResponse;
      try {
        res = await this.paceCall(() => searchApi.messages({
          query,
          count: 100,
          page,
          sort: 'timestamp',
          sort_dir: 'desc',
        }));
      } catch (err) {
        if (isInvalidAuthError(err)) throw err;
        if (isRateLimitedError(err)) {
          const seconds = readRetryAfter(err) ?? 60;
          const until = this.now() + seconds * 1000;
          if (until > this.globalPauseUntil) this.globalPauseUntil = until;
          log.warn(`429 on search.messages page=${page}, deferred ${seconds}s`);
          break;
        }
        log.warn(`search.messages page=${page} failed: ${describeErr(err)}`);
        break;
      }

      const matches = res.messages?.matches ?? [];
      if (matches.length === 0) break;

      let oldestOnPageTs: string | null = null;
      for (const match of matches) {
        const channelId = match.channel?.id;
        if (!channelId || !match.ts || typeof match.ts !== 'string') continue;

        // Track newest (for next cycle's floor) and oldest (for early-stop)
        // across ALL matches, before any allowlist/watermark filtering — the
        // boundary must reflect everything the index returned, not just what
        // we chose to dispatch.
        if (!cycleMaxTs || tsGt(match.ts, cycleMaxTs)) cycleMaxTs = match.ts;
        if (!oldestOnPageTs || tsCmp(match.ts, oldestOnPageTs) < 0) oldestOnPageTs = match.ts;

        // Allowlist filter: respect the same rule as the legacy path so the
        // user's "only these channels + DMs" config still gates everything.
        if (this.allowlistChannelIds.size > 0) {
          const isDm =
            !!match.channel?.is_im || channelId.startsWith('D');
          const allowed =
            this.allowlistChannelIds.has(channelId) ||
            (this.keepAllDms && isDm);
          if (!allowed) continue;
        }

        // Watermark filter: drop anything we've already dispatched in a prior
        // cycle. Each channel keeps its own watermark so a switch back to
        // per-channel polling later picks up exactly where search left off.
        const wm = this.watermarkStore.get(channelId);
        if (wm && tsLte(match.ts, wm.lastTs)) continue;
        const key = `${channelId}:${match.ts}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        pending.push({
          ts: match.ts,
          thread_ts: match.thread_ts,
          channel: channelId,
          user: match.user,
          text: match.text,
          subtype: match.subtype,
          files: Array.isArray(match.files) ? match.files : undefined,
        });
        const curMax = highestByChannel.get(channelId);
        if (!curMax || tsGt(match.ts, curMax)) {
          highestByChannel.set(channelId, match.ts);
        }
      }

      // Early stop: this page has paged back past the overlap floor, so every
      // remaining (older) match was already seen in a prior cycle.
      if (oldestOnPageTs && tsToBigInt(oldestOnPageTs) <= floorBig) break;

      // Pagination control. Slack returns `pagination.page_count` or the
      // legacy `paging.pages`; bail when we're past the last page or when
      // matches < count (no more left).
      const total = res.messages?.pagination?.page_count
        ?? res.messages?.paging?.pages
        ?? page;
      if (matches.length < 100) break;
      if (page >= total) break;
      page += 1;
    }

    // Dispatch chronologically (search returned newest-first) so trigger
    // listeners and thread ordering see messages in real-world order.
    pending.sort((a, b) => tsCmp(a.ts, b.ts));
    let dispatched = 0;
    for (const event of pending) {
      if (!this.running) break;
      try {
        await this.dispatch(event);
        dispatched += 1;
      } catch (err) {
        log.error(`dispatch error (search) channel=${event.channel} ts=${event.ts}: ${describeErr(err)}`);
      }
    }

    // Persist per-channel watermarks for everything we dispatched this cycle.
    for (const [channelId, highest] of highestByChannel) {
      const existing = this.watermarkStore.get(channelId)?.lastTs;
      if (!existing || tsGt(highest, existing)) {
        await this.watermarkStore.set(channelId, highest);
      }
    }

    // Remember the newest ts the index returned so the next cycle can stop
    // paging early once it crosses back past it (minus the overlap window).
    if (cycleMaxTs && (!this.lastSearchMaxTs || tsGt(cycleMaxTs, this.lastSearchMaxTs))) {
      this.lastSearchMaxTs = cycleMaxTs;
    }

    return { dispatched, pages: page };
  }

  private handleFatal(reason: string): void {
    this.fatalError = reason;
    this.running = false;
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    log.error(`Polling halted: ${reason}`);
    this.onFatalError?.(reason);
  }
}

// ─── Helpers ───

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

function describeErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Run `worker(item)` for each item with a max of `concurrency` in flight.
 * Errors thrown by individual workers are swallowed by the caller's
 * try/catch around `worker` — this helper itself never rejects.
 */
async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < limit; i += 1) {
    runners.push(
      (async () => {
        while (true) {
          const idx = cursor;
          cursor += 1;
          if (idx >= items.length) return;
          await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/** Adapter so the production code can pass a real Slack WebClient. */
export function asPollingWebClient(client: WebClient): PollingWebClient {
  return client as unknown as PollingWebClient;
}

// ─── Slack TS comparison helpers ───
//
// Slack timestamps are strings shaped like `XXXXXXXXXX.YYYYYY` — 10-digit
// seconds + 6-digit microseconds. Using `parseFloat()` on them silently loses
// precision in the last digits (JS doubles top out around 15–17 sig figs),
// which can cause two adjacent timestamps to compare equal and a real message
// to be silently dropped (`msg.ts <= wm.lastTs` accepting it as already-seen
// and `msg.ts > highestTs` refusing to advance the watermark). We use BigInt
// instead so the comparison is exact.

function tsToBigInt(ts: string | undefined | null): bigint {
  if (!ts) return 0n;
  const dot = ts.indexOf('.');
  const sec = dot === -1 ? ts : ts.slice(0, dot);
  const micro = dot === -1 ? '' : ts.slice(dot + 1);
  // Pad / truncate microseconds to exactly 6 digits so concatenation always
  // produces a consistent-magnitude integer.
  const microPadded = (micro + '000000').slice(0, 6);
  try {
    return BigInt(sec + microPadded);
  } catch {
    return 0n;
  }
}

/** True if `a <= b`. */
function tsLte(a: string | undefined, b: string | undefined): boolean {
  return tsToBigInt(a) <= tsToBigInt(b);
}

/** True if `a > b`. */
function tsGt(a: string | undefined, b: string | undefined): boolean {
  return tsToBigInt(a) > tsToBigInt(b);
}

/** Compare two ts strings for Array.sort. Returns -1, 0, or 1. */
function tsCmp(a: string, b: string): number {
  const ab = tsToBigInt(a);
  const bb = tsToBigInt(b);
  return ab < bb ? -1 : ab > bb ? 1 : 0;
}

// ─── Token bucket rate limiter ───
//
// Refills `1` token every `refillIntervalMs` up to `capacity`. Workers
// `acquire()` a token before making an API call; concurrent waiters are
// served FIFO via an explicit queue so we don't get a thundering-herd of
// setTimeouts all racing to take the next token. Honors `globalPauseUntil`
// so 429s from any one call back the whole client off.

interface TokenBucketOpts {
  capacity: number;
  refillIntervalMs: number;
  now: () => number;
  globalPauseUntil: () => number;
  isRunning: () => boolean;
}

class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  private waiters: Array<() => void> = [];
  private pumpScheduled = false;
  private readonly capacity: number;
  private readonly refillIntervalMs: number;
  private readonly nowFn: () => number;
  private readonly globalPauseUntilFn: () => number;
  private readonly isRunningFn: () => boolean;

  constructor(opts: TokenBucketOpts) {
    this.capacity = Math.max(1, opts.capacity);
    this.refillIntervalMs = Math.max(1, opts.refillIntervalMs);
    this.nowFn = opts.now;
    this.globalPauseUntilFn = opts.globalPauseUntil;
    this.isRunningFn = opts.isRunning;
    this.tokens = this.capacity;
    this.lastRefillMs = opts.now();
  }

  private refillNow(): void {
    const elapsed = this.nowFn() - this.lastRefillMs;
    if (elapsed <= 0) return;
    const gained = elapsed / this.refillIntervalMs;
    if (gained > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + gained);
      this.lastRefillMs = this.nowFn();
    }
  }

  async acquire(): Promise<void> {
    if (!this.isRunningFn()) throw new Error('SlackPollingClient stopped');
    // Wait through any global 429 pause before consuming a token so the
    // entire workspace honors Retry-After.
    const pauseRemaining = this.globalPauseUntilFn() - this.nowFn();
    if (pauseRemaining > 0) {
      await new Promise<void>((r) => setTimeout(r, pauseRemaining));
      if (!this.isRunningFn()) throw new Error('SlackPollingClient stopped');
    }
    this.refillNow();
    if (this.tokens >= 1 && this.waiters.length === 0) {
      this.tokens -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.schedulePump();
    });
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    const needed = Math.max(0, 1 - this.tokens);
    const waitMs = Math.max(10, Math.ceil(needed * this.refillIntervalMs));
    setTimeout(() => {
      this.pumpScheduled = false;
      this.refillNow();
      while (this.tokens >= 1 && this.waiters.length > 0) {
        this.tokens -= 1;
        const resolve = this.waiters.shift()!;
        resolve();
      }
      if (this.waiters.length > 0) {
        this.schedulePump();
      }
    }, waitMs);
  }
}
