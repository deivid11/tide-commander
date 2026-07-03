/**
 * VirtualizedOutputList - Efficient virtualized rendering for terminal output
 *
 * Uses @tanstack/react-virtual for sliding window rendering.
 * Only renders visible items plus overscan buffer, reducing DOM nodes from 200+ to ~30.
 */

import React, { useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { HistoryLine } from './HistoryLine';
import { OutputLine } from './OutputLine';
import type { EnrichedHistoryMessage, EditData } from './types';
import type { ClaudeOutput } from '../../store';
import type { ExecTask, Subagent } from '../../../shared/types';
import type { TestRunHandle } from '../../store';
import { buildItemKey } from './virtualizedOutputKey';
export { buildItemKey } from './virtualizedOutputKey';
export type { TaggedItem, TaggedHistoryItem, TaggedLiveItem } from './virtualizedOutputKey';

// Enriched output type from useFilteredOutputs
type EnrichedOutput = ClaudeOutput & {
  _toolKeyParam?: string;
  _editData?: EditData;
  _todoInput?: string;
  _bashOutput?: string;
  _bashCommand?: string;
  _isRunning?: boolean;
};

interface VirtualizedOutputListProps {
  // Data
  historyMessages: EnrichedHistoryMessage[];
  liveOutputs: EnrichedOutput[];
  agentId: string;
  execTasks?: ExecTask[];
  testRunHandles?: TestRunHandle[];
  subagents?: Map<string, Subagent>;

  // UI state
  viewMode: 'simple' | 'chat' | 'advanced';
  searchHighlight?: string;
  /** Index of the active search match to scroll to */
  searchActiveIndex?: number | null;

  // Message navigation
  selectedMessageIndex: number | null;
  isMessageSelected: (index: number) => boolean;

  // Callbacks
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
  onViewMarkdown?: (content: string) => void;

  // Scroll control
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onScrollTopReached?: () => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;

  // Auto-scroll control
  shouldAutoScroll: boolean;
  onUserScroll?: () => void;

  /**
   * When true, the list will actively "pin" itself to the bottom (for agent switching / initial load),
   * keeping the viewport at the latest message even while row heights are still being measured.
   */
  pinToBottom?: boolean;
  /** Optional callback when the user scrolls during pin mode (so the parent can cancel pinning). */
  onPinCancel?: () => void;

  // History loading state (used only to avoid pinning while fetch is active)
  isLoadingHistory?: boolean;
}

// Estimated heights for different message types (used for initial sizing)
const ESTIMATED_HEIGHTS = {
  user: 60,
  assistant: 120,
  tool_use: 40,
  tool_result: 80,
  default: 60,
};

// Tagged wrapper so the merged history+live array can be sorted while still
// telling each renderer which component to use (HistoryLine vs OutputLine).
// (Type aliases re-exported above are the source of truth — the local copies
// only narrow the live item to EnrichedOutput so render code can read tool
// enrichment fields without an extra cast.)
type _TaggedHistoryItem = { kind: 'history'; item: EnrichedHistoryMessage; originalIndex: number };
type _TaggedLiveItem = { kind: 'live'; item: EnrichedOutput; originalIndex: number };
type TaggedItem = _TaggedHistoryItem | _TaggedLiveItem;

/** Canonical 'created at' in epoch ms — bridges history's ISO strings and live's number ts. */
function getCanonicalTimestampMs(tagged: TaggedItem): number {
  if (tagged.kind === 'history') {
    const ts = tagged.item.timestamp;
    if (!ts) return 0;
    const parsed = new Date(ts).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return tagged.item.timestamp ?? 0;
}

function getCanonicalUuid(tagged: TaggedItem): string {
  if (tagged.kind === 'history') {
    return tagged.item.uuid ?? tagged.item.toolUseId ?? '';
  }
  return tagged.item.uuid ?? '';
}

function getEstimatedHeight(tagged: TaggedItem): number {
  if (tagged.kind === 'history') {
    const m = tagged.item;
    return ESTIMATED_HEIGHTS[m.type as keyof typeof ESTIMATED_HEIGHTS] || ESTIMATED_HEIGHTS.default;
  }
  const output = tagged.item;
  if (output.isUserPrompt) return ESTIMATED_HEIGHTS.user;
  if (output.text?.startsWith('Using tool:')) return ESTIMATED_HEIGHTS.tool_use;
  if (output.text?.startsWith('Tool result:')) return ESTIMATED_HEIGHTS.tool_result;
  return ESTIMATED_HEIGHTS.assistant;
}

// Individual row renderer - memoized for performance
const VirtualRow = memo(function VirtualRow({
  item,
  isHistory,
  agentId,
  execTasks,
  testRunHandles,
  subagents,
  simpleView,
  isSelected,
  messageIndex,
  searchHighlight,
  onImageClick,
  onFileClick,
  onBashClick,
  onViewMarkdown,
}: {
  item: EnrichedHistoryMessage | EnrichedOutput;
  isHistory: boolean;
  agentId: string;
  execTasks: ExecTask[];
  testRunHandles: TestRunHandle[];
  subagents?: Map<string, Subagent>;
  simpleView: boolean;
  isSelected: boolean;
  messageIndex: number;
  searchHighlight?: string;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
  onViewMarkdown?: (content: string) => void;
}) {
  return (
    <div
      data-message-index={messageIndex}
      className={`message-nav-wrapper ${isSelected ? 'message-selected' : ''}`}
    >
      {isHistory ? (
        <HistoryLine
          message={item as EnrichedHistoryMessage}
          agentId={agentId}
          simpleView={simpleView}
          highlight={searchHighlight}
          subagents={subagents}
          execTasks={execTasks}
          testRunHandles={testRunHandles}
          onImageClick={onImageClick}
          onFileClick={onFileClick}
          onBashClick={onBashClick}
          onViewMarkdown={onViewMarkdown}
        />
      ) : (
        <OutputLine
          output={item as EnrichedOutput}
          agentId={agentId}
          execTasks={execTasks}
          testRunHandles={testRunHandles}
          subagents={subagents}
          highlight={searchHighlight}
          onImageClick={onImageClick}
          onFileClick={onFileClick}
          onBashClick={onBashClick}
          onViewMarkdown={onViewMarkdown}
        />
      )}
    </div>
  );
});

export const VirtualizedOutputList = memo(function VirtualizedOutputList({
  historyMessages,
  liveOutputs,
  agentId,
  execTasks = [],
  testRunHandles = [],
  subagents,
  viewMode,
  searchHighlight,
  searchActiveIndex,
  selectedMessageIndex,
  isMessageSelected,
  onImageClick,
  onFileClick,
  onBashClick,
  onViewMarkdown,
  scrollContainerRef,
  onScrollTopReached,
  isLoadingMore,
  hasMore,
  shouldAutoScroll,
  onUserScroll,
  pinToBottom = false,
  onPinCancel,
  isLoadingHistory,
}: VirtualizedOutputListProps) {
  // Merge history + live into ONE chronologically sorted array. This is the
  // single authoritative ordering for the rendered list — without it, history
  // (server-sorted) and live outputs sit in separate concatenated blocks, so
  // a live event whose timestamp predates the newest history entry visually
  // appears AFTER it.
  //
  // Stable sort: ascending canonical timestamp, then uuid lex ascending,
  // then original insertion order (history-block first, then live-block).
  const allItems = useMemo<TaggedItem[]>(() => {
    const tagged: TaggedItem[] = [];
    for (let i = 0; i < historyMessages.length; i++) {
      tagged.push({ kind: 'history', item: historyMessages[i], originalIndex: i });
    }
    for (let i = 0; i < liveOutputs.length; i++) {
      tagged.push({ kind: 'live', item: liveOutputs[i], originalIndex: historyMessages.length + i });
    }
    tagged.sort((a, b) => {
      const ta = getCanonicalTimestampMs(a);
      const tb = getCanonicalTimestampMs(b);
      if (ta !== tb) return ta - tb;
      const ua = getCanonicalUuid(a);
      const ub = getCanonicalUuid(b);
      if (ua !== ub) return ua < ub ? -1 : 1;
      return a.originalIndex - b.originalIndex;
    });
    // Defensive de-dup: collapse any items that resolve to the same
    // virtualizer key. Without this, duplicate-key items (real-data dupes
    // from the source, optimistic+history coexisting briefly) cause
    // @tanstack/react-virtual to re-emit the same virtual row at multiple
    // indices, which the user sees as stacked bubbles in one position.
    const seen = new Set<string>();
    const unique: TaggedItem[] = [];
    for (const item of tagged) {
      const key = buildItemKey(item, agentId);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }, [historyMessages, liveOutputs, agentId]);

  // Track if we're programmatically scrolling (to avoid triggering onUserScroll)
  const isProgrammaticScrollRef = useRef(false);
  const prevItemCountRef = useRef(allItems.length);
  const agentSwitchGraceRef = useRef(false);
  // Ref for allItems count so scrollToBottom can read it without being recreated
  const allItemsCountRef = useRef(allItems.length);
  allItemsCountRef.current = allItems.length;
  // Track virtual content height to detect remeasurement changes
  const prevTotalSizeRef = useRef(0);

  // Create virtualizer
  // initialRect prevents the first render from having outerSize=0 (which yields
  // zero visible items until a scroll event triggers a re-measure).
  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => getEstimatedHeight(allItems[index]),
    // Two-phase overscan. While pinned (pane mount / agent switch) keep it
    // small — every overscanned row is a markdown-parsed OutputLine/HistoryLine
    // mounted synchronously, and that mount is the main cost of the switch.
    // Once settled, widen the window so scrolling reaches pre-mounted rows
    // instead of blank container background. The extra rows mount in the
    // unpin commit, while the content is still faded out.
    overscan: pinToBottom ? 10 : 25,
    initialRect: { width: 500, height: 800 },
    // Stable per-item key — see buildItemKey above for the live/history bridge
    // that prevents virtualizer remount when the optimistic prompt is replaced
    // by its history version after a session-update fetch. agentId is part of
    // the key so identical content across agents can never collide.
    getItemKey: (index) => {
      const tagged = allItems[index];
      if (!tagged) return index;
      return buildItemKey(tagged, agentId);
    },
    measureElement: (element) => {
      // Measure actual rendered height for accurate positioning
      return element.getBoundingClientRect().height;
    },
  });

  // Release all DOM element references held by the virtualizer's internal
  // elementsCache when this component unmounts.  @tanstack/virtual-core's
  // cleanup() disconnects the ResizeObserver but does NOT clear elementsCache,
  // so detached DOM nodes accumulate until the virtualizer is GC'd.
  useEffect(() => {
    return () => {
      virtualizer.elementsCache.clear();
    };
  }, [virtualizer]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const count = allItemsCountRef.current;
    if (count <= 0) return;
    // Use both the virtualizer and direct scrollTop for robustness.
    virtualizer.scrollToIndex(count - 1, { align: 'end' });
    container.scrollTop = container.scrollHeight;
  }, [scrollContainerRef, virtualizer]);

  // Pin-to-bottom mode (used for agent switching / initial load).
  // Immediate synchronous scroll before first paint.
  useLayoutEffect(() => {
    if (!pinToBottom) return;
    if (isLoadingHistory) return;
    if (allItems.length === 0) return;
    isProgrammaticScrollRef.current = true;
    agentSwitchGraceRef.current = true;
    scrollToBottom();
  }, [pinToBottom, isLoadingHistory, allItems.length, scrollToBottom]);

  // Continuous scroll enforcement while pinned — the virtualizer re-measures
  // items across multiple frames which changes scrollHeight.  A one-shot
  // scrollToBottom isn't enough; keep calling virtualizer.scrollToIndex +
  // raw scrollTop on every frame so we track measurement updates.
  useEffect(() => {
    if (!pinToBottom) {
      isProgrammaticScrollRef.current = false;
      agentSwitchGraceRef.current = false;
      return;
    }
    if (isLoadingHistory) return;
    if (allItems.length === 0) return;

    let rafId: number;
    const enforce = () => {
      isProgrammaticScrollRef.current = true;
      scrollToBottom();
      rafId = requestAnimationFrame(enforce);
    };
    rafId = requestAnimationFrame(enforce);
    return () => cancelAnimationFrame(rafId);
  }, [pinToBottom, isLoadingHistory, allItems.length, scrollToBottom]);

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (!shouldAutoScroll) return;
    if (allItems.length === 0) return;
    if (allItems.length <= prevItemCountRef.current) {
      prevItemCountRef.current = allItems.length;
      return;
    }

    prevItemCountRef.current = allItems.length;

    // Normal streaming case: scroll to bottom once when new content arrives.
    isProgrammaticScrollRef.current = true;
    scrollToBottom();
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, [allItems.length, shouldAutoScroll, scrollToBottom]);

  // Auto-scroll when virtualizer remeasures items and total content height grows.
  // The item-count effect above only fires when new items are added, but the
  // virtualizer can also grow the content when it measures actual heights that
  // exceed the estimates (e.g. during streaming or after initial render).
  // Without this, the scroll "jumps up" because the content grows under the viewport
  // but nothing pushes scrollTop to follow.
  const totalSize = virtualizer.getTotalSize();
  useEffect(() => {
    const prev = prevTotalSizeRef.current;
    prevTotalSizeRef.current = totalSize;

    if (!shouldAutoScroll) return;
    if (pinToBottom) return; // pinToBottom has its own RAF loop
    if (totalSize <= prev) return; // only care about growth
    if (totalSize - prev < 2) return; // ignore sub-pixel changes

    isProgrammaticScrollRef.current = true;
    scrollToBottom();
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, [totalSize, shouldAutoScroll, pinToBottom, scrollToBottom]);

  // Detect scroll to top for loading more history
  const lastScrollTopRef = useRef(0);
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const prevScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;

    // If the user scrolls while we are pinning, cancel pin mode (so we don't fight them).
    if (pinToBottom && !isProgrammaticScrollRef.current) {
      onPinCancel?.();
    }

    // Disable auto-scroll only on a genuine UPWARD user scroll (scrollTop
    // decreased). When new content grows under the viewport, isAtBottom goes
    // false without scrollTop decreasing — treating that as "user scrolled up"
    // is what made the view jump up off the latest agent message/reasoning.
    // Also skip during the post-agent-switch grace period and programmatic scrolls.
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
    const scrolledUp = scrollTop < prevScrollTop - 1;
    if (!isAtBottom && scrolledUp && !isProgrammaticScrollRef.current && !agentSwitchGraceRef.current && onUserScroll) {
      onUserScroll();
    }

    // Check if scrolled to top for loading more
    if (scrollTop < 200 && hasMore && !isLoadingMore && onScrollTopReached) {
      onScrollTopReached();
    }
  }, [hasMore, isLoadingMore, onScrollTopReached, onUserScroll, scrollContainerRef, pinToBottom, onPinCancel]);

  // Attach scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll, scrollContainerRef]);

  // Fix: sync virtualizer scroll offset after container resize.
  // The virtualizer tracks scroll offset only via scroll events. After a CSS grid
  // reflow (e.g. filter change alters agent count), the browser may clamp scrollTop
  // without firing a scroll event, leaving the virtualizer with a stale offset that
  // produces zero visible items. Dispatching a scroll event forces the re-read.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      isProgrammaticScrollRef.current = true;
      container.dispatchEvent(new Event('scroll'));
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  // Scroll to selected message when navigating
  useEffect(() => {
    if (selectedMessageIndex !== null && selectedMessageIndex >= 0 && selectedMessageIndex < allItems.length) {
      isProgrammaticScrollRef.current = true;
      virtualizer.scrollToIndex(selectedMessageIndex, { align: 'center' });
      const timer = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedMessageIndex, virtualizer, allItems.length]);

  // Scroll to active search match
  useEffect(() => {
    if (searchActiveIndex !== null && searchActiveIndex !== undefined && searchActiveIndex >= 0 && searchActiveIndex < allItems.length) {
      isProgrammaticScrollRef.current = true;
      virtualizer.scrollToIndex(searchActiveIndex, { align: 'center' });
      const timer = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [searchActiveIndex, virtualizer, allItems.length]);

  const virtualItems = virtualizer.getVirtualItems();
  const simpleView = viewMode !== 'advanced';

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }}
    >
      {virtualItems.map((virtualRow) => {
        const tagged = allItems[virtualRow.index];
        if (!tagged) return null;
        const isHistory = tagged.kind === 'history';

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <VirtualRow
              item={tagged.item}
              isHistory={isHistory}
              agentId={agentId}
              execTasks={execTasks}
              testRunHandles={testRunHandles}
              subagents={subagents}
              simpleView={simpleView}
              isSelected={isMessageSelected(virtualRow.index)}
              messageIndex={virtualRow.index}
              searchHighlight={searchHighlight}
              onImageClick={onImageClick}
              onFileClick={onFileClick}
              onBashClick={onBashClick}
              onViewMarkdown={onViewMarkdown}
            />
          </div>
        );
      })}
    </div>
  );
});

export default VirtualizedOutputList;
