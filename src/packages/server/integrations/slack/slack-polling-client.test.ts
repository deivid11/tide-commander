import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SlackPollingClient,
  type PollingWebClient,
  type PollingScheduler,
  type SocketLikeMessageEvent,
} from './slack-polling-client.js';
import { SlackWatermarkStore } from './slack-watermark-store.js';

// ─── Test Helpers ───

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slack-polling-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

interface MockMessage {
  ts: string;
  user?: string;
  text?: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
}

interface ScheduledTask {
  cb: () => void;
  ms: number;
  cleared: boolean;
}

/** Manual scheduler — tests advance time explicitly via `runDue()`. */
function createManualScheduler(): { scheduler: PollingScheduler; runDue: () => void; pending: ScheduledTask[] } {
  const tasks: ScheduledTask[] = [];
  const scheduler: PollingScheduler = {
    setTimeout: (cb, ms) => {
      const t: ScheduledTask = { cb, ms, cleared: false };
      tasks.push(t);
      return t;
    },
    clearTimeout: (handle) => {
      const t = handle as ScheduledTask;
      if (t) t.cleared = true;
    },
  };
  const runDue = () => {
    while (true) {
      const next = tasks.find((t) => !t.cleared);
      if (!next) return;
      next.cleared = true;
      next.cb();
    }
  };
  return { scheduler, runDue, pending: tasks };
}

/** Build a mock PollingWebClient with controllable per-channel histories. */
function buildMockClient(opts: {
  channels: { id: string; is_member?: boolean; is_im?: boolean; is_archived?: boolean }[];
  history: Record<string, MockMessage[] | (() => MockMessage[] | Promise<MockMessage[]>)>;
  /** Optional: thread replies indexed by `${channelId}:${threadTs}`. */
  replies?: Record<string, MockMessage[]>;
  /** Optional: cause history() to throw a Slack 429 the first N times for a given channel. */
  rateLimitFor?: { channel: string; times: number; retryAfter: number };
  /** Optional: cause history() to throw `invalid_auth` for a given channel. */
  invalidAuthFor?: string;
}) {
  const calls: { method: string; args: unknown }[] = [];
  let rateLimitCount = 0;

  const client: PollingWebClient = {
    conversations: {
      list: vi.fn(async (args) => {
        calls.push({ method: 'list', args });
        return { channels: opts.channels };
      }),
      history: vi.fn(async (args) => {
        calls.push({ method: 'history', args });
        if (opts.invalidAuthFor && args.channel === opts.invalidAuthFor) {
          const err = new Error('invalid_auth') as Error & { data?: { error?: string } };
          err.data = { error: 'invalid_auth' };
          throw err;
        }
        if (
          opts.rateLimitFor &&
          args.channel === opts.rateLimitFor.channel &&
          rateLimitCount < opts.rateLimitFor.times
        ) {
          rateLimitCount += 1;
          const err = new Error('ratelimited') as Error & {
            code?: string;
            data?: { error?: string; retry_after?: number };
            retryAfter?: number;
          };
          err.code = 'slack_webapi_rate_limited_error';
          err.data = { error: 'ratelimited', retry_after: opts.rateLimitFor.retryAfter };
          err.retryAfter = opts.rateLimitFor.retryAfter;
          throw err;
        }
        const entry = opts.history[args.channel as string];
        const messages = typeof entry === 'function' ? await entry() : entry ?? [];
        return { messages };
      }),
      replies: vi.fn(async (args) => {
        calls.push({ method: 'replies', args });
        const key = `${args.channel}:${args.ts}`;
        const all = opts.replies?.[key] ?? [];
        // Slack returns parent + replies; tests pass replies only, we just
        // mirror that. Filter by oldest (exclusive) like the real API.
        const oldest = args.oldest;
        const filtered = oldest
          ? all.filter((m) => parseFloat(m.ts) > parseFloat(oldest))
          : all;
        return { messages: filtered };
      }),
    },
  };

  return { client, calls };
}

async function makeStore(): Promise<SlackWatermarkStore> {
  const store = new SlackWatermarkStore({ filePath: path.join(tmpDir, 'wm.json') });
  await store.load();
  return store;
}

