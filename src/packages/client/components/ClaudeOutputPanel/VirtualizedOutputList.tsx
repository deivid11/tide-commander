/**
 * VirtualizedOutputList - Efficient virtualized rendering for terminal output
 *
 * Uses @tanstack/react-virtual for sliding window rendering.
 * Only renders visible items plus overscan buffer, reducing DOM nodes from 200+ to ~30.
 */

import React, { useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { HistoryLine } from './HistoryLine';
import { OutputLine } from './OutputLine';
import type { EnrichedHistoryMessage, EditData } from './types';
import type { ClaudeOutput } from '../../store';

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

  // UI state
  viewMode: 'simple' | 'chat' | 'advanced';
  searchHighlight?: string;

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

  // History loading state - used to trigger scroll when loading completes
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
  viewMode,
  searchHighlight,
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
  isLoadingHistory,
}: VirtualizedOutputListProps) {
  // Combine history and live outputs into single array
  const allItems = [...historyMessages, ...liveOutputs];
  const historyCount = historyMessages.length;

  // Track if we're programmatically scrolling (to avoid triggering onUserScroll)
  const isProgrammaticScrollRef = useRef(false);
  const prevItemCountRef = useRef(allItems.length);
  const prevAgentIdRef = useRef<string | null>(null);

  // Track if we need to scroll after agent switch
  const pendingScrollRef = useRef(false);

  // Grace period after agent switch - don't trigger user scroll detection during this time
  const agentSwitchGraceRef = useRef(false);

  const scrollToBottomSync = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    container.scrollTop = container.scrollHeight;
    return true;
  }, [scrollContainerRef]);

  const settleRafRef = useRef<number | null>(null);
  const settleUntilRef = useRef(0);

  const beginSettleToBottom = useCallback((durationMs: number) => {
    isProgrammaticScrollRef.current = true;
    agentSwitchGraceRef.current = true;
    const desiredUntil = performance.now() + durationMs;
    // Never shorten an in-progress settle window. This prevents a short "new output"
    // settle (e.g. 150ms) from canceling a longer agent-switch settle on large histories.
    settleUntilRef.current = Math.max(settleUntilRef.current, desiredUntil);

    const isAtBottom = (container: HTMLDivElement) => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight <= 2;
    };

    const tick = () => {
      const container = scrollContainerRef.current;
      if (!container) {
        settleRafRef.current = null;
        isProgrammaticScrollRef.current = false;
        agentSwitchGraceRef.current = false;
        return;
      }

      const now = performance.now();
      if (now >= settleUntilRef.current) {
        settleRafRef.current = null;
        isProgrammaticScrollRef.current = false;
        agentSwitchGraceRef.current = false;
        return;
      }

      // If content height changed due to measurement, keep pinned to bottom.
      if (!isAtBottom(container)) scrollToBottomSync();
      settleRafRef.current = requestAnimationFrame(tick);
    };

    // Kick immediately + then monitor for a short window.
    scrollToBottomSync();
    if (settleRafRef.current === null) {
      settleRafRef.current = requestAnimationFrame(tick);
    }
  }, [scrollContainerRef, scrollToBottomSync]);

  // Cleanup any pending settle loop on unmount
  useEffect(() => {
    return () => {
      if (settleRafRef.current !== null) {
        cancelAnimationFrame(settleRafRef.current);
      }
    };
  }, []);

  // If history fetch starts after agent selection (e.g., session establishment on mobile),
  // re-arm the pending scroll so we still scroll to bottom once loading completes.
  const prevIsLoadingHistoryRef = useRef<boolean | undefined>(isLoadingHistory);
  useEffect(() => {
    const wasLoading = prevIsLoadingHistoryRef.current;
    prevIsLoadingHistoryRef.current = isLoadingHistory;
    if (!wasLoading && isLoadingHistory) {
      pendingScrollRef.current = true;
      // Reset to 0 so the next item increase can trigger the auto-scroll effect
      prevItemCountRef.current = 0;
    }
  }, [isLoadingHistory]);

  // Reset item count tracking when agent changes (or on initial mount) to ensure scroll to bottom.
  // useLayoutEffect ensures the pending flag is set before the scroll layout effect runs.
  useLayoutEffect(() => {
    if (prevAgentIdRef.current !== agentId) {
      prevAgentIdRef.current = agentId;
      prevItemCountRef.current = 0;
      pendingScrollRef.current = true;
      agentSwitchGraceRef.current = true;
    }
  }, [agentId]);

  // Create virtualizer
  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => getEstimatedHeight(allItems[index]),
    overscan: 10, // Render 10 items above/below viewport
    measureElement: (element) => {
      // Measure actual rendered height for accurate positioning
      return element.getBoundingClientRect().height;
    },
  });

  // Agent-switch scroll: perform a single pre-paint scroll once loading is complete and we have items.
  // Keeping this deterministic avoids "jitter" from multiple delayed retry scrolls.
  useLayoutEffect(() => {
    if (!pendingScrollRef.current) return;
    if (isLoadingHistory) return;
    if (allItems.length === 0) return;

    // One pre-paint scroll + short settle window to handle virtualization measurement changes.
    // This avoids landing mid-list when row heights re-measure after render.
    scrollToBottomSync();
    pendingScrollRef.current = false;

    // Keep pinned longer on mobile: virtualization measurement + image loads can adjust heights
    // after the history fetch completes.
    beginSettleToBottom(1500);
  }, [agentId, allItems.length, isLoadingHistory, scrollToBottomSync, beginSettleToBottom]);

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (!shouldAutoScroll) return;
    if (allItems.length === 0) return;
    // Let the deterministic agent-switch handler own the initial post-load scroll.
    if (pendingScrollRef.current) {
      prevItemCountRef.current = allItems.length;
      return;
    }
    if (allItems.length <= prevItemCountRef.current) {
      prevItemCountRef.current = allItems.length;
      return;
    }

    prevItemCountRef.current = allItems.length;

    // Scroll to bottom with a small retry to handle initial measurement timing
    scrollToBottomSync();
    beginSettleToBottom(150);
  }, [allItems.length, shouldAutoScroll, scrollToBottomSync, beginSettleToBottom]);

  // Detect scroll to top for loading more history
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;

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
  }, [hasMore, isLoadingMore, onScrollTopReached, onUserScroll, scrollContainerRef]);

  // Attach scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll, scrollContainerRef]);

  // Scroll to selected message when navigating
  useEffect(() => {
    if (selectedMessageIndex !== null && selectedMessageIndex >= 0 && selectedMessageIndex < allItems.length) {
      isProgrammaticScrollRef.current = true;
      virtualizer.scrollToIndex(selectedMessageIndex, { align: 'center' });
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
    }
  }, [selectedMessageIndex, virtualizer, allItems.length]);

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
