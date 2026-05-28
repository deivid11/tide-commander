import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExternalEvent, TriggerDefinition } from '../../../shared/integration-types.js';
import type { SlackInstanceChange, SlackInstanceMeta } from './slack-instance-manifest.js';
import type { SlackMessage } from './slack-instance.js';

// ─── Fake SlackInstance ─────────────────────────────────────────────────────
//
// We model only the slice the trigger handler depends on: `id`, `onMessage`,
// and `addReaction`. `emit` is a test-only helper that simulates an inbound
// message by invoking every registered onMessage callback.

interface FakeSlackInstance {
  id: string;
  onMessage: (cb: (m: SlackMessage) => void) => () => void;
  addReaction: (params: { channel: string; ts: string; name: string }) => Promise<void>;
  emit: (m: SlackMessage) => void;
  listenerCount: () => number;
}

function makeFakeInstance(id: string): FakeSlackInstance {
  const listeners = new Set<(m: SlackMessage) => void>();
  return {
    id,
    onMessage(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    async addReaction() { /* swallow */ },
    emit(m) {
      for (const l of listeners) l(m);
    },
    listenerCount() { return listeners.size; },
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// The trigger handler reaches into `slack-instance` (for `getInstance`) and
// `slack-instance-manifest` (for `listInstanceMetas` + `onInstanceChange`).
// Tests drive the manifest by mutating `instanceRegistry` and calling
// `triggerInstanceChange`.

const instanceRegistry = new Map<string, FakeSlackInstance>();
const manifestListeners = new Set<(c: SlackInstanceChange) => void>();
let metas: SlackInstanceMeta[] = [];

function setMetas(ids: string[]): void {
  metas = ids.map((id) => ({ id, label: id, createdAt: 0 }));
}

function triggerInstanceChange(change: SlackInstanceChange): void {
  for (const l of manifestListeners) l(change);
}

vi.mock('./slack-instance.js', () => ({
  getInstance: (id: string) => {
    let inst = instanceRegistry.get(id);
    if (!inst) {
      inst = makeFakeInstance(id);
      instanceRegistry.set(id, inst);
    }
    return inst;
  },
}));

vi.mock('./slack-instance-manifest.js', () => ({
  listInstanceMetas: () => metas,
  onInstanceChange: (l: (c: SlackInstanceChange) => void) => {
    manifestListeners.add(l);
    return () => { manifestListeners.delete(l); };
  },
}));

// loadConfig is consulted on every dispatched message for the per-instance
// reactOnTrigger toggle. We always return a minimal valid config — actual
// reaction calls go to the fake addReaction (which swallows).
vi.mock('./slack-config.js', () => ({
  loadConfig: () => ({ reactOnTrigger: false }),
}));

// formatAttachmentLine isn't exercised here but is imported by the handler.
vi.mock('../../services/attachment-downloader.js', () => ({
  formatAttachmentLine: () => '',
}));

// Import AFTER vi.mock so the mocks are wired up.
import { slackTriggerHandler } from './slack-trigger-handler.js';

// ─── Test helpers ──────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<SlackMessage> = {}): SlackMessage {
  return {
    ts: '1700000000.000100',
    channel: 'C0TEST',
    channelName: '#test',
    userId: 'U999',
    userName: 'tester',
    text: 'hello',
    timestamp: 1_700_000_000_000,
    ...overrides,
  } as SlackMessage;
}

beforeEach(async () => {
  instanceRegistry.clear();
  manifestListeners.clear();
  metas = [];
  // Reset handler state between tests — stopListening clears subscriptions.
  await slackTriggerHandler.stopListening();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('slackTriggerHandler dynamic instance wiring', () => {
  it('subscribes to instances that already exist when startListening runs', async () => {
    setMetas(['default', 'personal']);

    const events: ExternalEvent[] = [];
    await slackTriggerHandler.startListening((e) => events.push(e));

    const def = instanceRegistry.get('default')!;
    const personal = instanceRegistry.get('personal')!;
    expect(def.listenerCount()).toBe(1);
    expect(personal.listenerCount()).toBe(1);

    def.emit(makeMessage({ text: 'from default' }));
    personal.emit(makeMessage({ text: 'from personal' }));

    expect(events).toHaveLength(2);
    expect((events[0].data as SlackMessage & { instanceId: string }).instanceId).toBe('default');
    expect((events[1].data as SlackMessage & { instanceId: string }).instanceId).toBe('personal');
  });

  it('attaches a listener to a brand-new instance created via the manifest event', async () => {
    setMetas(['default']);

    const events: ExternalEvent[] = [];
    await slackTriggerHandler.startListening((e) => events.push(e));

    // Brand-new instance — wasn't in metas at startListening time.
    triggerInstanceChange({
      type: 'added',
      id: 'personal',
      meta: { id: 'personal', label: 'Personal', createdAt: 0 },
    });

    const personal = instanceRegistry.get('personal');
    expect(personal).toBeDefined();
    expect(personal!.listenerCount()).toBe(1);

    personal!.emit(makeMessage({ text: 'late-bound' }));

    expect(events).toHaveLength(1);
    expect((events[0].data as SlackMessage & { instanceId: string }).instanceId).toBe('personal');
    expect(events[0].source).toBe('slack');
  });

  it('detaches an instance listener when the manifest fires a removed event', async () => {
    setMetas(['default', 'personal']);

    const events: ExternalEvent[] = [];
    await slackTriggerHandler.startListening((e) => events.push(e));

    const personal = instanceRegistry.get('personal')!;
    expect(personal.listenerCount()).toBe(1);

    triggerInstanceChange({ type: 'removed', id: 'personal' });

    expect(personal.listenerCount()).toBe(0);
    personal.emit(makeMessage({ text: 'after-remove' }));
    expect(events).toHaveLength(0);
  });

  it('stopListening detaches every subscription AND unhooks the manifest listener', async () => {
    setMetas(['default']);

    const events: ExternalEvent[] = [];
    await slackTriggerHandler.startListening((e) => events.push(e));

    const def = instanceRegistry.get('default')!;
    expect(def.listenerCount()).toBe(1);
    expect(manifestListeners.size).toBe(1);

    await slackTriggerHandler.stopListening();

    expect(def.listenerCount()).toBe(0);
    expect(manifestListeners.size).toBe(0);

    // Post-stop manifest changes must NOT resurrect a subscription.
    triggerInstanceChange({
      type: 'added',
      id: 'personal',
      meta: { id: 'personal', label: 'Personal', createdAt: 0 },
    });
    const personal = instanceRegistry.get('personal');
    // The handler shouldn't have created/wired anything for it.
    expect(personal?.listenerCount() ?? 0).toBe(0);
  });

  it('is idempotent — subscribing the same instance twice keeps a single listener', async () => {
    setMetas(['default']);
    await slackTriggerHandler.startListening(() => {});

    // Simulate a redundant "added" event for an instance we already wired up.
    triggerInstanceChange({
      type: 'added',
      id: 'default',
      meta: { id: 'default', label: 'Default', createdAt: 0 },
    });

    const def = instanceRegistry.get('default')!;
    expect(def.listenerCount()).toBe(1);
  });
});

// ─── structuralMatch (pure function — no manifest/instance dependency) ──────

describe('slackTriggerHandler.structuralMatch channel-id filters', () => {
  function eventOf(overrides: Partial<SlackMessage & { instanceId: string }> = {}): ExternalEvent {
    const msg = {
      ts: '1700000000.000100',
      channel: 'C06UCC5FFST',
      channelName: '#general',
      userId: 'U999',
      userName: 'tester',
      text: 'hello',
      timestamp: 1_700_000_000_000,
      instanceId: 'personal',
      ...overrides,
    };
    return { source: 'slack', type: 'message', data: msg, timestamp: msg.timestamp };
  }

  function triggerWith(config: Record<string, unknown>): TriggerDefinition {
    return { id: 't', type: 'slack', name: 'x', enabled: true, config } as unknown as TriggerDefinition;
  }

  it('drops a message whose channel is in excludeChannelIds', () => {
    const trig = triggerWith({ excludeChannelIds: ['C06UCC5FFST'] });
    expect(slackTriggerHandler.structuralMatch(trig, eventOf({ channel: 'C06UCC5FFST' }))).toBe(false);
  });

  it('passes a message in a non-excluded channel when excludeChannelIds is set', () => {
    const trig = triggerWith({ excludeChannelIds: ['C06UCC5FFST'] });
    expect(slackTriggerHandler.structuralMatch(trig, eventOf({ channel: 'C0AAAAAAA' }))).toBe(true);
  });

  it('exclude match is exact — a prefix collision must NOT trigger the filter', () => {
    // Guard against a future regression where someone swaps Array.includes for startsWith.
    const trig = triggerWith({ excludeChannelIds: ['C06UCC5FFST'] });
    expect(slackTriggerHandler.structuralMatch(trig, eventOf({ channel: 'C06UCC5FFSTXX' }))).toBe(true);
  });

  it('channelIdAllowlist drops a channel not in the list', () => {
    const trig = triggerWith({ channelIdAllowlist: ['D0AMP833LDQ'] });
    expect(slackTriggerHandler.structuralMatch(trig, eventOf({ channel: 'C06UCC5FFST' }))).toBe(false);
  });

  it('channelIdAllowlist passes a channel IN the list', () => {
    const trig = triggerWith({ channelIdAllowlist: ['D0AMP833LDQ'] });
    expect(slackTriggerHandler.structuralMatch(trig, eventOf({ channel: 'D0AMP833LDQ' }))).toBe(true);
  });

  it('excludeChannelIds short-circuits BEFORE messagePattern (invalid regex on muted channel is still safe)', () => {
    // If a future refactor moves messagePattern above excludeChannelIds we want
    // the test to catch it — an invalid regex on a muted channel must never
    // get a chance to throw.
    const muted = 'C06UCC5FFST';
    const trig = triggerWith({ excludeChannelIds: [muted], messagePattern: '(' /* invalid */ });
    expect(slackTriggerHandler.structuralMatch(trig, eventOf({ channel: muted }))).toBe(false);
  });

  it('empty excludeChannelIds / channelIdAllowlist arrays behave as if absent', () => {
    const trig = triggerWith({ excludeChannelIds: [], channelIdAllowlist: [] });
    expect(slackTriggerHandler.structuralMatch(trig, eventOf({ channel: 'C06UCC5FFST' }))).toBe(true);
  });
});
