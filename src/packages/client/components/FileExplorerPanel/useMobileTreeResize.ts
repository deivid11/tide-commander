/**
 * useMobileTreeResize - Hook for mobile drag-to-resize between tree panel and viewer panel
 *
 * Handles touch + mouse drag to resize the tree panel height on mobile.
 * Persists the chosen height to localStorage.
 *
 * IMPORTANT: Document-level move/end listeners are only attached during an active
 * resize drag and removed immediately on end. This avoids interfering with normal
 * scroll/touch behaviour on the page.
 */

import { useState, useRef, useCallback } from 'react';
import { store } from '../../store';
import {
  STORAGE_KEYS,
  getStorageNumber,
  setStorageNumber,
} from '../../utils/storage';

const MIN_HEIGHT = 100;
const MAX_HEIGHT_RATIO = 0.65; // 65% of available space (viewport minus header)
const HEADER_HEIGHT = 36; // file explorer panel header height

export interface UseMobileTreeResizeReturn {
  /** Current tree panel height in pixels (0 = use CSS default) */
  mobileTreeHeight: number;
  /** Handler for starting resize via mouse */
  handleResizeMouseDown: (e: React.MouseEvent) => void;
  /** Handler for starting resize via touch */
  handleResizeTouchStart: (e: React.TouchEvent) => void;
}

export function useMobileTreeResize(): UseMobileTreeResizeReturn {
  const [height, setHeight] = useState(() => {
    return getStorageNumber(STORAGE_KEYS.MOBILE_TREE_PANEL_HEIGHT, 0);
  });

  const heightRef = useRef(height);
  heightRef.current = height;

  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const getMaxHeight = () => Math.floor((window.innerHeight - HEADER_HEIGHT) * MAX_HEIGHT_RATIO);
  const clampHeight = (h: number) => Math.min(getMaxHeight(), Math.max(MIN_HEIGHT, h));

  const applyHeight = useCallback((newHeight: number) => {
    setHeight(newHeight);
    const main = document.querySelector<HTMLElement>('.file-explorer-main');
    if (main) {
      main.style.setProperty('--fe-mobile-tree-height', `${newHeight}px`);
    }
  }, []);

  const endResize = useCallback(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setStorageNumber(STORAGE_KEYS.MOBILE_TREE_PANEL_HEIGHT, heightRef.current);
    store.setTerminalResizing(false);
  }, []);

  // --- Mouse resize ---
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const panel = document.querySelector<HTMLElement>('.file-explorer-tree-panel');
    const initialHeight = heightRef.current > 0 ? heightRef.current : (panel?.getBoundingClientRect().height ?? 240);
    startYRef.current = e.clientY;
    startHeightRef.current = initialHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    store.setTerminalResizing(true);

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startYRef.current;
      applyHeight(clampHeight(startHeightRef.current + delta));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      endResize();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [applyHeight, endResize]);

  // --- Touch resize ---
  const handleResizeTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const panel = document.querySelector<HTMLElement>('.file-explorer-tree-panel');
    const initialHeight = heightRef.current > 0 ? heightRef.current : (panel?.getBoundingClientRect().height ?? 240);
    startYRef.current = e.touches[0].clientY;
    startHeightRef.current = initialHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    store.setTerminalResizing(true);

    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches.length !== 1) return;
      ev.preventDefault();
      const delta = ev.touches[0].clientY - startYRef.current;
      applyHeight(clampHeight(startHeightRef.current + delta));
    };

    const onTouchEnd = () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      endResize();
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
  }, [applyHeight, endResize]);

  return {
    mobileTreeHeight: height,
    handleResizeMouseDown,
    handleResizeTouchStart,
  };
}
