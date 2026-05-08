import { describe, it, expect } from 'vitest';
import {
  sanitizeFromName,
  isEmptyContentMessage,
  whatsappTriggerHandler,
  type NormalizedWhatsAppMessage,
} from './whatsapp-trigger-handler.js';
import type { ExternalEvent, TriggerDefinition } from '../../../shared/integration-types.js';

describe('sanitizeFromName', () => {
  it('returns undefined for empty / null inputs', () => {
    expect(sanitizeFromName(undefined, '521@s.whatsapp.net')).toBeUndefined();
    expect(sanitizeFromName(null, '521@s.whatsapp.net')).toBeUndefined();
    expect(sanitizeFromName('', '521@s.whatsapp.net')).toBeUndefined();
    expect(sanitizeFromName('   ', '521@s.whatsapp.net')).toBeUndefined();
  });

  it('passes a clean human name through verbatim', () => {
    expect(sanitizeFromName('Juan Perez', '5215512345678@s.whatsapp.net')).toBe('Juan Perez');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeFromName('  Juan Perez  ', '5215512345678@s.whatsapp.net')).toBe('Juan Perez');
  });

  it('strips a JID domain that leaked into the name field', () => {
    expect(
      sanitizeFromName('5215512345678@s.whatsapp.net', '5215512345678@s.whatsapp.net'),
    ).toBeUndefined(); // bare digits matching from-jid → undefined
    expect(
      sanitizeFromName('Juan Perez@s.whatsapp.net', '5215512345678@s.whatsapp.net'),
    ).toBe('Juan Perez');
  });

  it('returns undefined when name is just the phone digits matching the from JID', () => {
    expect(sanitizeFromName('5215512345678', '5215512345678@s.whatsapp.net')).toBeUndefined();
  });

  it('keeps a name even if it CONTAINS the phone digits, as long as it has letters', () => {
    expect(sanitizeFromName('Juan 5215512345678', '5215512345678@s.whatsapp.net')).toBe(
      'Juan 5215512345678',
    );
  });

  it('keeps a digit-only name when it does NOT match the from JID', () => {
    // Edge case: a contact saved as "12345" while the message is from a totally
    // different number. We keep it — user explicitly chose that label.
    expect(sanitizeFromName('12345', '5215512345678@s.whatsapp.net')).toBe('12345');
  });

  it('handles group-participant JID without breaking', () => {
    expect(sanitizeFromName('Carlos', '5215587654321@s.whatsapp.net')).toBe('Carlos');
  });
});

describe('isEmptyContentMessage', () => {
  function base(overrides: Partial<NormalizedWhatsAppMessage> = {}): NormalizedWhatsAppMessage {
    return {
      sessionId: '5532967210',
      from: '5215527271986@s.whatsapp.net',
      body: '',
      timestamp: Date.now(),
      isGroup: false,
      direction: 'inbound',
      chatId: '5215527271986-1386292220@g.us',
      ...overrides,
    };
  }

  it('flags empty body + no media as empty content', () => {
    expect(isEmptyContentMessage(base({ body: '' }))).toBe(true);
  });

  it('flags whitespace-only body + no media as empty content', () => {
    expect(isEmptyContentMessage(base({ body: '   \t\n  ' }))).toBe(true);
  });

  it('does NOT flag emoji-only body as empty', () => {
    expect(isEmptyContentMessage(base({ body: '👍' }))).toBe(false);
  });

  it('does NOT flag media with empty caption as empty', () => {
    expect(
      isEmptyContentMessage(
        base({ body: '', mediaType: 'image', mediaUrl: 'https://x/y.jpg' }),
      ),
    ).toBe(false);
  });

  it('does NOT flag media-type with no URL as empty (sticker/audio paths)', () => {
    expect(isEmptyContentMessage(base({ body: '', mediaType: 'sticker' }))).toBe(false);
  });

  it('flags real text content as non-empty', () => {
    expect(isEmptyContentMessage(base({ body: 'hola' }))).toBe(false);
  });
});

describe('whatsappTriggerHandler.structuralMatch', () => {
  const trigger: TriggerDefinition = {
    id: 't1',
    type: 'whatsapp',
    name: 'test',
    enabled: true,
    config: {},
  } as unknown as TriggerDefinition;

  function eventOf(msg: NormalizedWhatsAppMessage): ExternalEvent {
    return { source: 'whatsapp', type: 'message', data: msg, timestamp: msg.timestamp };
  }

  function baseMsg(overrides: Partial<NormalizedWhatsAppMessage> = {}): NormalizedWhatsAppMessage {
    return {
      sessionId: '5532967210',
      from: '5215527271986@s.whatsapp.net',
      body: 'hola',
      timestamp: Date.now(),
      isGroup: true,
      direction: 'inbound',
      chatId: '5215527271986-1386292220@g.us',
      ...overrides,
    };
  }

  it('drops the empty-body / no-media presence event from the boss example', () => {
    const msg = baseMsg({ body: '', mediaType: undefined, mediaUrl: undefined });
    expect(whatsappTriggerHandler.structuralMatch(trigger, eventOf(msg))).toBe(false);
  });

  it('passes a normal text message in a group', () => {
    const msg = baseMsg({ body: 'hola equipo' });
    expect(whatsappTriggerHandler.structuralMatch(trigger, eventOf(msg))).toBe(true);
  });

  it('passes an image with empty caption', () => {
    const msg = baseMsg({ body: '', mediaType: 'image', mediaUrl: 'https://x/y.jpg' });
    expect(whatsappTriggerHandler.structuralMatch(trigger, eventOf(msg))).toBe(true);
  });
});
