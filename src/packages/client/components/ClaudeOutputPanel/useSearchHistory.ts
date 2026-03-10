/**
 * useSearchHistory - Hook for in-thread search navigation (WhatsApp-style)
 *
 * Searches client-side through loaded history + live outputs.
 * When search activates, loads ALL history pages so the full conversation is searchable.
 * Highlights all matches and navigates between them with prev/next.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { EnrichedHistoryMessage } from './types';
import type { ClaudeOutput } from '../../store';

export interface UseSearchHistoryProps {
  selectedAgentId: string | null;
  isOpen: boolean;
  /** Combined items: history messages + live outputs (in display order) */
  allItems: Array<EnrichedHistoryMessage | ClaudeOutput>;
  /** Current view mode (simple/chat/advanced) */
  viewMode: 'simple' | 'chat' | 'advanced';
  /** Whether there are more history pages to load */
  hasMoreHistory: boolean;
  /** Load all remaining history pages */
  loadAllHistory: () => Promise<void>;
  /** Whether history is currently loading */
  loadingMore: boolean;
}

export interface UseSearchHistoryReturn {
  /** Whether search mode is active */
  searchMode: boolean;
  /** Current search query */
  searchQuery: string;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Ref for search input */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  /** Toggle search mode */
  toggleSearch: () => void;
  /** Close search and clear results */
  closeSearch: () => void;
  /** The search query to highlight (only set when there are matches) */
  highlightQuery: string | undefined;
  /** Indices of items that contain matches */
  matchIndices: number[];
  /** Current active match (0-based index into matchIndices) */
  currentMatch: number;
  /** Navigate to next match */
  navigateNext: () => void;
  /** Navigate to previous match */
  navigatePrev: () => void;
  /** The item index to scroll to (or null) */
  scrollToIndex: number | null;
  /** Whether full history is still loading for search */
  loadingFullHistory: boolean;
}

/** Extract searchable text from an item */
function getItemText(item: EnrichedHistoryMessage | ClaudeOutput): string {
  if ('type' in item && 'content' in item) {
    // EnrichedHistoryMessage
    const msg = item as EnrichedHistoryMessage;
    let text = msg.content || '';
    if (msg._bashOutput) text += ' ' + msg._bashOutput;
    if (msg._bashCommand) text += ' ' + msg._bashCommand;
    if (msg.toolName) text += ' ' + msg.toolName;
    return text;
  }
  // ClaudeOutput (live)
  const output = item as ClaudeOutput;
  return output.text || '';
}

/** Check if a history message is visible in the current view mode */
function isItemVisibleInViewMode(
  item: EnrichedHistoryMessage | ClaudeOutput,
  viewMode: 'simple' | 'chat' | 'advanced'
): boolean {
  if (viewMode === 'advanced') return true;

  // Check history messages
  if ('type' in item && 'content' in item) {
    const msg = item as EnrichedHistoryMessage;

    // System command messages are always hidden
    const content = msg.content || '';
    if (msg.type === 'user' && (
      content.includes('<command-name>/cost</command-name>') ||
      content.includes('<command-name>/compact</command-name>')
    )) {
      return false;
    }

    // tool_result is hidden in simple/chat view (simpleView = viewMode !== 'advanced')
    if (msg.type === 'tool_result') return false;

    return true;
  }

  // Check live outputs (ClaudeOutput)
  const output = item as ClaudeOutput;
  if (viewMode === 'chat') {
    if (output.isUserPrompt) return true;
    const text = output.text || '';
    // In chat view, hide tool-related messages
    if (text.startsWith('Using tool:')) return false;
    if (text.startsWith('Tool result:')) return false;
    if (text.startsWith('Tool error:')) return false;
    return true;
  }

  // Simple view - show most things except tool results
  const text = output.text || '';
  if (text.startsWith('Tool result:')) return false;
  return true;
}

