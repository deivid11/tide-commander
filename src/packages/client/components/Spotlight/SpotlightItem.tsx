/**
 * SpotlightItem - Individual search result item in the Spotlight modal
 */

import React, { memo } from 'react';
import type { SearchResult } from './types';
import { formatDuration, formatRelativeTime, getTypeLabel } from './utils';

interface SpotlightItemProps {
  result: SearchResult;
  isSelected: boolean;
  query: string;
  highlightMatch: (text: string, searchQuery: string) => React.ReactNode;
  onClick: () => void;
  onMouseEnter: () => void;
}

export const SpotlightItem = memo(function SpotlightItem({
  result,
  isSelected,
  query,
  highlightMatch,
  onClick,
  onMouseEnter,
}: SpotlightItemProps) {
  return (
    <div
      className={`spotlight-item ${isSelected ? 'selected' : ''} ${result.activityText ? 'has-activity' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="spotlight-item-icon">{result.icon}</span>
      <div className="spotlight-item-content">
        <div className="spotlight-item-header">
          <span className="spotlight-item-title">{highlightMatch(result.title, query)}</span>
          {result.lastUserInput && (
            <span className="spotlight-item-last-input">{highlightMatch(result.lastUserInput, query)}</span>
          )}
        </div>
        {result.subtitle && (
          <span className="spotlight-item-subtitle">{highlightMatch(result.subtitle, query)}</span>
        )}
        {result.statusDescription && (
          <span className="spotlight-item-status">{highlightMatch(result.statusDescription, query)}</span>
        )}
        {result.activityText && (
          <span className="spotlight-item-activity">{highlightMatch(result.activityText, query)}</span>
        )}
        {result.matchedFiles && result.matchedFiles.length > 0 && (
          <span className="spotlight-item-files">
            📁{' '}
            {result.matchedFiles.map((fp, i) => (
              <span key={fp}>
                {i > 0 && ', '}
                {highlightMatch(fp.split('/').pop() || fp, query)}
              </span>
            ))}
          </span>
        )}
        {result.matchedQuery && (
          <span className="spotlight-item-query">💬 {highlightMatch(result.matchedQuery, query)}</span>
        )}
        {result.matchedHistory && (
          <span className="spotlight-item-history">
            📜 {highlightMatch(result.matchedHistory.text, query)}
            <span className="spotlight-history-time">{formatRelativeTime(result.matchedHistory.timestamp)}</span>
          </span>
        )}
        {(result.timeAway !== undefined || result.lastStatusTime !== undefined) && (
          <span className="spotlight-item-time">
            {result.timeAway !== undefined && (
              <span className="spotlight-time-away">⏱️ {formatDuration(result.timeAway)}</span>
            )}
            {result.lastStatusTime !== undefined && (
              <span className="spotlight-status-time">📊 Status {formatRelativeTime(result.lastStatusTime)}</span>
            )}
          </span>
        )}
      </div>
      <span className={`spotlight-item-type ${result.type}`}>{getTypeLabel(result.type)}</span>
    </div>
  );
});
