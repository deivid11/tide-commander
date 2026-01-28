/**
 * useSearchHistory - Hook for searching conversation history
 *
 * Handles search state, API calls, and keyboard shortcuts.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { apiUrl, authFetch } from '../../utils/storage';
import type { HistoryMessage } from './types';

export interface UseSearchHistoryProps {
  selectedAgentId: string | null;
  isOpen: boolean;
}

export interface UseSearchHistoryReturn {
  /** Whether search mode is active */
  searchMode: boolean;
  /** Set search mode */
  setSearchMode: (mode: boolean) => void;
  /** Current search query */
  searchQuery: string;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Search results */
  searchResults: HistoryMessage[];
  /** Whether search is loading */
  searchLoading: boolean;
  /** Ref for search input */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  /** Execute search */
  handleSearch: () => Promise<void>;
  /** Toggle search mode */
  toggleSearch: () => void;
  /** Close search and clear results */
  closeSearch: () => void;
}

export function useSearchHistory({
  selectedAgentId,
  isOpen,
}: UseSearchHistoryProps): UseSearchHistoryReturn {
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HistoryMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Execute search
  const handleSearch = useCallback(async () => {
    if (!selectedAgentId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const res = await authFetch(apiUrl(`/api/agents/${selectedAgentId}/search?q=${encodeURIComponent(searchQuery)}&limit=100`));
      const data = await res.json();
      setSearchResults(data.matches || []);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [selectedAgentId, searchQuery]);

  // Focus search input when entering search mode
  useEffect(() => {
    if (searchMode && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchMode]);

  // Toggle search
  const toggleSearch = useCallback(() => {
    setSearchMode((prev) => {
      if (prev) {
        // Exiting search mode
        setSearchResults([]);
        setSearchQuery('');
      }
      return !prev;
    });
  }, []);

  // Close search
  const closeSearch = useCallback(() => {
    setSearchMode(false);
    setSearchResults([]);
    setSearchQuery('');
  }, []);

  // Ctrl+F shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isOpen) {
        e.preventDefault();
        toggleSearch();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggleSearch]);

  return {
    searchMode,
    setSearchMode,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    searchInputRef,
    handleSearch,
    toggleSearch,
    closeSearch,
  };
}
