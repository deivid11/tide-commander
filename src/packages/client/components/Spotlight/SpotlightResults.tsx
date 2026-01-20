/**
 * SpotlightResults - Results list container for the Spotlight modal
 */

import React, { forwardRef, useEffect } from 'react';
import type { SearchResult } from './types';
import { SpotlightItem } from './SpotlightItem';

interface SpotlightResultsProps {
  results: SearchResult[];
  selectedIndex: number;
  query: string;
  highlightMatch: (text: string, searchQuery: string) => React.ReactNode;
  onSelectIndex: (index: number) => void;
}

export const SpotlightResults = forwardRef<HTMLDivElement, SpotlightResultsProps>(function SpotlightResults(
  { results, selectedIndex, query, highlightMatch, onSelectIndex },
  ref
) {
  // Scroll selected item into view
  useEffect(() => {
    if (!ref || typeof ref === 'function') return;
    const container = ref.current;
    if (!container) return;

    const selectedEl = container.querySelector('.spotlight-item.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex, ref]);

  if (results.length === 0) {
    return (
      <div className="spotlight-results" ref={ref}>
        <div className="spotlight-empty">No results found</div>
      </div>
    );
  }

  return (
    <div className="spotlight-results" ref={ref}>
      {results.map((result, index) => (
        <SpotlightItem
          key={result.id}
          result={result}
          isSelected={index === selectedIndex}
          query={query}
          highlightMatch={highlightMatch}
          onClick={() => result.action()}
          onMouseEnter={() => onSelectIndex(index)}
        />
      ))}
    </div>
  );
});
