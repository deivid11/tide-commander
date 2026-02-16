/**
 * IframeModal Component
 * A resizable, draggable modal that displays a URL in an iframe
 * Always stays on top of other content
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './IframeModal.scss';

interface IframeModalProps {
  url: string;
  title?: string;
  isOpen: boolean;
  onClose: () => void;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
}

export function IframeModal({
  url,
  title,
  isOpen,
  onClose,
  initialWidth = 480,
  initialHeight = 360,
  minWidth = 320,
  minHeight = 240,
}: IframeModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number; startPosX: number; startPosY: number; direction: string } | null>(null);

  // Center modal on first open
  useEffect(() => {
    if (isOpen && !position) {
      const x = Math.max(50, (window.innerWidth - size.width) / 2);
      const y = Math.max(50, (window.innerHeight - size.height) / 2);
      setPosition({ x, y });
    }
  }, [isOpen, position, size.width, size.height]);

  // Reset loading state when URL changes
  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
  }, [url]);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleIframeError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      setIsLoading(true);
      setHasError(false);
      iframeRef.current.src = url;
    }
  }, [url]);

  const handleOpenExternal = useCallback(() => {
    window.open(url, '_blank');
  }, [url]);

  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(2, z + 0.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(0.25, z - 0.25));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  // Drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.iframe-modal-btn')) return;
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position?.x ?? 0,
      startPosY: position?.y ?? 0,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 100, dragRef.current.startPosX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 50, dragRef.current.startPosY + dy)),
      });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [position]);

  // Resize handling - fixed version
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startState = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
      startPosX: position?.x ?? 0,
      startPosY: position?.y ?? 0,
      direction,
    };
    resizeRef.current = startState;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = moveEvent.clientX - resizeRef.current.startX;
      const dy = moveEvent.clientY - resizeRef.current.startY;
      const dir = resizeRef.current.direction;

      let newWidth = resizeRef.current.startW;
      let newHeight = resizeRef.current.startH;
      let newX = resizeRef.current.startPosX;
      let newY = resizeRef.current.startPosY;

      // Calculate new dimensions based on direction
      if (dir.includes('e')) {
        newWidth = Math.max(minWidth, resizeRef.current.startW + dx);
      }
      if (dir.includes('w')) {
        const proposedWidth = resizeRef.current.startW - dx;
        if (proposedWidth >= minWidth) {
          newWidth = proposedWidth;
          newX = resizeRef.current.startPosX + dx;
        }
      }
      if (dir.includes('s')) {
        newHeight = Math.max(minHeight, resizeRef.current.startH + dy);
      }
      if (dir.includes('n')) {
        const proposedHeight = resizeRef.current.startH - dy;
        if (proposedHeight >= minHeight) {
          newHeight = proposedHeight;
          newY = resizeRef.current.startPosY + dy;
        }
      }

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [size, position, minWidth, minHeight]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className={`iframe-modal ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`}
      style={{
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        width: size.width,
        height: size.height,
      }}
    >
      {/* Toolbar */}
      <div className="iframe-modal-toolbar" onMouseDown={handleDragStart}>
        <div className="iframe-modal-title" title={url}>
          {title || url}
        </div>
        <div className="iframe-modal-actions">
          {/* Zoom controls */}
          <button
            className="iframe-modal-btn"
            onClick={handleZoomOut}
            title={t('terminal:iframeModal.zoomOut')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <button
            className="iframe-modal-btn iframe-modal-zoom-label"
            onClick={handleZoomReset}
            title={t('terminal:iframeModal.resetZoom')}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="iframe-modal-btn"
            onClick={handleZoomIn}
            title={t('terminal:iframeModal.zoomIn')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <div className="iframe-modal-separator" />
          <button
            className="iframe-modal-btn"
            onClick={handleRefresh}
            title={t('terminal:iframeModal.refresh')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
          <button
            className="iframe-modal-btn"
            onClick={handleOpenExternal}
            title={t('terminal:iframeModal.openInBrowser')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
          <button
            className="iframe-modal-btn iframe-modal-close"
            onClick={onClose}
            title={t('common:buttons.close')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="iframe-modal-content">
        {isLoading && (
          <div className="iframe-modal-loading">
            <div className="iframe-modal-spinner" />
            <span>{t('common:status.loading')}</span>
          </div>
        )}
        {hasError && (
          <div className="iframe-modal-error">
            <span>{t('terminal:iframeModal.failedToLoad')}</span>
            <button onClick={handleRefresh}>{t('terminal:iframeModal.retry')}</button>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={url}
          className="iframe-modal-frame"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          style={{
            display: hasError ? 'none' : 'block',
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            width: `${100 / zoom}%`,
            height: `${100 / zoom}%`,
          }}
        />
      </div>

      {/* Resize handles */}
      <div className="iframe-modal-resize-handle iframe-modal-resize-n" onMouseDown={(e) => handleResizeStart(e, 'n')} />
      <div className="iframe-modal-resize-handle iframe-modal-resize-s" onMouseDown={(e) => handleResizeStart(e, 's')} />
      <div className="iframe-modal-resize-handle iframe-modal-resize-e" onMouseDown={(e) => handleResizeStart(e, 'e')} />
      <div className="iframe-modal-resize-handle iframe-modal-resize-w" onMouseDown={(e) => handleResizeStart(e, 'w')} />
      <div className="iframe-modal-resize-handle iframe-modal-resize-ne" onMouseDown={(e) => handleResizeStart(e, 'ne')} />
      <div className="iframe-modal-resize-handle iframe-modal-resize-nw" onMouseDown={(e) => handleResizeStart(e, 'nw')} />
      <div className="iframe-modal-resize-handle iframe-modal-resize-se" onMouseDown={(e) => handleResizeStart(e, 'se')} />
      <div className="iframe-modal-resize-handle iframe-modal-resize-sw" onMouseDown={(e) => handleResizeStart(e, 'sw')} />
    </div>
  );
}

export default IframeModal;
