import { describe, expect, it } from 'vitest';
import { CodexAppServerEventAdapter } from './app-server-event-adapter.js';

describe('CodexAppServerEventAdapter', () => {
  it('streams agent-message deltas with a stable per-item uuid', () => {
    const a = new CodexAppServerEventAdapter();
    const e1 = a.handle('item/agentMessage/delta', { delta: 'Hello', itemId: 'i1', threadId: 't', turnId: 'u' });
    const e2 = a.handle('item/agentMessage/delta', { delta: ' world', itemId: 'i1', threadId: 't', turnId: 'u' });

    expect(e1).toEqual([{ type: 'text', text: 'Hello', isStreaming: true, uuid: 'codex-text-i1' }]);
    expect(e2).toEqual([{ type: 'text', text: ' world', isStreaming: true, uuid: 'codex-text-i1' }]);
  });

  it('finalizes the assistant message on item/completed with the same uuid', () => {
    const a = new CodexAppServerEventAdapter();
    a.handle('item/agentMessage/delta', { delta: 'Hi.', itemId: 'i9', threadId: 't', turnId: 'u' });
    const done = a.handle('item/completed', {
      threadId: 't',
      item: { id: 'i9', type: 'agentMessage', text: 'Hi.' },
    });

    expect(done).toEqual([{ type: 'text', text: 'Hi.', isStreaming: false, uuid: 'codex-text-i9' }]);
  });

  it('maps reasoning deltas to streaming thinking rows', () => {
    const a = new CodexAppServerEventAdapter();
    expect(a.handle('item/reasoning/summaryTextDelta', { delta: 'Think…', itemId: 'r1', threadId: 't', turnId: 'u' }))
      .toEqual([{ type: 'thinking', text: 'Think…', isStreaming: true, uuid: 'codex-thinking-r1' }]);
  });

  it('pairs a web search start and result by item id, dropping empty fields', () => {
    const a = new CodexAppServerEventAdapter();
    // itemStarted fires BEFORE the query/action exist — nothing useful yet, so
    // the input must be empty rather than a row of nulls.
    const start = a.handle('item/started', {
      threadId: 't',
      item: { id: 'w1', type: 'webSearch' },
    });
    const done = a.handle('item/completed', {
      threadId: 't',
      item: {
        id: 'w1',
        type: 'webSearch',
        query: 'https://community.daisy.audio/t/out-of-flash-memory/4370/11',
        action: { type: 'openPage', url: 'https://community.daisy.audio/t/out-of-flash-memory/4370/11' },
      },
    });

    expect(start).toEqual([
      { type: 'tool_start', toolName: 'web_search', toolInput: {}, uuid: 'w1', toolUseId: 'w1' },
    ]);
    // Same id → the client attaches this onto the started card.
    expect(done).toEqual([{
      type: 'tool_result',
      toolName: 'web_search',
      toolOutput: JSON.stringify({
        query: 'https://community.daisy.audio/t/out-of-flash-memory/4370/11',
        actionType: 'openPage',
        actionUrl: 'https://community.daisy.audio/t/out-of-flash-memory/4370/11',
      }),
      uuid: 'w1',
      toolUseId: 'w1',
    }]);
  });

  it('emits a command execution as a Bash tool result on completion', () => {
    const a = new CodexAppServerEventAdapter();
    const start = a.handle('item/started', {
      threadId: 't',
      item: { id: 'c1', type: 'commandExecution', command: 'echo hi', status: 'in_progress' },
    });
    const done = a.handle('item/completed', {
      threadId: 't',
      item: { id: 'c1', type: 'commandExecution', command: 'echo hi', aggregatedOutput: 'hi\n', exitCode: 0 },
    });

    expect(start).toEqual([{ type: 'tool_start', toolName: 'Bash', toolInput: { command: 'echo hi', status: 'in_progress' }, uuid: 'c1', toolUseId: 'c1' }]);
    expect(done).toEqual([{ type: 'tool_result', toolName: 'Bash', toolOutput: 'hi\n', uuid: 'c1', toolUseId: 'c1' }]);
  });

  it('renders a file change as an Edit with the inline unified diff', () => {
    const a = new CodexAppServerEventAdapter();
    const events = a.handle('item/completed', {
      threadId: 't',
      item: {
        id: 'f1',
        type: 'fileChange',
        status: 'completed',
        changes: [{ path: 'src/x.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-a\n+b\n' }],
      },
    });

    expect(events[0]).toMatchObject({ type: 'tool_start', toolName: 'Edit' });
    expect(events[0].toolInput).toMatchObject({ file_path: 'src/x.ts', unified_diff: '@@ -1 +1 @@\n-a\n+b\n' });
    expect(events[1]).toMatchObject({ type: 'tool_result', toolName: 'Edit' });
  });

  it('carries token usage + result text into step_complete on turn end', () => {
    const a = new CodexAppServerEventAdapter();
    a.handle('item/completed', { threadId: 't', item: { id: 'm1', type: 'agentMessage', text: 'All done.' } });
    a.handle('thread/tokenUsage/updated', {
      threadId: 't',
      turnId: 'u',
      tokenUsage: { modelContextWindow: 272000, last: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80 } },
    });
    const events = a.handle('turn/completed', { threadId: 't', turn: { id: 'u', status: 'completed' } });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'step_complete',
      resultText: 'All done.',
      tokens: { input: 100, output: 20, cacheRead: 80 },
      modelUsage: { contextWindow: 272000, inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80 },
    });
  });

  it('surfaces a failed turn as an error before finalizing', () => {
    const a = new CodexAppServerEventAdapter();
    const events = a.handle('turn/completed', {
      threadId: 't',
      turn: { id: 'u', status: 'failed', error: { message: 'model exploded' } },
    });

    expect(events[0]).toEqual({ type: 'error', errorMessage: 'model exploded' });
    expect(events[1]).toMatchObject({ type: 'step_complete', resultText: '[Error] model exploded' });
  });

  it('stays silent on informational notifications', () => {
    const a = new CodexAppServerEventAdapter();
    expect(a.handle('turn/started', { threadId: 't' })).toEqual([]);
    expect(a.handle('thread/status/changed', { threadId: 't' })).toEqual([]);
    expect(a.handle('account/rateLimits/updated', { threadId: 't' })).toEqual([]);
  });
});
