import { describe, expect, it } from 'vitest';
import { GrokJsonEventParser } from './json-event-parser.js';

describe('GrokJsonEventParser', () => {
  it('maps text chunks to streaming text events with a stable uuid', () => {
    const parser = new GrokJsonEventParser();
    const a = parser.parseEvent({ type: 'text', data: 'Hel' });
    const b = parser.parseEvent({ type: 'text', data: 'lo' });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({
      type: 'text',
      text: 'Hel',
      isStreaming: true,
    });
    expect(a[0].uuid).toBeTruthy();
    expect(b[0].uuid).toBe(a[0].uuid);
    expect(b[0].text).toBe('lo');
  });

  it('maps thought chunks to streaming thinking events with a stable uuid', () => {
    const parser = new GrokJsonEventParser();
    const a = parser.parseEvent({ type: 'thought', data: 'Con' });
    const b = parser.parseEvent({ type: 'thought', data: 'sidering' });

    expect(a[0]).toMatchObject({
      type: 'thinking',
      text: 'Con',
      isStreaming: true,
    });
    expect(a[0].uuid).toBeTruthy();
    expect(b[0].uuid).toBe(a[0].uuid);
  });

  it('uses different uuids for thinking vs text streams', () => {
    const parser = new GrokJsonEventParser();
    const thinking = parser.parseEvent({ type: 'thought', data: 'hmm' });
    const text = parser.parseEvent({ type: 'text', data: 'hi' });
    expect(thinking[0].uuid).not.toBe(text[0].uuid);
  });

  it('finalizes streams on end with full text and isStreaming=false', () => {
    const parser = new GrokJsonEventParser();
    parser.parseEvent({ type: 'thought', data: 'think' });
    const firstText = parser.parseEvent({ type: 'text', data: 'Hel' });
    parser.parseEvent({ type: 'text', data: 'lo' });

    const events = parser.parseEvent({
      type: 'end',
      stopReason: 'EndTurn',
      sessionId: 'sess-1',
    });

    const finalThinking = events.find(e => e.type === 'thinking');
    const finalText = events.find(e => e.type === 'text');
    const step = events.find(e => e.type === 'step_complete');

    expect(finalThinking).toMatchObject({
      type: 'thinking',
      text: 'think',
      isStreaming: false,
    });
    expect(finalText).toMatchObject({
      type: 'text',
      text: 'Hello',
      isStreaming: false,
      uuid: firstText[0].uuid,
    });
    expect(step).toBeDefined();
    expect(step!.resultText).toBe('Hello');
    expect(step!.sessionId).toBe('sess-1');
  });

  it('maps error events', () => {
    const parser = new GrokJsonEventParser();
    const events = parser.parseEvent({
      type: 'error',
      message: 'auth failed',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      errorMessage: 'auth failed',
    });
  });

  it('ignores unknown event types', () => {
    const parser = new GrokJsonEventParser();
    expect(parser.parseEvent({ type: 'auto_compact_started' })).toEqual([]);
  });

  it('starts a new stream uuid after end', () => {
    const parser = new GrokJsonEventParser();
    const first = parser.parseEvent({ type: 'text', data: 'a' });
    parser.parseEvent({ type: 'end', stopReason: 'EndTurn' });
    const second = parser.parseEvent({ type: 'text', data: 'b' });
    expect(first[0].uuid).not.toBe(second[0].uuid);
  });

  it('breakOpenStreams finalizes intermediate text so tool rounds do not mash bubbles', () => {
    const parser = new GrokJsonEventParser();
    const t1 = parser.parseEvent({ type: 'text', data: 'Status: starting…' });
    expect(t1[0].uuid).toBeTruthy();

    // Tool boundary mid-turn (no `end` from Grok)
    const breaks = parser.breakOpenStreams('sess-1');
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({
      type: 'text',
      text: 'Status: starting…',
      isStreaming: false,
      uuid: t1[0].uuid,
    });
    // No step_complete — agent stays working
    expect(breaks.some((e) => e.type === 'step_complete')).toBe(false);

    const t2 = parser.parseEvent({ type: 'text', data: 'Final answer' });
    expect(t2[0].uuid).not.toBe(t1[0].uuid);
    expect(t2[0].text).toBe('Final answer');

    const end = parser.parseEvent({ type: 'end', stopReason: 'EndTurn', sessionId: 'sess-1' });
    const finalText = end.find((e) => e.type === 'text');
    expect(finalText).toMatchObject({
      text: 'Final answer',
      isStreaming: false,
      uuid: t2[0].uuid,
    });
    // Must NOT be "Status: starting…Final answer"
    expect(finalText!.text).not.toContain('Status:');
  });
});

describe('GrokBackend per-agent parser isolation', () => {
  it('concurrent agents get separate stream uuids and never leak text across finalize', async () => {
    const { GrokBackend } = await import('./backend.js');
    const backend = new GrokBackend();

    const a = backend.parseEvent({ type: 'text', data: 'text from A' }, 'agent-a');
    const b = backend.parseEvent({ type: 'text', data: 'text from B' }, 'agent-b');

    expect((a as { uuid?: string }).uuid).toBeTruthy();
    expect((b as { uuid?: string }).uuid).toBeTruthy();
    expect((a as { uuid?: string }).uuid).not.toBe((b as { uuid?: string }).uuid);

    // A hits a tool boundary — its finalize must contain ONLY A's text.
    // (With the old shared parser, lastTextContent held A+B interleaved.)
    const breaks = backend.breakOpenStreams('agent-a');
    const finalized = breaks.find((e) => e.type === 'text');
    expect(finalized?.text).toBe('text from A');

    // B's stream is untouched by A's break: same uuid keeps accumulating.
    const b2 = backend.parseEvent({ type: 'text', data: ' more B' }, 'agent-b');
    expect((b2 as { uuid?: string }).uuid).toBe((b as { uuid?: string }).uuid);
  });
});
