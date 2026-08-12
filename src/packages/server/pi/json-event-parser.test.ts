import { describe, expect, it } from 'vitest';
import { PiJsonEventParser } from './json-event-parser.js';

// Event shapes below mirror a real `pi --mode json -p` capture (v0.80.x).

describe('PiJsonEventParser', () => {
  it('ignores the session header (id handled by backend.extractSessionId)', () => {
    const parser = new PiJsonEventParser();
    const events = parser.parseEvent({
      type: 'session',
      version: 3,
      id: '019ff4bc-44ba-737c-ae6c-6c19e44fe904',
      cwd: '/tmp/project',
    });
    expect(events).toHaveLength(0);
  });

  it('maps agent_start to init', () => {
    const parser = new PiJsonEventParser();
    const events = parser.parseEvent({ type: 'agent_start' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('init');
  });

  it('streams text deltas with a stable uuid and finalizes on text_end', () => {
    const parser = new PiJsonEventParser();
    parser.parseEvent({ type: 'message_start', message: { role: 'assistant', content: [] } });

    parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
    });
    const a = parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ' },
    });
    const b = parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'world' },
    });
    expect(a[0]).toMatchObject({ type: 'text', text: 'Hello ', isStreaming: true });
    expect(b[0]).toMatchObject({ type: 'text', text: 'world', isStreaming: true });
    expect(a[0].uuid).toBe(b[0].uuid);

    const end = parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_end',
        contentIndex: 0,
        content: { type: 'text', text: 'Hello world' },
      },
    });
    expect(end[0]).toMatchObject({
      type: 'text',
      text: 'Hello world',
      isStreaming: false,
      uuid: a[0].uuid,
    });
  });

  it('streams thinking deltas separately from text', () => {
    const parser = new PiJsonEventParser();
    parser.parseEvent({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const think = parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm' },
    });
    expect(think[0]).toMatchObject({ type: 'thinking', text: 'hmm', isStreaming: true });

    const thinkEnd = parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'thinking_end',
        contentIndex: 0,
        content: { type: 'thinking', thinking: 'hmm done' },
      },
    });
    expect(thinkEnd[0]).toMatchObject({
      type: 'thinking',
      text: 'hmm done',
      isStreaming: false,
      uuid: think[0].uuid,
    });
  });

  it('mints new stream uuids per assistant message', () => {
    const parser = new PiJsonEventParser();
    parser.parseEvent({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const first = parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'a' },
    });
    parser.parseEvent({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const second = parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'b' },
    });
    expect(first[0].uuid).not.toBe(second[0].uuid);
  });

  it('maps tool_execution_start/end to tool_start/tool_result keyed by toolCallId', () => {
    const parser = new PiJsonEventParser();
    const start = parser.parseEvent({
      type: 'tool_execution_start',
      toolCallId: 'toolu_01Sxt1Te4a8BizPXKpkBWrfs',
      toolName: 'write',
      args: { path: 'hello.txt', content: 'hola pi' },
    });
    expect(start[0]).toMatchObject({
      type: 'tool_start',
      toolName: 'Write',
      toolInput: { path: 'hello.txt', content: 'hola pi' },
      toolUseId: 'toolu_01Sxt1Te4a8BizPXKpkBWrfs',
      uuid: 'toolu_01Sxt1Te4a8BizPXKpkBWrfs',
    });

    const end = parser.parseEvent({
      type: 'tool_execution_end',
      toolCallId: 'toolu_01Sxt1Te4a8BizPXKpkBWrfs',
      toolName: 'write',
      result: { content: [{ type: 'text', text: 'Successfully wrote 7 bytes to hello.txt' }] },
      isError: false,
    });
    expect(end[0]).toMatchObject({
      type: 'tool_result',
      toolName: 'Write',
      toolOutput: 'Successfully wrote 7 bytes to hello.txt',
      toolUseId: 'toolu_01Sxt1Te4a8BizPXKpkBWrfs',
    });
  });

  it('prefixes errored tool output', () => {
    const parser = new PiJsonEventParser();
    const end = parser.parseEvent({
      type: 'tool_execution_end',
      toolCallId: 'call_x',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'command not found' }] },
      isError: true,
    });
    expect(end[0]).toMatchObject({
      type: 'tool_result',
      toolName: 'Bash',
      toolOutput: 'Error: command not found',
    });
  });

  it('emits usage_snapshot from assistant message_end usage', () => {
    const parser = new PiJsonEventParser();
    const events = parser.parseEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done' }],
        stopReason: 'stop',
        model: 'claude-haiku-4-5',
        usage: {
          input: 2419,
          output: 68,
          cacheRead: 100,
          cacheWrite: 50,
          totalTokens: 2487,
          cost: { total: 0.002759 },
        },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'usage_snapshot',
      model: 'claude-haiku-4-5',
      tokens: { input: 2419, output: 68, cacheRead: 100, cacheCreation: 50 },
    });
  });

  it('surfaces assistant error stopReason as an error event', () => {
    const parser = new PiJsonEventParser();
    const events = parser.parseEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'No API key for provider: anthropic',
        usage: { input: 0, output: 0, totalTokens: 0 },
      },
    });
    expect(events[0]).toMatchObject({
      type: 'error',
      errorMessage: 'No API key for provider: anthropic',
    });
  });

  it('emits step_complete with resultText, tokens, and cost on agent_end', () => {
    const parser = new PiJsonEventParser();
    parser.parseEvent({ type: 'message_start', message: { role: 'assistant', content: [] } });
    parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
    });
    parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'All done.' },
    });
    parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_end',
        contentIndex: 0,
        content: { type: 'text', text: 'All done.' },
      },
    });
    parser.parseEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'All done.' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0.01 } },
      },
    });

    const events = parser.parseEvent({ type: 'agent_end', messages: [] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'step_complete',
      resultText: 'All done.',
      cost: 0.01,
      tokens: { input: 10, output: 5 },
    });
  });

  it('marks thinking-only runs on step_complete', () => {
    const parser = new PiJsonEventParser();
    parser.parseEvent({ type: 'message_start', message: { role: 'assistant', content: [] } });
    parser.parseEvent({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'thinking_end',
        contentIndex: 0,
        content: { type: 'thinking', thinking: 'only thoughts' },
      },
    });
    const events = parser.parseEvent({ type: 'agent_end', messages: [] });
    expect(events[0].type).toBe('step_complete');
    expect(events[0].resultText).toContain('Empty response');
  });

  it('maps compaction_start to compacting and skips lifecycle noise', () => {
    const parser = new PiJsonEventParser();
    expect(parser.parseEvent({ type: 'compaction_start', reason: 'threshold' })[0]).toMatchObject({ type: 'compacting' });
    expect(parser.parseEvent({ type: 'turn_start' })).toHaveLength(0);
    expect(parser.parseEvent({ type: 'turn_end', message: {}, toolResults: [] })).toHaveLength(0);
    expect(parser.parseEvent({ type: 'queue_update', steering: [], followUp: [] })).toHaveLength(0);
  });
});
