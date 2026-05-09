/**
 * WhatsApp message bubble renderer.
 *
 * Plain flex-column row → bubble. No position:absolute, no transform-for-layout,
 * no margins outside the wrapper's border-box. Row height is fully content-
 * determined; the virtualizer measures the wrapper via getBoundingClientRect
 * (border-box) and that's all we rely on.
 */

import React from 'react';
import { Icon } from '../Icon';

export interface WhatsAppMessage {
  direction: 'inbound' | 'outbound';
  rawFrom: string;
  phone: string;
  fromName: string;
  groupName: string;
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
const MX_MOBILE_RE = /^521(\d{3})(\d{3})(\d{4})$/;

export function parseWhatsAppMessage(text: string): WhatsAppMessage | null {
  if (!text) return null;
  const headerMatch = text.match(HEADER_RE);
  if (!headerMatch) return null;

  const bodyMarkerIdx = text.search(/\n[ \t]*Mensaje\s*:[ \t]*\n?/);
  if (bodyMarkerIdx < 0) return null;

  const headerSection = text.slice(0, bodyMarkerIdx);
  let bodyAndTail = text.slice(bodyMarkerIdx).replace(/^\n[ \t]*Mensaje\s*:[ \t]*\n?/, '');
  bodyAndTail = bodyAndTail.replace(/\n+[ \t]*Revisa el contenido[\s\S]*$/i, '');

  const direction = headerMatch[1].toLowerCase() as 'inbound' | 'outbound';
  const deLine = (headerSection.match(FIELD_RE('De'))?.[1] ?? '').trim();
  const { name: fromName, jid: rawFrom } = splitNameAndJid(deLine);
  const session = (headerSection.match(FIELD_RE('Sesión'))?.[1]
    ?? headerSection.match(FIELD_RE('Sesion'))?.[1]
    ?? '').trim();
  const grupoLine = (headerSection.match(FIELD_RE('Grupo'))?.[1] ?? '').trim();
  const { isGroup, groupName } = parseGroupField(grupoLine);
  const dateISO = (headerSection.match(FIELD_RE('Fecha'))?.[1] ?? '').trim();
  const media = (headerSection.match(FIELD_RE('Media'))?.[1] ?? '').trim();
  const body = bodyAndTail.replace(/^\n+/, '').replace(/\s+$/, '');

  return {
    direction,
    rawFrom,
    phone: formatWhatsAppPhone(rawFrom),
    fromName,
    groupName,
    session,
    isGroup,
    dateISO,
    date: parseDate(dateISO),
    media,
    body,
  };
}

// Splits a `De:` line into a name + JID. The line may be `<jid>` alone (legacy),
// `Name <jid>` (new template), or just a name with no JID. Returns empty
// strings for missing pieces — never null, so the renderer can do simple
// fallbacks.
function splitNameAndJid(line: string): { name: string; jid: string } {
  if (!line) return { name: '', jid: '' };
  const angled = line.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angled) return { name: angled[1].trim(), jid: angled[2].trim() };
  // No angle brackets — assume the whole line is a JID-ish identifier (legacy
  // template) so existing screenshots keep parsing as before.
  return { name: '', jid: line };
}

// Parses the `Grupo:` line — either `true|false` (legacy) or `<bool> <name>`
// (new template). Returns the group flag and any trailing name token.
function parseGroupField(value: string): { isGroup: boolean; groupName: string } {
  const trimmed = value.trim();
  if (!trimmed) return { isGroup: false, groupName: '' };
  const m = trimmed.match(/^(\S+)\s*(.*)$/);
  const head = (m?.[1] ?? '').toLowerCase();
  const tail = (m?.[2] ?? '').trim();
  const isGroup = head === 'true' || head === 'sí' || head === 'si' || head === '1';
  return { isGroup, groupName: tail };
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
          className="whatsapp-bubble__link"
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

// Build the bubble's primary/secondary header strings from the parsed message.
// DM: primary = fromName (or phone fallback), secondary = phone if distinct.
// Group: primary = `<groupName> · <fromName>`, secondary = phone if distinct.
// When everything is empty, primary stays '' and the renderer falls back to '—'.
export function composeIdentity(
  msg: Pick<WhatsAppMessage, 'fromName' | 'groupName' | 'isGroup'>,
  phoneLabel: string,
): { primary: string; secondary: string } {
  const fromName = msg.fromName?.trim() ?? '';
  const groupName = msg.groupName?.trim() ?? '';
  const sender = fromName || phoneLabel;
  const primary = msg.isGroup
    ? [groupName, sender].filter(Boolean).join(' · ')
    : sender;
  const secondary = primary && phoneLabel && !primary.includes(phoneLabel) ? phoneLabel : '';
  return { primary, secondary };
}

interface WhatsAppMessageBubbleProps {
  msg: WhatsAppMessage;
}

export function WhatsAppMessageBubble({ msg }: WhatsAppMessageBubbleProps): React.ReactElement {
  const time = formatBubbleTime(msg.date);
  const sessionLabel = shortenSession(msg.session);
  const dirLabel = msg.direction === 'outbound' ? 'enviado' : 'recibido';
  const phoneLabel = msg.phone || msg.rawFrom || '';
  const { primary, secondary } = composeIdentity(msg, phoneLabel);

  return (
    <div className={`whatsapp-row whatsapp-row--${msg.direction}`}>
      <div className="whatsapp-bubble" role="group" aria-label="WhatsApp message">
        <div className="whatsapp-bubble__header">
          <span className="whatsapp-bubble__icon" aria-hidden="true">
            <Icon name="chat" size={11} weight="fill" />
          </span>
          <span className="whatsapp-bubble__phone" title={msg.rawFrom || msg.phone}>
            {primary || '—'}
          </span>
          {secondary && (
            <span className="whatsapp-bubble__session" title={msg.rawFrom}>{secondary}</span>
          )}
          {msg.isGroup && (
            <span className="whatsapp-bubble__badge">
              <Icon name="users" size={10} /> Grupo
            </span>
          )}
          {sessionLabel && (
            <span className="whatsapp-bubble__session" title={msg.session}>{sessionLabel}</span>
          )}
        </div>
        {msg.media && (
          <div className="whatsapp-bubble__media">
            <Icon name="paperclip" size={11} />
            <span>{msg.media}</span>
          </div>
        )}
        <div className="whatsapp-bubble__body">
          {msg.body
            ? renderBodyWithLinks(msg.body)
            : <span className="whatsapp-bubble__empty">—</span>}
        </div>
        <div className="whatsapp-bubble__footer">
          <span className="whatsapp-bubble__brand">WhatsApp · {dirLabel}</span>
          {time && <span className="whatsapp-bubble__time">{time}</span>}
        </div>
      </div>
    </div>
  );
}
