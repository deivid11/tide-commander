/**
 * Gmail email bubble renderer.
 *
 * Detects user prompts produced by the Gmail trigger handler's
 * promptTemplate (Spanish "Nuevo correo de Gmail …" format) and renders
 * them as a compact email card with a collapsible body and a separately
 * collapsed quoted-thread tail. The outgoing prompt the agent receives is
 * not modified — we only change how that text is *displayed* to the human.
 */

import React, { useMemo, useState } from 'react';
import { Icon } from '../Icon';

export interface EmailAddress {
  name: string;
  email: string;
  raw: string;
}

export interface EmailMessage {
  direction: 'inbound' | 'outbound';
  from: EmailAddress;
  to: EmailAddress;
  subject: string;
  dateISO: string;
  date: Date | null;
  labels: string[];
  thread: string;
  attachments: string[];
  uniqueAttachments: string[];
  body: string;
  topBody: string;
  quotedBody: string;
}

const HEADER_RE = /^[ \t]*Nuevo correo de Gmail\s*\((inbound|outbound)\)\.?\s*$/im;
const FIELD_RE = (label: string) =>
  new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(.*)$`, 'im');
const URL_RE = /(https?:\/\/[^\s<>"'\)]+)/g;
// Gmail's "On <date>, <person> wrote:" / "El <date>, <person> escribió:" header
// can wrap across multiple lines (the address part frequently breaks at "<").
// Matches anchored at the start of a line, allowing the body to span newlines
// up to the closing "wrote:" / "escribió:" terminator on its own line end.
const QUOTED_HEADER_RE = /(?:^|\n)([ \t]*(?:On |El )[\s\S]*?(?:wrote|escribió):[ \t]*)(?=\n|$)/i;

export function parseEmailMessage(text: string): EmailMessage | null {
  if (!text) return null;
  const headerMatch = text.match(HEADER_RE);
  if (!headerMatch) return null;

  const bodyMarkerIdx = text.search(/\n[ \t]*Cuerpo\s*:[ \t]*\n?/);
  if (bodyMarkerIdx < 0) return null;

  const headerSection = text.slice(0, bodyMarkerIdx);
  let bodyAndTail = text.slice(bodyMarkerIdx).replace(/^\n[ \t]*Cuerpo\s*:[ \t]*\n?/, '');
  bodyAndTail = bodyAndTail.replace(/\n+[ \t]*Revisa el contenido[\s\S]*$/i, '');

  const direction = headerMatch[1].toLowerCase() as 'inbound' | 'outbound';
  const fromRaw = (headerSection.match(FIELD_RE('De'))?.[1] ?? '').trim();
  const toRaw = (headerSection.match(FIELD_RE('Para'))?.[1] ?? '').trim();
  const subject = (headerSection.match(FIELD_RE('Asunto'))?.[1] ?? '').trim();
  const dateISO = (headerSection.match(FIELD_RE('Fecha'))?.[1] ?? '').trim();
  const labelsRaw = (headerSection.match(FIELD_RE('Labels'))?.[1] ?? '').trim();
  const thread = (headerSection.match(FIELD_RE('Thread'))?.[1] ?? '').trim();
  const attachmentsRaw = (headerSection.match(FIELD_RE('Adjuntos'))?.[1] ?? '').trim();

  const body = bodyAndTail.replace(/^\n+/, '').replace(/\s+$/, '');
  const { topBody, quotedBody } = splitQuotedThread(body);

  const attachments = attachmentsRaw
    ? attachmentsRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  return {
    direction,
    from: parseAddress(fromRaw),
    to: parseAddress(toRaw),
    subject,
    dateISO,
    date: parseDate(dateISO),
    labels: labelsRaw ? labelsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    thread,
    attachments,
    uniqueAttachments: dedupeAttachments(attachments),
    body,
    topBody,
    quotedBody,
  };
}

function dedupeAttachments(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function parseAddress(raw: string): EmailAddress {
  if (!raw) return { name: '', email: '', raw: '' };
  const angleMatch = raw.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/);
  if (angleMatch) {
    return { name: angleMatch[1].trim(), email: angleMatch[2].trim(), raw };
  }
  if (/@/.test(raw) && !/\s/.test(raw.trim())) {
    return { name: '', email: raw.trim(), raw };
  }
  return { name: raw.trim(), email: '', raw };
}

function parseDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Split body into the freshly-typed "top" portion and the "quoted" tail
// (everything from the first "On <date>, <person> wrote:" / Spanish equivalent).
function splitQuotedThread(body: string): { topBody: string; quotedBody: string } {
  if (!body) return { topBody: '', quotedBody: '' };

  const headerMatch = QUOTED_HEADER_RE.exec(body);
  if (headerMatch && typeof headerMatch.index === 'number') {
    const offset = headerMatch.index === 0 ? 0 : headerMatch.index + 1;
    return {
      topBody: body.slice(0, offset).trimEnd(),
      quotedBody: body.slice(offset).trim(),
    };
  }

  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*>+\s/.test(lines[i])) {
      return {
        topBody: lines.slice(0, i).join('\n').trimEnd(),
        quotedBody: lines.slice(i).join('\n').trim(),
      };
    }
  }
  return { topBody: body, quotedBody: '' };
}

export function buildGmailMessageUrl(msg: EmailMessage): string | null {
  if (msg.thread) {
    return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(msg.thread)}`;
  }
  const subject = (msg.subject || '').trim();
  const fromAddr = (msg.from.email || msg.from.raw || '').trim();
  if (!subject && !fromAddr) return null;
  const q = fromAddr ? `${subject} from:${fromAddr}` : subject;
  return `https://mail.google.com/mail/u/0/?#search/${encodeURIComponent(q.trim())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatEmailDate(date: Date | null): string {
  if (!date) return '';
  const now = new Date();
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (isSameDay(date, now)) return `Hoy · ${time}`;
  const ymd = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `${ymd} · ${time}`;
}

function initialsFor(addr: EmailAddress): string {
  const source = (addr.name || addr.email || '').trim();
  if (!source) return '?';
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function renderTextWithLinks(text: string, keyBase: string): React.ReactNode[] {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  lines.forEach((line, lineIdx) => {
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    let segIdx = 0;
    while ((match = URL_RE.exec(line)) !== null) {
      if (match.index > lastIdx) {
        out.push(<span key={`${keyBase}-${lineIdx}-t-${segIdx++}`}>{line.slice(lastIdx, match.index)}</span>);
      }
      const url = match[1];
      out.push(
        <a
          key={`${keyBase}-${lineIdx}-l-${segIdx++}`}
          className="gmail-bubble-link"
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
      out.push(<span key={`${keyBase}-${lineIdx}-t-${segIdx++}`}>{line.slice(lastIdx)}</span>);
    }
    if (lineIdx < lines.length - 1) out.push(<br key={`${keyBase}-${lineIdx}-br`} />);
  });
  return out;
}

const TOP_BODY_COLLAPSE_LINE_THRESHOLD = 8;
const TOP_BODY_COLLAPSE_CHAR_THRESHOLD = 600;

interface GmailMessageBubbleProps {
  msg: EmailMessage;
}

export function GmailMessageBubble({ msg }: GmailMessageBubbleProps): React.ReactElement {
  const dateLabel = formatEmailDate(msg.date);
  const subject = msg.subject || '(sin asunto)';

  const topNeedsCollapse = useMemo(() => {
    const lines = msg.topBody.split('\n').length;
    return lines > TOP_BODY_COLLAPSE_LINE_THRESHOLD
      || msg.topBody.length > TOP_BODY_COLLAPSE_CHAR_THRESHOLD;
  }, [msg.topBody]);

  const [topExpanded, setTopExpanded] = useState(false);
  const [quotedExpanded, setQuotedExpanded] = useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);

  const topPreview = useMemo(() => {
    if (!topNeedsCollapse || topExpanded) return msg.topBody;
    const lines = msg.topBody.split('\n').slice(0, TOP_BODY_COLLAPSE_LINE_THRESHOLD);
    let text = lines.join('\n');
    if (text.length > TOP_BODY_COLLAPSE_CHAR_THRESHOLD) {
      text = text.slice(0, TOP_BODY_COLLAPSE_CHAR_THRESHOLD).replace(/\s+\S*$/, '');
    }
    return text;
  }, [msg.topBody, topNeedsCollapse, topExpanded]);

  const fromInitials = initialsFor(msg.from);
  const fromLabel = msg.from.name || msg.from.email || msg.from.raw || '—';
  const toLabel = msg.to.name || msg.to.email || msg.to.raw || '—';
  const visibleAttachments = attachmentsExpanded
    ? msg.uniqueAttachments
    : msg.uniqueAttachments.slice(0, 4);
  const gmailUrl = msg.direction === 'inbound' ? buildGmailMessageUrl(msg) : null;

  return (
    <div className={`gmail-bubble-row gmail-${msg.direction}`}>
      <div className="gmail-bubble" role="group" aria-label="Gmail email">
        <div className="gmail-bubble-meta">
          <span className="gmail-bubble-icon" aria-hidden="true">
            <Icon name="envelope" size={12} weight="fill" />
          </span>
          <span className="gmail-bubble-direction">
            {msg.direction === 'outbound' ? 'Enviado' : 'Recibido'}
          </span>
          {msg.labels.map(label => (
            <span key={label} className="gmail-bubble-label">{label}</span>
          ))}
          {dateLabel && <span className="gmail-bubble-date">{dateLabel}</span>}
        </div>

        <div className="gmail-bubble-subject" title={subject}>{subject}</div>

        <div className="gmail-bubble-people">
          <div className="gmail-bubble-person">
            <span className="gmail-bubble-avatar gmail-bubble-avatar-from">{fromInitials}</span>
            <div className="gmail-bubble-person-text">
              <span className="gmail-bubble-person-role">De</span>
              <span className="gmail-bubble-person-name" title={msg.from.raw}>{fromLabel}</span>
              {msg.from.email && msg.from.name && (
                <span className="gmail-bubble-person-email">{msg.from.email}</span>
              )}
            </div>
          </div>
          <div className="gmail-bubble-arrow" aria-hidden="true">
            <Icon name="arrow-clockwise" size={11} />
          </div>
          <div className="gmail-bubble-person">
            <span className="gmail-bubble-avatar gmail-bubble-avatar-to">{initialsFor(msg.to)}</span>
            <div className="gmail-bubble-person-text">
              <span className="gmail-bubble-person-role">Para</span>
              <span className="gmail-bubble-person-name" title={msg.to.raw}>{toLabel}</span>
              {msg.to.email && msg.to.name && (
                <span className="gmail-bubble-person-email">{msg.to.email}</span>
              )}
            </div>
          </div>
        </div>

        {msg.uniqueAttachments.length > 0 && (
          <div className="gmail-bubble-attachments">
            <button
              type="button"
              className="gmail-bubble-attachments-toggle"
              onClick={() => setAttachmentsExpanded(v => !v)}
              aria-expanded={attachmentsExpanded}
            >
              <Icon name="paperclip" size={11} />
              <span>
                {msg.uniqueAttachments.length} adjunto{msg.uniqueAttachments.length === 1 ? '' : 's'}
                {msg.attachments.length !== msg.uniqueAttachments.length
                  && ` · ${msg.attachments.length} ref.`}
              </span>
              <Icon name={attachmentsExpanded ? 'caret-down' : 'caret-right'} size={10} />
            </button>
            {attachmentsExpanded && (
              <div className="gmail-bubble-attachments-list">
                {visibleAttachments.map((name, i) => (
                  <span key={`${name}-${i}`} className="gmail-bubble-attachment-chip">
                    <Icon name="paperclip" size={10} />
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="gmail-bubble-body">
          {msg.topBody
            ? renderTextWithLinks(topPreview, 'top')
            : <span className="gmail-bubble-empty">(cuerpo vacío)</span>}
          {topNeedsCollapse && (
            <button
              type="button"
              className="gmail-bubble-more-btn"
              onClick={() => setTopExpanded(v => !v)}
              aria-expanded={topExpanded}
            >
              {topExpanded ? 'Mostrar menos' : 'Mostrar más'}
            </button>
          )}
        </div>

        {msg.quotedBody && (
          <div className="gmail-bubble-quoted">
            <button
              type="button"
              className="gmail-bubble-quoted-toggle"
              onClick={() => setQuotedExpanded(v => !v)}
              aria-expanded={quotedExpanded}
            >
              <Icon name={quotedExpanded ? 'caret-down' : 'caret-right'} size={10} />
              <span>{quotedExpanded ? 'Ocultar hilo previo' : 'Ver hilo previo'}</span>
            </button>
            {quotedExpanded && (
              <blockquote className="gmail-bubble-quoted-body">
                {renderTextWithLinks(msg.quotedBody, 'q')}
              </blockquote>
            )}
          </div>
        )}

        <div className="gmail-bubble-footer">
          <span className="gmail-bubble-brand">Gmail</span>
          <div className="gmail-bubble-footer-right">
            {gmailUrl && (
              <a
                className="gmail-bubble-open"
                href={gmailUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir en Gmail"
              >
                <Icon name="open-external" size={10} />
                <span>Ver en Gmail</span>
              </a>
            )}
            {msg.thread && (
              <span className="gmail-bubble-thread" title={`Thread ${msg.thread}`}>
                #{msg.thread.slice(0, 8)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
