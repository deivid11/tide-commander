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
  const prevAgentIdRef = useRef(agentId);

  // Track if we need to scroll after agent switch
  const pendingScrollRef = useRef(false);

  // Grace period after agent switch - don't trigger user scroll detection during this time
  const agentSwitchGraceRef = useRef(false);

  // Reset item count tracking when agent changes to ensure scroll to bottom on switch
  useEffect(() => {
    if (prevAgentIdRef.current !== agentId) {
      prevAgentIdRef.current = agentId;
      // Reset to 0 so next render will trigger scroll to bottom
      prevItemCountRef.current = 0;
      // Mark that we need to scroll to bottom after content loads
      pendingScrollRef.current = true;
      // Start grace period - don't detect user scroll for a while after agent switch
      agentSwitchGraceRef.current = true;

      // End grace period after history has had time to load
      setTimeout(() => {
        agentSwitchGraceRef.current = false;
      }, 3000);
    }
  }, [agentId]);

  // CRITICAL: useLayoutEffect runs SYNCHRONOUSLY before browser paint
  // This ensures scroll happens immediately when content arrives, before user sees it at top
  useLayoutEffect(() => {
    // Always scroll to bottom when we have pending scroll and content
    // Note: We check pendingScrollRef ONLY, not shouldAutoScroll, because shouldAutoScroll
    // might have been incorrectly set to false by scroll events during agent switch
    if (pendingScrollRef.current && allItems.length > 0) {
      const container = scrollContainerRef.current;
      if (container && container.scrollHeight > container.clientHeight) {
        // Force scroll to bottom synchronously before paint
        container.scrollTop = container.scrollHeight;
        isProgrammaticScrollRef.current = true;
      }
    }
  }); // Run on every render when pending

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

    // Direct scroll for immediate effect
    const forceScrollToBottom = () => {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    };

    // Scroll immediately
    scrollToEnd();
    forceScrollToBottom();

    // And with retries
    requestAnimationFrame(() => {
      scrollToEnd();
      forceScrollToBottom();
      setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 50);
      setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 150);
      setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 300);
      // Reset flag after all scroll attempts complete
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        pendingScrollRef.current = false;
      }, 350);
    });
  }, [allItems.length, shouldAutoScroll, virtualizer, scrollContainerRef]);

  // Additional scroll attempts when agent changes and content becomes available
  // This catches cases where history loads after the initial effect runs
  useEffect(() => {
    if (!pendingScrollRef.current) return;
    // Note: Don't check shouldAutoScroll here - pendingScrollRef takes precedence
    // because shouldAutoScroll might be incorrectly false due to scroll events during agent switch
    if (allItems.length === 0) return;

    // Schedule multiple scroll attempts with longer delays for agent switch
    // History can take several seconds to load for long conversations
    isProgrammaticScrollRef.current = true;

    const scrollToEnd = () => {
      if (allItems.length > 0) {
        virtualizer.scrollToIndex(allItems.length - 1, { align: 'end' });
      }
    };

    // Also force scroll the container directly
    const forceScrollToBottom = () => {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    };

    // Extended delays to handle slow-loading conversations (up to 5 seconds)
    const timeouts = [50, 100, 200, 400, 600, 1000, 1500, 2000, 2500, 3000, 4000, 5000].map(delay =>
      setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, delay)
    );

    const cleanupTimeout = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      pendingScrollRef.current = false;
      agentSwitchGraceRef.current = false;
    }, 5100);

    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(cleanupTimeout);
    };
  }, [agentId, allItems.length, virtualizer, scrollContainerRef]);

  // Watch specifically for history messages loading (this is the slow part)
  // When history count changes after agent switch, scroll to bottom IMMEDIATELY
  const prevHistoryCountRef = useRef(historyCount);
  useEffect(() => {
    // Only trigger if history count increased AND we have a pending scroll
    // Note: Don't check shouldAutoScroll - pendingScrollRef takes precedence
    if (historyCount > prevHistoryCountRef.current && pendingScrollRef.current) {
      isProgrammaticScrollRef.current = true;

      const scrollToEnd = () => {
        if (allItems.length > 0) {
          virtualizer.scrollToIndex(allItems.length - 1, { align: 'end' });
        }
      };

      // Also force scroll the container directly for immediate effect
      const forceScrollToBottom = () => {
        const container = scrollContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      };

      // Scroll immediately using both methods
      scrollToEnd();
      forceScrollToBottom();

      // And with delays after history loads for any late measurements
      requestAnimationFrame(() => {
        scrollToEnd();
        forceScrollToBottom();
        setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 50);
        setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 100);
        setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 200);
        setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 400);
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 500);
      });
    }
    prevHistoryCountRef.current = historyCount;
  }, [historyCount, allItems.length, virtualizer, scrollContainerRef]);

  // Watch for history loading to complete - this is the definitive trigger
  // When isLoadingHistory transitions from true to false, scroll to bottom
  const prevLoadingRef = useRef(isLoadingHistory);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    const isLoading = isLoadingHistory;
    prevLoadingRef.current = isLoading;

    // Trigger scroll when loading completes AND we have content AND pending scroll
    // Note: Don't check shouldAutoScroll - pendingScrollRef takes precedence
    if (wasLoading && !isLoading && allItems.length > 0 && pendingScrollRef.current) {
      isProgrammaticScrollRef.current = true;

      const scrollToEnd = () => {
        if (allItems.length > 0) {
          virtualizer.scrollToIndex(allItems.length - 1, { align: 'end' });
        }
      };

      // Also force scroll the container directly for immediate effect
      const forceScrollToBottom = () => {
        const container = scrollContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      };

      // Scroll immediately using both methods
      scrollToEnd();
      forceScrollToBottom();

      // Multiple scroll attempts after loading completes
      requestAnimationFrame(() => {
        scrollToEnd();
        forceScrollToBottom();
        setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 50);
        setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 150);
        setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 300);
        setTimeout(() => { scrollToEnd(); forceScrollToBottom(); }, 500);
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
          pendingScrollRef.current = false;
          agentSwitchGraceRef.current = false;
        }, 600);
      });
    }
  }, [isLoadingHistory, allItems.length, virtualizer, scrollContainerRef]);

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
