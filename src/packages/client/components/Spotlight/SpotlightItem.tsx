/**
 * SpotlightItem - Individual search result item in the Spotlight modal
 * Enhanced with better visual hierarchy and information display
 */

import React, { memo } from 'react';
import type { SearchResult } from './types';
import type { SessionExtractKind } from '../../api/sessions';
import { formatDuration, getTypeLabel } from './utils';
import { getAgentStatusColor } from '../../utils/colors';
import { providerLabel } from '../../utils/providerDisplay';
import { ProviderIcon } from '../ProviderIcon';
import { Icon } from '../Icon';

interface SpotlightItemProps {
  result: SearchResult;
  isSelected: boolean;
  query: string;
  highlightMatch: (text: string, searchQuery: string) => React.ReactNode;
  onClick: () => void;
  onMouseEnter: () => void;
}

// Extract voice tags — a short marker before each conversation extract, in
// the same role palette the Session Finder uses (user blue, agent green,
// tool orange). `raw` is an unparseable line shown muted, unlabeled.
const EXTRACT_KIND_LABEL: Record<SessionExtractKind, string> = {
  user: 'you',
  assistant: 'agent',
  tool: 'tool',
  raw: '',
};
const EXTRACT_KIND_TITLE: Record<SessionExtractKind, string> = {
  user: 'Your prompt',
  assistant: 'Agent message / reasoning',
  tool: 'Tool call / output',
  raw: 'Raw line',
};

// Idle-age emphasis for the time pill: fresh (minutes) → green, warm (<1h) →
// yellow, stale (<1d) → orange, old (≥1d) → red.
function idleAgeClass(ms: number): string {
  if (ms < 10 * 60_000) return 'is-fresh';
  if (ms < 3600_000) return 'is-warm';
  if (ms < 86_400_000) return 'is-stale';
  return 'is-old';
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
  const extracts = result.matchedExtracts && result.matchedExtracts.length > 0 ? result.matchedExtracts : undefined;
  const hasSecondaryInfo =
    result.activityText ||
    (result.matchedFiles && result.matchedFiles.length > 0) ||
    result.matchedQuery ||
    extracts;

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
          {result._provider && (
            <ProviderIcon
              className="spotlight-item-provider"
              provider={result._provider}
              piModel={result._piModel}
              piModelProvider={result._piModelProvider}
              alt={providerLabel(result._provider, result._piModel, result._piModelProvider)}
            />
          )}
          {result._status && statusColor && (
            <span
              className={`spotlight-item-agent-status${result._status === 'working' ? ' spotlight-item-agent-status--working' : ''}`}
              style={{ color: statusColor, background: `${statusColor}1f`, borderColor: `${statusColor}55` }}
            >
              {result._status === 'working' && <span className="spotlight-working-dot" aria-hidden="true" />}
              {result._status.replace(/_/g, ' ')}
            </span>
          )}
          {/* Conversation hit count — how many times the query occurs in the
              agent's conversation. Present only for full-text hits (the
              snippet below shows one of them). Session rows already carry
              the count in their subtitle ("N×"), so agents only. */}
          {result.type === 'agent' && result._sessionMatches !== undefined && result._sessionMatches > 0 && (
            <span
              className="spotlight-item-match-count"
              title={`${result._sessionMatches} match${result._sessionMatches === 1 ? '' : 'es'} in conversation`}
            >
              <Icon name="chat" size={9} aria-hidden />
              {result._sessionMatches}
              {result._sessionMatches === 1 ? ' match' : ' matches'}
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
          {(result.type === 'file' || result.type === 'file-content') && result._projectName && (
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

            {/* Conversation extracts (agent + session full-text hits): up to
                4 stacked lines — user prompts first — colored by who said
                it (you / agent / tool) so the topic AND the voice read at a
                glance. Falls back to the single matched user query/task. */}
            {extracts ? (
              <ul className="spotlight-item-extracts" aria-label="Matching conversation extracts">
                {extracts.map((ex, i) => (
                  <li
                    key={i}
                    className={`spotlight-item-extract is-${ex.kind}`}
                    title={EXTRACT_KIND_TITLE[ex.kind]}
                  >
                    <span className="spotlight-extract-role" aria-hidden="true">{EXTRACT_KIND_LABEL[ex.kind]}</span>
                    {highlightMatch(ex.text, query)}
                  </li>
                ))}
              </ul>
            ) : result.matchedQuery && (
              <span className="spotlight-item-query">{highlightMatch(result.matchedQuery, query)}</span>
            )}
          </div>
        )}

        {/* Time indicators — prominent idle-age pill. Hidden while working:
            the pulsing status chip in the header already owns that state. */}
        {result.timeAway !== undefined && result._status !== 'working' && (
          <span className="spotlight-item-time">
            <span className={`spotlight-time-away ${idleAgeClass(result.timeAway)}`}>
              <Icon name="hourglass" size={9} aria-hidden />
              Idle: {formatDuration(result.timeAway)}
            </span>
          </span>
        )}

        {/* Last user input if not already shown */}
        {result.lastUserInput && !result.matchedQuery && !extracts && (
          <span className="spotlight-item-last-input">"{highlightMatch(result.lastUserInput, query)}"</span>
        )}
      </div>
    </div>
  );
});
