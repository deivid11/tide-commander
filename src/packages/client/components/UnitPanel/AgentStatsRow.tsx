/**
 * Reusable stats row component for displaying agent statistics
 */

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['common']);
  return (
    <div className="unit-stats">
      <div className="unit-stat">
        <div className="unit-stat-label">{t('labels.tokens')}</div>
        <div className="unit-stat-value">{formatTokens(tokensUsed)}</div>
      </div>
      <div className="unit-stat">
        <div className="unit-stat-label">{t('labels.uptime')}</div>
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
  const { t } = useTranslation(['common']);
  const { remainingPercent, hasData } = contextInfo;

  return (
    <div
      className="unit-context unit-context-clickable"
      onClick={onClick}
      title={hasData ? t('unitPanel.remainingContext') : t('unitPanel.notRetrievedYet')}
      style={{ cursor: 'pointer' }}
    >
      <div className="unit-stat-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span>{t('unitPanel.remainingContext')}</span>
        {hasData ? (
          <span style={{ fontSize: '10px', opacity: 0.6 }}>📊</span>
        ) : (
          <span style={{ fontSize: '9px', color: '#ff9e4a', opacity: 0.8 }} title={t('unitPanel.notRetrievedYet')}>⚠️</span>
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
          {t('unitPanel.notRetrievedYet')}
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
  const { t } = useTranslation(['common']);
  return (
    <div
      className="unit-idle-timer"
      title={t('unitPanel.timeSinceActivity')}
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
  const { t } = useTranslation(['common']);
  return (
    <div className="unit-current-tool">
      <span className="unit-stat-label">{t('unitPanel.using')}</span>
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
  const { t } = useTranslation(['common']);
  return (
    <div className="unit-task">
      <div className="unit-stat-label">{t('labels.task')}</div>
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
  const { t } = useTranslation(['common']);
  return (
    <div className="unit-cwd">
      <div className="unit-stat-label">{t('labels.cwd')}</div>
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
  const { t } = useTranslation(['common']);
  return (
    <div className="unit-last-prompt">
      <div className="unit-stat-label">{t('unitPanel.lastPrompt')}</div>
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
  const { t } = useTranslation(['common']);
  return (
    <div className="unit-last-message">
      <div className="unit-stat-label">{t('unitPanel.lastResponse')}</div>
      <div className="unit-last-message-text">
        {text.length > maxLength ? text.slice(0, maxLength) + '...' : text}
      </div>
    </div>
  );
});
