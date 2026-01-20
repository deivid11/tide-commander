/**
 * GuakeAgentLink component - agent indicator in the bottom bar
 */

import React, { useState, useEffect } from 'react';
import { useCustomAgentClassesArray } from '../../store';
import type { Agent } from '../../../shared/types';
import { formatIdleTime } from '../../utils/formatting';
import { getClassConfig } from '../../utils/classConfig';
import { getIdleTimerColor, getAgentStatusColor } from '../../utils/colors';
import { TOOL_ICONS } from '../../utils/outputRendering';

/**
 * Compact idle time format for small spaces (e.g., "2m", "1h", "3d")
 */
function formatIdleTimeCompact(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface GuakeAgentLinkProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

export function GuakeAgentLink({ agent, isSelected, onClick }: GuakeAgentLinkProps) {
  const customClasses = useCustomAgentClassesArray();
  const [, setTick] = useState(0);
  const config = getClassConfig(agent.class, customClasses);

  // Update timer every second when agent is idle
  useEffect(() => {
    if (agent.status === 'idle' && agent.lastActivity > 0) {
      const interval = setInterval(() => {
        setTick((t) => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [agent.status, agent.lastActivity]);

  const showIdleTimer = agent.status === 'idle' && agent.lastActivity > 0;

  return (
    <div
      className={`guake-agent-link ${isSelected ? 'selected' : ''} ${agent.status}`}
      onClick={onClick}
      title={`${agent.name} - ${agent.status}${agent.currentTool ? ` (${agent.currentTool})` : ''}${agent.lastActivity ? ` • Idle: ${formatIdleTime(agent.lastActivity)}` : ''}${agent.lastAssignedTask ? `\n📋 ${agent.lastAssignedTask}` : ''}`}
    >
      <span className="guake-agent-link-icon">{config.icon}</span>
      <span className="guake-agent-link-status" style={{ backgroundColor: getAgentStatusColor(agent.status) }} />
      {showIdleTimer && (
        <span className="guake-agent-link-idle" style={{ color: getIdleTimerColor(agent.lastActivity) }}>
          {formatIdleTimeCompact(agent.lastActivity)}
        </span>
      )}
      {agent.currentTool && (
        <span className="guake-agent-link-tool">{TOOL_ICONS[agent.currentTool] || TOOL_ICONS.default}</span>
      )}
    </div>
  );
}
