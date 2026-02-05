/**
 * useRightPanelResize - Hook for right panel drag-to-resize
 *
 * Handles mouse drag to resize the panel width from its left edge.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  STORAGE_KEY_PANEL_WIDTH,
} from './types';

export interface UseRightPanelResizeReturn {
  panelWidth: number;
  panelRef: React.RefObject<HTMLDivElement | null>;
  handleResizeStart: (e: React.MouseEvent) => void;
  isResizing: boolean;
}

function getStoredWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PANEL_WIDTH);
    if (stored !== null) {
      const val = parseFloat(stored);
      if (val >= MIN_PANEL_WIDTH && val <= MAX_PANEL_WIDTH) return val;
    }
  } catch { /* ignore */ }
  return DEFAULT_PANEL_WIDTH;
}

export function useRightPanelResize(): UseRightPanelResizeReturn {
  const [panelWidth, setPanelWidth] = useState(getStoredWidth);
  const [isResizing, setIsResizing] = useState(false);

  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      resizeStartXRef.current = e.clientX;
      resizeStartWidthRef.current = panelWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      setIsResizing(true);
    },
    [panelWidth]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      // Dragging left = positive delta = wider panel
      const deltaX = resizeStartXRef.current - e.clientX;
      const newWidth = Math.min(
        MAX_PANEL_WIDTH,
        Math.max(MIN_PANEL_WIDTH, resizeStartWidthRef.current + deltaX)
      );
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setIsResizing(false);
        try {
          localStorage.setItem(STORAGE_KEY_PANEL_WIDTH, String(panelWidthRef.current));
        } catch { /* ignore */ }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return {
    panelWidth,
    panelRef,
    handleResizeStart,
    isResizing,
  };
}
