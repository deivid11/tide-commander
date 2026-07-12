import { describe, expect, it } from 'vitest';
import { OpencodeServerEventAdapter } from './opencode-server-event-adapter.js';

const SID = 'ses_test';

function delta(partID: string, text: string, field = 'text') {
  return { type: 'message.part.delta', properties: { sessionID: SID, partID, messageID: 'msg_1', field, delta: text } };
}
function idle() {
  return { type: 'session.idle', properties: { sessionID: SID } };
}

describe('OpencodeServerEventAdapter', () => {
  it('streams message.part.delta as streaming text with a stable part uuid', () => {
    const a = new OpencodeServerEventAdapter();
    const e1 = a.handle(delta('prt_1', 'Hello'));
    const e2 = a.handle(delta('prt_1', ' world'));
    expect(e1).toEqual([{ type: 'text', text: 'Hello', isStreaming: true, uuid: 'opencode-text-prt_1' }]);
    expect(e2).toEqual([{ type: 'text', text: ' world', isStreaming: true, uuid: 'opencode-text-prt_1' }]);
  });

  it('maps reasoning-field deltas to streaming thinking', () => {
    const a = new OpencodeServerEventAdapter();
    expect(a.handle(delta('prt_r', 'hmm', 'reasoning'))).toEqual([
      { type: 'thinking', text: 'hmm', isStreaming: true, uuid: 'opencode-thinking-prt_r' },
    ]);
  });

  it('emits a tool_start once and a tool_result on completion', () => {
    const a = new OpencodeServerEventAdapter();
    const pending = a.handle({
      type: 'message.part.updated',
      properties: { sessionID: SID, part: { id: 'prt_t', type: 'tool', tool: 'bash', callID: 'call_1', state: { status: 'pending', input: {} } } },
    });
    const running = a.handle({
      type: 'message.part.updated',
      properties: { sessionID: SID, part: { type: 'tool', tool: 'bash', callID: 'call_1', state: { status: 'running', input: { command: 'echo hi' } } } },
    });
    const completed = a.handle({
      type: 'message.part.updated',
      properties: { sessionID: SID, part: { type: 'tool', tool: 'bash', callID: 'call_1', state: { status: 'completed', input: { command: 'echo hi' }, output: 'hi' } } },
    });

    // pending → tool_start with empty input
    expect(pending).toEqual([{ type: 'tool_start', toolName: 'Bash', toolInput: {}, uuid: 'call_1', toolUseId: 'call_1' }]);
    // running → tool_start refresh once input is known
    expect(running).toEqual([{ type: 'tool_start', toolName: 'Bash', toolInput: { command: 'echo hi' }, uuid: 'call_1', toolUseId: 'call_1' }]);
    // completed → tool_result
    expect(completed).toEqual([{ type: 'tool_result', toolName: 'Bash', toolOutput: 'hi', uuid: 'call_1', toolUseId: 'call_1' }]);
  });

  it('finalizes the turn on session.idle with step_complete + resultText', () => {
    const a = new OpencodeServerEventAdapter();
    a.handle(delta('prt_x', 'Final answer.'));
    a.handle({ type: 'message.updated', properties: { sessionID: SID, info: { role: 'assistant', tokens: { input: 10, output: 5, cache: { read: 2, write: 0 } }, cost: 0.01 } } });
    const events = a.handle(idle());

    const stepComplete = events.find((e) => e.type === 'step_complete');
    const finalText = events.find((e) => e.type === 'text' && e.isStreaming === false);
    expect(finalText).toMatchObject({ type: 'text', text: 'Final answer.', isStreaming: false, uuid: 'opencode-text-prt_x' });
    expect(stepComplete).toMatchObject({ type: 'step_complete', resultText: 'Final answer.' });
    expect(stepComplete?.tokens).toMatchObject({ input: 10, output: 5 });
  });

  it('resets tool tracking between turns', () => {
    const a = new OpencodeServerEventAdapter();
    a.handle({ type: 'message.part.updated', properties: { sessionID: SID, part: { type: 'tool', tool: 'read', callID: 'c1', state: { status: 'completed', input: { p: 1 }, output: 'x' } } } });
    a.handle(idle());
    // Same callID in a new turn should emit a fresh tool_start again.
    const again = a.handle({ type: 'message.part.updated', properties: { sessionID: SID, part: { type: 'tool', tool: 'read', callID: 'c1', state: { status: 'running', input: { p: 1 } } } } });
    expect(again.some((e) => e.type === 'tool_start')).toBe(true);
  });

  it('stays silent on unrelated events', () => {
    const a = new OpencodeServerEventAdapter();
    expect(a.handle({ type: 'server.connected', properties: {} })).toEqual([]);
    expect(a.handle({ type: 'session.status', properties: { sessionID: SID } })).toEqual([]);
  });
});
