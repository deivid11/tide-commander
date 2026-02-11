/**
 * SpotlightItem - Individual search result item in the Spotlight modal
 * Enhanced with better visual hierarchy and information display
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
  // Determine if this result has secondary information
  const hasSecondaryInfo =
    result.activityText ||
    result.statusDescription ||
    (result.matchedFiles && result.matchedFiles.length > 0) ||
    result.matchedQuery ||
    result.matchedHistory;

  return (
    <div
      className={`spotlight-item ${isSelected ? 'selected' : ''} ${result.activityText ? 'has-activity' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={isSelected}
    >
      <span className="spotlight-item-icon" aria-hidden="true">
        {result.icon}
      </span>
      <div className="spotlight-item-content">
        {/* Main header: Title + Type Badge */}
        <div className="spotlight-item-header">
          <span className="spotlight-item-title">{highlightMatch(result.title, query)}</span>
          <span className={`spotlight-item-type ${result.type}`} aria-label={getTypeLabel(result.type)}>
            {getTypeLabel(result.type)}
          </span>
        </div>

        {/* Subtitle/Path info */}
        {result.subtitle && (
          <span className="spotlight-item-subtitle">{highlightMatch(result.subtitle, query)}</span>
        )}

        {/* Status badge if present */}
        {result.statusDescription && (
          <span className="spotlight-item-status">{highlightMatch(result.statusDescription, query)}</span>
        )}

        {/* Activity/Summary text - most important context */}
        {result.activityText && <span className="spotlight-item-activity">{highlightMatch(result.activityText, query)}</span>}

        {/* Secondary details row */}
        {hasSecondaryInfo && (
          <div className="spotlight-item-details">
            {/* Modified files */}
            {result.matchedFiles && result.matchedFiles.length > 0 && (
              <span className="spotlight-item-files">
                {result.matchedFiles.map((fp, i) => (
                  <span key={fp} className="file-badge">
                    {i > 0 && <span className="file-separator">•</span>}
                    {highlightMatch(fp.split('/').pop() || fp, query)}
                  </span>
                ))}
              </span>
            )}

            {/* User query/task */}
            {result.matchedQuery && (
              <span className="spotlight-item-query">{highlightMatch(result.matchedQuery, query)}</span>
            )}

            {/* History/Analysis */}
            {result.matchedHistory && (
              <span className="spotlight-item-history">
                {highlightMatch(result.matchedHistory.text, query)}
                <span className="spotlight-history-time">{formatRelativeTime(result.matchedHistory.timestamp)}</span>
              </span>
            )}
          </div>
        )}

        {/* Time indicators */}
        {(result.timeAway !== undefined || result.lastStatusTime !== undefined) && (
          <span className="spotlight-item-time">
            {result.timeAway !== undefined && (
              <span className="spotlight-time-away">Idle: {formatDuration(result.timeAway)}</span>
            )}
            {result.lastStatusTime !== undefined && (
              <span className="spotlight-status-time">Updated {formatRelativeTime(result.lastStatusTime)}</span>
            )}
          </span>
        )}

        {/* Last user input if not already shown */}
        {result.lastUserInput && !result.matchedQuery && (
          <span className="spotlight-item-last-input">"{highlightMatch(result.lastUserInput, query)}"</span>
        )}
      </div>
    </div>
  );
});
