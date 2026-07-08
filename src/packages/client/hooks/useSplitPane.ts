/**
 * Draggable vertical split between a browser's left list and right detail
 * pane (tests/http building browsers). The left width is a percentage of the
 * body — so one persisted value works for both the wide modal and the compact
 * docked bottom panel — stored in localStorage under `storageKey`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_PCT = 15;
const MAX_PCT = 80;

export function useSplitPane(storageKey: string, defaultPct = 40) {
  const [leftPct, setLeftPct] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const n = raw === null ? NaN : Number(raw);
      if (Number.isFinite(n) && n >= MIN_PCT && n <= MAX_PCT) return n;
    } catch {
      /* ignore */
    }
    return defaultPct;
  });
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(leftPct)));
    } catch {
      /* ignore */
    }
  }, [storageKey, leftPct]);

  const onSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const body = bodyRef.current;
    if (!body) return;
    const onMove = (ev: MouseEvent) => {
      const rect = body.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(MAX_PCT, Math.max(MIN_PCT, pct)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return { leftPct, bodyRef, onSplitMouseDown };
}
