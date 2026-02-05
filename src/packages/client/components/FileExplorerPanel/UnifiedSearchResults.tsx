/**
 * UnifiedSearchResults - Combined filename and content search results
 *
 * Shows filename matches first (prioritized), then content matches below.
 */

import React, { memo } from 'react';
import type { TreeNode, ContentMatch } from './types';
import { getFileIcon, findMatchIndices } from './fileUtils';

// ============================================================================
// HIGHLIGHT MATCH COMPONENT
// ============================================================================

interface HighlightMatchProps {
  text: string;
  query: string;
}

function HighlightMatch({ text, query }: HighlightMatchProps) {
  if (!query) return <>{text}</>;

  // For filename matches, use the existing utility
  const match = findMatchIndices(text, query);
  if (match) {
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

  // Fallback for content matches (case-insensitive)
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const index = textLower.indexOf(queryLower);

  if (index === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, index)}
      <mark className="search-highlight">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

// ============================================================================
// FILENAME RESULT ITEM
// ============================================================================

interface FilenameResultItemProps {
  node: TreeNode;
  query: string;
  isSelected: boolean;
  onSelect: (node: TreeNode) => void;
  lineNumber?: number;
}

const FilenameResultItem = memo(function FilenameResultItem({
  node,
  query,
  isSelected,
  onSelect,
  lineNumber,
}: FilenameResultItemProps) {
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
          {lineNumber && <span className="search-result-line-badge">:{lineNumber}</span>}
        </span>
        <span className="search-result-path">{node.path}</span>
      </div>
    </div>
  );
});

// ============================================================================
// CONTENT RESULT ITEM
// ============================================================================

interface ContentResultItemProps {
  match: ContentMatch;
  query: string;
  isSelected: boolean;
  onSelect: (path: string, line?: number) => void;
}

const ContentResultItem = memo(function ContentResultItem({
  match,
  query,
  isSelected,
  onSelect,
}: ContentResultItemProps) {
  const iconNode = {
    name: match.name,
    path: match.path,
    isDirectory: false,
    size: 0,
    extension: match.extension,
  };

  return (
    <div className={`content-search-item ${isSelected ? 'selected' : ''}`}>
      <div
        className="content-search-header"
        onClick={() => onSelect(match.path)}
      >
        <span className="content-search-icon">{getFileIcon(iconNode)}</span>
        <span className="content-search-name">{match.name}</span>
        <span className="content-search-count">
          {match.matches.length} match{match.matches.length > 1 ? 'es' : ''}
        </span>
      </div>
      <div className="content-search-matches">
        {match.matches.slice(0, 3).map((m, idx) => (
          <div
            key={`${match.path}-${m.line}-${idx}`}
            className="content-search-match"
            onClick={() => onSelect(match.path, m.line)}
          >
            <span className="content-search-line-num">{m.line}</span>
            <span className="content-search-line-content">
              <HighlightMatch text={m.content} query={query} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ============================================================================
// UNIFIED SEARCH RESULTS COMPONENT
// ============================================================================

export interface UnifiedSearchResultsProps {
  filenameResults: TreeNode[];
  contentResults: ContentMatch[];
  onSelectFile: (node: TreeNode) => void;
  onSelectContent: (path: string, line?: number) => void;
  selectedPath: string | null;
  query: string;
  lineNumber?: number;
}

function UnifiedSearchResultsComponent({
  filenameResults,
  contentResults,
  onSelectFile,
  onSelectContent,
  selectedPath,
  query,
  lineNumber,
}: UnifiedSearchResultsProps) {
  const hasFilenameResults = filenameResults.length > 0;
  const hasContentResults = contentResults.length > 0;

  if (!hasFilenameResults && !hasContentResults) {
    return <div className="search-no-results">No matches found</div>;
  }

  return (
    <div className="unified-search-results">
      {/* Filename matches (prioritized) */}
      {hasFilenameResults && (
        <div className="unified-search-section">
          <div className="unified-search-section-header">
            <span className="unified-search-section-icon">📄</span>
            <span className="unified-search-section-title">Files</span>
            <span className="unified-search-section-count">{filenameResults.length}</span>
          </div>
          <div className="unified-search-section-content">
            {filenameResults.map((node) => (
              <FilenameResultItem
                key={node.path}
                node={node}
                query={query}
                isSelected={selectedPath === node.path}
                onSelect={onSelectFile}
                lineNumber={lineNumber}
              />
            ))}
          </div>
        </div>
      )}

      {/* Content matches */}
      {hasContentResults && (
        <div className="unified-search-section">
          <div className="unified-search-section-header">
            <span className="unified-search-section-icon">📝</span>
            <span className="unified-search-section-title">Content</span>
            <span className="unified-search-section-count">
              {contentResults.reduce((sum, r) => sum + r.matches.length, 0)} in {contentResults.length} files
            </span>
          </div>
          <div className="unified-search-section-content">
            {contentResults.map((match) => (
              <ContentResultItem
                key={match.path}
                match={match}
                query={query}
                isSelected={selectedPath === match.path}
                onSelect={onSelectContent}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const UnifiedSearchResults = memo(UnifiedSearchResultsComponent, (prev, next) => {
  if (prev.query !== next.query) return false;
  if (prev.selectedPath !== next.selectedPath) return false;
  if (prev.filenameResults.length !== next.filenameResults.length) return false;
  if (prev.contentResults.length !== next.contentResults.length) return false;
  return true;
});

UnifiedSearchResults.displayName = 'UnifiedSearchResults';
