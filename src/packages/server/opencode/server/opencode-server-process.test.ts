import { describe, expect, it } from 'vitest';
import { unwrapGlobalSseEvent } from './opencode-server-process.js';

describe('unwrapGlobalSseEvent', () => {
  it('unwraps the /global/event envelope to the inner bus event', () => {
    const inner = {
      id: 'evt_1',
      type: 'message.part.delta',
      properties: { sessionID: 'ses_1', partID: 'prt_1', field: 'text', delta: 'Hi' },
    };
    const wrapped = { directory: '/home/riven/d/daisy', project: 'abc123', payload: inner };
    expect(unwrapGlobalSseEvent(wrapped)).toBe(inner);
  });

  it('passes legacy /event shapes through untouched', () => {
    const legacy = { id: 'evt_2', type: 'session.idle', properties: { sessionID: 'ses_1' } };
    expect(unwrapGlobalSseEvent(legacy)).toBe(legacy);
  });

  it('keeps the outer object when payload is not a bus event', () => {
    const odd = { type: 'server.connected', payload: 'not-an-event', properties: {} };
    expect(unwrapGlobalSseEvent(odd)).toBe(odd);
  });
});
