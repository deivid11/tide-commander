import React from 'react';
import type { Agent } from '@shared/types';
import { getStatusColor, getAgentClassIcon, getContextPercent, getContextBarColor } from './utils';

interface AgentCardProps {
  agent: Agent;
  isSelected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onChat?: () => void;
  onFocus?: () => void;
  onKill?: () => void;
}

export const AgentCard = React.memo(({
  agent,
  isSelected,
  onSelect,
  onDoubleClick,
  onChat,
  onFocus,
  onKill,
}: AgentCardProps) => {
  const statusColor = getStatusColor(agent.status);
  const icon = getAgentClassIcon(agent.class);
  const contextPercent = getContextPercent(agent);
  const barColor = getContextBarColor(contextPercent);
  const taskPreview = agent.currentTask || agent.lastAssignedTask;

  return (
    <div
      className={`dash-card dash-card--${statusColor} ${isSelected ? 'dash-card--selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      title="Double-click to open terminal"
    >
      {/* Row 1: Status dot + name + class badge */}
      <div className="dash-card__row1">
        <span className={`dash-card__status-dot dash-card__status-dot--${statusColor}`} />
        <span className="dash-card__name">{agent.name}</span>
        <span className="dash-card__class">{icon} {agent.class}</span>
      </div>

      {/* Row 2: Status + context bar + percentage */}
      <div className="dash-card__row2">
        <span className={`dash-card__status dash-card__status--${statusColor}`}>{agent.status}</span>
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

      {/* Row 3: Task preview (if exists) */}
      {taskPreview && (
        <div className="dash-card__row3">
          <span className="dash-card__task">{taskPreview}</span>
        </div>
      )}

      {/* Row 4: Action buttons */}
      <div className="dash-card__actions">
        {onChat && (
          <button
            className="dash-card__action-btn dash-card__action-btn--chat"
            onClick={(e) => { e.stopPropagation(); onChat(); }}
            title="Open terminal"
          >
            Chat
          </button>
        )}
        {onFocus && (
          <button
            className="dash-card__action-btn"
            onClick={(e) => { e.stopPropagation(); onFocus(); }}
            title="Focus in 3D view"
          >
            Focus
          </button>
        )}
        {onKill && (
          <button
            className="dash-card__action-btn dash-card__action-btn--danger"
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            title="Kill agent"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
});

AgentCard.displayName = 'AgentCard';
