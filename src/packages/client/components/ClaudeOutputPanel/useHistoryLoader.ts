/**
 * useHistoryLoader - Hook for loading conversation history
 *
 * Handles initial history loading, pagination, and output deduplication.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { store, ClaudeOutput } from '../../store';
import { apiUrl, authFetch } from '../../utils/storage';
import type { HistoryMessage } from './types';
import { MESSAGES_PER_PAGE, SCROLL_THRESHOLD } from './types';

export interface UseHistoryLoaderProps {
  selectedAgentId: string | null;
  hasSessionId: boolean;
  reconnectCount: number;
  lastPrompts: Map<string, { text: string }>;
  /** External ref for the scroll container (from swipe hook) */
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseHistoryLoaderReturn {
  /** Conversation history messages */
  history: HistoryMessage[];
  /** Whether initial history is loading */
  loadingHistory: boolean;
  /** Whether more history is being loaded */
  loadingMore: boolean;
  /** Whether more history is available */
  hasMore: boolean;
  /** Total count of messages */
  totalCount: number;
  /** Ref to track mount state */
  isMountedRef: React.MutableRefObject<boolean>;
  /** Load more history (pagination) */
  loadMoreHistory: () => Promise<void>;
  /** Handle scroll to detect load more trigger */
  handleScroll: (keyboardScrollLockRef: React.MutableRefObject<boolean>) => void;
  /** Clear history (for context clear) */
  clearHistory: () => void;
}

