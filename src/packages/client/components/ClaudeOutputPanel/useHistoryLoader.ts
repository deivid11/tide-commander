/**
 * useHistoryLoader - Hook for loading conversation history
 *
 * Handles initial history loading, pagination, and output deduplication.
 */

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { store, ClaudeOutput } from '../../store';
import { apiUrl, authFetch } from '../../utils/storage';
import type { HistoryMessage } from './types';
import { MESSAGES_PER_PAGE, SCROLL_THRESHOLD } from './types';
import { dedupeOutputsAgainstHistory, mergeOlderHistoryPage } from './historyDedup';

// Maximum number of agents to keep cached history for (LRU eviction).
// A cached agent switches instantly (pin + reveal run on the cached page while
// the refetch happens in the background); an uncached one waits for the fetch.
const HISTORY_CACHE_MAX_AGENTS = 24;
const HISTORY_FETCH_TIMEOUT_MS = 12_000;

// Per-agent history cache for instant display on revisit (LRU: most recent access last)
const historyCache = new Map<string, {
  messages: HistoryMessage[];
  hasMore: boolean;
  totalCount: number;
}>();

/** Touch an entry to mark it as most recently used (move to end of Map iteration order). */
function historyCacheTouch(agentId: string): void {
  const entry = historyCache.get(agentId);
  if (entry) {
    historyCache.delete(agentId);
    historyCache.set(agentId, entry);
  }
}

/** Evict oldest entries when cache exceeds max size. */
function historyCacheEvict(): void {
  while (historyCache.size > HISTORY_CACHE_MAX_AGENTS) {
    const oldestKey = historyCache.keys().next().value;
    if (oldestKey !== undefined) {
      historyCache.delete(oldestKey);
    } else {
      break;
    }
  }
}

/**
 * Remove a specific agent's cached history (call when agent is removed/killed).
 */
export function evictHistoryCache(agentId: string): void {
  historyCache.delete(agentId);
}

// Hovering across the miniature dock can touch many chips in a second. Keep
// speculative history traffic below the browser's per-origin connection limit
// so real selection requests always have a free socket.
const MAX_CONCURRENT_HISTORY_PREFETCHES = 2;
const prefetchInFlight = new Set<string>();
const prefetchQueue: string[] = [];
let activeHistoryPrefetches = 0;

function drainHistoryPrefetchQueue(): void {
  while (activeHistoryPrefetches < MAX_CONCURRENT_HISTORY_PREFETCHES && prefetchQueue.length > 0) {
    const agentId = prefetchQueue.shift();
    if (!agentId) return;
    if (historyCache.has(agentId)) {
      prefetchInFlight.delete(agentId);
      continue;
    }

    activeHistoryPrefetches += 1;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), HISTORY_FETCH_TIMEOUT_MS);
    authFetch(
      apiUrl(`/api/agents/${agentId}/history?limit=${MESSAGES_PER_PAGE}&offset=0`),
      { signal: controller.signal },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.messages) || data.messages.length === 0) return;
        if (historyCache.has(agentId)) return;
        historyCache.set(agentId, {
          messages: data.messages,
          hasMore: data.hasMore || false,
          totalCount: data.totalCount || 0,
        });
        historyCacheEvict();
        const subagents = Array.isArray(data.subagents) ? data.subagents : [];
        if (subagents.length > 0) store.hydrateSubagentsFromHistory(agentId, subagents);
      })
      .catch(() => { /* best-effort; the real load retries */ })
      .finally(() => {
        window.clearTimeout(timeout);
        activeHistoryPrefetches -= 1;
        prefetchInFlight.delete(agentId);
        drainHistoryPrefetchQueue();
      });
  }
}

/** Warm history before selection without competing with foreground loads. */
export function prefetchAgentHistory(agentId: string): void {
  if (!agentId || historyCache.has(agentId) || prefetchInFlight.has(agentId)) return;
  prefetchInFlight.add(agentId);
  prefetchQueue.push(agentId);
  drainHistoryPrefetchQueue();
}


