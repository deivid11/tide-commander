/**
 * Regression tests for VirtualizedOutputList key generation.
 *
 * Hard invariant: every distinct item produces a UNIQUE key, so the virtualizer
 * (@tanstack/react-virtual) cannot re-emit the same virtual row at multiple
 * indices — that's what caused the "stacked WhatsApp bubbles, same content
 * repeated 6×" rendering bug. Cross-agent isolation is also enforced because
 * the agent prefix is part of every key.
 */

import { describe, it, expect } from 'vitest';
import { buildItemKey, type TaggedItem } from '../virtualizedOutputKey';

function liveItem(item: any, originalIndex = 0): TaggedItem {
  return { kind: 'live', item, originalIndex };
}

function historyItem(item: any, originalIndex = 0): TaggedItem {
  return { kind: 'history', item, originalIndex };
}

const AGENT_A = 'agent-a';
const AGENT_B = 'agent-b';

describe('VirtualizedOutputList buildItemKey — uniqueness', () => {
  it('two history user messages with identical content but different uuids get different keys', () => {
    // The exact crash scenario: the WhatsApp JSONL had two entries with the
    // same content text — content-bucket bridge collapsed them into one
    // key, virtualizer re-emitted the row 6×. With uuid-based keys, the
    // two messages stay distinct.
    const a = historyItem({
      type: 'user',
      content: 'amigo solo comentario, en el control de cambios, se indica que es uat Nube',
      timestamp: '2026-05-07T13:01:57.000Z',
      uuid: 'uuid-aaa',
    });
    const b = historyItem({
      type: 'user',
      content: 'amigo solo comentario, en el control de cambios, se indica que es uat Nube',
      timestamp: '2026-05-07T13:01:57.000Z',
      uuid: 'uuid-bbb',
    });

    expect(buildItemKey(a, AGENT_A)).not.toBe(buildItemKey(b, AGENT_A));
  });

  it('uuid-bearing live and history items with same uuid get distinct keys (h: vs o:)', () => {
    // A uuid that, hypothetically, leaks across the live/history boundary
    // must not collapse — the items live in different store partitions
    // and the dedup pipeline above is responsible for picking which one
    // to keep, not the key generator.
    const live = liveItem({
      text: 'sure, here is the answer',
      isStreaming: false,
      timestamp: 1_000_000_500,
      uuid: 'msg-uuid-xyz',
    });
    const history = historyItem({
      type: 'assistant',
      content: 'sure, here is the answer',
      timestamp: new Date(1_000_000_500).toISOString(),
      uuid: 'msg-uuid-xyz',
    });

    expect(buildItemKey(live, AGENT_A)).not.toBe(buildItemKey(history, AGENT_A));
  });

  it('same-uuid live tool rows get different keys', () => {
    const usingTool = liveItem({
      text: 'Using tool: Bash',
      isStreaming: false,
      timestamp: 1_000_000_500,
      uuid: 'toolu-uuid-xyz',
    }, 3);
    const toolInput = liveItem({
      text: 'Tool input: {"command":"npm test"}',
      isStreaming: false,
      timestamp: 1_000_000_501,
      uuid: 'toolu-uuid-xyz',
    }, 4);

    expect(buildItemKey(usingTool, AGENT_A)).not.toBe(buildItemKey(toolInput, AGENT_A));
  });

  it('same live streaming row keeps its key when text accumulates', () => {
    const firstChunk = liveItem({
      text: 'Hel',
      isStreaming: true,
      timestamp: 1_000_000_500,
      uuid: 'stream-uuid-xyz',
    }, 7);
    const accumulated = liveItem({
      text: 'Hello world',
      isStreaming: true,
      timestamp: 1_000_000_500,
      uuid: 'stream-uuid-xyz',
    }, 7);

    expect(buildItemKey(firstChunk, AGENT_A)).toBe(buildItemKey(accumulated, AGENT_A));
  });

  it('different prompts produce different keys', () => {
    const a = liveItem({
      text: 'first prompt',
      isStreaming: false,
      timestamp: 1_000_000_000,
      isUserPrompt: true,
    });
    const b = liveItem({
      text: 'second prompt',
      isStreaming: false,
      timestamp: 1_000_000_000,
      isUserPrompt: true,
    });

    expect(buildItemKey(a, AGENT_A)).not.toBe(buildItemKey(b, AGENT_A));
  });

  it('uuid is preferred over content/timestamp for history user messages', () => {
    // Two consecutive history user messages with the SAME wall-clock
    // timestamp (server batched them) must still get unique keys via uuid.
    const a = historyItem({
      type: 'user',
      content: 'ok',
      timestamp: '2026-05-07T13:01:57.000Z',
      uuid: 'uuid-1',
    });
    const b = historyItem({
      type: 'user',
      content: 'ok',
      timestamp: '2026-05-07T13:01:57.000Z',
      uuid: 'uuid-2',
    });

    expect(buildItemKey(a, AGENT_A)).toBe(`${AGENT_A}:h:u:uuid-1`);
    expect(buildItemKey(b, AGENT_A)).toBe(`${AGENT_A}:h:u:uuid-2`);
  });

  it('falls back to a stable composite key for non-uuid history entries', () => {
    const noUuid = historyItem({
      type: 'assistant',
      content: 'partial stream',
      timestamp: '2026-05-07T00:00:00.000Z',
    });
    expect(buildItemKey(noUuid, AGENT_A)).toMatch(/^agent-a:h:s:assistant:/);
  });
});

describe('VirtualizedOutputList buildItemKey — cross-agent isolation', () => {
  it('identical user-prompt content on two agents produces different keys', () => {
    const sameText = 'Nuevo mensaje de WhatsApp (inbound). De: +52...';
    const sameTs = 1_700_000_000_000;

    const onA = liveItem({
      text: sameText,
      isStreaming: false,
      timestamp: sameTs,
      isUserPrompt: true,
    });
    const onB = liveItem({
      text: sameText,
      isStreaming: false,
      timestamp: sameTs,
      isUserPrompt: true,
    });

    expect(buildItemKey(onA, AGENT_A)).not.toBe(buildItemKey(onB, AGENT_B));
  });

  it('identical uuid on two agents produces different keys', () => {
    const live = liveItem({
      text: 'shared',
      isStreaming: false,
      timestamp: 1_700_000_000_000,
      uuid: 'collision-uuid',
    });
    expect(buildItemKey(live, AGENT_A)).not.toBe(buildItemKey(live, AGENT_B));
  });

  it('history fallback (no uuid, no toolUseId) is also agent-scoped', () => {
    const noUuid = historyItem({
      type: 'assistant',
      content: 'streamed chunk',
      timestamp: '2026-05-07T00:00:00.000Z',
    });
    expect(buildItemKey(noUuid, AGENT_A)).not.toBe(buildItemKey(noUuid, AGENT_B));
  });
});
