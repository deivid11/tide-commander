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
}

export interface SlackPollingClientOptions {
  webClient: PollingWebClient;
  watermarkStore: SlackWatermarkStore;
  /** Called for every new message (shape matches Socket Mode). */
  dispatch: MessageDispatcher;
  /** Default poll interval (seconds). Clamped to [10, 600]. */
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
  private readonly scheduler: PollingScheduler;
  private readonly now: () => number;

  /** Pacer state: serializes outbound API calls through a promise chain. */
  private rateGateChain: Promise<void> = Promise.resolve();
  /** When > now(), all paced calls sleep until that wall-clock ms. Set on 429. */
  private globalPauseUntil = 0;

  private running = false;
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private cycleCount = 0;
  /** ChannelId → seconds to skip until (epoch ms) after a 429. */
  private channelBackoffUntil = new Map<string, number>();
  /** ChannelId set known from the most recent list refresh. */
  private knownChannels = new Set<string>();
  /** Set when we've hit a fatal auth error so the loop self-stops. */
  private fatalError: string | null = null;
  /** Optional callback the wrapper can subscribe to for fatal errors. */
  private onFatalError: ((reason: string) => void) | null = null;

  constructor(opts: SlackPollingClientOptions) {
    this.webClient = opts.webClient;
    this.watermarkStore = opts.watermarkStore;
    this.dispatch = opts.dispatch;
    this.intervalMs = clamp(opts.intervalSec, 10, 600) * 1000;
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
    this.scheduler = opts.scheduler ?? DEFAULT_SCHEDULER;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Throttle gate for outbound Slack API calls. All calls (history + replies)
   * go through here so the per-cycle burst is smeared across the cycle. When
   * `minMsBetweenCalls` is 0 the gate is a no-op — used by tests.
   *
   * Honors `globalPauseUntil` set by 429 handlers so the entire client backs
   * off when Slack tells us to.
   */
  private async paceCall<T>(fn: () => Promise<T>): Promise<T> {
    // Stop() was called while we were queued — bail without consuming the
    // pacing slot or making the API call.
    if (!this.running) {
      throw new Error('SlackPollingClient stopped');
    }
    if (this.minMsBetweenCalls === 0 && this.globalPauseUntil <= this.now()) {
      return fn();
    }
    const prev = this.rateGateChain;
    let release!: () => void;
    this.rateGateChain = new Promise<void>((r) => { release = r; });
    await prev;

    // Re-check after waiting on the gate — stop() could have fired meanwhile.
    if (!this.running) {
      release();
      throw new Error('SlackPollingClient stopped');
    }

    // Sleep through any global pause first.
    const pauseRemainingMs = this.globalPauseUntil - this.now();
    if (pauseRemainingMs > 0) {
      await new Promise((r) => setTimeout(r, pauseRemainingMs));
    }

    try {
      return await fn();
    } finally {
      // Release the gate after the min interval — the next paced call will
      // unblock then. We don't await this; it's fire-and-forget.
      if (this.minMsBetweenCalls > 0) {
        setTimeout(release, this.minMsBetweenCalls);
      } else {
        release();
      }
    }
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
    if (messages.length === 0) return 0;

    // Slack returns newest-first; dispatch in chronological order so trigger
    // listeners and dedupe see them in real-world order.
    const ordered = [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

    let dispatched = 0;
    let highestTs = wm?.lastTs ?? '0';

    for (const msg of ordered) {
      // Defense-in-depth: never re-dispatch ts <= watermark even if the
      // server returned an unexpected row.
      if (wm && parseFloat(msg.ts) <= parseFloat(wm.lastTs)) continue;

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

      if (parseFloat(msg.ts) > parseFloat(highestTs)) {
        highestTs = msg.ts;
      }

      // ─── Cheap thread-reply heuristic ───
      // If this message is a thread parent (reply_count > 0) and the latest
      // reply is newer than what we've already seen for this channel, fetch
      // the new replies. This catches replies in threads whose parent is in
      // the current cycle's history window — which is the majority case for
      // active conversations. Older threads with new replies are still
      // missed (their parent doesn't re-surface in history) — option 2 would
      // fix that with per-thread watermarks.
      const parentTs = msg.ts;
      const replyCount = msg.reply_count ?? 0;
      const latestReply = msg.latest_reply;
      const repliesAreNew = !!latestReply && parseFloat(latestReply) > parseFloat(wm?.lastTs ?? '0');
      if (replyCount > 0 && repliesAreNew) {
        const oldestForReplies = wm?.lastTs ?? parentTs;
        try {
          const repliesRes = await this.paceCall(() => this.webClient.conversations.replies({
            channel: channelId,
            ts: parentTs,
            oldest: oldestForReplies,
            limit: 100,
          }));
          const replies = (repliesRes.messages ?? []).filter(
            (r): r is SlackHistoryMessage => !!r && typeof r.ts === 'string' && r.ts !== parentTs,
          );
          // conversations.replies returns oldest-first, but be defensive.
          const orderedReplies = [...replies].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
          for (const reply of orderedReplies) {
            // Defense: skip ts already at or below the watermark (handles overlap).
            if (wm && parseFloat(reply.ts) <= parseFloat(wm.lastTs)) continue;

            const replyEvent: SocketLikeMessageEvent = {
              ts: reply.ts,
              thread_ts: reply.thread_ts ?? parentTs,
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
              log.error(`dispatch error (reply) channel=${channelId} ts=${reply.ts}: ${describeErr(err)}`);
            }
            if (parseFloat(reply.ts) > parseFloat(highestTs)) {
              highestTs = reply.ts;
            }
          }
        } catch (err) {
          // 429 / invalid_auth on replies fetch are non-fatal for this cycle —
          // we already dispatched the parent. Bubble auth errors to the outer
          // caller so the loop halts; rate limits just skip this thread.
          if (isInvalidAuthError(err)) throw err;
          if (isRateLimitedError(err)) {
            const seconds = readRetryAfter(err) ?? 60;
            const until = this.now() + seconds * 1000;
            if (until > this.globalPauseUntil) this.globalPauseUntil = until;
            log.warn(`429 on conversations.replies channel=${channelId} thread=${parentTs}, deferred ${seconds}s`);
          } else {
            log.warn(`replies fetch failed channel=${channelId} thread=${parentTs}: ${describeErr(err)}`);
          }
        }
      }
    }

    if (highestTs !== (wm?.lastTs ?? '0')) {
      await this.watermarkStore.set(channelId, highestTs);
    }

    // Clear any prior backoff record on success.
    if (this.channelBackoffUntil.has(channelId)) {
      this.channelBackoffUntil.delete(channelId);
    }

    return dispatched;
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
