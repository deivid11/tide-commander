import { describe, it, expect } from 'vitest';
import { parseSlackMessage } from '../SlackMessageBubble';

const sampleInbound = `Nuevo mensaje de Slack.

De: @Luis Cabiedes (U078UV85AEM)
Canal: D0789LHE1GE
Thread: 1778180755.429849
Instancia: personal
Adjuntos: 1 Liberacion CC - Actualización de servicios en Transfer Connect.docx

Mensaje:
hola, ¿revisas?

Revisa el mensaje y decide si requiere acción. No respondas a menos que sea claramente necesario.`;

const sampleEmptyBody = `Nuevo mensaje de Slack.

De: @Luis Cabiedes (U078UV85AEM)
Canal: D0789LHE1GE
Thread: 1778180755.429849
Instancia: personal
Adjuntos: 1 Liberacion CC - Actualización de servicios en Transfer Connect.docx

Mensaje:


Revisa el mensaje y decide si requiere acción. No respondas a menos que sea claramente necesario.`;

const sampleChannel = `Nuevo mensaje de Slack.

De: @Equipo SPEI (U999AAA111)
Canal: C12345PUB
Thread: 1700000000.000100
Instancia: trabajo

Mensaje:
ya está liberado el servicio en TC, https://tide.mx/release confirmado.

Revisa el mensaje y decide si requiere acción.`;

describe('parseSlackMessage', () => {
  it('parses inbound DM with attachment and trailing instruction stripped', () => {
    const parsed = parseSlackMessage(sampleInbound);
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe('inbound');
    expect(parsed!.fromName).toBe('Luis Cabiedes');
    expect(parsed!.fromUserId).toBe('U078UV85AEM');
    expect(parsed!.channel).toBe('D0789LHE1GE');
    expect(parsed!.channelKind).toBe('dm');
    expect(parsed!.thread).toBe('1778180755.429849');
    expect(parsed!.instance).toBe('personal');
    expect(parsed!.attachments).toEqual([
      '1 Liberacion CC - Actualización de servicios en Transfer Connect.docx',
    ]);
    expect(parsed!.body).toBe('hola, ¿revisas?');
    expect(parsed!.body).not.toContain('Revisa el mensaje');
  });

  it('preserves empty body when only the trailing instruction is present', () => {
    const parsed = parseSlackMessage(sampleEmptyBody);
    expect(parsed).not.toBeNull();
    expect(parsed!.body).toBe('');
    // Header still parsed correctly even with empty body.
    expect(parsed!.fromUserId).toBe('U078UV85AEM');
    expect(parsed!.channelKind).toBe('dm');
  });

  it('classifies public channels and group conversations from the channel ID prefix', () => {
    const pub = parseSlackMessage(sampleChannel)!;
    expect(pub.channelKind).toBe('channel');
    expect(pub.channel).toBe('C12345PUB');

    const grp = parseSlackMessage(sampleChannel.replace('C12345PUB', 'G98765GROUP'))!;
    expect(grp.channelKind).toBe('group');
  });

  it('keeps embedded URLs intact in the body', () => {
    const parsed = parseSlackMessage(sampleChannel)!;
    expect(parsed.body).toContain('https://tide.mx/release');
  });

  it('returns null when the Mensaje: marker is absent', () => {
    expect(parseSlackMessage('Nuevo mensaje de Slack.\n\nDe: foo')).toBeNull();
  });

  it('returns null for non-slack prompts that just mention slack', () => {
    expect(parseSlackMessage('Manda un mensaje por Slack a Luis')).toBeNull();
    expect(parseSlackMessage('')).toBeNull();
  });

  it('honors an optional (outbound) marker when the template includes it', () => {
    const out = parseSlackMessage(sampleInbound.replace(
      'Nuevo mensaje de Slack.',
      'Nuevo mensaje de Slack (outbound).',
    ))!;
    expect(out.direction).toBe('outbound');
  });
});
