/**
 * useSidePanelResize - Shared horizontal resizer for the Guake side panels
 * (git changes, buildings, debug, overview).
 *
 * Owns the persisted width and exposes an onMouseDown handler for the drag
 * strip. Reused by ClaudeOutputPanel (3D Guake terminal) and FlatView so the
 * git/buildings side panels resize identically and share one persisted width
 * via STORAGE_KEYS.SIDE_PANEL_WIDTH. Mirrors the useBottomTerminalResize hook.
 */

import { useCallback, useRef, useState } from 'react';
import { store } from '../../store';
import {
  STORAGE_KEYS,
  getStorageNumber,
  setStorageNumber,
} from '../../utils/storage';

const MIN_WIDTH = 280;
const MAX_WIDTH = 700;
const DEFAULT_WIDTH = 420;

export interface SidePanelResize {
  /** Current side-panel width in px (drives the --guake-side-panel-width var). */
  sidePanelWidth: number;
  /** Begin a drag-resize from the given handle side. */
  handleSidePanelResizeStart: (e: React.MouseEvent, side: 'left' | 'right') => void;
}

export function useSidePanelResize(): SidePanelResize {
  const [sidePanelWidth, setSidePanelWidth] = useState(() => {
    const saved = getStorageNumber(STORAGE_KEYS.SIDE_PANEL_WIDTH, DEFAULT_WIDTH);
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, saved));
  });
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const handleSidePanelResizeStart = useCallback((e: React.MouseEvent, side: 'left' | 'right') => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: sidePanelWidth };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    store.setTerminalResizing(true);
    let lastWidth = sidePanelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = moveEvent.clientX - resizeRef.current.startX;
      // Each panel grows when its handle is dragged toward the screen center.
      // Left-anchored panels (overview) put the handle on their RIGHT edge, so
      // dragging right grows them (+dx). Right-anchored panels (git/buildings)
      // put the handle on their LEFT edge, so dragging left grows them (-dx).
      const delta = side === 'left' ? dx : -dx;
      lastWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeRef.current.startW + delta));
      setSidePanelWidth(lastWidth);
    };

    const onMouseUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      store.setTerminalResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setStorageNumber(STORAGE_KEYS.SIDE_PANEL_WIDTH, lastWidth);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidePanelWidth]);

  return { sidePanelWidth, handleSidePanelResizeStart };
}
