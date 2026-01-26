/**
 * useTerminalResize - Hook for terminal resize drag functionality
 *
 * Handles mouse drag to resize the terminal panel height.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { store } from '../../store';
import {
  STORAGE_KEYS,
  getStorageNumber,
  setStorageNumber,
} from '../../utils/storage';
import {
  DEFAULT_TERMINAL_HEIGHT,
  MIN_TERMINAL_HEIGHT,
  MAX_TERMINAL_HEIGHT,
} from './types';

export interface UseTerminalResizeReturn {
  /** Current terminal height as a percentage */
  terminalHeight: number;
  /** Ref for the terminal container element */
  terminalRef: React.RefObject<HTMLDivElement | null>;
  /** Handler for starting resize drag */
  handleResizeStart: (e: React.MouseEvent) => void;
}

export function useTerminalResize(): UseTerminalResizeReturn {
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = getStorageNumber(STORAGE_KEYS.TERMINAL_HEIGHT, DEFAULT_TERMINAL_HEIGHT);
    if (saved >= MIN_TERMINAL_HEIGHT && saved <= MAX_TERMINAL_HEIGHT) {
      return saved;
    }
    return DEFAULT_TERMINAL_HEIGHT;
  });

  const isResizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalHeightRef = useRef(terminalHeight);
  terminalHeightRef.current = terminalHeight;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      resizeStartYRef.current = e.clientY;
      resizeStartHeightRef.current = terminalHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      // Notify store that terminal is being resized (disables battlefield drag selection)
      store.setTerminalResizing(true);
    },
    [terminalHeight]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const deltaY = e.clientY - resizeStartYRef.current;
      const windowHeight = window.innerHeight;
      const deltaPercent = (deltaY / windowHeight) * 100;
      const newHeight = Math.min(
        MAX_TERMINAL_HEIGHT,
        Math.max(MIN_TERMINAL_HEIGHT, resizeStartHeightRef.current + deltaPercent)
      );
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setStorageNumber(STORAGE_KEYS.TERMINAL_HEIGHT, terminalHeightRef.current);
        // Notify store that terminal resize is complete
        store.setTerminalResizing(false);
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
    terminalHeight,
    terminalRef,
    handleResizeStart,
  };
}
