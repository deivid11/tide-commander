import { describe, it, expect } from 'vitest';
import { parseWhatsAppMessage } from '../WhatsAppMessageBubble';

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
});
