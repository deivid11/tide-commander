import { describe, it, expect } from 'vitest';
import {
  sanitizeFromName,
  isEmptyContentMessage,
  whatsappTriggerHandler,
  humanizeWhatsAppJid,
  humanizeGroupJid,
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

  it('drops messages whose chatId is in excludeChatIds', () => {
    const muted = '120363248688514495@g.us';
    const trig = {
      ...trigger,
      config: { excludeChatIds: [muted] },
    } as unknown as TriggerDefinition;
    expect(whatsappTriggerHandler.structuralMatch(trig, eventOf(baseMsg({ chatId: muted })))).toBe(false);
  });

  it('still passes a message in a non-excluded chat when excludeChatIds is set', () => {
    const trig = {
      ...trigger,
      config: { excludeChatIds: ['120363248688514495@g.us'] },
    } as unknown as TriggerDefinition;
    const msg = baseMsg({ chatId: '5215527271986-1386292220@g.us' });
    expect(whatsappTriggerHandler.structuralMatch(trig, eventOf(msg))).toBe(true);
  });

  it('exclude match is exact — a prefix collision must NOT trigger the filter', () => {
    // Real bug guard: if we ever switched to startsWith / includes the bad way,
    // every chat sharing a digit prefix would silently get dropped.
    const trig = {
      ...trigger,
      config: { excludeChatIds: ['120363248688514495@g.us'] },
    } as unknown as TriggerDefinition;
    const msg = baseMsg({ chatId: '120363248688514495999@g.us' });
    expect(whatsappTriggerHandler.structuralMatch(trig, eventOf(msg))).toBe(true);
  });

  it('chatIdAllowlist drops a chatId not in the list', () => {
    const trig = {
      ...trigger,
      config: { chatIdAllowlist: ['5215527271986-1386292220@g.us'] },
    } as unknown as TriggerDefinition;
    const msg = baseMsg({ chatId: '5219999999999@s.whatsapp.net' });
    expect(whatsappTriggerHandler.structuralMatch(trig, eventOf(msg))).toBe(false);
  });

  it('chatIdAllowlist passes a chatId IN the list', () => {
    const allowed = '5215527271986-1386292220@g.us';
    const trig = {
      ...trigger,
      config: { chatIdAllowlist: [allowed] },
    } as unknown as TriggerDefinition;
    expect(whatsappTriggerHandler.structuralMatch(trig, eventOf(baseMsg({ chatId: allowed })))).toBe(true);
  });

  it('empty excludeChatIds / chatIdAllowlist arrays behave as if absent', () => {
    const trig = {
      ...trigger,
      config: { excludeChatIds: [], chatIdAllowlist: [] },
    } as unknown as TriggerDefinition;
    expect(whatsappTriggerHandler.structuralMatch(trig, eventOf(baseMsg({ body: 'hi' })))).toBe(true);
  });

  it('excludeChatIds short-circuits BEFORE bodyPattern (no regex evaluation on excluded chats)', () => {
    // If a future refactor moves bodyPattern above excludeChatIds we want the
    // test to catch it — a malformed regex on a muted chat must still be safe.
    const muted = '120363248688514495@g.us';
    const trig = {
      ...trigger,
      config: { excludeChatIds: [muted], bodyPattern: '(' /* invalid regex */ },
    } as unknown as TriggerDefinition;
    expect(whatsappTriggerHandler.structuralMatch(trig, eventOf(baseMsg({ chatId: muted })))).toBe(false);
  });
});

describe('humanizeWhatsAppJid', () => {
  it('formats a Mexican mobile JID into +52 1 NNN NNN NNNN', () => {
    expect(humanizeWhatsAppJid('5215512345678@s.whatsapp.net')).toBe('+52 1 551 234 5678');
  });

  it('strips the group-participant tag before formatting', () => {
    // Group sender JIDs come as `<phone>-<grouptag>@g.us`. The user's screenshot
    // showed digits being concatenated; we drop the `-tag` cleanly.
    expect(humanizeWhatsAppJid('5215527271986-1386292220@g.us')).toBe('+52 1 552 727 1986');
  });

  it('falls back to +<digits> for unknown formats', () => {
    expect(humanizeWhatsAppJid('123@s.whatsapp.net')).toBe('+123');
  });

  it('renders a LID as "WhatsApp user <last4>" — never as a phone number', () => {
    // A LID is opaque, not dialable — "+153996203434060" was the bug.
    expect(humanizeWhatsAppJid('153996203434060@lid')).toBe('WhatsApp user 4060');
  });

  it('returns empty string for empty / unparseable input', () => {
    expect(humanizeWhatsAppJid(undefined)).toBe('');
    expect(humanizeWhatsAppJid('')).toBe('');
    expect(humanizeWhatsAppJid('@s.whatsapp.net')).toBe('');
  });
});

