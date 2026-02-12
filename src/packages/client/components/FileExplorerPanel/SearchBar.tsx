/**
 * SearchBar - Floating search input for less-style file viewer search
 *
 * Appears at the bottom of the file viewer when search is activated (/ key)
 * Shows match count and provides navigation controls (n/N or arrow buttons)
 */

import React, { useEffect, useRef, useCallback } from 'react';

export interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  currentIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  query,
  onQueryChange,
  matchCount,
  currentIndex,
  onNext,
  onPrev,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle keyboard events in search bar
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Stop propagation to prevent less-style navigation while searching
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // Enter moves to next match
        onNext();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onPrev();
      }
    },
    [onNext, onPrev, onClose]
  );

  // Display match counter
  const matchText =
    matchCount === 0 && query ? 'No matches' : matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : '';

  return (
    <div className="file-viewer-search-bar">
      <div className="file-viewer-search-input-wrapper">
        <span className="file-viewer-search-prefix">/</span>
        <input
          ref={inputRef}
          type="text"
          className="file-viewer-search-input"
          placeholder="Search in file..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck="false"
        />
      </div>

      {query && (
        <>
          <div className="file-viewer-search-counter">{matchText}</div>

          <div className="file-viewer-search-nav">
            <button
              className="file-viewer-search-btn file-viewer-search-prev"
              onClick={onPrev}
              disabled={matchCount === 0}
              title="Previous match (Shift+N or ↑)"
              aria-label="Previous match"
            >
              ↑
            </button>
            <button
              className="file-viewer-search-btn file-viewer-search-next"
              onClick={onNext}
              disabled={matchCount === 0}
              title="Next match (N or ↓)"
              aria-label="Next match"
            >
              ↓
            </button>
          </div>
        </>
      )}

      <button
        className="file-viewer-search-close"
        onClick={onClose}
        title="Close search (Escape)"
        aria-label="Close search"
      >
        ✕
      </button>
    </div>
  );
};

SearchBar.displayName = 'SearchBar';