interface SearchMatch {
  ts: string;
  channel: { id: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean };
  user?: string;
  text?: string;
  thread_ts?: string;
}

/**
 * Build a mock PollingWebClient that serves `search.messages` from an
 * in-memory universe of matches, paginating with the same count/sort_dir the
 * client requests. `conversations.*` are inert stubs (search mode never calls
 * them). Exposes `calls` (every search.messages invocation) and `addMatch` so
 * tests can simulate new messages arriving between cycles.
 */
function buildSearchMockClient(initial: SearchMatch[]) {
  const universe: SearchMatch[] = [...initial];
  const calls: { method: string; args: { count?: number; page?: number; sort_dir?: string } }[] = [];

  const client: PollingWebClient = {
    conversations: {
      list: vi.fn(async () => ({ channels: [] })),
      history: vi.fn(async () => ({ messages: [] })),
      replies: vi.fn(async () => ({ messages: [] })),
    },
    search: {
      messages: vi.fn(async (args) => {
        calls.push({ method: 'search', args });
        const desc = [...universe].sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
        const ordered = args.sort_dir === 'asc' ? desc.reverse() : desc;
        const count = args.count ?? 100;
        const page = args.page ?? 1;
        const start = (page - 1) * count;
        const pageMatches = ordered.slice(start, start + count);
        const pages = Math.max(1, Math.ceil(ordered.length / count));
        return {
          ok: true,
          messages: {
            total: ordered.length,
            paging: { count, total: ordered.length, page, pages },
            matches: pageMatches,
          },
        };
      }),
    },
  };

  return {
    client,
    calls,
    addMatch: (m: SearchMatch) => { universe.push(m); },
  };
}

// ─── Tests ───

