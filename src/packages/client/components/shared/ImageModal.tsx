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

import React from 'react';
import { ModalPortal } from './ModalPortal';
import { ZoomableImage } from './ZoomableImage';
import { useModalClose } from '../../hooks/useModalClose';
import { Icon } from '../Icon';

export interface ImageModalProps {
  url: string;
  name: string;
  onClose: () => void;
  /** Secondary line under the title, e.g. `image/png · 240 KB`. */
  subtitle?: string;
  /** Filename for the header download button. Omit to hide the button. */
  downloadName?: string;
}

/** Any modal that shows a single image should render this rather than rolling
 *  its own `<img>` chrome. */
export function ImageModal({ url, name, onClose, subtitle, downloadName }: ImageModalProps) {
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  return (
    <ModalPortal>
      <div className="image-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="image-modal">
          <div className="image-modal-header">
            <div className="image-modal-heading">
              <span className="image-modal-title">{name}</span>
              {subtitle && <span className="image-modal-subtitle">{subtitle}</span>}
            </div>
            {downloadName && (
              <a className="image-modal-download" href={url} download={downloadName} title="Download" aria-label="Download">
                <Icon name="download" size={12} />
              </a>
            )}
            <button className="image-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="image-modal-content">
            <ZoomableImage src={url} alt={name} />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
