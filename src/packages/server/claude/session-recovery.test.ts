import { describe, expect, it } from 'vitest';
import {
  buildLostSessionRetryPrompt,
  classifyZeroTurnResult,
  isMissingSessionError,
  zeroTurnErrorMessage,
} from './session-recovery.js';

// The exact result Claude Code wrote for Hoppip / Catys Magnemite when their transcripts were gone.
const missing = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  num_turns: 0,
  session_id: '8d8b590f-a7a1-44e8-93ff-998a457c05c8',
  errors: ['No conversation found with session ID: 8d8b590f-a7a1-44e8-93ff-998a457c05c8'],
};

describe('classifyZeroTurnResult', () => {
  it('a 0-turn error result whose errors say the conversation is gone is a lost session', () => {
    expect(classifyZeroTurnResult(missing)).toEqual({
      kind: 'session_missing',
      message: 'No conversation found with session ID: 8d8b590f-a7a1-44e8-93ff-998a457c05c8',
    });
  });

  it('any other 0-turn error is a zero_turn failure, never a normal end of turn', () => {
    expect(classifyZeroTurnResult({ subtype: 'error_during_execution', is_error: true, num_turns: 0, errors: ['OAuth token expired'] })).toEqual({
      kind: 'zero_turn',
      message: 'OAuth token expired',
    });
    expect(classifyZeroTurnResult({ subtype: 'error_during_execution', is_error: true, num_turns: 0 })).toEqual({
      kind: 'zero_turn',
      message: 'claude exited with error_during_execution',
    });
  });

  it('a turn that actually ran (even if it failed) or a success is not classified', () => {
    expect(classifyZeroTurnResult({ subtype: 'error_max_turns', is_error: true, num_turns: 30 })).toBeNull();
    expect(classifyZeroTurnResult({ subtype: 'success', is_error: false, num_turns: 0 })).toBeNull();
    expect(classifyZeroTurnResult({ subtype: 'success', is_error: false, num_turns: 3 })).toBeNull();
  });
});

describe('zeroTurnErrorMessage / isMissingSessionError', () => {
  it('prefers errors[], then the result text, then the subtype', () => {
    expect(zeroTurnErrorMessage({ errors: ['a', 'b'], result: 'x', subtype: 's' })).toBe('a | b');
    expect(zeroTurnErrorMessage({ errors: [], result: 'boom', subtype: 's' })).toBe('boom');
    expect(zeroTurnErrorMessage({ errors: [42], subtype: 's' })).toBe('claude exited with s');
  });

  it('matches the CLI wording regardless of case', () => {
    expect(isMissingSessionError('no conversation found with session id: x')).toBe(true);
    expect(isMissingSessionError('Process crashed')).toBe(false);
    expect(isMissingSessionError(undefined)).toBe(false);
  });
});

describe('buildLostSessionRetryPrompt', () => {
  it('prefixes a [System: …] notice (so lastAssignedTask keeps the original) and keeps the message intact', () => {
    const p = buildLostSessionRetryPrompt('Hola Hoppip, ¿me ayudas con lens?', 'ca155f91-aaaa');
    expect(p.startsWith('[System: your previous Claude Code session (ca155f91-aaaa) no longer exists')).toBe(true);
    expect(p.endsWith('\n\nHola Hoppip, ¿me ayudas con lens?')).toBe(true);
    expect(buildLostSessionRetryPrompt('x', undefined)).toContain('session no longer exists');
  });
});