export function useHistoryLoader({
  selectedAgentId,
  hasSessionId,
  reconnectCount,
  lastPrompts,
  outputScrollRef,
}: UseHistoryLoaderProps): UseHistoryLoaderReturn {
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const isMountedRef = useRef(true);

  // Track history length in a ref to avoid dependency issues in loadMoreHistory
  const historyLengthRef = useRef(0);

  // Track loading/hasMore state in refs for scroll handler (avoid stale closures)
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);

  // Track previous agent ID and sessionId to detect switches vs session establishment
  const prevAgentIdRef = useRef<string | null>(null);
  const prevHasSessionIdRef = useRef<boolean>(false);
  // Track if we've already loaded history for the current agent/session combo
  const loadedForRef = useRef<string | null>(null);
  // Deferred loading state timer - only show loading after a delay to avoid flash
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track mount state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load conversation history when agent changes or on reconnect
  useEffect(() => {
    if (!selectedAgentId || !hasSessionId) {
      setHistory([]);
      historyLengthRef.current = 0;
      setHasMore(false);
      hasMoreRef.current = false;
      setTotalCount(0);
      setLoadingHistory(false);
      prevHasSessionIdRef.current = false;
      loadedForRef.current = null;
      return;
    }

    // Create a unique key for this agent+reconnect combo
    const loadKey = `${selectedAgentId}:${reconnectCount}`;

    // Skip if we've already loaded for this exact combo
    if (loadedForRef.current === loadKey) {
      return;
    }

    // Detect if this is an agent switch or reconnect vs session establishment
    const isAgentSwitch = prevAgentIdRef.current !== null && prevAgentIdRef.current !== selectedAgentId;
    const isReconnect = reconnectCount > 0;
    const shouldClearOutputs = isAgentSwitch || isReconnect;

    // Detect if session was just established for the current agent
    const isSessionEstablishment = !isAgentSwitch && !prevHasSessionIdRef.current && hasSessionId;

    // Update refs AFTER checking
    prevAgentIdRef.current = selectedAgentId;
    prevHasSessionIdRef.current = hasSessionId;
    loadedForRef.current = loadKey;

    // Preserve outputs on reconnect
    let preservedOutputsSnapshot: ClaudeOutput[] | undefined;
    if (isReconnect) {
      const currentOutputs = store.getOutputs(selectedAgentId);
      if (currentOutputs.length > 0) {
        preservedOutputsSnapshot = currentOutputs.map(o => ({ ...o }));
      }
    }

    // Clear any pending loading timer
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }

    // Only show loading after a delay to avoid flash for quick loads
    if (!isSessionEstablishment) {
      loadingTimerRef.current = setTimeout(() => {
        setLoadingHistory(true);
      }, 150); // Only show loading if fetch takes longer than 150ms
    }

    authFetch(apiUrl(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=0`))
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => {
        const messages = data.messages || [];
        setHistory(messages);
        historyLengthRef.current = messages.length;
        const hasMoreValue = data.hasMore || false;
        setHasMore(hasMoreValue);
        hasMoreRef.current = hasMoreValue;
        setTotalCount(data.totalCount || 0);

        // Handle output deduplication - always dedupe to avoid showing same message twice
        if (preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0) {
          // Use preserved snapshot for reconnect scenarios
          const lastHistoryTimestamp = messages.length > 0
            ? Math.max(...messages.map((m: HistoryMessage) => m.timestamp ? new Date(m.timestamp).getTime() : 0))
            : 0;

          const newerOutputs = preservedOutputsSnapshot.filter(o => o.timestamp > lastHistoryTimestamp);

          store.clearOutputs(selectedAgentId);
          for (const output of newerOutputs) {
            store.addOutput(selectedAgentId, output);
          }
        } else if (messages.length > 0) {
          // Dedupe current outputs against loaded history
          const lastHistoryTimestamp = Math.max(
            ...messages.map((m: HistoryMessage) => m.timestamp ? new Date(m.timestamp).getTime() : 0)
          );

          const currentOutputs = store.getOutputs(selectedAgentId);
          const newerOutputs = currentOutputs.filter(o => o.timestamp > lastHistoryTimestamp);

          if (currentOutputs.length !== newerOutputs.length) {
            // Only clear/re-add if there are duplicates to remove
            store.clearOutputs(selectedAgentId);
            for (const output of newerOutputs) {
              store.addOutput(selectedAgentId, output);
            }
          }
        }

        // Set last prompt if not already set
        if (!lastPrompts.get(selectedAgentId)) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].type === 'user') {
              store.setLastPrompt(selectedAgentId, messages[i].content);
              break;
            }
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load history:', err);
        setHistory([]);
        historyLengthRef.current = 0;
        setHasMore(false);
        hasMoreRef.current = false;
        setTotalCount(0);
        // Restore preserved outputs on error
        if (shouldClearOutputs && preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0) {
          store.clearOutputs(selectedAgentId);
          for (const output of preservedOutputsSnapshot) {
            store.addOutput(selectedAgentId, output);
          }
        }
      })
      .finally(() => {
        // Clear loading timer if it hasn't fired yet
        if (loadingTimerRef.current) {
          clearTimeout(loadingTimerRef.current);
          loadingTimerRef.current = null;
        }
        setLoadingHistory(false);
      });
  // Note: lastPrompts intentionally excluded from deps - we only use it to set initial prompt, not to trigger reloads
  }, [selectedAgentId, hasSessionId, reconnectCount]);

  // Load more history when scrolling to top
  const loadMoreHistory = useCallback(async () => {
    // Use refs to avoid stale closure issues
    if (!selectedAgentId || loadingMoreRef.current || !hasMoreRef.current) return;

    const scrollContainer = outputScrollRef.current;
    if (!scrollContainer) {
      console.warn('loadMoreHistory: outputScrollRef not connected');
      return;
    }

    const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    // Use ref instead of state to avoid stale closure
    const currentOffset = historyLengthRef.current;

    try {
      const res = await authFetch(apiUrl(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=${currentOffset}`));
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        if (!isMountedRef.current) return;
        setHistory((prev) => {
          const newHistory = [...data.messages, ...prev];
          historyLengthRef.current = newHistory.length;
          return newHistory;
        });
        const hasMoreValue = data.hasMore || false;
        hasMoreRef.current = hasMoreValue;
        setHasMore(hasMoreValue);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!isMountedRef.current) return;
            if (outputScrollRef.current) {
              outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight - distanceFromBottom;
            }
            loadingMoreRef.current = false;
            setLoadingMore(false);
          });
        });
      } else {
        if (!isMountedRef.current) return;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    } catch (err) {
      console.error('Failed to load more history:', err);
      if (!isMountedRef.current) return;
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [selectedAgentId, outputScrollRef]);

  // Handle scroll to detect load more trigger
  const handleScroll = useCallback((keyboardScrollLockRef: React.MutableRefObject<boolean>) => {
    if (!outputScrollRef.current) return;
    if (keyboardScrollLockRef.current) return;

    const { scrollTop } = outputScrollRef.current;

    // Use refs to avoid stale closure issues
    if (!loadingMoreRef.current && hasMoreRef.current && scrollTop < SCROLL_THRESHOLD) {
      loadMoreHistory();
    }
  }, [loadMoreHistory, outputScrollRef]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    historyLengthRef.current = 0;
  }, []);

  return {
    history,
    loadingHistory,
    loadingMore,
    hasMore,
    totalCount,
    isMountedRef,
    loadMoreHistory,
    handleScroll,
    clearHistory,
  };
}