describe('humanizeGroupJid', () => {
  it('returns Grupo <last4> for a group chat JID', () => {
    expect(humanizeGroupJid('5215527271986-1386292220@g.us')).toBe('Grupo 2220');
  });

  it('returns empty string for empty input', () => {
    expect(humanizeGroupJid(undefined)).toBe('');
    expect(humanizeGroupJid('')).toBe('');
  });
});

describe('whatsappTriggerHandler.extractVariables', () => {
  const trigger: TriggerDefinition = {
    id: 't', type: 'whatsapp', name: 'x', enabled: true, config: {},
  } as unknown as TriggerDefinition;

  function vars(msg: NormalizedWhatsAppMessage): Record<string, string> {
    return whatsappTriggerHandler.extractVariables(trigger, {
      source: 'whatsapp', type: 'message', data: msg, timestamp: msg.timestamp,
    });
  }

  function baseMsg(overrides: Partial<NormalizedWhatsAppMessage> = {}): NormalizedWhatsAppMessage {
    return {
      sessionId: 's', from: '5215512345678@s.whatsapp.net', body: 'hi',
      timestamp: Date.now(), isGroup: false, direction: 'inbound',
      chatId: '5215512345678@s.whatsapp.net', ...overrides,
    };
  }

  it('passes through fromName + groupName when upstream provides them', () => {
    const v = vars(baseMsg({
      fromName: 'Juan',
      isGroup: true,
      groupName: 'Equipo Producto',
      chatId: '5215512345678-100@g.us',
    }));
    expect(v['whatsapp.fromName']).toBe('Juan');
    expect(v['whatsapp.groupName']).toBe('Equipo Producto');
  });

  it('falls back to humanized JID when fromName is missing', () => {
    const v = vars(baseMsg({ fromName: undefined }));
    expect(v['whatsapp.fromName']).toBe('+52 1 551 234 5678');
  });

  it('falls back to humanized group label when groupName is missing on a group chat', () => {
    const v = vars(baseMsg({
      fromName: 'Juan',
      isGroup: true,
      groupName: undefined,
      chatId: '5215512345678-1386292220@g.us',
    }));
    expect(v['whatsapp.groupName']).toBe('Grupo 2220');
  });

  it('keeps groupName empty for DMs even when groupName field is set', () => {
    const v = vars(baseMsg({ fromName: 'Juan', isGroup: false, groupName: 'noise' }));
    expect(v['whatsapp.groupName']).toBe('');
  });

  it('keeps the resolved fromName for OUTBOUND DMs (recipient JID is what we want to display)', () => {
    // Regression: contact enrichment was inbound-only, so outbound DMs
    // showed only the formatted phone instead of the recipient's contact
    // name. payload.from on outbound DMs is the recipient's JID (Baileys
    // key.remoteJid is always the chat counterparty), so the cache lookup
    // is meaningful in both directions.
    const msg = baseMsg({
      isGroup: false,
      direction: 'outbound',
      fromName: 'Juan Perez',           // post-enrichment payload
      from: '5215537230810@s.whatsapp.net',
      chatId: '5215537230810@s.whatsapp.net',
    });
    const v = vars(msg);
    expect(v['whatsapp.fromName']).toBe('Juan Perez');
    expect(v['whatsapp.direction']).toBe('outbound');
  });

  it('keeps the resolved groupName for OUTBOUND group msgs (group subject is direction-independent)', () => {
    // Regression: an early version of this fix only enriched inbound msgs, so
    // outbound msgs to the Bolba group fell back to humanizeGroupJid even
    // though the cache had the real subject. Bridge logic now enriches groups
    // regardless of direction; this asserts extractVariables passes a
    // resolver-supplied subject through on outbound too.
    const msg = baseMsg({
      isGroup: true,
      direction: 'outbound',
      groupName: 'Bolba', // post-enrichment payload
      chatId: '120363426536125334@g.us',
      from: '120363426536125334@g.us',
    });
    const v = vars(msg);
    expect(v['whatsapp.groupName']).toBe('Bolba');
    expect(v['whatsapp.direction']).toBe('outbound');
  });

  it('returns resolver-supplied groupName when the upstream payload had none', () => {
    // Mirrors the bridge's enrichment flow: GroupNameCache resolves "Bolba",
    // mutates payload.groupName before notifyTriggerSubscribers fires
    // extractVariables.
    const msg = baseMsg({
      fromName: undefined,
      isGroup: true,
      groupName: undefined,
      chatId: '120363426536125334@g.us',
      from: '120363426536125334@g.us',
    });
    msg.groupName = 'Bolba'; // simulated post-enrichment mutation
    const v = vars(msg);
    expect(v['whatsapp.groupName']).toBe('Bolba');
  });
});
