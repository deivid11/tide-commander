/**
 * SearchResults - File search results component
 *
 * Displays search results from fuzzy file search.
 * Following ClaudeOutputPanel's component decomposition pattern.
 */

import React, { memo } from 'react';
import type { SearchResultsProps, TreeNode } from './types';
import { getFileIcon, findMatchIndices } from './fileUtils';

// ============================================================================
// HIGHLIGHT MATCH COMPONENT
// ============================================================================

interface HighlightMatchProps {
  text: string;
  query: string;
}

function HighlightMatch({ text, query }: HighlightMatchProps) {
  const match = findMatchIndices(text, query);

  if (!match) return <>{text}</>;

  return (
    <>
      {text.slice(0, match.start)}
      <mark className="search-highlight">
        {text.slice(match.start, match.end)}
      </mark>
      {text.slice(match.end)}
    </>
  );
}

// ============================================================================
// SEARCH RESULT ITEM
// ============================================================================

interface SearchResultItemProps {
  node: TreeNode;
  query: string;
  isSelected: boolean;
  onSelect: (node: TreeNode) => void;
}

const SearchResultItem = memo(function SearchResultItem({
  node,
  query,
  isSelected,
  onSelect,
}: SearchResultItemProps) {
  return (
    <div
      className={`search-result-item ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(node)}
    >
      <span className="search-result-icon">
        {node.isDirectory ? '📁' : getFileIcon(node)}
      </span>
      <div className="search-result-info">
        <span className="search-result-name">
          <HighlightMatch text={node.name} query={query} />
        </span>
        <span className="search-result-path">{node.path}</span>
      </div>
    </div>
  );
});

// ============================================================================
// SEARCH RESULTS COMPONENT
// ============================================================================

function SearchResultsComponent({
  results,
  onSelect,
  selectedPath,
  query,
}: SearchResultsProps) {
  if (results.length === 0) {
    return <div className="search-no-results">No files found</div>;
  }

  return (
    <div className="search-results">
      {results.map((node) => (
        <SearchResultItem
          key={node.path}
          node={node}
          query={query}
          isSelected={selectedPath === node.path}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * Memoized SearchResults component
 */
export const SearchResults = memo(SearchResultsComponent, (prev, next) => {
  if (prev.query !== next.query) return false;
  if (prev.selectedPath !== next.selectedPath) return false;
  if (prev.results.length !== next.results.length) return false;

  // Check if results array changed
  for (let i = 0; i < prev.results.length; i++) {
    if (prev.results[i].path !== next.results[i].path) return false;
  }

  return true;
});

SearchResults.displayName = 'SearchResults';
