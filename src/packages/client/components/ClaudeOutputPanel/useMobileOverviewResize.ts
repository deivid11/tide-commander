/**
 * useMobileOverviewResize - Hook for mobile drag-to-resize between overview panel and terminal
 *
 * Handles touch + mouse drag to resize the overview panel height on mobile.
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

const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.7; // 70% of viewport

export interface UseMobileOverviewResizeReturn {
  /** Current overview height in pixels (0 = use CSS default) */
  mobileOverviewHeight: number;
  /** Handler for starting resize via mouse */
  handleResizeMouseDown: (e: React.MouseEvent) => void;
  /** Handler for starting resize via touch */
  handleResizeTouchStart: (e: React.TouchEvent) => void;
}

export function useMobileOverviewResize(): UseMobileOverviewResizeReturn {
  const [height, setHeight] = useState(() => {
    return getStorageNumber(STORAGE_KEYS.MOBILE_OVERVIEW_HEIGHT, 0);
  });

  const heightRef = useRef(height);
  heightRef.current = height;

  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const getMaxHeight = () => Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
  const clampHeight = (h: number) => Math.min(getMaxHeight(), Math.max(MIN_HEIGHT, h));

  const applyHeight = useCallback((newHeight: number) => {
    setHeight(newHeight);
    const terminal = document.querySelector<HTMLElement>('.guake-terminal');
    if (terminal) {
      terminal.style.setProperty('--guake-mobile-overview-height', `${newHeight}px`);
    }
  }, []);

  const endResize = useCallback(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setStorageNumber(STORAGE_KEYS.MOBILE_OVERVIEW_HEIGHT, heightRef.current);
    store.setTerminalResizing(false);
  }, []);

  // --- Mouse resize ---
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const panel = document.querySelector<HTMLElement>('.agent-overview-panel');
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
    const panel = document.querySelector<HTMLElement>('.agent-overview-panel');
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
    mobileOverviewHeight: height,
    handleResizeMouseDown,
    handleResizeTouchStart,
  };
}
