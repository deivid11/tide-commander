/**
 * useHistoryLoader - Hook for loading conversation history
 *
 * Handles initial history loading, pagination, and output deduplication.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { store, ClaudeOutput } from '../../store';
import { apiUrl } from '../../utils/storage';
import type { HistoryMessage } from './types';
import { MESSAGES_PER_PAGE, SCROLL_THRESHOLD } from './types';

export interface UseHistoryLoaderProps {
  selectedAgentId: string | null;
  hasSessionId: boolean;
  reconnectCount: number;
  lastPrompts: Map<string, { text: string }>;
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
  /** Ref for the output scroll container */
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
}

export function useHistoryLoader({
  selectedAgentId,
  hasSessionId,
  reconnectCount,
  lastPrompts,
}: UseHistoryLoaderProps): UseHistoryLoaderReturn {
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const isMountedRef = useRef(true);
  const outputScrollRef = useRef<HTMLDivElement>(null);

  // Track previous agent ID and sessionId to detect switches vs session establishment
  const prevAgentIdRef = useRef<string | null>(null);
  const prevHasSessionIdRef = useRef<boolean>(false);

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
      setHasMore(false);
      setTotalCount(0);
      setLoadingHistory(false);
      prevHasSessionIdRef.current = false;
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

    // Preserve outputs on reconnect
    let preservedOutputsSnapshot: ClaudeOutput[] | undefined;
    if (isReconnect) {
      const currentOutputs = store.getOutputs(selectedAgentId);
      if (currentOutputs.length > 0) {
        preservedOutputsSnapshot = currentOutputs.map(o => ({ ...o }));
      }
    }

    // Only show loading on agent switch or reconnect
    if (!isSessionEstablishment) {
      setLoadingHistory(true);
    }

    fetch(apiUrl(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=0`))
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => {
        const messages = data.messages || [];
        setHistory(messages);
        setHasMore(data.hasMore || false);
        setTotalCount(data.totalCount || 0);

        // Handle output deduplication
        if (shouldClearOutputs) {
          if (preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0) {
            const lastHistoryTimestamp = messages.length > 0
              ? Math.max(...messages.map((m: HistoryMessage) => m.timestamp ? new Date(m.timestamp).getTime() : 0))
              : 0;

            const newerOutputs = preservedOutputsSnapshot.filter(o => o.timestamp > lastHistoryTimestamp);

            store.clearOutputs(selectedAgentId);
            for (const output of newerOutputs) {
              store.addOutput(selectedAgentId, output);
            }
          } else if (messages.length > 0) {
            const lastHistoryTimestamp = Math.max(
              ...messages.map((m: HistoryMessage) => m.timestamp ? new Date(m.timestamp).getTime() : 0)
            );

            const currentOutputs = store.getOutputs(selectedAgentId);
            const newerOutputs = currentOutputs.filter(o => o.timestamp > lastHistoryTimestamp);

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
        setHasMore(false);
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
        setLoadingHistory(false);
      });
  }, [selectedAgentId, hasSessionId, reconnectCount, lastPrompts]);

  // Load more history when scrolling to top
  const loadMoreHistory = useCallback(async () => {
    if (!selectedAgentId || loadingMore || !hasMore) return;

    const scrollContainer = outputScrollRef.current;
    if (!scrollContainer) return;

    const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop;

    setLoadingMore(true);
    const currentOffset = history.length;

    try {
      const res = await fetch(apiUrl(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=${currentOffset}`));
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        if (!isMountedRef.current) return;
        setHistory((prev) => [...data.messages, ...prev]);
        setHasMore(data.hasMore || false);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!isMountedRef.current) return;
            if (outputScrollRef.current) {
              outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight - distanceFromBottom;
            }
            setLoadingMore(false);
          });
        });
      } else {
        if (!isMountedRef.current) return;
        setLoadingMore(false);
      }
    } catch (err) {
      console.error('Failed to load more history:', err);
      if (!isMountedRef.current) return;
      setLoadingMore(false);
    }
  }, [selectedAgentId, loadingMore, hasMore, history.length]);

  // Handle scroll to detect load more trigger
  const handleScroll = useCallback((keyboardScrollLockRef: React.MutableRefObject<boolean>) => {
    if (!outputScrollRef.current) return;
    if (keyboardScrollLockRef.current) return;

    const { scrollTop } = outputScrollRef.current;

    if (!loadingMore && hasMore && scrollTop < SCROLL_THRESHOLD) {
      loadMoreHistory();
    }
  }, [loadMoreHistory, loadingMore, hasMore]);

  const clearHistory = useCallback(() => {
    setHistory([]);
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
    outputScrollRef,
  };
}
