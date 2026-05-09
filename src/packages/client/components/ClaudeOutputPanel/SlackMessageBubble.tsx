/**
 * Slack message bubble renderer.
 *
 * Mirrors WhatsAppMessageBubble's plain flex-column design — see that file for
 * the layout rationale (no abs/transform/float, padding-only, inset shadow).
 * Detects user prompts produced by the Slack trigger handler's promptTemplate
 * (Spanish "Nuevo mensaje de Slack." format).
 */

import React from 'react';
import { Icon } from '../Icon';

export interface SlackMessage {
  direction: 'inbound' | 'outbound';
  rawFrom: string;
  fromName: string;
  fromUserId: string;
  /** Raw text from the `Canal:` line — useful when callers want to display the unparsed value. */
  channelRaw: string;
  /** Resolved channel id (`Cxxx` / `Dxxx` / `Gxxx`) — empty when only a name was given. */
  channel: string;
  /** Friendly channel label (`#navi`, `DM con @Luis`, `Grupo: …`) — empty when not present. */
  channelName: string;
  channelKind: 'dm' | 'group' | 'channel';
  thread: string;
  instance: string;
  attachments: string[];
  body: string;
}

const HEADER_RE = /^[ \t]*Nuevo mensaje de Slack(?:\s*\((inbound|outbound)\))?\.?\s*$/im;
const FIELD_RE = (label: string) =>
  new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(.*)$`, 'im');
const URL_RE = /(https?:\/\/[^\s<>"'\)]+)/g;
// "@Display Name (UXXXXXX)" — Slack's user mention format.
const SLACK_USER_RE = /^\s*@?\s*([^()]+?)\s*\(\s*(U[A-Z0-9]+)\s*\)\s*$/;
// "<friendly label> (<channel id>)" — the new format produced when the
// trigger template uses {{slack.channelName}} ({{slack.channelId}}).
// Channel ids start with C/D/G in Slack.
const SLACK_CHANNEL_RE = /^\s*(.+?)\s*\(\s*([CDG][A-Z0-9]{6,})\s*\)\s*$/;
// Bare channel id by itself, no friendly label — legacy format.
const SLACK_BARE_CHANNEL_RE = /^\s*([CDG][A-Z0-9]{6,})\s*$/;

export function parseSlackMessage(text: string): SlackMessage | null {
  if (!text) return null;
  const headerMatch = text.match(HEADER_RE);
  if (!headerMatch) return null;

  // Body delimiter must exist — reject lookalikes that mention Slack but
  // don't actually carry a message body.
  const bodyMarkerIdx = text.search(/\n[ \t]*Mensaje\s*:[ \t]*\n?/);
  if (bodyMarkerIdx < 0) return null;

  const headerSection = text.slice(0, bodyMarkerIdx);
  let bodyAndTail = text.slice(bodyMarkerIdx).replace(/^\n[ \t]*Mensaje\s*:[ \t]*\n?/, '');
  bodyAndTail = bodyAndTail.replace(/\n+[ \t]*Revisa el (mensaje|contenido)[\s\S]*$/i, '');

  // Default to inbound — most Slack notification flows are inbound; the
  // (outbound) marker is honored if the user's template includes it.
  const direction = (headerMatch[1]?.toLowerCase() === 'outbound' ? 'outbound' : 'inbound');
  const rawFrom = (headerSection.match(FIELD_RE('De'))?.[1] ?? '').trim();
  const channelRaw = (headerSection.match(FIELD_RE('Canal'))?.[1] ?? '').trim();
  const thread = (headerSection.match(FIELD_RE('Thread'))?.[1] ?? '').trim();
  const instance = (headerSection.match(FIELD_RE('Instancia'))?.[1] ?? '').trim();
  const attachmentsRaw = (headerSection.match(FIELD_RE('Adjuntos'))?.[1] ?? '').trim();
  const body = bodyAndTail.replace(/^\n+/, '').replace(/\s+$/, '');

  const { fromName, fromUserId } = parseSlackUser(rawFrom);
  const { channel, channelName } = parseSlackChannel(channelRaw);
  const attachments = attachmentsRaw
    ? splitAttachments(attachmentsRaw)
    : [];

  return {
    direction,
    rawFrom,
    fromName,
    fromUserId,
    channelRaw,
    channel,
    channelName,
    channelKind: classifyChannel(channel || channelName),
    thread,
    instance,
    attachments,
    body,
  };
}

function parseSlackChannel(raw: string): { channel: string; channelName: string } {
  if (!raw) return { channel: '', channelName: '' };
  const labeled = raw.match(SLACK_CHANNEL_RE);
  if (labeled) return { channelName: labeled[1].trim(), channel: labeled[2].trim() };
  const bare = raw.match(SLACK_BARE_CHANNEL_RE);
  if (bare) return { channel: bare[1].trim(), channelName: '' };
  // Fallback: a friendly label-only string with no parenthesised id (e.g.
  // "#navi" or "DM con @luis") — treat the whole thing as the friendly name
  // so the renderer can still show something useful.
  return { channel: '', channelName: raw };
}

function parseSlackUser(raw: string): { fromName: string; fromUserId: string } {
  if (!raw) return { fromName: '', fromUserId: '' };
  const match = raw.match(SLACK_USER_RE);
  if (match) return { fromName: match[1].trim(), fromUserId: match[2].trim() };
  return { fromName: raw.replace(/^@/, '').trim(), fromUserId: '' };
}

// Slack channel ID prefixes: D = direct message, G = private group/MPIM,
// C = public channel. Anything else falls back to 'channel'.
function classifyChannel(channel: string): 'dm' | 'group' | 'channel' {
  if (!channel) return 'channel';
  const head = channel.charAt(0).toUpperCase();
  if (head === 'D') return 'dm';
  if (head === 'G') return 'group';
  return 'channel';
}

function splitAttachments(raw: string): string[] {
  // Attachments are one-per-line in some templates, comma-separated in others.
  // Newline split first, then comma fallback for single-line lists.
  const lines = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (lines.length > 1) return dedupe(lines);
  return dedupe(raw.split(',').map(s => s.trim()).filter(Boolean));
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function shortenThread(thread: string): string {
  if (!thread) return '';
  // Slack thread_ts looks like "1778180755.429849" — keep the integer second
  // portion only for compactness.
  const dot = thread.indexOf('.');
  if (dot > 0) return thread.slice(0, dot);
  return thread.length <= 12 ? thread : `${thread.slice(0, 10)}…`;
}

function channelLabel(msg: SlackMessage): string {
  // Friendly name wins when present — "#navi", "DM con @Luis", "Grupo: …".
  if (msg.channelName) return msg.channelName;
  // Legacy (id-only) format. Render a kind-specific fallback.
  if (!msg.channel) return '—';
  if (msg.channelKind === 'dm') return 'DM';
  if (msg.channelKind === 'group') return `grupo · ${msg.channel}`;
  return `#${msg.channel}`;
}