describe('SlackPollingClient', () => {
  it('first cycle backfills with the message-cap and dispatches in chronological order', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler, runDue } = createManualScheduler();
    const { client } = buildMockClient({
      channels: [{ id: 'C1', is_member: true }],
      history: {
        // Slack returns newest-first; the client should reorder.
        C1: [
          { ts: '1700000003.000003', user: 'U1', text: 'third' },
          { ts: '1700000002.000002', user: 'U1', text: 'second' },
          { ts: '1700000001.000001', user: 'U1', text: 'first' },
        ],
      },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
    });

    await polling.start();
    runDue(); // run the first scheduled cycle (delay 0)
    // Wait for in-flight cycle to settle.
    await polling.runOnce();

    expect(dispatched.map((m) => m.ts)).toEqual([
      '1700000001.000001',
      '1700000002.000002',
      '1700000003.000003',
    ]);
    expect(store.get('C1')?.lastTs).toBe('1700000003.000003');
    await polling.stop();
  });

  it('does not re-dispatch messages already at or below the watermark across cycles', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler, runDue } = createManualScheduler();

    let phase: 'first' | 'second' = 'first';
    const { client } = buildMockClient({
      channels: [{ id: 'C2', is_member: true }],
      history: {
        C2: () => {
          if (phase === 'first') {
            return [
              { ts: '1700000010.000010', user: 'U1', text: 'A' },
              { ts: '1700000011.000011', user: 'U1', text: 'B' },
            ];
          }
          // Server may still echo the prior tip + a new message. Filter must drop A,B.
          return [
            { ts: '1700000011.000011', user: 'U1', text: 'B' },
            { ts: '1700000012.000012', user: 'U1', text: 'C' },
          ];
        },
      },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
    });

    await polling.start();
    runDue();
    await polling.runOnce(); // first cycle

    phase = 'second';
    await polling.runOnce(); // second cycle

    expect(dispatched.map((m) => m.ts)).toEqual([
      '1700000010.000010',
      '1700000011.000011',
      '1700000012.000012',
    ]);
    expect(store.get('C2')?.lastTs).toBe('1700000012.000012');
    await polling.stop();
  });

  it('respects Retry-After on a 429 — the next cycle after the window dispatches successfully', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();

    let now = 1_000_000;

    const { client } = buildMockClient({
      channels: [{ id: 'C3', is_member: true }],
      history: {
        C3: [{ ts: '1700000020.000020', user: 'U1', text: 'after retry' }],
      },
      rateLimitFor: { channel: 'C3', times: 1, retryAfter: 30 },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
      now: () => now,
    });

    await polling.start();
    await polling.runOnce(); // first cycle: 429 — backoff recorded, no dispatch
    expect(dispatched).toEqual([]);

    // Inside the backoff window: still skipped.
    now += 10 * 1000;
    await polling.runOnce();
    expect(dispatched).toEqual([]);

    // Past the backoff window: succeeds.
    now += 30 * 1000;
    await polling.runOnce();
    expect(dispatched.map((m) => m.ts)).toEqual(['1700000020.000020']);
    await polling.stop();
  });

  it('halts on invalid_auth and notifies the fatal-error callback', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();

    const { client } = buildMockClient({
      channels: [{ id: 'C4', is_member: true }],
      history: { C4: [] },
      invalidAuthFor: 'C4',
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
    });

    const fatalSpy = vi.fn();
    polling.setOnFatalError(fatalSpy);

    await polling.start();
    await polling.runOnce();

    expect(fatalSpy).toHaveBeenCalledTimes(1);
    expect(fatalSpy.mock.calls[0][0]).toMatch(/invalid_auth/);
    // Subsequent runOnce calls should be no-ops.
    await polling.runOnce();
    expect(dispatched).toEqual([]);
  });

  it('skips archived channels and channels where the user is not a member', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    const { client, calls } = buildMockClient({
      channels: [
        { id: 'C5_archived', is_member: true, is_archived: true },
        { id: 'C5_notmember', is_member: false },
        { id: 'C5_dm', is_im: true },
      ],
      history: {
        C5_dm: [{ ts: '1700000030.000030', user: 'U1', text: 'dm' }],
        C5_archived: [{ ts: '999.000', text: 'should-not-fetch' }],
        C5_notmember: [{ ts: '999.001', text: 'should-not-fetch' }],
      },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
    });

    await polling.start();
    await polling.runOnce();

    const fetchedChannels = calls
      .filter((c) => c.method === 'history')
      .map((c) => (c.args as { channel: string }).channel);
    expect(fetchedChannels).toEqual(['C5_dm']);
    expect(dispatched.map((m) => m.channel)).toEqual(['C5_dm']);
    await polling.stop();
  });

  it('stop() awaits the in-flight cycle and prevents further dispatches', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    const { client } = buildMockClient({
      channels: [{ id: 'C6', is_member: true }],
      history: { C6: [{ ts: '1700000040.000040', user: 'U1', text: 'x' }] },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
    });

    await polling.start();
    const firstCycle = polling.runOnce();
    await polling.stop();
    await firstCycle;
    // After stop, runOnce is a no-op.
    const before = dispatched.length;
    await polling.runOnce();
    expect(dispatched.length).toBe(before);
  });

  it('respects an allowlist while still keeping DMs when keepAllDms is on', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    const { client, calls } = buildMockClient({
      channels: [
        { id: 'C_keep_me', is_member: true },       // in allowlist
        { id: 'C_skip_me', is_member: true },       // not in allowlist
        { id: 'G_keep_too', is_member: true },      // in allowlist
        { id: 'G_drop_this', is_member: true },     // not in allowlist
        { id: 'D_personal_dm', is_im: true },       // DM — keep via keepAllDms
      ],
      history: {
        C_keep_me: [{ ts: '1700000050.000050', user: 'U1', text: 'allow' }],
        C_skip_me: [{ ts: '1700000051.000051', user: 'U1', text: 'should-not-fetch' }],
        G_keep_too: [{ ts: '1700000052.000052', user: 'U1', text: 'group ok' }],
        G_drop_this: [{ ts: '1700000053.000053', user: 'U1', text: 'should-not-fetch' }],
        D_personal_dm: [{ ts: '1700000054.000054', user: 'U2', text: 'hi' }],
      },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      allowlistChannelIds: ['C_keep_me', 'G_keep_too'],
      keepAllDms: true,
      scheduler,
    });

    await polling.start();
    await polling.runOnce();

    const fetched = calls
      .filter((c) => c.method === 'history')
      .map((c) => (c.args as { channel: string }).channel)
      .sort();
    expect(fetched).toEqual(['C_keep_me', 'D_personal_dm', 'G_keep_too']);
    expect(dispatched.map((m) => m.channel).sort()).toEqual(['C_keep_me', 'D_personal_dm', 'G_keep_too']);
    await polling.stop();
  });

  it('strict allowlist (keepAllDms=false) excludes DMs that are not on the list', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    const { client, calls } = buildMockClient({
      channels: [
        { id: 'C_only_one', is_member: true },
        { id: 'D_not_listed', is_im: true },
      ],
      history: {
        C_only_one: [{ ts: '1700000060.000060', user: 'U1', text: 'yep' }],
        D_not_listed: [{ ts: '1700000061.000061', user: 'U1', text: 'should-not-fetch' }],
      },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      allowlistChannelIds: ['C_only_one'],
      keepAllDms: false,
      scheduler,
    });

    await polling.start();
    await polling.runOnce();

    const fetched = calls.filter((c) => c.method === 'history').map((c) => (c.args as { channel: string }).channel);
    expect(fetched).toEqual(['C_only_one']);
    expect(dispatched.map((m) => m.channel)).toEqual(['C_only_one']);
    await polling.stop();
  });

  it('fetches and dispatches thread replies for new-active threads (option-1 heuristic)', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    const { client, calls } = buildMockClient({
      channels: [{ id: 'C_threads', is_member: true }],
      history: {
        // Two top-level messages — one is a thread parent with new replies.
        C_threads: [
          {
            ts: '1700000010.000010',
            user: 'U1',
            text: 'parent thread post',
            reply_count: 2,
            latest_reply: '1700000012.000020',
          },
          { ts: '1700000011.000011', user: 'U2', text: 'unrelated channel post' },
        ],
      },
      replies: {
        // Real conversations.replies returns the parent plus replies; the
        // mock helper filters by oldest exclusive, mimicking the real API.
        'C_threads:1700000010.000010': [
          { ts: '1700000011.000050', user: 'U3', text: 'reply 1' },
          { ts: '1700000012.000020', user: 'U4', text: 'reply 2' },
        ],
      },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
    });

    await polling.start();
    await polling.runOnce();

    // Parent + 2 replies + the unrelated post = 4 events dispatched.
    expect(dispatched.map((m) => m.ts)).toEqual([
      '1700000010.000010',  // parent first
      '1700000011.000050',  // reply 1
      '1700000012.000020',  // reply 2
      '1700000011.000011',  // unrelated post (its parent had no replies, so no thread fetch)
    ]);
    // Replies API was called for the thread parent only — not for the unrelated post.
    const repliesCalls = calls.filter((c) => c.method === 'replies');
    expect(repliesCalls).toHaveLength(1);
    expect((repliesCalls[0].args as { ts: string }).ts).toBe('1700000010.000010');
    // Watermark advanced to the highest dispatched ts (a reply, not the parent).
    expect(store.get('C_threads')?.lastTs).toBe('1700000012.000020');
    await polling.stop();
  });

  it('does not refetch replies on a subsequent cycle if latest_reply is unchanged', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();

    let phase: 'first' | 'second' = 'first';
    const { client, calls } = buildMockClient({
      channels: [{ id: 'C_repeat', is_member: true }],
      history: {
        C_repeat: () => {
          if (phase === 'first') {
            return [{
              ts: '1700000020.000020',
              user: 'U1',
              text: 'thread parent',
              reply_count: 1,
              latest_reply: '1700000021.000021',
            }];
          }
          // Second cycle: server still returns the parent (in case backfill
          // window includes it) but latest_reply hasn't moved.
          return [];
        },
      },
      replies: {
        'C_repeat:1700000020.000020': [
          { ts: '1700000021.000021', user: 'U2', text: 'a reply' },
        ],
      },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
    });

    await polling.start();
    await polling.runOnce(); // first cycle: parent + reply

    phase = 'second';
    await polling.runOnce(); // second cycle: nothing new

    // Total dispatch is just from the first cycle.
    expect(dispatched.map((m) => m.ts)).toEqual([
      '1700000020.000020',
      '1700000021.000021',
    ]);
    // Only one replies call total.
    expect(calls.filter((c) => c.method === 'replies')).toHaveLength(1);
    await polling.stop();
  });

  it('refreshes the channel list on the first cycle even if intervalNCycles is large', async () => {
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    const { client, calls } = buildMockClient({
      channels: [{ id: 'C7', is_member: true }],
      history: { C7: [] },
    });

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: () => {},
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      scheduler,
    });

    await polling.start();
    await polling.runOnce();
    expect(calls.filter((c) => c.method === 'list').length).toBe(1);
    // Second cycle should NOT refresh again (large N).
    await polling.runOnce();
    expect(calls.filter((c) => c.method === 'list').length).toBe(1);
    await polling.stop();
  });
});

