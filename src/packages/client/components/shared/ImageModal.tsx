/**
 * ImageModal — the shared zoomable single-image viewer.
 *
 * Deliberately lives outside TerminalModals.tsx and imports only leaf modules
 * (never the `hooks` or `store` barrels): both barrels reach
 * `websocket/state.ts`, which touches `window` at module top level and so
 * explodes with `window is not defined` in the `environment: 'node'` unit
 * tests. WhatsAppAttachmentPreview is reachable from those suites, so an edge
 * from it into a barrel-importing module breaks them at collection time.
 * Same hazard documented in ClaudeOutputPanel/historyDedup.ts.
 */

import React, { useEffect, useRef } from 'react';
import { ModalPortal } from './ModalPortal';
import { ZoomableImage } from './ZoomableImage';
import { useModalClose } from '../../hooks/useModalClose';
import { Icon } from '../Icon';

/** Browse a set of images from one viewer (a conversation's screenshots). */
export interface ImageGallery {
  items: ReadonlyArray<{ url: string; name: string }>;
  index: number;
  onNavigate: (index: number) => void;
}

export interface ImageModalProps {
  url: string;
  name: string;
  onClose: () => void;
  /** Secondary line under the title, e.g. `image/png · 240 KB`. */
  subtitle?: string;
  /** Filename for the header download button. Omit to hide the button. */
  downloadName?: string;
  /** Prev/next + thumbnail strip. Ignored with fewer than two images. */
  gallery?: ImageGallery;
}

/**
 * True when the source is an SVG — by filename, by the (URL-encoded) path in an
 * `/api/files/binary?path=…` query, or by a `data:image/svg+xml` URI.
 */
function isSvgSource(url: string, name: string): boolean {
  if (/^data:image\/svg\+xml/i.test(url)) return true;
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* keep raw */ }
  return /\.svg(?:[?#&]|$)/i.test(name.trim()) || /\.svg(?:[?#&]|$)/i.test(decoded);
}

/** Any modal that shows a single image should render this rather than rolling
 *  its own `<img>` chrome. */
export function ImageModal({ url, name, onClose, subtitle, downloadName, gallery }: ImageModalProps) {
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  // SVGs that only carry a viewBox have no intrinsic pixel size, so this
  // modal's shrink-to-fit box has nothing to measure and collapses the image to
  // 0×0. The class gives those a definite width to scale into.
  const svgSource = isSvgSource(url, name);

  const browsable = !!gallery && gallery.items.length > 1;
  const index = gallery?.index ?? 0;
  const count = gallery?.items.length ?? 0;
  const hasPrev = browsable && index > 0;
  const hasNext = browsable && index < count - 1;
  const galleryRef = useRef(gallery);
  galleryRef.current = gallery;

  // ←/→ browse, Home/End jump. Capture phase so the terminal's own arrow-key
  // message navigation never sees the keystroke while the viewer is open.
  useEffect(() => {
    if (!browsable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const current = galleryRef.current;
      if (!current) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const last = current.items.length - 1;
      let next: number | null = null;
      if (event.key === 'ArrowLeft' && current.index > 0) next = current.index - 1;
      else if (event.key === 'ArrowRight' && current.index < last) next = current.index + 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      if (next === null || next === current.index) return;
      event.preventDefault();
      event.stopPropagation();
      current.onNavigate(next);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [browsable]);

  // Keep the active thumbnail visible as the user browses.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!browsable) return;
    const active = stripRef.current?.querySelector<HTMLElement>('.image-modal-thumb.is-active');
    active?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [browsable, index]);

  const go = (event: React.MouseEvent, next: number) => {
    event.stopPropagation();
    gallery?.onNavigate(next);
  };

  return (
    <ModalPortal>
      <div className="image-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className={`image-modal${browsable ? ' is-gallery' : ''}`}>
          <div className="image-modal-header">
            <div className="image-modal-heading">
              <span className="image-modal-title">{name}</span>
              {subtitle && <span className="image-modal-subtitle">{subtitle}</span>}
            </div>
            {browsable && (
              <span className="image-modal-counter" aria-live="polite">{index + 1} / {count}</span>
            )}
            {downloadName && (
              <a className="image-modal-download" href={url} download={downloadName} title="Download" aria-label="Download">
                <Icon name="download" size={12} />
              </a>
            )}
            <button className="image-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className={`image-modal-content${svgSource ? ' is-svg' : ''}`}>
            {browsable && (
              <button
                className="image-modal-nav is-prev"
                onClick={(event) => go(event, index - 1)}
                disabled={!hasPrev}
                title="Previous image (←)"
                aria-label="Previous image"
              >
                <Icon name="caret-left" size={22} />
              </button>
            )}
            {/* Keyed by URL: each image starts at fit-to-view, not the last zoom. */}
            <ZoomableImage key={url} src={url} alt={name} />
            {browsable && (
              <button
                className="image-modal-nav is-next"
                onClick={(event) => go(event, index + 1)}
                disabled={!hasNext}
                title="Next image (→)"
                aria-label="Next image"
              >
                <Icon name="caret-right" size={22} />
              </button>
            )}
          </div>
          {browsable && gallery && (
            <div className="image-modal-thumbs" ref={stripRef} role="listbox" aria-label="Images in this conversation">
              {gallery.items.map((item, itemIndex) => (
                <button
                  key={item.url}
                  className={`image-modal-thumb${itemIndex === index ? ' is-active' : ''}`}
                  onClick={(event) => go(event, itemIndex)}
                  title={item.name}
                  role="option"
                  aria-selected={itemIndex === index}
                >
                  <img src={item.url} alt={item.name} loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
