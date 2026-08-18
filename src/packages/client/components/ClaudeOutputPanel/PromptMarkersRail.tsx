/**
 * PromptMarkersRail - Claude.ai-style user-prompt overview rail.
 *
 * A vertical stack of small dots pinned to the right edge of the chat, one
 * per user prompt in the conversation (capped to the newest — see
 * MAX_PROMPT_MARKERS). Hovering the dot stack expands a panel listing EVERY
 * prompt truncated (all at once); clicking a row or a dot jumps to that
 * message. Rendered by VirtualizedOutputList inside a sticky, zero-height
 * anchor so it overlays the viewport without participating in scroll layout.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PromptMarker } from './promptMarkers';

interface PromptMarkersRailProps {
  markers: PromptMarker[];
  /** Position (into `markers`) of the prompt being read right now, -1 = none. */
  activePos: number;
  /** The .guake-output scroll container, for viewport-height tracking. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onJump: (marker: PromptMarker) => void;
}

// Vertical rhythm of the dot stack; compresses when prompts outgrow the rail.
const DOT_GAP = 14;
const EDGE_PADDING = 12;
// Hover margin around the dot stack — the panel opens only from here, not
// from the whole right edge of the pane.
const HOVER_PAD = 10;
// Grace period when the mouse crosses the gap between the dot strip and the
// expanded panel, so the panel doesn't flicker closed mid-crossing.
const CLOSE_DELAY_MS = 150;

function formatTime(timestampMs: number): string | null {
  if (!timestampMs) return null;
  try {
    return new Date(timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

// Memo: the parent list re-renders on every live chunk; with a stable
// `markers` array (see buildPromptMarkers) the rail only re-renders when a
// prompt is added or the active position moves.
export const PromptMarkersRail = React.memo(function PromptMarkersRail({
  markers,
  activePos,
  scrollContainerRef,
  onJump,
}: PromptMarkersRailProps) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  // Track the scroll container's inner height (rail spans the visible pane).
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    setViewportHeight(container.clientHeight);
    const observer = new ResizeObserver(() => {
      setViewportHeight(container.clientHeight);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  const openPanel = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Centered stack: fixed gap while it fits, evenly compressed when it doesn't.
  // The hover zone hugs the stack (plus a small margin) instead of the full
  // pane height, so only the dots themselves are interactive.
  const layout = useMemo(() => {
    const count = markers.length;
    const usable = Math.max(0, viewportHeight - EDGE_PADDING * 2);
    const gap = count > 1 ? Math.min(DOT_GAP, usable / (count - 1)) : 0;
    const stackTop = EDGE_PADDING + Math.max(0, (usable - gap * (count - 1)) / 2);
    return {
      gap,
      zoneTop: stackTop - HOVER_PAD,
      zoneHeight: gap * (count - 1) + HOVER_PAD * 2,
      hitHeight: Math.max(6, Math.min(18, gap || DOT_GAP)),
    };
  }, [markers.length, viewportHeight]);

  // When the panel opens, bring the current prompt into its scroll window.
  // The panel always sits fully inside the viewport, so 'nearest' only
  // scrolls the panel's own overflow — never the conversation.
  useEffect(() => {
    if (open) {
      activeRowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [open]);

  if (markers.length < 2 || viewportHeight === 0) {
    return null;
  }

  return (
    <div className="prompt-markers-rail" style={{ height: viewportHeight }}>
      <div
        className="prompt-markers-hover-zone"
        style={{ top: layout.zoneTop, height: layout.zoneHeight }}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
      >
        {markers.map((marker, pos) => (
          <button
            key={marker.key}
            type="button"
            className={`prompt-marker${pos === activePos ? ' active' : ''}`}
            style={{ top: HOVER_PAD + pos * layout.gap, height: layout.hitHeight }}
            aria-label={marker.preview}
            onClick={(e) => {
              e.stopPropagation();
              onJump(marker);
            }}
          >
            <span className="prompt-marker-dot" />
          </button>
        ))}
      </div>
      {open && (
        <div
          className="prompt-markers-panel"
          style={{ maxHeight: Math.max(60, viewportHeight - 16) }}
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
        >
          {markers.map((marker, pos) => {
            const time = formatTime(marker.timestampMs);
            return (
              <button
                key={marker.key}
                type="button"
                ref={pos === activePos ? activeRowRef : undefined}
                className={`prompt-markers-panel-item${pos === activePos ? ' active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onJump(marker);
                }}
              >
                {time && <span className="prompt-markers-panel-time">{time}</span>}
                <span className="prompt-markers-panel-text">{marker.preview}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default PromptMarkersRail;