describe('SlackPollingClient (search mode)', () => {
  it('dispatches chronologically (newest-first fetch, asc dispatch) and advances watermark', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    const { client } = buildSearchMockClient([
      { ts: '1700000003.000003', channel: { id: 'C1' }, user: 'U1', text: 'third' },
      { ts: '1700000001.000001', channel: { id: 'C1' }, user: 'U1', text: 'first' },
      { ts: '1700000002.000002', channel: { id: 'C1' }, user: 'U1', text: 'second' },
    ]);

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      useSearch: true,
      scheduler,
    });

    await polling.start();
    await polling.runOnce();

    expect(dispatched.map((m) => m.ts)).toEqual([
      '1700000001.000001',
      '1700000002.000002',
      '1700000003.000003',
    ]);
    expect(store.get('C1')?.lastTs).toBe('1700000003.000003');
    await polling.stop();
  });

  it('applies allowlist + keepAllDms and does not re-dispatch on a quiet next cycle', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    const { client } = buildSearchMockClient([
      { ts: '1700000010.000010', channel: { id: 'C_keep' }, user: 'U1', text: 'a' },
      { ts: '1700000011.000011', channel: { id: 'C_skip' }, user: 'U1', text: 'no' },
      { ts: '1700000012.000012', channel: { id: 'D_dm', is_im: true }, user: 'U2', text: 'dm' },
    ]);

    const polling = new SlackPollingClient({
      webClient: client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      allowlistChannelIds: ['C_keep'],
      keepAllDms: true,
      useSearch: true,
      scheduler,
    });

    await polling.start();
    await polling.runOnce();
    expect(dispatched.map((m) => m.channel).sort()).toEqual(['C_keep', 'D_dm']);

    // Nothing new arrived: a second cycle must not re-dispatch.
    await polling.runOnce();
    expect(dispatched.length).toBe(2);
    await polling.stop();
  });

  it('stops paging early once a page crosses back past the overlap floor', async () => {
    const dispatched: SocketLikeMessageEvent[] = [];
    const store = await makeStore();
    const { scheduler } = createManualScheduler();
    // 150 messages spaced 10s apart → a 25-min span (wider than the 5-min
    // overlap window) so the early-stop boundary actually triggers.
    const base = 1_700_000_000;
    const initial: SearchMatch[] = [];
    for (let i = 0; i < 150; i++) {
      initial.push({ ts: `${base + i * 10}.000000`, channel: { id: 'C_big' }, user: 'U1', text: `m${i}` });
    }
    const harness = buildSearchMockClient(initial);

    const polling = new SlackPollingClient({
      webClient: harness.client,
      watermarkStore: store,
      dispatch: (e) => { dispatched.push(e); },
      intervalSec: 30,
      backfillMessageCap: 5,
      backfillSeconds: 24 * 60 * 60,
      concurrency: 1,
      channelListRefreshEveryNCycles: 999,
      useSearch: true,
      scheduler,
    });

    await polling.start();
    await polling.runOnce(); // first cycle: no floor yet → pages the full window
    expect(dispatched.length).toBe(150);
    const firstCycleCalls = harness.calls.length;
    expect(firstCycleCalls).toBe(2); // 100 + 50

    // One new message arrives, newer than everything.
    harness.addMatch({ ts: `${base + 150 * 10}.000000`, channel: { id: 'C_big' }, user: 'U1', text: 'newest' });
    await polling.runOnce();

    // Only the new message is dispatched (the rest are below the watermark)…
    expect(dispatched.length).toBe(151);
    expect(dispatched[150].text).toBe('newest');
    // …and the cycle fetched exactly ONE page before the floor stopped it.
    expect(harness.calls.length - firstCycleCalls).toBe(1);
    await polling.stop();
  });
});
