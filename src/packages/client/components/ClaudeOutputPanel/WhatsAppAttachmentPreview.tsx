/**
 * WhatsAppAttachmentPreview — modal previewer for attachments produced by the
 * inbound WhatsApp trigger pipeline. Sits inside the WhatsApp chat bubble and
 * opens when the user clicks an `[attachment: …]` chip.
 *
 * Files live under `/tmp/tide-commander-uploads/triggers/whatsapp/<msgId>/<file>`
 * which the Express static mount serves at `/uploads/triggers/whatsapp/<msgId>/<file>`.
 * That URL is what the inline `<img>`, `<video>`, etc. point at.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from '../Icon';
import { ModalPortal } from '../shared/ModalPortal';
import { useModalClose } from '../../hooks/useModalClose';
import { getApiBaseUrl } from '../../utils/storage';

interface WhatsAppAttachmentPreviewProps {
  /** Absolute on-disk path: `/tmp/tide-commander-uploads/triggers/whatsapp/<msgId>/<file>`. */
  path: string;
  /** MIME type as reported by the downloader. Optional. */
  mimetype?: string;
  /** Original filename. Falls back to the basename of `path`. */
  filename?: string;
  /** Size in bytes. Optional. */
  size?: number;
  onClose: () => void;
}

const UPLOAD_ROOT_PREFIX = '/tmp/tide-commander-uploads/';

/** Convert an absolute /tmp/tide-commander-uploads/... path into the absolute
 *  URL served by the Express static mount at `/uploads/...`. Uses the API
 *  base URL so it works in dev mode (where Vite serves the client on a
 *  different port and does NOT proxy /uploads). URL-encodes each path
 *  segment so spaces / non-ASCII filenames survive. */
export function uploadPathToUrl(absPath: string): string | null {
  if (!absPath.startsWith(UPLOAD_ROOT_PREFIX)) return null;
  const rel = absPath.slice(UPLOAD_ROOT_PREFIX.length);
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return `${getApiBaseUrl()}/uploads/${encoded}`;
}

function humanSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';

function classify(mimetype: string | undefined, filename: string): Kind {
  const m = (mimetype ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml') return 'text';
  // Fall back to extension sniffing when mimetype is missing.
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', '3gp', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'json', 'xml', 'csv', 'log'].includes(ext)) return 'text';
  return 'other';
}

function iconForKind(kind: Kind): IconName {
  switch (kind) {
    case 'image': return 'eye';
    case 'video': return 'film';
    case 'audio': return 'music-note';
    case 'pdf': return 'file-text';
    case 'text': return 'file-text';
    default: return 'file';
  }
}

export function WhatsAppAttachmentPreview({ path, mimetype, filename, size, onClose }: WhatsAppAttachmentPreviewProps): React.ReactElement | null {
  const { handleMouseDown, handleClick } = useModalClose(onClose);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  const url = useMemo(() => uploadPathToUrl(path), [path]);
  const effectiveName = filename || path.split('/').pop() || 'file';
  const kind = useMemo(() => classify(mimetype, effectiveName), [mimetype, effectiveName]);

  // ESC closes the modal — useModalClose handles backdrop only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // For small text attachments, fetch the body and render inline.
  useEffect(() => {
    if (kind !== 'text' || !url) return;
    let cancelled = false;
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.text();
      })
      .then(t => { if (!cancelled) setTextContent(t.slice(0, 200_000)); })
      .catch(err => { if (!cancelled) setTextError(String(err)); });
    return () => { cancelled = true; };
  }, [url, kind]);

  if (!url) return null;

  const body = (() => {
    if (kind === 'image') {
      return <img src={url} alt={effectiveName} style={{ maxWidth: '85vw', maxHeight: '70vh', display: 'block', margin: '0 auto', borderRadius: 6 }} />;
    }
    if (kind === 'video') {
      return <video controls src={url} style={{ maxWidth: '85vw', maxHeight: '70vh', display: 'block', margin: '0 auto', borderRadius: 6 }} />;
    }
    if (kind === 'audio') {
      return <audio controls src={url} style={{ width: 'min(80vw, 480px)', display: 'block', margin: '24px auto' }} />;
    }
    if (kind === 'pdf') {
      return <iframe src={url} title={effectiveName} style={{ width: '85vw', height: '70vh', border: 'none', borderRadius: 6, background: 'white' }} />;
    }
    if (kind === 'text') {
      if (textError) {
        return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Failed to load preview: {textError}</div>;
      }
      if (textContent === null) {
        return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div>;
      }
      return (
        <pre style={{
          maxWidth: '85vw',
          maxHeight: '70vh',
          margin: 0,
          padding: 16,
          overflow: 'auto',
          background: 'var(--bg-tertiary, #1a1a1a)',
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}>
          {textContent}
        </pre>
      );
    }
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <Icon name="file" size={48} />
        <div style={{ marginTop: 12 }}>No inline preview available for this file type.</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>Use the download button below to open it locally.</div>
      </div>
    );
  })();

  return (
    <ModalPortal>
      <div
        className="modal-overlay visible"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        style={{ zIndex: 1000 }}
      >
        {/* NOTE: do NOT use className="modal" — that class hard-codes width:400px
         *  from `_modal.scss`, which makes media previews look like a tiny
         *  popover. This container is sized by its content up to 90vw/90vh. */}
        <div
          role="dialog"
          aria-label="WhatsApp attachment preview"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--bg-secondary, #1e1e1e)',
            border: '1px solid var(--border-color, #444)',
            borderRadius: 8,
            padding: 0,
            maxWidth: '90vw',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-color, #444)',
            background: 'var(--bg-tertiary, #161616)',
          }}>
            <Icon name={iconForKind(kind)} size={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {effectiveName}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>
                {[mimetype || 'unknown type', humanSize(size)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <a
              href={url}
              download={effectiveName}
              className="btn btn-secondary btn-sm"
              title="Download"
              style={{ textDecoration: 'none' }}
            >
              <Icon name="download" size={12} />
            </a>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
          <div style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: kind === 'image' || kind === 'video' ? 'rgba(0,0,0,0.4)' : 'transparent',
          }}>
            {body}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
