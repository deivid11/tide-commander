import { describe, it, expect } from 'vitest';
import { parseWhatsAppMessage, composeIdentity } from '../WhatsAppMessageBubble';

const sampleInbound = `Nuevo mensaje de WhatsApp (inbound).

De:  5218124699974@s.whatsapp.net
Sesión: 7e6f-aa11
Grupo: false
Fecha: 2026-05-06T18:30:00.000Z
Media:

Mensaje:
Hola, ¿cómo estás?
Esto es una prueba multilínea con link https://tide.mx/x

Revisa el contenido y procede según corresponda. No respondas a menos que sea claramente necesario.`;

const sampleOutboundGroup = `Nuevo mensaje de WhatsApp (outbound).

De:  5215512345678@g.us
Sesión: session-x
Grupo: true
Fecha: 2026-05-06T18:30:00.000Z
Media: image attachment.jpg

Mensaje:
Mensaje a un grupo`;

describe('parseWhatsAppMessage', () => {
  it('parses inbound DM with multi-line body and strips trailing instruction', () => {
    const parsed = parseWhatsAppMessage(sampleInbound);
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe('inbound');
    expect(parsed!.rawFrom).toBe('5218124699974@s.whatsapp.net');
    expect(parsed!.phone).toBe('+52 1 812 469 9974');
    expect(parsed!.session).toBe('7e6f-aa11');
    expect(parsed!.isGroup).toBe(false);
    expect(parsed!.media).toBe('');
    expect(parsed!.body).toContain('Hola, ¿cómo estás?');
    expect(parsed!.body).toContain('https://tide.mx/x');
    expect(parsed!.body).not.toContain('Revisa el contenido');
  });

  it('parses outbound group with media (no trailing instruction)', () => {
    const parsed = parseWhatsAppMessage(sampleOutboundGroup);
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe('outbound');
    expect(parsed!.isGroup).toBe(true);
    expect(parsed!.media).toBe('image attachment.jpg');
    expect(parsed!.body.trim()).toBe('Mensaje a un grupo');
  });

  it('returns null for regular prompts that just mention WhatsApp', () => {
    expect(parseWhatsAppMessage('Manda un mensaje por WhatsApp a Juan')).toBeNull();
    expect(parseWhatsAppMessage('')).toBeNull();
  });

  it('returns null when Mensaje: marker is absent', () => {
    expect(parseWhatsAppMessage('Nuevo mensaje de WhatsApp (inbound).\n\nDe: foo')).toBeNull();
  });

  it('preserves an empty body and missing fields', () => {
    const minimal = `Nuevo mensaje de WhatsApp (inbound).

De:
Sesión:
Grupo: false
Fecha:
Media:

Mensaje:
`;
    const parsed = parseWhatsAppMessage(minimal);
    expect(parsed).not.toBeNull();
    expect(parsed!.body).toBe('');
    expect(parsed!.phone).toBe('');
    expect(parsed!.date).toBeNull();
  });

  it('extracts fromName + JID from `Name <jid>` template (DM)', () => {
    const text = `Nuevo mensaje de WhatsApp (inbound).

De: Juan Perez <5215512345678@s.whatsapp.net>
Sesión: 7e6f
Grupo: false
Fecha: 2026-05-08T10:00:00.000Z
Media:

Mensaje:
hola`;
    const parsed = parseWhatsAppMessage(text)!;
    expect(parsed.fromName).toBe('Juan Perez');
    expect(parsed.rawFrom).toBe('5215512345678@s.whatsapp.net');
    // Phone formats from the JID alone, no longer from the whole line.
    expect(parsed.phone).toBe('+52 1 551 234 5678');
    expect(parsed.groupName).toBe('');
  });

  it('extracts groupName + sender name from `Grupo: <bool> <name>` template', () => {
    const text = `Nuevo mensaje de WhatsApp (inbound).

De: Carlos <5215527271986-1386292220@g.us>
Sesión: s1
Grupo: true Equipo Producto
Fecha: 2026-05-08T10:00:00.000Z
Media:

Mensaje:
hi team`;
    const parsed = parseWhatsAppMessage(text)!;
    expect(parsed.isGroup).toBe(true);
    expect(parsed.groupName).toBe('Equipo Producto');
    expect(parsed.fromName).toBe('Carlos');
  });

  it('still parses legacy template (JID alone, bool only) without name/group fields', () => {
    const text = `Nuevo mensaje de WhatsApp (inbound).

De:  5218124699974@s.whatsapp.net
Sesión: legacy
Grupo: false
Fecha:
Media:

Mensaje:
legacy body`;
    const parsed = parseWhatsAppMessage(text)!;
    expect(parsed.fromName).toBe('');
    expect(parsed.groupName).toBe('');
    expect(parsed.rawFrom).toBe('5218124699974@s.whatsapp.net');
    expect(parsed.phone).toBe('+52 1 812 469 9974');
  });
});

describe('composeIdentity', () => {
  it('shows fromName as primary on DMs and JID-formatted phone as secondary', () => {
    const out = composeIdentity(
      { fromName: 'Juan Perez', groupName: '', isGroup: false },
      '+52 1 551 234 5678',
    );
    expect(out.primary).toBe('Juan Perez');
    expect(out.secondary).toBe('+52 1 551 234 5678');
  });

  it('shows `<group> · <sender>` on group messages', () => {
    const out = composeIdentity(
      { fromName: 'Carlos', groupName: 'Equipo Producto', isGroup: true },
      '+52 1 552 727 1986',
    );
    expect(out.primary).toBe('Equipo Producto · Carlos');
    expect(out.secondary).toBe('+52 1 552 727 1986');
  });

  it('falls back to phone label when no name is available (DM)', () => {
    const out = composeIdentity(
      { fromName: '', groupName: '', isGroup: false },
      '+52 1 812 469 9974',
    );
    expect(out.primary).toBe('+52 1 812 469 9974');
    // Primary already IS the phone — don't repeat as secondary.
    expect(out.secondary).toBe('');
  });

  it('omits secondary when phone is empty (truly missing data)', () => {
    const out = composeIdentity(
      { fromName: 'Juan', groupName: '', isGroup: false },
      '',
    );
    expect(out.primary).toBe('Juan');
    expect(out.secondary).toBe('');
  });
});
