/**
 * AttachmentChip — shared chip + body-renderer used by the WhatsApp and Slack
 * chat bubbles. Detects `[attachment: …]` markers produced by the trigger
 * pipeline (paths under `/tmp/tide-commander-uploads/triggers/<src>/<msgId>/<file>`)
 * and replaces them with a clickable chip that opens the preview modal.
 *
 * The two bubbles share this module so when the backend grows new sources
 * (e.g. Gmail, Jira) we don't have to duplicate the parser.
 */

import React, { useState } from 'react';
import { Icon, type IconName } from '../Icon';
import { WhatsAppAttachmentPreview } from './WhatsAppAttachmentPreview';

// Matches the bracket envelope only. The inner content is parsed by
// `parseAttachmentInner` so filenames with spaces (e.g. `report (1).pdf`)
// survive — naive whitespace-splitting regexes lose them.
const ATTACHMENT_RE = /\[attachment: (\/tmp\/tide-commander-uploads\/[^\]\n]+?)\]/g;
const URL_RE = /(https?:\/\/[^\s<>"'\)]+)/g;

export interface AttachmentFields {
  path: string;
  mimetype?: string;
  filename?: string;
  size?: number;
}

/**
 * Parse the inner content of `[attachment: ... ]`. The backend's
 * `formatAttachmentLine` joins fields with TWO spaces, so we locate the
 * next `  key=` marker for each known field (mimetype, name, size) rather
 * than naively splitting on whitespace — filenames legitimately contain
 * single spaces.
 */
export function parseAttachmentInner(inner: string): AttachmentFields {
  const FIELD_KEYS = ['mimetype', 'name', 'size'] as const;
  let pathEnd = inner.length;
  for (const k of FIELD_KEYS) {
    const idx = inner.indexOf(`  ${k}=`);
    if (idx >= 0 && idx < pathEnd) pathEnd = idx;
  }
  const path = inner.slice(0, pathEnd);
  const rest = inner.slice(pathEnd);
  let mimetype: string | undefined;
  let filename: string | undefined;
  let size: number | undefined;
  const mMatch = rest.match(/  mimetype=(.+?)(?=  (?:name|size)=|$)/);
  if (mMatch) mimetype = mMatch[1];
  const nMatch = rest.match(/  name=(.+?)(?=  size=|$)/);
  if (nMatch) filename = nMatch[1];
  const sMatch = rest.match(/  size=(\d+)/);
  if (sMatch) {
    const n = Number(sMatch[1]);
    if (Number.isFinite(n)) size = n;
  }
  return { path, mimetype, filename, size };
}

function humanSizeShort(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function chipIconForMime(mimetype: string | undefined, filename: string | undefined): IconName {
  const m = (mimetype ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'eye';
  if (m.startsWith('video/')) return 'film';
  if (m.startsWith('audio/')) return 'music-note';
  if (m === 'application/pdf') return 'file-text';
  if (m.startsWith('text/')) return 'file-text';
  const ext = (filename ?? '').toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg'].includes(ext)) return 'eye';
  if (['mp4', 'mov', 'webm', '3gp', 'm4v'].includes(ext)) return 'film';
  if (['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return 'music-note';
  if (ext === 'pdf' || ['txt', 'md', 'json', 'xml', 'csv', 'log'].includes(ext)) return 'file-text';
  return 'paperclip';
}

interface AttachmentChipProps {
  path: string;
  mimetype?: string;
  filename?: string;
  size?: number;
}

export function AttachmentChip({ path, mimetype, filename, size }: AttachmentChipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const displayName = filename || path.split('/').pop() || 'attachment';
  const sizeLabel = humanSizeShort(size);
  return (
    <>
      <span
        className="attachment-chip"
        role="button"
        tabIndex={0}
        title={`${displayName}${mimetype ? ` (${mimetype})` : ''} — click to preview`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 8px',
          borderRadius: 12,
          background: 'rgba(74, 158, 255, 0.12)',
          border: '1px solid rgba(74, 158, 255, 0.35)',
          color: 'var(--text-primary, #ddd)',
          fontSize: 12,
          lineHeight: 1.4,
          cursor: 'pointer',
          verticalAlign: 'middle',
          maxWidth: '100%',
        }}
      >
        <Icon name={chipIconForMime(mimetype, filename)} size={12} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
          {displayName}
        </span>
        {sizeLabel && (
          <span style={{ color: 'var(--text-muted, #888)', fontSize: 11 }}>{sizeLabel}</span>
        )}
      </span>
      {open && (
        <WhatsAppAttachmentPreview
          path={path}
          mimetype={mimetype}
          filename={filename}
          size={size}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Render a chat bubble body, replacing `[attachment: …]` markers with
 * clickable chips and turning bare URLs into anchors. The `linkClassName`
 * is applied to the anchor tags so each bubble keeps its own visual style
 * (`whatsapp-bubble__link`, `slack-bubble__link`).
 */
export function renderBodyWithAttachments(body: string, linkClassName: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  ATTACHMENT_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let chipIdx = 0;

  const urlifyLine = (line: string, keyPrefix: string): React.ReactNode[] => {
    const lineOut: React.ReactNode[] = [];
    let lastIdx = 0;
    let urlMatch: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    let segIdx = 0;
    while ((urlMatch = URL_RE.exec(line)) !== null) {
      if (urlMatch.index > lastIdx) {
        lineOut.push(<span key={`${keyPrefix}-t-${segIdx++}`}>{line.slice(lastIdx, urlMatch.index)}</span>);
      }
      const url = urlMatch[1];
      lineOut.push(
        <a
          key={`${keyPrefix}-l-${segIdx++}`}
          className={linkClassName}
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
      lineOut.push(<span key={`${keyPrefix}-t-${segIdx++}`}>{line.slice(lastIdx)}</span>);
    }
    return lineOut;
  };

  const pushTextSegment = (text: string, segKey: string) => {
    if (!text) return;
    const lines = text.split('\n');
    lines.forEach((line, lineIdx) => {
      out.push(<React.Fragment key={`${segKey}-line-${lineIdx}`}>{urlifyLine(line, `${segKey}-line-${lineIdx}`)}</React.Fragment>);
      if (lineIdx < lines.length - 1) out.push(<br key={`${segKey}-br-${lineIdx}`} />);
    });
  };

  while ((match = ATTACHMENT_RE.exec(body)) !== null) {
    if (match.index > cursor) {
      pushTextSegment(body.slice(cursor, match.index), `pre-${chipIdx}`);
    }
    const parsed = parseAttachmentInner(match[1]);
    out.push(
      <AttachmentChip
        key={`att-${chipIdx++}-${parsed.path}`}
        path={parsed.path}
        mimetype={parsed.mimetype}
        filename={parsed.filename}
        size={parsed.size}
      />,
    );
    cursor = ATTACHMENT_RE.lastIndex;
  }
  if (cursor < body.length) {
    pushTextSegment(body.slice(cursor), `tail-${chipIdx}`);
  }
  return out;
}
