import { beforeEach, describe, expect, it, vi } from 'vitest';

// trigger-service has heavy data/runtime deps; stub them so we can exercise the
// fan-out + per-agent dedup logic in fireTrigger in isolation. sendCommand and
// handleTrigger are pulled in via dynamic import() inside fireTrigger — vi.mock
// intercepts those too.
vi.mock('../data/trigger-store.js', () => ({
  loadTriggers: () => [],
  saveTriggers: vi.fn(),
  saveTriggersSync: vi.fn(),
  saveTriggersAsync: vi.fn().mockResolvedValue(undefined),
}));

let nextEventId = 1;
vi.mock('../data/event-db.js', () => ({
  insertOne: vi.fn(() => nextEventId++),
  queryMany: vi.fn(() => []),
  execute: vi.fn(),
}));

vi.mock('./llm-matcher-service.js', () => ({
  llmMatch: vi.fn(),
  llmExtractVariables: vi.fn(),
}));

vi.mock('./cron-service.js', () => ({
  schedule: vi.fn(),
  scheduleOnce: vi.fn(),
  stop: vi.fn(),
  validate: vi.fn(),
  getNextFireTimes: vi.fn(),
}));

vi.mock('./runtime-service.js', () => ({
  sendCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./workflow-executor.js', () => ({
  handleTrigger: vi.fn().mockResolvedValue(undefined),
}));

import * as triggerService from './trigger-service.js';
import * as runtimeService from './runtime-service.js';

const sendCommand = vi.mocked(runtimeService.sendCommand);

function makeSlackTrigger(overrides: Record<string, unknown> = {}): string {
  const created = triggerService.createTrigger({
    name: 'fanout-test',
    type: 'slack',
    agentId: 'A',
    promptTemplate: 'msg {{slack.message}}',
    enabled: true,
    status: 'enabled',
    matchMode: 'structural',
    rateLimitPerMinute: 0, // disable rate limiting for the test
    config: {},
    ...overrides,
  } as Parameters<typeof triggerService.createTrigger>[0]);
  return created.id;
}

beforeEach(() => {
  sendCommand.mockClear();
});

describe('fireTrigger fan-out + dedup', () => {
  it('delivers to every subscribed agent (agentId + agentIds), de-duped', async () => {
    const id = makeSlackTrigger({ agentId: 'A', agentIds: ['B', 'C', 'A'] });
    await triggerService.fireTrigger(id, { 'slack.message': 'hi' }, {
      dedupeSourceType: 'slack',
      dedupeSourceId: 'unique-fanout-1',
    });

    const agents = sendCommand.mock.calls.map((c) => c[0]).sort();
    expect(agents).toEqual(['A', 'B', 'C']); // 'A' listed twice → delivered once
  });

  it('does not deliver the same source message to the same agent twice', async () => {
    const id = makeSlackTrigger({ agentId: 'A', agentIds: ['B'] });
    const src = { dedupeSourceType: 'slack', dedupeSourceId: 'shared-msg-1' };

    // First instance sees the message.
    await triggerService.fireTrigger(id, { 'slack.message': 'hi' }, src);
    // Second instance sees the SAME physical message (same ts) moments later.
    await triggerService.fireTrigger(id, { 'slack.message': 'hi' }, src);

    const agents = sendCommand.mock.calls.map((c) => c[0]).sort();
    expect(agents).toEqual(['A', 'B']); // delivered once each, not twice
  });

  it('delivers again when the source id differs', async () => {
    const id = makeSlackTrigger({ agentId: 'A', agentIds: ['B'] });
    await triggerService.fireTrigger(id, {}, { dedupeSourceType: 'slack', dedupeSourceId: 'm-A' });
    await triggerService.fireTrigger(id, {}, { dedupeSourceType: 'slack', dedupeSourceId: 'm-B' });

    expect(sendCommand.mock.calls.length).toBe(4); // 2 agents × 2 distinct messages
  });

  it('skips dedup entirely when no source id is provided (cron/manual fires)', async () => {
    const id = makeSlackTrigger({ agentId: 'A', agentIds: ['B'] });
    await triggerService.fireTrigger(id, {});
    await triggerService.fireTrigger(id, {});

    expect(sendCommand.mock.calls.length).toBe(4); // both fires deliver to both agents
  });
});