export function useSearchHistory({
  selectedAgentId,
  isOpen,
  allItems,
  viewMode,
  hasMoreHistory,
  loadAllHistory,
  loadingMore,
}: UseSearchHistoryProps): UseSearchHistoryReturn {
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);
  const [scrollToIndex, setScrollToIndex] = useState<number | null>(null);
  const [loadingFullHistory, setLoadingFullHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // When search mode activates and there's more history, load it all.
  // Uses a ref to avoid calling loadAllHistory multiple times.
  const loadAllTriggeredRef = useRef(false);

  useEffect(() => {
    if (!searchMode) {
      loadAllTriggeredRef.current = false;
      return;
    }
    if (!hasMoreHistory) {
      setLoadingFullHistory(false);
      return;
    }
    // Wait until any in-progress load finishes before triggering loadAll
    if (loadingMore) return;
    // Only trigger once per search session
    if (loadAllTriggeredRef.current) return;

    loadAllTriggeredRef.current = true;
    setLoadingFullHistory(true);
    loadAllHistory().finally(() => {
      setLoadingFullHistory(false);
    });
  }, [searchMode, hasMoreHistory, loadingMore, loadAllHistory]);

  // Find all matching item indices (client-side search)
  const matchIndices = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return [];
    const query = searchQuery.trim().toLowerCase();
    const indices: number[] = [];
    for (let i = 0; i < allItems.length; i++) {
      const text = getItemText(allItems[i]).toLowerCase();
      if (text.includes(query) && isItemVisibleInViewMode(allItems[i], viewMode)) {
        indices.push(i);
      }
    }
    return indices;
  }, [allItems, searchQuery, viewMode]);

  // Reset current match when matches change
  useEffect(() => {
    if (matchIndices.length > 0) {
      // Jump to the last match (most recent) when starting a new search
      const newIndex = matchIndices.length - 1;
      setCurrentMatch(newIndex);
      setScrollToIndex(matchIndices[newIndex]);
    } else {
      setCurrentMatch(0);
      setScrollToIndex(null);
    }
  }, [matchIndices]);

  // Focus search input when entering search mode
  useEffect(() => {
    if (searchMode && searchInputRef.current) {
      // Small delay to ensure the input is rendered
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [searchMode]);

  // Navigate to next match
  const navigateNext = useCallback(() => {
    if (matchIndices.length === 0) return;
    const next = (currentMatch + 1) % matchIndices.length;
    setCurrentMatch(next);
    setScrollToIndex(matchIndices[next]);
  }, [currentMatch, matchIndices]);

  // Navigate to previous match
  const navigatePrev = useCallback(() => {
    if (matchIndices.length === 0) return;
    const prev = (currentMatch - 1 + matchIndices.length) % matchIndices.length;
    setCurrentMatch(prev);
    setScrollToIndex(matchIndices[prev]);
  }, [currentMatch, matchIndices]);

  // Toggle search
  const toggleSearch = useCallback(() => {
    setSearchMode((prev) => {
      if (prev) {
        // Exiting search mode
        setSearchQuery('');
        setCurrentMatch(0);
        setScrollToIndex(null);
        setLoadingFullHistory(false);
      }
      return !prev;
    });
  }, []);

  // Close search
  const closeSearch = useCallback(() => {
    setSearchMode(false);
    setSearchQuery('');
    setCurrentMatch(0);
    setScrollToIndex(null);
    setLoadingFullHistory(false);
  }, []);

  // Reset when agent changes
  useEffect(() => {
    if (searchMode) {
      setSearchQuery('');
      setCurrentMatch(0);
      setScrollToIndex(null);
    }
  }, [selectedAgentId]);

  // Ctrl+F shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isOpen) {
        e.preventDefault();
        if (searchMode) {
          // If already in search mode, just focus the input
          searchInputRef.current?.focus();
        } else {
          setSearchMode(true);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, searchMode]);

  const highlightQuery = searchMode && searchQuery.trim().length >= 2 && matchIndices.length > 0
    ? searchQuery.trim()
    : undefined;

  return {
    searchMode,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    toggleSearch,
    closeSearch,
    highlightQuery,
    matchIndices,
    currentMatch,
    navigateNext,
    navigatePrev,
    scrollToIndex,
    loadingFullHistory,
  };
}
