/**
 * SearchBar - Floating search input for less-style file viewer search
 *
 * Appears at the bottom of the file viewer when search is activated (/ key)
 * Shows match count and provides navigation controls (n/N or arrow buttons)
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation(['terminal']);
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

      // Let the hook handle Escape (so it properly prevents modal close)
      // Only handle other navigation keys here
      if (e.key === 'Enter') {
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
    [onNext, onPrev]
  );

  // Display match counter
  const matchText =
    matchCount === 0 && query ? t('terminal:fileExplorer.noMatches') : matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : '';

  return (
    <div className="file-viewer-search-bar">
      <div className="file-viewer-search-input-wrapper">
        <span className="file-viewer-search-prefix">/</span>
        <input
          ref={inputRef}
          type="text"
          className="file-viewer-search-input"
          placeholder={t('terminal:fileExplorer.searchInFile')}
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
              title={t('terminal:fileExplorer.previousMatch')}
              aria-label={t('terminal:fileExplorer.previousMatch')}
            >
              ↑
            </button>
            <button
              className="file-viewer-search-btn file-viewer-search-next"
              onClick={onNext}
              disabled={matchCount === 0}
              title={t('terminal:fileExplorer.nextMatch')}
              aria-label={t('terminal:fileExplorer.nextMatch')}
            >
              ↓
            </button>
          </div>
        </>
      )}

      <button
        className="file-viewer-search-close"
        onClick={onClose}
        title={t('terminal:fileExplorer.closeSearch')}
        aria-label={t('terminal:fileExplorer.closeSearch')}
      >
        ✕
      </button>
    </div>
  );
};

SearchBar.displayName = 'SearchBar';
