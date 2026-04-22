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

function getEstimatedHeight(item: EnrichedHistoryMessage | EnrichedOutput): number {
  if ('type' in item) {
    return ESTIMATED_HEIGHTS[item.type as keyof typeof ESTIMATED_HEIGHTS] || ESTIMATED_HEIGHTS.default;
  }
  // Live output
  const output = item as EnrichedOutput;
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
          subagents={subagents}
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
  // Combine history and live outputs into single array (memoized to avoid
  // re-creating the array on every render, which would trigger virtualizer
  // recalculations and cascade into unnecessary child re-renders)
  const allItems = useMemo(
    () => [...historyMessages, ...liveOutputs],
    [historyMessages, liveOutputs]
  );
  const historyCount = historyMessages.length;

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
    overscan: 25, // Render 25 items above/below viewport
    initialRect: { width: 500, height: 800 },
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
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;

    // If the user scrolls while we are pinning, cancel pin mode (so we don't fight them).
    if (pinToBottom && !isProgrammaticScrollRef.current) {
      onPinCancel?.();
    }

    // Check if user scrolled up (not at bottom)
    // BUT: Don't trigger during grace period after agent switch, as this would
    // incorrectly disable auto-scroll before history even loads
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
    if (!isAtBottom && !isProgrammaticScrollRef.current && !agentSwitchGraceRef.current && onUserScroll) {
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
        const item = allItems[virtualRow.index];
        const isHistory = virtualRow.index < historyCount;

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
              item={item}
              isHistory={isHistory}
              agentId={agentId}
              execTasks={execTasks}
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
