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

  it('drops a stale session.idle with no activity behind it (abort double-idle)', () => {
    const a = new OpencodeServerEventAdapter();
    a.handle(delta('prt_1', 'partial'));
    const first = a.handle(idle());
    expect(first.some((e) => e.type === 'step_complete')).toBe(true);
    // The abort's second idle lands after the next turn already started —
    // finalizing here would flip the agent idle while the model is generating.
    const stale = a.handle(idle());
    expect(stale).toEqual([]);
    // Activity from the new turn re-arms finalization.
    a.handle(delta('prt_2', 'new turn'));
    const real = a.handle(idle());
    expect(real.some((e) => e.type === 'step_complete')).toBe(true);
  });

  it('does not re-arm finalization on the abort-fallout message.updated between idles', () => {
    const a = new OpencodeServerEventAdapter();
    a.handle(delta('prt_1', 'partial'));
    a.handle({ type: 'session.error', properties: { sessionID: SID, error: { message: 'Aborted' } } });
    a.handle(idle()); // idle #1 finalizes the aborted turn
    // Captured live abort fallout: the aborted assistant message's METADATA
    // replays between the two idles — it must not count as content.
    a.handle({ type: 'message.updated', properties: { sessionID: SID, info: { id: 'msg_aborted', role: 'assistant', time: { created: 1, completed: 2 } } } });
    expect(a.handle(idle())).toEqual([]); // idle #2 dropped
  });

  it('drops session.idle on a turn with zero activity, but forceFinalize still finalizes', () => {
    const a = new OpencodeServerEventAdapter();
    expect(a.handle(idle())).toEqual([]);
    const forced = a.forceFinalize();
    expect(forced.some((e) => e.type === 'step_complete')).toBe(true);
  });

  it('stays silent on unrelated events', () => {
    const a = new OpencodeServerEventAdapter();
    expect(a.handle({ type: 'server.connected', properties: {} })).toEqual([]);
    expect(a.handle({ type: 'session.status', properties: { sessionID: SID } })).toEqual([]);
  });

  it('renders reasoning deltas (field:text on a reasoning part) as thinking, NOT duplicated text', () => {
    const a = new OpencodeServerEventAdapter();
    // Real OpenCode shape: the reasoning part is announced first (type=reasoning,
    // empty text), THEN its deltas arrive tagged field:'text'.
    const announce = a.handle({ type: 'message.part.updated', properties: { sessionID: SID, part: { id: 'prt_r', type: 'reasoning', messageID: 'msg_a', text: '' } } });
    const d1 = a.handle({ type: 'message.part.delta', properties: { sessionID: SID, partID: 'prt_r', messageID: 'msg_a', field: 'text', delta: 'Let me think' } });
    const d2 = a.handle({ type: 'message.part.delta', properties: { sessionID: SID, partID: 'prt_r', messageID: 'msg_a', field: 'text', delta: ' about it' } });

    expect(announce).toEqual([]); // empty text → nothing
    // Deltas classified as THINKING (aligned to the part's real type), single uuid.
    expect(d1).toEqual([{ type: 'thinking', text: 'Let me think', isStreaming: true, uuid: 'opencode-thinking-prt_r' }]);
    expect(d2).toEqual([{ type: 'thinking', text: ' about it', isStreaming: true, uuid: 'opencode-thinking-prt_r' }]);
    // No stray text row was produced for the reasoning content.
    expect(d1.every((e) => e.type !== 'text')).toBe(true);
  });

  it('does NOT echo the user prompt: skips parts belonging to a user-role message', () => {
    const a = new OpencodeServerEventAdapter();
    // OpenCode announces the user message (role user), then streams its text part.
    a.handle({ type: 'message.updated', properties: { sessionID: SID, info: { id: 'msg_user', role: 'user' } } });
    const userDelta = a.handle({ type: 'message.part.delta', properties: { sessionID: SID, partID: 'prt_u', messageID: 'msg_user', field: 'text', delta: 'te gusta queen?' } });
    const userUpdated = a.handle({ type: 'message.part.updated', properties: { sessionID: SID, part: { id: 'prt_u', type: 'text', messageID: 'msg_user', text: 'te gusta queen?' } } });
    // The assistant reply must still render.
    a.handle({ type: 'message.updated', properties: { sessionID: SID, info: { id: 'msg_asst', role: 'assistant' } } });
    const asstDelta = a.handle({ type: 'message.part.delta', properties: { sessionID: SID, partID: 'prt_a', messageID: 'msg_asst', field: 'text', delta: 'Objetivamente' } });

    expect(userDelta).toEqual([]);
    expect(userUpdated).toEqual([]);
    expect(asstDelta).toEqual([{ type: 'text', text: 'Objetivamente', isStreaming: true, uuid: 'opencode-text-prt_a' }]);
  });
});
