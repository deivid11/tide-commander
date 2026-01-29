import React, { useMemo, memo } from 'react';
import { store, useCustomAgentClassesArray } from '../store';
import type { Agent, AgentSupervisorHistoryEntry } from '../../shared/types';
import { getClassConfig } from '../utils/classConfig';
import { getAgentStatusColor } from '../utils/colors';
import { TOOL_ICONS } from '../utils/outputRendering';

interface AgentHoverPopupProps {
  agent: Agent;
  screenPos: { x: number; y: number };
  onClose: () => void;
}

const getStatusLabel = (status: Agent['status']) => {
  switch (status) {
    case 'idle': return 'Idle';
    case 'working': return 'Working';
    case 'waiting': return 'Waiting';
    case 'error': return 'Error';
    case 'offline': return 'Offline';
    default: return 'Unknown';
  }
};

const formatTokens = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

const getProgressColor = (progress: string) => {
  switch (progress) {
    case 'on_track': return '#4aff9e';
    case 'completed': return '#4a9eff';
    case 'stalled': return '#ff9e4a';
    case 'blocked': return '#ff4a4a';
    case 'idle': return '#888888';
    default: return '#888888';
  }
};

export const AgentHoverPopup = memo(function AgentHoverPopup({ agent, screenPos, onClose }: AgentHoverPopupProps) {
  const customClasses = useCustomAgentClassesArray();
  const area = store.getAreaForAgent(agent.id);
  const lastPrompt = store.getState().lastPrompts.get(agent.id);
  const config = getClassConfig(agent.class, customClasses);

  // Get last supervisor analysis for this agent
  const supervisorHistory = store.getAgentSupervisorHistory(agent.id);
  const lastSupervisorEntry: AgentSupervisorHistoryEntry | undefined =
    supervisorHistory.length > 0 ? supervisorHistory[supervisorHistory.length - 1] : undefined;

  // Format uptime
  const uptimeMs = Date.now() - (agent.createdAt || Date.now());
  const uptimeMinutes = Math.floor(uptimeMs / 60000);
  const uptimeHours = Math.floor(uptimeMinutes / 60);
  const uptimeStr = uptimeHours > 0
    ? `${uptimeHours}h ${uptimeMinutes % 60}m`
    : `${uptimeMinutes}m`;

  // Context usage percentage
  const contextPercent = agent.contextLimit > 0
    ? Math.round((agent.contextUsed / agent.contextLimit) * 100)
    : 0;

  // Memoize popup style to avoid recalculating on every render
  const popupStyle = useMemo((): React.CSSProperties => {
    const maxWidth = 300;
    const maxHeight = 320;
    // Position closer to agent - small offset from cursor, above it
    let left = screenPos.x - maxWidth / 2;
    let top = screenPos.y - maxHeight - 10;

    if (typeof window !== 'undefined') {
      // Keep within horizontal bounds
      if (left < 10) {
        left = 10;
      } else if (left + maxWidth > window.innerWidth - 10) {
        left = window.innerWidth - maxWidth - 10;
      }
      // If not enough room above, show below
      if (top < 10) {
        top = screenPos.y + 10;
      }
    }

    return {
      position: 'fixed',
      left,
      top,
      zIndex: 10000,
      maxWidth,
      maxHeight,
      fontSize: '0.85em',
    };
  }, [screenPos.x, screenPos.y]);

  return (
    <div
      className="agent-hover-popup"
      style={popupStyle}
      onMouseLeave={onClose}
    >
      <div className="agent-bar-tooltip-header">
        <span className="agent-bar-tooltip-icon">
          {config.icon}
        </span>
        <span className="agent-bar-tooltip-name">{agent.name}</span>
        <span
          className="agent-bar-tooltip-status"
          style={{ color: getAgentStatusColor(agent.status) }}
        >
          {getStatusLabel(agent.status)}
        </span>
      </div>
      <div className="agent-bar-tooltip-info">
        <div className="agent-bar-tooltip-row">
          <span className="agent-bar-tooltip-label">Class:</span>
          <span className="agent-bar-tooltip-value">
            {agent.class} — {config.description}
          </span>
        </div>
        {area && (
          <div className="agent-bar-tooltip-row">
            <span className="agent-bar-tooltip-label">Area:</span>
            <span
              className="agent-bar-tooltip-value agent-bar-tooltip-area"
              style={{ color: area.color }}
            >
              {area.name}
            </span>
          </div>
        )}
        <div className="agent-bar-tooltip-row">
          <span className="agent-bar-tooltip-label">Directory:</span>
          <span className="agent-bar-tooltip-value agent-bar-tooltip-path">
            {agent.cwd}
          </span>
        </div>
        <div className="agent-bar-tooltip-row">
          <span className="agent-bar-tooltip-label">Uptime:</span>
          <span className="agent-bar-tooltip-value">{uptimeStr}</span>
        </div>
        <div className="agent-bar-tooltip-row">
          <span className="agent-bar-tooltip-label">Tokens:</span>
          <span className="agent-bar-tooltip-value">
            {formatTokens(agent.tokensUsed)} used
          </span>
        </div>
        <div className="agent-bar-tooltip-row">
          <span className="agent-bar-tooltip-label">Context:</span>
          <span className="agent-bar-tooltip-value" style={{
            color: contextPercent > 80 ? '#ff4a4a' : contextPercent > 60 ? '#ff9e4a' : undefined
          }}>
            {formatTokens(agent.contextUsed)} / {formatTokens(agent.contextLimit)} ({contextPercent}%)
          </span>
        </div>
        {agent.currentTool && (
          <div className="agent-bar-tooltip-row">
            <span className="agent-bar-tooltip-label">Tool:</span>
            <span className="agent-bar-tooltip-value agent-bar-tooltip-tool">
              {TOOL_ICONS[agent.currentTool] || TOOL_ICONS.default} {agent.currentTool}
            </span>
          </div>
        )}
        {agent.currentTask && (
          <div className="agent-bar-tooltip-row">
            <span className="agent-bar-tooltip-label">Task:</span>
            <span className="agent-bar-tooltip-value">
              {agent.currentTask.substring(0, 150)}
              {agent.currentTask.length > 150 ? '...' : ''}
            </span>
          </div>
        )}
        {agent.lastAssignedTask && !agent.currentTask && (
          <div className="agent-bar-tooltip-row">
            <span className="agent-bar-tooltip-label">Assigned Task:</span>
            <span className="agent-bar-tooltip-value agent-bar-tooltip-query">
              {agent.lastAssignedTask.substring(0, 200)}
              {agent.lastAssignedTask.length > 200 ? '...' : ''}
            </span>
          </div>
        )}
        {lastPrompt && (
          <div className="agent-bar-tooltip-row">
            <span className="agent-bar-tooltip-label">Last Query:</span>
            <span className="agent-bar-tooltip-value agent-bar-tooltip-query">
              {lastPrompt.text.substring(0, 300)}
              {lastPrompt.text.length > 300 ? '...' : ''}
            </span>
          </div>
        )}
        {/* Supervisor Analysis Section */}
        {lastSupervisorEntry && (
          <>
            <div className="agent-bar-tooltip-divider" />
            <div className="agent-bar-tooltip-row">
              <span className="agent-bar-tooltip-label">Supervisor:</span>
              <span
                className="agent-bar-tooltip-value"
                style={{ color: getProgressColor(lastSupervisorEntry.analysis.progress) }}
              >
                {lastSupervisorEntry.analysis.progress.replace('_', ' ')}
              </span>
            </div>
            <div className="agent-bar-tooltip-row">
              <span className="agent-bar-tooltip-label">Status:</span>
              <span className="agent-bar-tooltip-value agent-bar-tooltip-supervisor">
                {lastSupervisorEntry.analysis.statusDescription}
              </span>
            </div>
            {lastSupervisorEntry.analysis.recentWorkSummary && (
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">Summary:</span>
                <span className="agent-bar-tooltip-value agent-bar-tooltip-supervisor">
                  {lastSupervisorEntry.analysis.recentWorkSummary.substring(0, 300)}
                  {lastSupervisorEntry.analysis.recentWorkSummary.length > 300 ? '...' : ''}
                </span>
              </div>
            )}
            {lastSupervisorEntry.analysis.concerns && lastSupervisorEntry.analysis.concerns.length > 0 && (
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">Concerns:</span>
                <span className="agent-bar-tooltip-value agent-bar-tooltip-concerns">
                  {lastSupervisorEntry.analysis.concerns.join('; ')}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
