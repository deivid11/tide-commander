import { describe, it, expect } from 'vitest';
import { parseEmailMessage, buildGmailMessageUrl } from '../GmailMessageBubble';

const sampleOutbound = `Nuevo correo de Gmail (outbound).

De: "David Alcalá" <david@tide.mx>
Para: Claudia Silva Hernandez <claudia.silva@transfer.com>
Asunto: Re: Restimación de requerimiento OPMC-195
Fecha: 2026-05-07T00:11:59.000Z
Labels: SENT
Thread: 19cdf2b0c49ef1ba
Adjuntos: image007.png, image006.png, image010.png, image007.png, image006.png

Cuerpo:
👌

David Alcalá reacted via Gmail
<https://www.google.com/gmail/about/?utm_source=gmail-in-product>

On Wed, May 6, 2026 at 5:15 PM Claudia Silva Hernandez <
claudia.silva@transfer.com> wrote:

> Muchas gracias David, espero confirmante a la brevedad mañana tengo
> sesión con el equipo de Finanzas.
>
>> Buena tarde Claudia,
>> Te comparto las tres cotizaciones separadas por sprint.

Revisa el contenido y procede según corresponda.`;

const sampleInboundMinimal = `Nuevo correo de Gmail (inbound).

De: noreply@example.com
Para: support@tide.mx
Asunto:
Fecha: 2026-05-06T12:00:00.000Z
Labels:
Thread: thread-id
Adjuntos:

Cuerpo:
Hola.`;

describe('parseEmailMessage', () => {
  it('parses outbound email, dedupes attachments, strips trailing instruction', () => {
    const parsed = parseEmailMessage(sampleOutbound);
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe('outbound');
    expect(parsed!.from.name).toBe('David Alcalá');
    expect(parsed!.from.email).toBe('david@tide.mx');
    expect(parsed!.to.name).toBe('Claudia Silva Hernandez');
    expect(parsed!.to.email).toBe('claudia.silva@transfer.com');
    expect(parsed!.subject).toBe('Re: Restimación de requerimiento OPMC-195');
    expect(parsed!.labels).toEqual(['SENT']);
    expect(parsed!.thread).toBe('19cdf2b0c49ef1ba');
    expect(parsed!.attachments.length).toBe(5);
    expect(parsed!.uniqueAttachments).toEqual(['image007.png', 'image006.png', 'image010.png']);
    expect(parsed!.body).not.toContain('Revisa el contenido');
  });

  it('splits the body into top response and quoted thread', () => {
    const parsed = parseEmailMessage(sampleOutbound);
    expect(parsed).not.toBeNull();
    expect(parsed!.topBody).toContain('👌');
    expect(parsed!.topBody).not.toContain('Muchas gracias David');
    expect(parsed!.quotedBody).toContain('On Wed, May 6, 2026');
    expect(parsed!.quotedBody).toContain('Muchas gracias David');
  });

  it('handles minimal inbound email with empty subject/labels/attachments', () => {
    const parsed = parseEmailMessage(sampleInboundMinimal);
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe('inbound');
    expect(parsed!.from.email).toBe('noreply@example.com');
    expect(parsed!.from.name).toBe('');
    expect(parsed!.subject).toBe('');
    expect(parsed!.labels).toEqual([]);
    expect(parsed!.attachments).toEqual([]);
    expect(parsed!.body).toBe('Hola.');
    expect(parsed!.topBody).toBe('Hola.');
    expect(parsed!.quotedBody).toBe('');
  });

  it('returns null for non-email prompts', () => {
    expect(parseEmailMessage('Manda un correo a David')).toBeNull();
    expect(parseEmailMessage('')).toBeNull();
    expect(parseEmailMessage('Nuevo correo de Gmail (inbound).')).toBeNull();
  });
});

describe('buildGmailMessageUrl', () => {
  it('builds a Gmail thread URL when thread is present', () => {
    const parsed = parseEmailMessage(sampleInboundMinimal)!;
    const url = buildGmailMessageUrl(parsed);
    expect(url).toBe('https://mail.google.com/mail/u/0/#inbox/thread-id');
  });

  it('falls back to a search URL using subject + sender when thread is missing', () => {
    const parsed = parseEmailMessage(sampleInboundMinimal)!;
    const url = buildGmailMessageUrl({ ...parsed, thread: '' });
    expect(url).toContain('https://mail.google.com/mail/u/0/?#search/');
    expect(url).toContain(encodeURIComponent('from:noreply@example.com'));
  });

  it('returns null when neither thread nor subject/sender are available', () => {
    const parsed = parseEmailMessage(sampleInboundMinimal)!;
    const stripped = {
      ...parsed,
      thread: '',
      subject: '',
      from: { name: '', email: '', raw: '' },
    };
    expect(buildGmailMessageUrl(stripped)).toBeNull();
  });
});
