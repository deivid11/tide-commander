/**
 * SpotlightResults - Results list container for the Spotlight modal
 * Groups results by type with category headers (IntelliJ-inspired)
 */

import React, { forwardRef, useEffect, useMemo } from 'react';
import type { SearchResult } from './types';
import { SpotlightItem } from './SpotlightItem';

interface SpotlightResultsProps {
  results: SearchResult[];
  selectedIndex: number;
  query: string;
  highlightMatch: (text: string, searchQuery: string) => React.ReactNode;
  onSelectIndex: (index: number) => void;
}

// Category labels and grouping
const categoryLabels: Record<string, string> = {
  command: '🎮 Commands',
  agent: '👤 Agents',
  building: '🏗️ Infrastructure',
  area: '🗺️ Areas',
  'modified-file': '📁 Modified Files',
  activity: '📊 Recent Activity',
};

const categoryOrder = ['command', 'agent', 'building', 'area', 'modified-file', 'activity'];

export const SpotlightResults = forwardRef<HTMLDivElement, SpotlightResultsProps>(function SpotlightResults(
  { results, selectedIndex, query, highlightMatch, onSelectIndex },
  ref
) {
  // Group results by category
  const groupedResults = useMemo(() => {
    const grouped: Record<string, { result: SearchResult; index: number }[]> = {};

    results.forEach((result, index) => {
      if (!grouped[result.type]) {
        grouped[result.type] = [];
      }
      grouped[result.type].push({ result, index });
    });

    // Sort groups by category order
    const sorted: [string, { result: SearchResult; index: number }[]][] = [];
    for (const category of categoryOrder) {
      if (grouped[category]) {
        sorted.push([category, grouped[category]]);
      }
    }
    // Add any remaining categories not in the order
    for (const category of Object.keys(grouped)) {
      if (!categoryOrder.includes(category)) {
        sorted.push([category, grouped[category]]);
      }
    }

    return sorted;
  }, [results]);

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
      {groupedResults.map(([category, items]) => (
        <div key={category}>
          {groupedResults.length > 1 && <div className="spotlight-category-header">{categoryLabels[category] || category}</div>}
          {items.map(({ result, index }) => (
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
      ))}
    </div>
  );
});
