/**
 * useTreePanelResize - Hook for tree panel resize drag functionality
 *
 * Handles mouse drag to resize the file explorer tree panel width.
 * Follows the same pattern as useTerminalResize.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  STORAGE_KEYS,
  getStorageNumber,
  setStorageNumber,
} from '../../utils/storage';

const DEFAULT_TREE_WIDTH = 280;
const MIN_TREE_WIDTH = 150;
const MAX_TREE_WIDTH = 1200;

export interface UseTreePanelResizeReturn {
  /** Current tree panel width in pixels */
  treePanelWidth: number;
  /** Handler for starting resize drag */
  handleResizeStart: (e: React.MouseEvent) => void;
  /** Whether a resize is currently in progress */
  isResizing: boolean;
}

export function useTreePanelResize(): UseTreePanelResizeReturn {
  const [treePanelWidth, setTreePanelWidth] = useState(() => {
    const saved = getStorageNumber(STORAGE_KEYS.TREE_PANEL_WIDTH, DEFAULT_TREE_WIDTH);
    if (saved >= MIN_TREE_WIDTH && saved <= MAX_TREE_WIDTH) {
      return saved;
    }
    return DEFAULT_TREE_WIDTH;
  });

  const isResizingRef = useRef(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const treePanelWidthRef = useRef(treePanelWidth);
  treePanelWidthRef.current = treePanelWidth;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      setIsResizing(true);
      resizeStartXRef.current = e.clientX;
      resizeStartWidthRef.current = treePanelWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    },
    [treePanelWidth]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const deltaX = e.clientX - resizeStartXRef.current;
      const newWidth = Math.min(
        MAX_TREE_WIDTH,
        Math.max(MIN_TREE_WIDTH, resizeStartWidthRef.current + deltaX)
      );
      setTreePanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        setIsResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setStorageNumber(STORAGE_KEYS.TREE_PANEL_WIDTH, treePanelWidthRef.current);
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
    treePanelWidth,
    handleResizeStart,
    isResizing,
  };
}