export interface UseHistoryLoaderProps {
  selectedAgentId: string | null;
  hasSessionId: boolean;
  reconnectCount: number;
  /** Increments when an agent's session file updates or agent transitions to idle */
  historyRefreshTrigger: number;
  lastPrompts: Map<string, { text: string }>;
  /** External ref for the scroll container (from swipe hook) */
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseHistoryLoaderReturn {
  /** Conversation history messages */
  history: HistoryMessage[];
  /** Whether initial history is loading */
  loadingHistory: boolean;
  /**
   * Whether a history fetch is currently in-flight.
   * This is set immediately (unlike `loadingHistory`, which is delayed to avoid UI flashes).
   * Use this for logic that must run strictly after history finishes loading (e.g., scroll-to-bottom).
   */
  fetchingHistory: boolean;
  /** Monotonic counter incremented when a history load completes (success or failure). */
  historyLoadVersion: number;
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
  /** Check if an agent has cached history (for instant display on revisit) */
  hasCachedHistory: (agentId: string) => boolean;
  /** Load ALL remaining history pages (for search) */
  loadAllHistory: () => Promise<void>;
  /** Whether all history has been loaded (no more pages) */
  allLoaded: boolean;
}

export function useHistoryLoader({
  selectedAgentId,
  hasSessionId,
  reconnectCount,
  historyRefreshTrigger,
  lastPrompts,
  outputScrollRef,
}: UseHistoryLoaderProps): UseHistoryLoaderReturn {
  // Hydrate synchronously from the cache: a keyed pane remounts on every agent
  // switch, and seeding state in the initializers means the FIRST paint of the
  // new pane already shows the conversation — no empty commit, no wait for the
  // load effect. The effect below still runs and refreshes from the network.
  const mountCached = selectedAgentId && hasSessionId ? historyCache.get(selectedAgentId) : undefined;
  const [history, setHistory] = useState<HistoryMessage[]>(() => mountCached?.messages ?? []);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // A cold keyed pane is guaranteed to start a fetch in the mount effect.
  // Mark it pending in the first render so consumers never briefly reveal the
  // live tail before the persisted history page arrives.
  const [fetchingHistory, setFetchingHistory] = useState(() => !!selectedAgentId && hasSessionId && !mountCached);
  const [historyLoadVersion, setHistoryLoadVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => mountCached?.hasMore ?? false);
  const [totalCount, setTotalCount] = useState(() => mountCached?.totalCount ?? 0);
  const isMountedRef = useRef(true);

  // Token to ignore out-of-order fetch completions when switching agents quickly
  const fetchSeqRef = useRef(0);

  // Track history length in a ref to avoid dependency issues in loadMoreHistory
  const historyLengthRef = useRef(mountCached?.messages.length ?? 0);

  // Server offset for the NEXT older page. Advances by each fetched page size
  // (NOT the deduped length) so pagination can't stall when the server's
  // offset-from-end drifts and a whole page overlaps what we already have.
  const paginationOffsetRef = useRef(mountCached?.messages.length ?? 0);

  // Track loading/hasMore state in refs for scroll handler (avoid stale closures)
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(mountCached?.hasMore ?? false);

  // Distance-from-bottom to restore after an older page is prepended; consumed
  // pre-paint by the layout effect below.
  const pendingScrollRestoreRef = useRef<number | null>(null);

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

  // Load conversation history when agent changes, on reconnect, or when session file updates
  useEffect(() => {
    if (!selectedAgentId || !hasSessionId) {
      setHistory([]);
      historyLengthRef.current = 0;
      paginationOffsetRef.current = 0;
      setHasMore(false);
      hasMoreRef.current = false;
      setTotalCount(0);
      setLoadingHistory(false);
      setFetchingHistory(false);
      // Invalidate any in-flight pagination (loadMoreHistory) so a late
      // older-page fetch can't prepend onto the now-cleared history.
      fetchSeqRef.current += 1;
      // Treat clearing as a completed "load" for downstream effects
      setHistoryLoadVersion((v) => v + 1);
      prevHasSessionIdRef.current = false;
      loadedForRef.current = null;
      return;
    }

    // Create a unique key for this agent+reconnect+refresh combo
    const loadKey = `${selectedAgentId}:${reconnectCount}:${historyRefreshTrigger}`;

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
    let showedCachedHistory = false;
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

    // Invalidate cache on reconnect so we fetch fresh data
    if (isReconnect) {
      historyCache.delete(selectedAgentId);
    }

    // Mark fetch as in-flight immediately (used for logic like scroll-to-bottom)
    fetchSeqRef.current += 1;
    const fetchSeq = fetchSeqRef.current;
    setFetchingHistory(true);

    // On reconnect, keep current history on screen to avoid flicker.
    // Fresh data will replace it once the fetch completes.
    if (!isReconnect) {
      // If we have cached history for this agent, show it immediately
      // instead of blanking the screen while waiting for the network fetch.
      const cached = historyCache.get(selectedAgentId);
      if (cached) {
        showedCachedHistory = true;
        historyCacheTouch(selectedAgentId);
        setHistory(cached.messages);
        historyLengthRef.current = cached.messages.length;
        paginationOffsetRef.current = cached.messages.length;
        setHasMore(cached.hasMore);
        hasMoreRef.current = cached.hasMore;
        setTotalCount(cached.totalCount);
      } else {
        // Clear existing history immediately on any new load to avoid briefly showing
        // the previous agent's conversation (which can also cause scroll glitches).
        setHistory([]);
        historyLengthRef.current = 0;
        paginationOffsetRef.current = 0;
        setHasMore(false);
        hasMoreRef.current = false;
        setTotalCount(0);
      }
    }

    // Only show loading after a delay to avoid flash for quick loads
    // On reconnect, skip the loading indicator entirely to avoid UI disruption
    if (!isSessionEstablishment && !isReconnect) {
      loadingTimerRef.current = setTimeout(() => {
        setLoadingHistory(true);
      }, 80); // Only show loading if fetch takes longer than this; until then the pane is blank
    }

    // A keyed pane unmounts on every agent switch. Abort its history request
    // immediately so rapid switches cannot leave enough 2–3 second requests
    // alive to exhaust the browser's per-origin connection pool. A hard reload
    // used to appear to "fix" the frozen UI only because it aborted that queue.
    const abortController = new AbortController();
    let fetchTimedOut = false;
    const fetchTimeout = window.setTimeout(() => {
      fetchTimedOut = true;
      abortController.abort();
    }, HISTORY_FETCH_TIMEOUT_MS);

    authFetch(
      apiUrl(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=0`),
      { signal: abortController.signal },
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => {
        // Ignore stale completions if a newer fetch has started (rapid agent switching)
        if (fetchSeq !== fetchSeqRef.current) return;

        const messages: HistoryMessage[] = Array.isArray(data.messages) ? data.messages : [];
        const subagents = Array.isArray(data.subagents) ? data.subagents : [];
        setHistory(messages);
        historyLengthRef.current = messages.length;
        // Next older page starts just before the messages we just loaded.
        paginationOffsetRef.current = messages.length;
        const hasMoreValue = data.hasMore || false;
        setHasMore(hasMoreValue);
        hasMoreRef.current = hasMoreValue;
        setTotalCount(data.totalCount || 0);

        if (subagents.length > 0) {
          store.hydrateSubagentsFromHistory(selectedAgentId, subagents);
        }

        // Cache for instant display on revisit (LRU-evicted)
        historyCache.set(selectedAgentId, {
          messages,
          hasMore: hasMoreValue,
          totalCount: data.totalCount || 0,
        });
        historyCacheEvict();

        // Handle output deduplication — always dedupe against the LIVE store
        // (current outputs), never against the pre-fetch snapshot. The snapshot
        // is captured at effect-fire time, before authFetch; any output that
        // arrives via WS during the in-flight window (the optimistic prompt
        // from `command_started`, an assistant chunk, a tool event) is in the
        // live store at .then() time but NOT in the snapshot, and filtering
        // the snapshot would silently delete it on clearOutputs+re-add. The
        // snapshot is only used in the catch() block below for error recovery.
        if (messages.length > 0 || (preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0)) {
          const dedupResult = dedupeOutputsAgainstHistory(
            store.getOutputs(selectedAgentId),
            messages,
          );
          if (dedupResult.changed) {
            store.clearOutputs(selectedAgentId);
            for (const output of dedupResult.kept) {
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
        const wasAborted = err instanceof Error && err.name === 'AbortError';
        // Effect cleanup means another agent/fetch owns the pane now. Do not
        // clear state or log a false failure for that expected cancellation.
        if (wasAborted && !fetchTimedOut) return;
        if (fetchTimedOut) console.warn('History request timed out:', selectedAgentId);
        else console.error('Failed to load history:', err);
        // A failed background refresh must not erase the cached conversation
        // that was already painted successfully.
        if (!showedCachedHistory) {
          setHistory([]);
          historyLengthRef.current = 0;
          paginationOffsetRef.current = 0;
          setHasMore(false);
          hasMoreRef.current = false;
          setTotalCount(0);
        }
        // Restore preserved outputs on error
        if (shouldClearOutputs && preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0) {
          store.clearOutputs(selectedAgentId);
          for (const output of preservedOutputsSnapshot) {
            store.addOutput(selectedAgentId, output);
          }
        }
      })
      .finally(() => {
        window.clearTimeout(fetchTimeout);
        if (!isMountedRef.current) return;
        // Ignore out-of-order completions if a newer fetch started
        if (fetchSeq !== fetchSeqRef.current) return;

        // Clear loading timer if it hasn't fired yet
        if (loadingTimerRef.current) {
          clearTimeout(loadingTimerRef.current);
          loadingTimerRef.current = null;
        }
        setLoadingHistory(false);
        setFetchingHistory(false);
        setHistoryLoadVersion((v) => v + 1);
      });

    return () => {
      window.clearTimeout(fetchTimeout);
      abortController.abort();
      // React StrictMode replays effects with the same dependencies. Release
      // this effect's guards so the replay starts a fresh request instead of
      // inheriting an aborted loadKey and remaining empty.
      if (loadedForRef.current === loadKey) loadedForRef.current = null;
      if (fetchSeqRef.current === fetchSeq) fetchSeqRef.current += 1;
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  // Note: lastPrompts intentionally excluded from deps - we only use it to set initial prompt, not to trigger reloads
  }, [selectedAgentId, hasSessionId, reconnectCount, historyRefreshTrigger]);

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
    // Server offset for the next older page. Advancing-offset (not history
    // length) so we keep marching toward older messages even if a page is fully
    // deduped/dropped due to the server's offset-from-end drifting.
    const currentOffset = paginationOffsetRef.current;
    // Snapshot the fetch token so a concurrent agent switch / history refresh
    // (both bump fetchSeqRef) invalidates this in-flight older-page load and
    // prevents prepending a stale page onto a different agent's history.
    const startFetchSeq = fetchSeqRef.current;

    try {
      const res = await authFetch(apiUrl(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=${currentOffset}`));
      const data = await res.json();

      // Drop stale completions: the agent switched or history reloaded while
      // this page was in flight, so prepending it would interleave messages
      // from a different snapshot.
      if (!isMountedRef.current) {
        loadingMoreRef.current = false;
        return;
      }
      if (startFetchSeq !== fetchSeqRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
        return;
      }

      const subagents = Array.isArray(data.subagents) ? data.subagents : [];
      if (subagents.length > 0) {
        store.hydrateSubagentsFromHistory(selectedAgentId, subagents);
      }

      if (data.messages && data.messages.length > 0) {
        // Advance by the fetched page size (raw, before dedup) so the offset
        // always progresses toward older messages and never re-fetches the same
        // window forever when a page is dropped by the dedupe/timestamp guards.
        paginationOffsetRef.current = currentOffset + data.messages.length;
        // The scroll restore runs pre-paint in the layout effect below, in the
        // same commit that prepends the page. A rAF-deferred restore painted
        // 1-2 frames at the shifted position first — a visible jump every time
        // an older page auto-loaded while scrolling up.
        pendingScrollRestoreRef.current = distanceFromBottom;
        setHistory((prev) => {
          // Dedupe overlapping pages (offset drift) so older messages stay
          // above current ones in order, with no duplicates or interleaving.
          const newHistory = mergeOlderHistoryPage(data.messages, prev);
          historyLengthRef.current = newHistory.length;
          return newHistory;
        });
        const hasMoreValue = data.hasMore || false;
        hasMoreRef.current = hasMoreValue;
        setHasMore(hasMoreValue);
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

  // Pre-paint scroll restore for prepended pages: runs in the same commit that
  // inserted the older messages (child DOM already updated, browser not yet
  // painted), so the viewport never shows the shifted position.
  useLayoutEffect(() => {
    if (pendingScrollRestoreRef.current === null) return;
    const distanceFromBottom = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;

    const container = outputScrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight - distanceFromBottom;
      // Sync the virtualizer's internal offset in the SAME frame. A
      // programmatic scrollTop change fires its scroll event asynchronously
      // (1-2 frames later on mobile); until then the virtualizer still thinks
      // it sits near the top, so it renders the wrong row window (flicker)
      // AND skips its built-in scroll correction for the just-prepended rows
      // measuring taller than their estimates — item.start < scrollOffset is
      // evaluated against the stale offset — which pulled the view back as
      // the real heights landed. The synchronous dispatch makes the
      // virtualizer re-read scrollTop before paint.
      container.dispatchEvent(new Event('scroll'));
    }
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [history, outputScrollRef]);

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
    paginationOffsetRef.current = 0;
    if (selectedAgentId) historyCache.delete(selectedAgentId);
  }, [selectedAgentId]);

  // Load ALL history in a single request (used for search to cover full conversation)
  const loadAllHistoryRef = useRef(false);
  const loadAllHistory = useCallback(async () => {
    if (!selectedAgentId || !hasMoreRef.current) return;
    if (loadingMoreRef.current || loadAllHistoryRef.current) return;

    loadAllHistoryRef.current = true;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      // Fetch entire history in one request (limit=100000 to get everything)
      const res = await authFetch(apiUrl(`/api/agents/${selectedAgentId}/history?limit=100000&offset=0`));
      const data = await res.json();

      if (!isMountedRef.current) return;

      const subagents = Array.isArray(data.subagents) ? data.subagents : [];
      if (subagents.length > 0) {
        store.hydrateSubagentsFromHistory(selectedAgentId, subagents);
      }

      if (data.messages && data.messages.length > 0) {
        setHistory(data.messages);
        historyLengthRef.current = data.messages.length;
        paginationOffsetRef.current = data.messages.length;
      }

      hasMoreRef.current = false;
      setHasMore(false);
      setTotalCount(data.totalCount || data.messages?.length || 0);

      // Update cache with full history
      historyCache.set(selectedAgentId, {
        messages: data.messages || [],
        hasMore: false,
        totalCount: data.totalCount || data.messages?.length || 0,
      });
    } catch (err) {
      console.error('Failed to load all history:', err);
    } finally {
      if (isMountedRef.current) {
        loadingMoreRef.current = false;
        loadAllHistoryRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [selectedAgentId]);

  return {
    history,
    loadingHistory,
    fetchingHistory,
    historyLoadVersion,
    loadingMore,
    hasMore,
    totalCount,
    isMountedRef,
    loadMoreHistory,
    loadAllHistory,
    allLoaded: !hasMore,
    handleScroll,
    clearHistory,
    hasCachedHistory: useCallback((agentId: string) => historyCache.has(agentId), []),
  };
}
