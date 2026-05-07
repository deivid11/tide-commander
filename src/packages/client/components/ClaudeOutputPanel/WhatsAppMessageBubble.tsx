/**
 * WhatsApp message bubble renderer.
 *
 * Detects user prompts produced by the WhatsApp trigger handler's
 * promptTemplate (Spanish "Nuevo mensaje de WhatsApp …" format) and renders
 * them as a chat-style bubble instead of a wall of plain text. The trailing
 * "Revisa el contenido y procede según corresponda…" instruction is for the
 * agent's context and is intentionally hidden from the visual bubble — the
 * outgoing user prompt the agent receives is never modified, we only change
 * how that text is *displayed* to the human.
 */

import React from 'react';
import { Icon } from '../Icon';

export interface WhatsAppMessage {
  direction: 'inbound' | 'outbound';
  rawFrom: string;
  phone: string;
  session: string;
  isGroup: boolean;
  dateISO: string;
  date: Date | null;
  media: string;
  body: string;
}

const HEADER_RE = /^[ \t]*Nuevo mensaje de WhatsApp\s*\((inbound|outbound)\)\.?\s*$/im;
const FIELD_RE = (label: string) =>
  new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(.*)$`, 'im');
const URL_RE = /(https?:\/\/[^\s<>"'\)]+)/g;
// Mexican mobile format: +52 1 NNN NNN NNNN — common for the user's region.
// Falls back to "+<digits>" when format isn't recognized.
const MX_MOBILE_RE = /^521(\d{3})(\d{3})(\d{4})$/;

export function parseWhatsAppMessage(text: string): WhatsAppMessage | null {
  if (!text) return null;
  const headerMatch = text.match(HEADER_RE);
  if (!headerMatch) return null;

  // Body delimiter must exist — reject lookalikes that mention WhatsApp but
  // don't actually carry a message body.
  const bodyMarkerIdx = text.search(/\n[ \t]*Mensaje\s*:[ \t]*\n?/);
  if (bodyMarkerIdx < 0) return null;

  const headerSection = text.slice(0, bodyMarkerIdx);
  let bodyAndTail = text.slice(bodyMarkerIdx).replace(/^\n[ \t]*Mensaje\s*:[ \t]*\n?/, '');

  const trailRe = /\n+[ \t]*Revisa el contenido[\s\S]*$/i;
  bodyAndTail = bodyAndTail.replace(trailRe, '');

  const direction = headerMatch[1].toLowerCase() as 'inbound' | 'outbound';
  const rawFrom = (headerSection.match(FIELD_RE('De'))?.[1] ?? '').trim();
  const session = (headerSection.match(FIELD_RE('Sesión'))?.[1]
    ?? headerSection.match(FIELD_RE('Sesion'))?.[1]
    ?? '').trim();
  const grupoVal = (headerSection.match(FIELD_RE('Grupo'))?.[1] ?? '').trim().toLowerCase();
  const dateISO = (headerSection.match(FIELD_RE('Fecha'))?.[1] ?? '').trim();
  const media = (headerSection.match(FIELD_RE('Media'))?.[1] ?? '').trim();
  const body = bodyAndTail.replace(/^\n+/, '').replace(/\s+$/, '');

  return {
    direction,
    rawFrom,
    phone: formatWhatsAppPhone(rawFrom),
    session,
    isGroup: grupoVal === 'true' || grupoVal === 'sí' || grupoVal === 'si' || grupoVal === '1',
    dateISO,
    date: parseDate(dateISO),
    media,
    body,
  };
}

function formatWhatsAppPhone(raw: string): string {
  if (!raw) return '';
  const stripped = raw.replace(/@.*$/, '').trim();
  const digits = stripped.replace(/[^\d]/g, '');
  if (!digits) return stripped || raw;
  const mx = digits.match(MX_MOBILE_RE);
  if (mx) return `+52 1 ${mx[1]} ${mx[2]} ${mx[3]}`;
  if (digits.length === 12 && digits.startsWith('52')) {
    return `+52 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

function parseDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatBubbleTime(date: Date | null): string {
  if (!date) return '';
  const now = new Date();
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (isSameDay(date, now)) return time;
  const ymd = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `${time} · ${ymd}`;
}

function shortenSession(session: string): string {
  if (!session) return '';
  if (session.length <= 10) return session;
  return `${session.slice(0, 8)}…`;
}

function renderBodyWithLinks(body: string): React.ReactNode[] {
  const lines = body.split('\n');
  const out: React.ReactNode[] = [];
  lines.forEach((line, lineIdx) => {
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    let segIdx = 0;
    while ((match = URL_RE.exec(line)) !== null) {
      if (match.index > lastIdx) {
        out.push(<span key={`${lineIdx}-t-${segIdx++}`}>{line.slice(lastIdx, match.index)}</span>);
      }
      const url = match[1];
      out.push(
        <a
          key={`${lineIdx}-l-${segIdx++}`}
          className="whatsapp-bubble-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {url}
        </a>,
      );
      lastIdx = URL_RE.lastIndex;
    }
    if (lastIdx < line.length) {
      out.push(<span key={`${lineIdx}-t-${segIdx++}`}>{line.slice(lastIdx)}</span>);
    }
    if (lineIdx < lines.length - 1) out.push(<br key={`${lineIdx}-br`} />);
  });
  return out;
}

interface WhatsAppMessageBubbleProps {
  msg: WhatsAppMessage;
}

export function WhatsAppMessageBubble({ msg }: WhatsAppMessageBubbleProps): React.ReactElement {
  const time = formatBubbleTime(msg.date);
  const sessionLabel = shortenSession(msg.session);

  return (
    <div className={`whatsapp-bubble-row whatsapp-${msg.direction}`}>
      <div className="whatsapp-bubble" role="group" aria-label="WhatsApp message">
        <div className="whatsapp-bubble-meta">
          <span className="whatsapp-bubble-icon" aria-hidden="true">
            <Icon name="chat" size={11} weight="fill" />
          </span>
          <span className="whatsapp-bubble-phone" title={msg.rawFrom}>
            {msg.phone || msg.rawFrom || '—'}
          </span>
          {msg.isGroup && (
            <span className="whatsapp-bubble-badge whatsapp-bubble-badge-group">
              <Icon name="users" size={10} /> Grupo
            </span>
          )}
          {sessionLabel && (
            <span className="whatsapp-bubble-session" title={msg.session}>{sessionLabel}</span>
          )}
        </div>
        {msg.media && (
          <div className="whatsapp-bubble-media">
            <Icon name="paperclip" size={11} />
            <span>{msg.media}</span>
          </div>
        )}
        <div className="whatsapp-bubble-body">
          {msg.body
            ? renderBodyWithLinks(msg.body)
            : <span className="whatsapp-bubble-empty">—</span>}
        </div>
        <div className="whatsapp-bubble-footer">
          <span className="whatsapp-bubble-brand">WhatsApp · {msg.direction === 'outbound' ? 'enviado' : 'recibido'}</span>
          {time && <span className="whatsapp-bubble-time">{time}</span>}
        </div>
      </div>
    </div>
  );
}
