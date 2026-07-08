/**
 * Inline PM2 log viewer for docked bottom panels (guake + flat terminal).
 * Virtualized, ANSI-colorized, stick-to-bottom unless the user scrolled up.
 * Streaming comes from the store's streamingBuildingLogs slice, so the same
 * stream renders identically wherever the panel is hosted.
 */

import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../../store';
import { trimLogBufferByLines } from '../../utils/logRetention';
import { ansiToHtml } from '../../utils/ansiToHtml';

export const BottomPm2LogContent = memo(function BottomPm2LogContent({
  buildingId,
  filterText,
  maxRetention,
}: {
  buildingId: string;
  filterText: string;
  maxRetention: number | null;
}) {
  const { streamingBuildingLogs } = useStore();
  const logs = streamingBuildingLogs.get(buildingId) || '';
  const logRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);
  const previousScrollHeightRef = useRef(0);
  const normalizedFilter = filterText.trim().toLowerCase();
  const bottomThreshold = 30;

  const updateStickToBottom = useCallback(() => {
    const el = logRef.current;
    if (!el) return;

    const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - bottomThreshold;
    isUserScrolledUpRef.current = !isNearBottom;
  }, []);

  const retainedLogs = useMemo(() => trimLogBufferByLines(logs, maxRetention), [logs, maxRetention]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;

    const previousScrollHeight = previousScrollHeightRef.current;
    const nextScrollHeight = el.scrollHeight;

    if (isUserScrolledUpRef.current) {
      const removedHeight = previousScrollHeight - nextScrollHeight;
      if (removedHeight > 0) {
        el.scrollTop = Math.max(0, el.scrollTop - removedHeight);
      }
    } else {
      el.scrollTop = nextScrollHeight;
    }

    previousScrollHeightRef.current = el.scrollHeight;
  }, [retainedLogs, normalizedFilter]);

  const visibleLogs = useMemo(() => {
    if (!retainedLogs) return '';
    if (!normalizedFilter) return retainedLogs;

    return retainedLogs
      .split('\n')
      .filter((line) => line.toLowerCase().includes(normalizedFilter))
      .join('\n');
  }, [retainedLogs, normalizedFilter]);

  const visibleLines = useMemo(() => (
    visibleLogs ? visibleLogs.split('\n') : []
  ), [visibleLogs]);

  const lineHtml = useMemo(() => (
    visibleLines.map((line) => ansiToHtml(line || ' '))
  ), [visibleLines]);

  const emptyMessage = useMemo(() => {
    if (!retainedLogs) return 'Waiting for logs...';
    if (normalizedFilter && !visibleLogs) return 'No log lines match the current filter.';
    return null;
  }, [retainedLogs, normalizedFilter, visibleLogs]);

  const virtualizer = useVirtualizer({
    count: lineHtml.length,
    getScrollElement: () => logRef.current,
    estimateSize: () => 20,
    overscan: 12,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={logRef}
      className="guake-bottom-pm2-logs"
      onScroll={updateStickToBottom}
    >
      {emptyMessage ? (
        <div className="guake-bottom-pm2-logs-empty">{emptyMessage}</div>
      ) : (
        <div
          className="guake-bottom-pm2-logs-inner"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((virtualItem) => (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              className="guake-bottom-pm2-log-line"
              data-index={virtualItem.index}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
              dangerouslySetInnerHTML={{ __html: lineHtml[virtualItem.index] }}
            />
          ))}
        </div>
      )}
    </div>
  );
});
