/**
 * VirtualLineList — windowed renderer for fixed-height code lines.
 *
 * The file viewer and the diff panes used to emit one `div + span + code` row
 * per line with no windowing. A 31,841-line file (docs/openapi.json, 1 MB) came
 * out at ~183k DOM nodes and 541,000px of layout per pane — enough to lock the
 * main thread for seconds on open and to make every later scroll expensive.
 *
 * Rows are exactly `lineHeight` tall (`white-space: pre`, no wrapping), so the
 * window is positioned with plain top/bottom spacer padding rather than
 * absolute offsets. Two things fall out of that, both of which the old DOM had
 * and callers depend on:
 *   - total scroll height stays `count * lineHeight`, which the diff viewer's
 *     scroll-sync and connector canvas assume (`scrollTop / LINE_HEIGHT`);
 *   - rows stay in normal flow, so a `width: max-content` track still sizes to
 *     the widest rendered line and horizontal scrolling keeps working.
 *
 * Callers must not style rows with `:first-child` / `:last-child` — only the
 * rendered window is in the DOM, so those match the wrong rows.
 */

import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualLineListProps {
  /** Total number of lines. */
  count: number;
  /** Exact row height in px — must match the CSS for these rows. */
  lineHeight: number;
  /** The scrolling ancestor. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Renders one line; must produce a single element of exactly `lineHeight`. */
  renderLine: (index: number) => React.ReactNode;
  /** Extra rows kept mounted above/below the viewport. */
  overscan?: number;
}

export function VirtualLineList({
  count,
  lineHeight,
  scrollRef,
  renderLine,
  overscan = 30,
}: VirtualLineListProps) {
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => lineHeight,
    overscan,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom = items.length > 0 ? totalSize - items[items.length - 1].end : 0;

  return (
    <div style={{ paddingTop, paddingBottom, width: 'max-content', minWidth: '100%' }}>
      {items.map((item) => (
        <React.Fragment key={item.key}>{renderLine(item.index)}</React.Fragment>
      ))}
    </div>
  );
}

/**
 * Scroll a windowed line list so `lineIndex` (0-based) sits mid-viewport.
 * Plain scrollTop arithmetic — valid precisely because rows are fixed-height.
 */
export function scrollLineIntoView(
  scroller: HTMLElement,
  lineIndex: number,
  lineHeight: number
): void {
  const target = lineIndex * lineHeight - scroller.clientHeight / 2 + lineHeight / 2;
  scroller.scrollTop = Math.max(0, target);
}
