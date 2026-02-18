import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@shared/types';
import { getStatusColor, getAgentClassIcon, getContextPercent, getContextBarColor } from './utils';
import { formatIdleTime, formatTimeAgo } from '../../utils/formatting';
import { getIdleTimerColor } from '../../utils/colors';
import { useAgentsWithUnseenOutput } from '../../store';

interface AgentCardProps {
  agent: Agent;
  isSelected: boolean;
  isKeyboardFocused?: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onChat?: () => void;
  onFocus?: () => void;
  onKill?: () => void;
  onDragStart?: (agent: Agent) => void;
}

export const AgentCard = React.memo(({
  agent,
  isSelected,
  isKeyboardFocused = false,
  onSelect,
  onDoubleClick,
  onChat,
  onFocus: _onFocus,
  onKill,
  onDragStart,
}: AgentCardProps) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();
  const hasUnseen = agentsWithUnseenOutput.has(agent.id);
  const statusColor = getStatusColor(agent.status);
  const icon = getAgentClassIcon(agent.class);
  const contextPercent = getContextPercent(agent);
  const barColor = getContextBarColor(contextPercent);
  const taskPreview = agent.currentTask || agent.lastAssignedTask;
  const showIdleTime = agent.status === 'idle' && agent.lastActivity > 0;
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!showIdleTime) return;
    const interval = window.setInterval(() => setTick((v) => v + 1), 15000);
    return () => window.clearInterval(interval);
  }, [showIdleTime]);

  return (
    <div
      className={`dash-card dash-card--${statusColor} ${isSelected ? 'dash-card--selected' : ''} ${isKeyboardFocused ? 'dash-card--keyboard-focused' : ''}`}
      data-agent-id={agent.id}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      onDragStart={(e) => {
        onDragStart?.(agent);
        e.dataTransfer.effectAllowed = 'move';
      }}
      draggable
      title={t('cards.doubleClickHint')}
    >
      {/* Row 1: Status dot + name + class badge + provider + unseen badge */}
      <div className="dash-card__row1">
        <span className={`dash-card__status-dot dash-card__status-dot--${statusColor}`} />
        <span className="dash-card__name">{agent.name}</span>
        <span className="dash-card__class">{icon} {agent.class}</span>
        <span className={`dash-card__provider dash-card__provider--${agent.provider}`}>
          {agent.provider === 'codex' ? '🔸' : '🤖'} {agent.provider}
        </span>
        {hasUnseen && (
          <span
            className="dash-card__unseen-badge"
            title="New output available - click to view"
          >
            !
          </span>
        )}
      </div>

      {/* Row 2: Status + context bar + percentage */}
      <div className="dash-card__row2">
        <span className={`dash-card__status dash-card__status--${statusColor}`}>
          {hasUnseen ? 'Unseen' : agent.status}
        </span>
        <div className="dash-card__context">
          <div className="dash-card__context-bar">
            <div
              className={`dash-card__context-fill dash-card__context-fill--${barColor}`}
              style={{ width: `${contextPercent}%` }}
            />
          </div>
          <span className={`dash-card__context-pct dash-card__context-pct--${barColor}`}>{contextPercent}%</span>
        </div>
      </div>

      {/* Row 3: Working directory + idle time */}
      <div className="dash-card__row3">
        <span className="dash-card__workdir" title={agent.cwd}>
          📁 {agent.cwd.split('/').pop() || agent.cwd}
        </span>
        {showIdleTime && (
          <span
            className="dash-card__idle-time"
            style={{ color: getIdleTimerColor(agent.lastActivity) }}
            title={formatIdleTime(agent.lastActivity)}
          >
            ⏱ {formatTimeAgo(agent.lastActivity)}
          </span>
        )}
      </div>

      {/* Row 4: Task preview (if exists) */}
      {taskPreview && (
        <div className="dash-card__row4">
          <span className="dash-card__task">{taskPreview}</span>
        </div>
      )}

      {/* Row 5: Action buttons */}
      <div className="dash-card__actions">
        {onChat && (
          <button
            className="dash-card__action-btn dash-card__action-btn--chat"
            onClick={(e) => { e.stopPropagation(); onChat(); }}
            title={t('cards.openTerminal')}
          >
            {t('cards.chat')}
          </button>
        )}
        {onKill && (
          <button
            className="dash-card__action-btn dash-card__action-btn--danger"
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            title={t('cards.killAgent')}
          >
            {t('cards.stop')}
          </button>
        )}
      </div>
    </div>
  );
});

AgentCard.displayName = 'AgentCard';
