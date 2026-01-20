/**
 * Reusable stats row component for displaying agent statistics
 */

import React, { memo } from 'react';
import { formatTokens, formatTimeAgo, formatIdleTime } from '../../utils/formatting';
import { getIdleTimerColor } from '../../utils/colors';
import { getContextBarColor } from './agentUtils';
import type { ContextInfo } from './types';

// ============================================================================
// Stats Grid Component
// ============================================================================

interface AgentStatsGridProps {
  tokensUsed: number;
  createdAt: number;
}

export const AgentStatsGrid = memo(function AgentStatsGrid({
  tokensUsed,
  createdAt,
}: AgentStatsGridProps) {
  return (
    <div className="unit-stats">
      <div className="unit-stat">
        <div className="unit-stat-label">Tokens</div>
        <div className="unit-stat-value">{formatTokens(tokensUsed)}</div>
      </div>
      <div className="unit-stat">
        <div className="unit-stat-label">Uptime</div>
        <div className="unit-stat-value">{formatTimeAgo(createdAt)}</div>
      </div>
    </div>
  );
});

// ============================================================================
// Context Bar Component
// ============================================================================

interface ContextBarProps {
  contextInfo: ContextInfo;
  onClick: () => void;
}

export const ContextBar = memo(function ContextBar({
  contextInfo,
  onClick,
}: ContextBarProps) {
  const { remainingPercent, hasData } = contextInfo;

  return (
    <div
      className="unit-context unit-context-clickable"
      onClick={onClick}
      title={hasData ? "Click for detailed context breakdown" : "Click to fetch context stats"}
      style={{ cursor: 'pointer' }}
    >
      <div className="unit-stat-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span>Remaining Context</span>
        {hasData ? (
          <span style={{ fontSize: '10px', opacity: 0.6 }}>📊</span>
        ) : (
          <span style={{ fontSize: '9px', color: '#ff9e4a', opacity: 0.8 }} title="Click to fetch accurate stats">⚠️</span>
        )}
      </div>
      {hasData ? (
        <>
          <div className="unit-context-bar">
            <div
              className="unit-context-fill"
              style={{
                width: `${remainingPercent}%`,
                background: getContextBarColor(remainingPercent),
              }}
            />
          </div>
          <span className="unit-context-value">{Math.round(remainingPercent)}%</span>
        </>
      ) : (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Not retrieved yet
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Idle Timer Component
// ============================================================================

interface IdleTimerProps {
  lastActivity: number;
}

export const IdleTimer = memo(function IdleTimer({ lastActivity }: IdleTimerProps) {
  return (
    <div
      className="unit-idle-timer"
      title="Time since last activity"
      style={{ color: getIdleTimerColor(lastActivity) }}
    >
      ⏱ {formatIdleTime(lastActivity)}
    </div>
  );
});

// ============================================================================
// Current Tool Display
// ============================================================================

interface CurrentToolProps {
  toolName: string;
}

export const CurrentTool = memo(function CurrentTool({ toolName }: CurrentToolProps) {
  return (
    <div className="unit-current-tool">
      <span className="unit-stat-label">Using:</span>
      <span className="unit-tool-name">{toolName}</span>
    </div>
  );
});

// ============================================================================
// Current Task Display
// ============================================================================

interface CurrentTaskProps {
  task: string;
}

export const CurrentTask = memo(function CurrentTask({ task }: CurrentTaskProps) {
  return (
    <div className="unit-task">
      <div className="unit-stat-label">Task</div>
      <div className="unit-task-text">{task}</div>
    </div>
  );
});

// ============================================================================
// Working Directory Display
// ============================================================================

interface WorkingDirectoryProps {
  cwd: string;
}

export const WorkingDirectory = memo(function WorkingDirectory({ cwd }: WorkingDirectoryProps) {
  return (
    <div className="unit-cwd">
      <div className="unit-stat-label">CWD</div>
      <div className="unit-cwd-path" title={cwd}>{cwd}</div>
    </div>
  );
});

// ============================================================================
// Last Prompt Display
// ============================================================================

interface LastPromptProps {
  text: string;
  maxLength?: number;
}

export const LastPrompt = memo(function LastPrompt({ text, maxLength = 150 }: LastPromptProps) {
  return (
    <div className="unit-last-prompt">
      <div className="unit-stat-label">Last Prompt</div>
      <div className="unit-last-prompt-text">
        {text.length > maxLength ? text.slice(0, maxLength) + '...' : text}
      </div>
    </div>
  );
});

// ============================================================================
// Last Response Display
// ============================================================================

interface LastResponseProps {
  text: string;
  maxLength?: number;
}

export const LastResponse = memo(function LastResponse({ text, maxLength = 200 }: LastResponseProps) {
  return (
    <div className="unit-last-message">
      <div className="unit-stat-label">Last Response</div>
      <div className="unit-last-message-text">
        {text.length > maxLength ? text.slice(0, maxLength) + '...' : text}
      </div>
    </div>
  );
});