function initialsFor(name: string): string {
  const source = (name || '').trim();
  if (!source) return '?';
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
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
          className="slack-bubble__link"
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

interface SlackMessageBubbleProps {
  msg: SlackMessage;
}

export function SlackMessageBubble({ msg }: SlackMessageBubbleProps): React.ReactElement {
  const dirLabel = msg.direction === 'outbound' ? 'enviado' : 'recibido';
  const fromLabel = msg.fromName || msg.rawFrom || '—';
  const channelTxt = channelLabel(msg);
  const channelTooltip = msg.channel && msg.channelName ? `${msg.channelName} · ${msg.channel}` : (msg.channel || msg.channelName);
  const threadShort = shortenThread(msg.thread);

  return (
    <div className={`slack-row slack-row--${msg.direction}`}>
      <div className="slack-bubble" role="group" aria-label="Slack message">
        <div className="slack-bubble__header">
          <span className="slack-bubble__avatar" aria-hidden="true">{initialsFor(fromLabel)}</span>
          <div className="slack-bubble__person">
            <span className="slack-bubble__name" title={msg.rawFrom}>{fromLabel}</span>
            {msg.fromUserId && (
              <span className="slack-bubble__userid" title={msg.fromUserId}>{msg.fromUserId}</span>
            )}
          </div>
          <span className={`slack-bubble__channel slack-bubble__channel--${msg.channelKind}`} title={channelTooltip}>
            <Icon name={msg.channelKind === 'dm' ? 'chat' : 'announce'} size={10} />
            <span>{channelTxt}</span>
            {msg.channelName && msg.channel && (
              <span className="slack-bubble__channelid" title={msg.channel}>{msg.channel}</span>
            )}
          </span>
          {msg.instance && (
            <span className="slack-bubble__instance" title={`Workspace: ${msg.instance}`}>{msg.instance}</span>
          )}
        </div>

        {msg.attachments.length > 0 && (
          <div className="slack-bubble__attachments">
            {msg.attachments.map((name, i) => (
              <span key={`${name}-${i}`} className="slack-bubble__attachment">
                <Icon name="paperclip" size={11} />
                <span className="slack-bubble__attachment-name">{name}</span>
              </span>
            ))}
          </div>
        )}

        <div className="slack-bubble__body">
          {msg.body
            ? renderBodyWithLinks(msg.body)
            : <span className="slack-bubble__empty">(sin texto)</span>}
        </div>

        <div className="slack-bubble__footer">
          <span className="slack-bubble__brand">Slack · {dirLabel}</span>
          {threadShort && (
            <span className="slack-bubble__thread" title={`thread_ts ${msg.thread}`}>
              thread #{threadShort}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
