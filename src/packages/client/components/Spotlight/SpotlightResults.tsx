/**
 * SpotlightResults - Results list container for the Spotlight modal
 * Groups results by type with category headers (IntelliJ-inspired)
 */

import React, { forwardRef, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchResult, SpotlightTab, SpotlightAreaSection } from './types';
import { SpotlightItem } from './SpotlightItem';

interface SpotlightResultsProps {
  results: SearchResult[];
  selectedIndex: number;
  query: string;
  activeTab: SpotlightTab;
  areaSections: SpotlightAreaSection[];
  highlightMatch: (text: string, searchQuery: string) => React.ReactNode;
  onSelectIndex: (index: number) => void;
}

export const SpotlightResults = forwardRef<HTMLDivElement, SpotlightResultsProps>(function SpotlightResults(
  { results, selectedIndex, query, activeTab, areaSections, highlightMatch, onSelectIndex },
  ref
) {
  const { t } = useTranslation(['terminal']);

  // Track whether the mouse has intentionally moved since results appeared.
  // This prevents the cursor's resting position from stealing selection on open.
  const mouseHasMoved = useRef(false);

  // Reset the flag whenever results change (new search or spotlight re-open)
  useEffect(() => {
    mouseHasMoved.current = false;
  }, [results]);

  // Listen for any mousemove on the results container to flip the flag
  useEffect(() => {
    const resolvedRef = typeof ref === 'function' ? null : ref?.current;
    if (!resolvedRef) return;

    const handleMouseMove = () => {
      mouseHasMoved.current = true;
    };

    resolvedRef.addEventListener('mousemove', handleMouseMove);
    return () => {
      resolvedRef.removeEventListener('mousemove', handleMouseMove);
    };
  }, [ref, results]);

  // Category labels and grouping
  const categoryLabels: Record<string, string> = {
    command: t('terminal:spotlight.categories.commands'),
    agent: t('terminal:spotlight.categories.agents'),
    building: t('terminal:spotlight.categories.infrastructure'),
    area: t('terminal:spotlight.categories.areas'),
    folder: t('terminal:spotlight.categories.folders'),
    'modified-file': t('terminal:spotlight.categories.modifiedFiles'),
    session: t('terminal:spotlight.categories.sessions'),
  };

  // Group results by category, preserving the order from the results array.
  // Results are already sorted by category order from useSpotlightSearch,
  // so we just need to detect group boundaries for rendering headers.
  const groupedResults = useMemo(() => {
    const groups: [string, { result: SearchResult; index: number }[]][] = [];
    let currentCategory: string | null = null;
    let currentItems: { result: SearchResult; index: number }[] = [];

    results.forEach((result, index) => {
      if (result.type !== currentCategory) {
        if (currentCategory !== null && currentItems.length > 0) {
          groups.push([currentCategory, currentItems]);
        }
        currentCategory = result.type;
        currentItems = [];
      }
      currentItems.push({ result, index });
    });

    if (currentCategory !== null && currentItems.length > 0) {
      groups.push([currentCategory, currentItems]);
    }

    return groups;
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

  // "Areas" tab: render each area as a section header with its agents listed
  // underneath. The flat index assigned to each agent matches the flattened
  // `results` array (areaSections.flatMap(s => s.agents)) used for keyboard nav.
  if (activeTab === 'areas') {
    if (areaSections.length === 0) {
      return (
        <div className="spotlight-results" ref={ref}>
          <div className="spotlight-empty">{t('terminal:spotlight.noResults')}</div>
        </div>
      );
    }
    let flatIndex = 0;
    return (
      <div className="spotlight-results" ref={ref}>
        {areaSections.map((section) => (
          <div key={section.areaId}>
            <div className="spotlight-category-header spotlight-area-section-header">
              <span className="spotlight-area-dot" style={{ background: section.areaColor }} aria-hidden="true" />
              <span className="spotlight-area-name">{section.areaName}</span>
              <span className="spotlight-area-count">{section.agents.length}</span>
            </div>
            {section.agents.length === 0 ? (
              <div className="spotlight-area-empty">{t('terminal:spotlight.noAgentsInArea')}</div>
            ) : (
              section.agents.map((result) => {
                const index = flatIndex++;
                return (
                  <SpotlightItem
                    key={result.id}
                    result={result}
                    isSelected={index === selectedIndex}
                    query={query}
                    highlightMatch={highlightMatch}
                    onClick={() => result.action()}
                    onMouseEnter={() => { if (mouseHasMoved.current) onSelectIndex(index); }}
                  />
                );
              })
            )}
          </div>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="spotlight-results" ref={ref}>
        <div className="spotlight-empty">{t('terminal:spotlight.noResults')}</div>
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
              onMouseEnter={() => { if (mouseHasMoved.current) onSelectIndex(index); }}
            />
          ))}
        </div>
      ))}
    </div>
  );
});
