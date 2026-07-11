import { describe, expect, it } from 'vitest';
import { OpencodeJsonEventParser } from './json-event-parser.js';

describe('OpencodeJsonEventParser', () => {
  it('maps final text event (time.end set) to non-streaming text', () => {
    const parser = new OpencodeJsonEventParser();
    const events = parser.parseEvent({
      type: 'text',
      sessionID: 'ses_123',
      part: {
        id: 'prt_1',
        messageID: 'msg_1',
        type: 'text',
        text: 'Hello world',
        time: { start: 1, end: 2 },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'text',
      text: 'Hello world',
      isStreaming: false,
      uuid: 'opencode-text-prt_1',
    });
  });

  it('maps progressive text snapshots to streaming deltas with a stable uuid', () => {
    const parser = new OpencodeJsonEventParser();
    const a = parser.parseEvent({
      type: 'text',
      part: { id: 'prt_grow', type: 'text', text: 'Hel' },
    });
    const b = parser.parseEvent({
      type: 'text',
      part: { id: 'prt_grow', type: 'text', text: 'Hello' },
    });
    expect(a[0]).toMatchObject({
      type: 'text',
      text: 'Hel',
      isStreaming: true,
      uuid: 'opencode-text-prt_grow',
    });
    expect(b[0]).toMatchObject({
      type: 'text',
      text: 'lo',
      isStreaming: true,
      uuid: 'opencode-text-prt_grow',
    });
  });

  it('maps message.part.delta to streaming text chunks', () => {
    const parser = new OpencodeJsonEventParser();
    const events = parser.parseEvent({
      type: 'message.part.delta',
      properties: {
        partID: 'prt_d',
        messageID: 'msg_d',
        field: 'text',
        delta: 'Hi',
      },
    });
    expect(events[0]).toMatchObject({
      type: 'text',
      text: 'Hi',
      isStreaming: true,
      uuid: 'opencode-text-prt_d',
    });
  });

  it('maps reasoning event to thinking standard event', () => {
    const parser = new OpencodeJsonEventParser();
    const events = parser.parseEvent({
      type: 'reasoning',
      sessionID: 'ses_123',
      part: {
        id: 'prt_r',
        type: 'reasoning',
        text: 'Let me think about this...',
        time: { start: 1, end: 2 },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'thinking',
      text: 'Let me think about this...',
      isStreaming: false,
      uuid: 'opencode-thinking-prt_r',
    });
  });

  it('emits step_complete with resultText when text is present', () => {
    const parser = new OpencodeJsonEventParser();

    parser.parseEvent({
      type: 'text',
      part: { type: 'text', text: 'Some response' },
    });

    const events = parser.parseEvent({
      type: 'step_finish',
      part: {
        reason: 'stop',
        tokens: { input: 100, output: 10 },
      },
    });

    const stepComplete = events.find((e: any) => e.type === 'step_complete');
    expect(stepComplete).toBeDefined();
    expect(stepComplete!.resultText).toBe('Some response');
  });

  it('emits empty response fallback when only reasoning is present', () => {
    const parser = new OpencodeJsonEventParser();

    parser.parseEvent({
      type: 'reasoning',
      part: { type: 'reasoning', text: 'Thinking silently...' },
    });

    const events = parser.parseEvent({
      type: 'step_finish',
      part: {
        reason: 'stop',
        tokens: { input: 50, output: 0 },
      },
    });

    const stepComplete = events.find((e: any) => e.type === 'step_complete');
    expect(stepComplete).toBeDefined();
    expect(stepComplete!.resultText).toContain('Empty response');
    expect(stepComplete!.resultText).toContain('Thinking silently...');
    expect(stepComplete!.resultText).toContain('"stop_reason":"stop"');
  });

  it('does not emit empty response fallback when text exists alongside reasoning', () => {
    const parser = new OpencodeJsonEventParser();

    parser.parseEvent({
      type: 'reasoning',
      part: { type: 'reasoning', text: 'Thinking...' },
    });

    parser.parseEvent({
      type: 'text',
      part: { type: 'text', text: 'Actual answer' },
    });

    const events = parser.parseEvent({
      type: 'step_finish',
      part: {
        reason: 'stop',
        tokens: { input: 100, output: 5 },
      },
    });

    const stepComplete = events.find((e: any) => e.type === 'step_complete');
    expect(stepComplete!.resultText).toBe('Actual answer');
    expect(stepComplete!.resultText).not.toContain('Empty response');
  });

  it('maps tool_use to tool_start and tool_result', () => {
    const parser = new OpencodeJsonEventParser();
    const events = parser.parseEvent({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'bash',
        callID: 'bash:0',
        state: {
          status: 'completed',
          input: { command: 'echo hello' },
          output: 'hello',
        },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'tool_start',
      toolName: 'Bash',
      toolUseId: 'bash:0',
    });
    expect(events[1]).toMatchObject({
      type: 'tool_result',
      toolName: 'Bash',
      toolUseId: 'bash:0',
      toolOutput: 'hello',
    });
  });

  it('normalizes lowercase tool names', () => {
    const parser = new OpencodeJsonEventParser();
    const events = parser.parseEvent({
      type: 'tool_use',
      part: {
        tool: 'webfetch',
        state: { status: 'completed' },
      },
    });

    expect(events[0]).toMatchObject({
      type: 'tool_start',
      toolName: 'WebFetch',
    });
  });

  it('emits usage_snapshot on step_finish', () => {
    const parser = new OpencodeJsonEventParser();
    const events = parser.parseEvent({
      type: 'step_finish',
      part: {
        reason: 'stop',
        tokens: {
          input: 100,
          output: 20,
          cache: { write: 0, read: 50 },
        },
      },
    });

    const usage = events.find((e: any) => e.type === 'usage_snapshot');
    expect(usage).toBeDefined();
    expect(usage!.tokens).toMatchObject({
      input: 100,
      output: 20,
      cacheCreation: 0,
      cacheRead: 50,
    });
  });
});
