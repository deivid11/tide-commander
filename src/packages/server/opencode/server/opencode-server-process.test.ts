import { describe, expect, it } from 'vitest';
import {
  busySessionIdsFromStatus,
  isOpencodeTransportError,
  providerCatalogHasModel,
  unwrapGlobalSseEvent,
} from './opencode-server-process.js';

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

describe('busySessionIdsFromStatus', () => {
  it('returns only sessions whose status is busy', () => {
    expect([...busySessionIdsFromStatus({
      ses_busy: { type: 'busy' },
      ses_idle: { type: 'idle' },
      unrelated: { type: 'busy' },
    })!]).toEqual(['ses_busy']);
  });

  it('accepts data envelopes and rejects non-map payloads', () => {
    expect([...busySessionIdsFromStatus({ data: { ses_running: { type: 'running' } } })!])
      .toEqual(['ses_running']);
    expect(busySessionIdsFromStatus([])).toBeNull();
  });
});

describe('providerCatalogHasModel', () => {
  const catalog = {
    all: [
      {
        id: 'opencode-go',
        models: {
          'glm-5.2': { id: 'glm-5.2' },
          alias: { id: 'glm-5.3' },
        },
      },
    ],
  };

  it('finds models by catalog key or model id', () => {
    expect(providerCatalogHasModel(catalog, 'opencode-go', 'glm-5.2')).toBe(true);
    expect(providerCatalogHasModel(catalog, 'opencode-go', 'glm-5.3')).toBe(true);
  });

  it('returns false for a known catalog that lacks the model', () => {
    expect(providerCatalogHasModel(catalog, 'opencode-go', 'glm-5.4')).toBe(false);
    expect(providerCatalogHasModel(catalog, 'missing-provider', 'glm-5.3')).toBe(false);
  });

  it('accepts SDK data envelopes and rejects unknown payloads', () => {
    expect(providerCatalogHasModel({ data: catalog }, 'opencode-go', 'glm-5.3')).toBe(true);
    expect(providerCatalogHasModel({ providers: [] }, 'opencode-go', 'glm-5.3')).toBeNull();
  });
});

describe('isOpencodeTransportError', () => {
  it('recognizes undici and Node socket failures', () => {
    const fetchError = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }),
    });
    expect(isOpencodeTransportError(fetchError)).toBe(true);
    expect(isOpencodeTransportError(Object.assign(new Error('connect failed'), { code: 'ECONNRESET' }))).toBe(true);
  });

  it('does not treat HTTP/model errors as transport failures', () => {
    expect(isOpencodeTransportError(new Error('500 Model not found'))).toBe(false);
  });
});
