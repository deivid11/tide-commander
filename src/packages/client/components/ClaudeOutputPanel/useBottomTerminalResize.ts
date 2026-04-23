/**
 * Shared bottom-terminal resizer.
 *
 * Owns the persisted height state and exposes an onMouseDown handler for the
 * drag strip. Reused by GuakeOutputPanel's bottom panel area and by the
 * FlatView's embedded terminal so both surfaces behave identically.
 */

import { useCallback, useRef, useState } from 'react';

const STORAGE_KEY = 'tide:bottom-terminal-height';
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 250;

function readSavedHeight(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HEIGHT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_HEIGHT;
    return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parsed));
  } catch {
    return DEFAULT_HEIGHT;
  }
}

export interface BottomTerminalResize {
  height: number;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function useBottomTerminalResize(): BottomTerminalResize {
  const [height, setHeight] = useState<number>(() => readSavedHeight());
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    let lastHeight = height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - moveEvent.clientY;
      lastHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dragRef.current.startH + dy));
      setHeight(lastHeight);
    };

    const onMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      try { localStorage.setItem(STORAGE_KEY, String(lastHeight)); } catch { /* ignore */ }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [height]);

  return { height, onResizeStart };
}
