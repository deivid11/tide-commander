/**
 * VirtualizedOutputList - Efficient virtualized rendering for terminal output
 *
 * Uses @tanstack/react-virtual for sliding window rendering.
 * Only renders visible items plus overscan buffer, reducing DOM nodes from 200+ to ~30.
 */

import React, { useRef, useEffect, useCallback, memo } from 'react';
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
}: VirtualizedOutputListProps) {
  // Combine history and live outputs into single array
  const allItems = [...historyMessages, ...liveOutputs];
  const historyCount = historyMessages.length;

  // Track if we're programmatically scrolling (to avoid triggering onUserScroll)
  const isProgrammaticScrollRef = useRef(false);
  const prevItemCountRef = useRef(allItems.length);
  const prevAgentIdRef = useRef(agentId);

  // Track if we need to scroll after agent switch
  const pendingScrollRef = useRef(false);

  // Reset item count tracking when agent changes to ensure scroll to bottom on switch
  useEffect(() => {
    if (prevAgentIdRef.current !== agentId) {
      prevAgentIdRef.current = agentId;
      // Reset to 0 so next render will trigger scroll to bottom
      prevItemCountRef.current = 0;
      // Mark that we need to scroll to bottom after content loads
      pendingScrollRef.current = true;
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

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (!shouldAutoScroll) return;
    if (allItems.length === 0) return;
    if (allItems.length <= prevItemCountRef.current) {
      prevItemCountRef.current = allItems.length;
      return;
    }

    prevItemCountRef.current = allItems.length;

    // Scroll to bottom with multiple attempts to handle virtualizer measurement timing
    isProgrammaticScrollRef.current = true;

    const scrollToEnd = () => {
      virtualizer.scrollToIndex(allItems.length - 1, { align: 'end' });
    };

    // Initial scroll
    requestAnimationFrame(() => {
      scrollToEnd();
      // Retry after virtualizer has measured elements (timing varies)
      setTimeout(scrollToEnd, 50);
      setTimeout(scrollToEnd, 150);
      setTimeout(scrollToEnd, 300);
      // Reset flag after all scroll attempts complete
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        pendingScrollRef.current = false;
      }, 350);
    });
  }, [allItems.length, shouldAutoScroll, virtualizer]);

  // Additional scroll attempts when agent changes and content becomes available
  // This catches cases where history loads after the initial effect runs
  useEffect(() => {
    if (!pendingScrollRef.current) return;
    if (!shouldAutoScroll) return;
    if (allItems.length === 0) return;

    // Schedule multiple scroll attempts with longer delays for agent switch
    isProgrammaticScrollRef.current = true;

    const scrollToEnd = () => {
      virtualizer.scrollToIndex(allItems.length - 1, { align: 'end' });
    };

    // Longer delays to ensure virtualizer has measured all items after agent switch
    const timeouts = [100, 250, 500, 750, 1000].map(delay =>
      setTimeout(scrollToEnd, delay)
    );

    const cleanupTimeout = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      pendingScrollRef.current = false;
    }, 1050);

    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(cleanupTimeout);
    };
  }, [agentId, allItems.length, shouldAutoScroll, virtualizer]);

  // Detect scroll to top for loading more history
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;

    // Check if user scrolled up (not at bottom)
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
    if (!isAtBottom && !isProgrammaticScrollRef.current && onUserScroll) {
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
