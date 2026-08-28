import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppClient } from './whatsapp-client.js';
import {
  hasVisibleWhatsAppMention,
  parseWhatsAppMentions,
  resolveWhatsAppMentionJids,
} from './whatsapp-routes.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WhatsApp outbound mentions', () => {
  it('normalizes and deduplicates mention JIDs at the Tide route boundary', () => {
    expect(parseWhatsAppMentions([
      ' 5215512345678@s.whatsapp.net ',
      '5215512345678@s.whatsapp.net',
      '153996203434060@lid',
    ])).toEqual([
      '5215512345678@s.whatsapp.net',
      '153996203434060@lid',
    ]);
    expect(() => parseWhatsAppMentions('5215512345678@s.whatsapp.net'))
      .toThrow(/must be an array/);
    expect(() => parseWhatsAppMentions([''])).toThrow(/non-empty/);
  });

  it('resolves a visible contact name to a real WhatsApp JID', () => {
    const contacts = [
      {
        id: '31766249259027@lid',
        name: 'Transfer bot',
        pushname: 'Transfer bot',
        number: '31766249259027',
      },
      {
        id: '5215534367455@s.whatsapp.net',
        name: 'Transfer Chat Bot',
        pushname: null,
        number: '5215534367455',
      },
    ];

    expect(hasVisibleWhatsAppMention('@Transfer Chat Bot hola?')).toBe(true);
    expect(resolveWhatsAppMentionJids('@Transfer Chat Bot hola?', contacts))
      .toEqual(['5215534367455@s.whatsapp.net']);
    expect(resolveWhatsAppMentionJids('@⁨Transfer Chat Bot⁩ hola?', contacts))
      .toEqual(['5215534367455@s.whatsapp.net']);
    expect(hasVisibleWhatsAppMention('correo bot@example.com')).toBe(false);
  });

  it('prefers a LID when the contact mapping exposes one', () => {
    expect(resolveWhatsAppMentionJids('@Maria revisa esto', [{
      id: '5215512345678@s.whatsapp.net',
      lid: '153996203434060@lid',
      name: 'Maria',
      pushname: null,
      number: '5215512345678',
    }])).toEqual(['153996203434060@lid']);
  });

  it('forwards mention metadata to the upstream Baileys API', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new WhatsAppClient('http://localhost:3007', 'upstream-secret');

    await client.sendMessage('main', '120363123456789@g.us', 'Hola @5215512345678', {
      mentions: ['5215512345678@s.whatsapp.net'],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3007/api/sessions/main/send-message');
    expect(JSON.parse(String(init?.body))).toEqual({
      to: '120363123456789@g.us',
      message: 'Hola @5215512345678',
      mentions: ['5215512345678@s.whatsapp.net'],
    });
  });
});
