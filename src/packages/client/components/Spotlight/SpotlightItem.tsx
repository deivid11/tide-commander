/**
 * SpotlightItem - Individual search result item in the Spotlight modal
 * Enhanced with better visual hierarchy and information display
 */

import React, { memo } from 'react';
import type { SearchResult } from './types';
import { formatDuration, getTypeLabel } from './utils';
import { getAgentStatusColor } from '../../utils/colors';
import { Icon } from '../Icon';

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
    (result.matchedFiles && result.matchedFiles.length > 0) ||
    result.matchedQuery;

  // Colored status chip for agent results.
  const statusColor = result._status ? getAgentStatusColor(result._status) : undefined;
  const ports = result.type === 'building' ? result._ports : undefined;

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
        {/* Main header: Title + Status chip + Type Badge */}
        <div className="spotlight-item-header">
          <span className="spotlight-item-title">{highlightMatch(result.title, query)}</span>
          {result._status && statusColor && (
            <span
              className={`spotlight-item-agent-status${result._status === 'working' ? ' spotlight-item-agent-status--working' : ''}`}
              style={{ color: statusColor, background: `${statusColor}1f`, borderColor: `${statusColor}55` }}
            >
              {result._status === 'working' && <span className="spotlight-working-dot" aria-hidden="true" />}
              {result._status.replace(/_/g, ' ')}
            </span>
          )}
          {result._taskLabel && (
            <span className="spotlight-item-task-label" title={result._taskLabel}>
              <Icon name="task" size={9} aria-hidden />
              {highlightMatch(result._taskLabel, query)}
            </span>
          )}
          {result.type === 'agent' && result._areaName && (
            <span className="spotlight-item-area-badge" title={`Area: ${result._areaName}`}>
              <span
                className="spotlight-area-dot"
                style={result._areaColor ? { background: result._areaColor } : undefined}
                aria-hidden="true"
              />
              {highlightMatch(result._areaName, query)}
            </span>
          )}
          {result.type === 'folder' && result._isGitRepo && (
            <span
              className="spotlight-item-git-badge"
              title={result._gitBranch ? `git branch: ${result._gitBranch}` : 'git repository'}
            >
              <Icon name="git-branch" size={9} aria-hidden />
              {result._gitBranch || 'git'}
            </span>
          )}
          {result.type === 'file' && result._projectName && (
            <span
              className="spotlight-item-project-badge"
              title={result._areaName && result._areaName !== result._projectName
                ? `${result._projectName} · ${result._areaName}`
                : result._projectName}
            >
              <Icon name="folder" size={9} aria-hidden />
              {result._projectName}
              {result._areaName && result._areaName !== result._projectName ? ` · ${result._areaName}` : ''}
            </span>
          )}
          <span className={`spotlight-item-type ${result.type}`} aria-label={getTypeLabel(result.type)}>
            {getTypeLabel(result.type)}
          </span>
        </div>

        {/* Subtitle/Path info */}
        {result.subtitle && (
          <span className="spotlight-item-subtitle">{highlightMatch(result.subtitle, query)}</span>
        )}

        {/* Building listening ports — open http://localhost:<port> in a new tab */}
        {ports && ports.length > 0 && (
          <span className="spotlight-item-ports">
            {ports.map((port) => (
              <a
                key={port}
                className="spotlight-port-link"
                href={`http://localhost:${port}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`http://localhost:${port}`}
                onClick={(e) => e.stopPropagation()}
              >
                :{port}
              </a>
            ))}
          </span>
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
          </div>
        )}

        {/* Time indicators */}
        {result.timeAway !== undefined && (
          <span className="spotlight-item-time">
            <span className="spotlight-time-away">Idle: {formatDuration(result.timeAway)}</span>
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
