/**
 * AgentsList - List view component showing all agents grouped by area
 * Includes GlobalSupervisorStatus and AgentListItem components
 */

import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, store, useCustomAgentClassesArray } from '../../store';
import { getClassConfig } from '../../utils/classConfig';
import { PROGRESS_COLORS } from '../../utils/colors';
import { formatIdleTime, filterCostText } from '../../utils/formatting';
import { getIdleTimerColor } from '../../utils/colors';
import { STORAGE_KEYS, getStorageBoolean, setStorageBoolean } from '../../utils/storage';
import { formatIdleCompact, formatRelativeTime, groupAgentsByArea, sortAreaIds } from './agentUtils';
import type { AgentsListProps, AgentListItemProps, GlobalSupervisorStatusProps, AgentStatusWithHistory } from './types';

// ============================================================================
// AgentsList Component
// ============================================================================

export function AgentsList({ onOpenAreaExplorer }: AgentsListProps) {
  const { t } = useTranslation(['common']);
  const state = useStore();
  const agentsArray = Array.from(state.agents.values());
  const areasArray = Array.from(state.areas.values());

  // Create a stable key for agent IDs to avoid re-running effect on every render
  const agentIds = useMemo(() => agentsArray.map(a => a.id).sort().join(','), [agentsArray]);

  // Track which agents we've already requested history for (avoid duplicate requests)
  const requestedHistoryRef = useRef<Set<string>>(new Set());

  // Request supervisor history for all agents that don't have it yet (only once per agent)
  useEffect(() => {
    for (const agent of agentsArray) {
      // Skip if we've already requested this agent's history
      if (requestedHistoryRef.current.has(agent.id)) continue;

      const history = store.getAgentSupervisorHistory(agent.id);
      if (history.length === 0 && !store.isLoadingHistoryForAgent(agent.id)) {
        requestedHistoryRef.current.add(agent.id);
        store.requestAgentSupervisorHistory(agent.id);
      }
    }
  }, [agentIds]);

  // Group agents by area
  const agentsByArea = groupAgentsByArea(agentsArray, (id) => store.getAreaForAgent(id));

  // Make sure all areas are included (even empty ones)
  for (const area of areasArray) {
    if (!agentsByArea.has(area.id)) {
      agentsByArea.set(area.id, []);
    }
  }

  // Sort: areas first (alphabetically), then unassigned
  const sortedAreaIds = sortAreaIds(
    Array.from(agentsByArea.keys()),
    (id) => state.areas.get(id)
  );

  // Show empty state only if no agents AND no areas
  if (agentsArray.length === 0 && areasArray.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⚔️</div>
        <div className="empty-state-title">{t('agentsList.noAgentsDeployed')}</div>
        <div className="empty-state-desc">{t('agentsList.clickNewAgent')}</div>
      </div>
    );
  }

  return (
    <div className="agents-list">
      <div className="agents-list-header">{t('agentsList.areasAndAgents')}</div>
      {sortedAreaIds.map((areaId) => {
        const agents = agentsByArea.get(areaId)!;
        const area = areaId ? state.areas.get(areaId) : null;

        return (
          <div key={areaId || 'unassigned'} className="agents-group">
            <div
              className="agents-group-header"
              style={area ? {
                borderLeftColor: area.color,
                background: `${area.color}15`
              } : undefined}
            >
              {area ? (
                <>
                  <span className="agents-group-dot" style={{ background: area.color }} />
                  <span className="agents-group-name">{area.name}</span>
                  {area.directories.length > 0 && (
                    <button
                      className="area-browse-btn"
                      onClick={() => onOpenAreaExplorer?.(area.id)}
                      title={t('agentsList.browseFiles')}
                    >
                      📂
                    </button>
                  )}
                </>
              ) : (
                <span className="agents-group-name unassigned">{t('agentsList.unassigned')}</span>
              )}
              <span className="agents-group-count">{agents.length}</span>
            </div>

            {agents.length > 0 && (
              <div
                className="agents-group-items"
                style={area ? { background: `${area.color}08` } : undefined}
              >
                {agents.map((agent) => (
                  <AgentListItem key={agent.id} agent={agent} area={area} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Global Supervisor Status - show latest status for all agents from history */}
      {agentsArray.length > 0 && (
        <GlobalSupervisorStatus agents={agentsArray} />
      )}
    </div>
  );
}

// ============================================================================
// AgentListItem Component
// ============================================================================

const AgentListItem = memo(function AgentListItem({ agent, area: _area }: AgentListItemProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const classConfig = getClassConfig(agent.class, customClasses);
  const isSelected = state.selectedAgentIds.has(agent.id);
  const [, setTick] = useState(0);

  // Update idle timer every 15 seconds when agent is idle
  useEffect(() => {
    if (agent.status === 'idle') {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [agent.status]);

  const handleClick = () => {
    store.selectAgent(agent.id);
  };

  // Get idle timer color
  const showIdleClock = agent.status === 'idle' && agent.lastActivity > 0;
  const idleColor = agent.lastActivity > 0 ? getIdleTimerColor(agent.lastActivity) : undefined;

  return (
    <div className={`agent-item ${isSelected ? 'selected' : ''}`} onClick={handleClick}>
      <div className="agent-item-icon" style={{ background: `${classConfig.color}20` }}>
        {classConfig.icon}
      </div>
      <div className="agent-item-info">
        <div className="agent-item-name">{agent.name}</div>
        <div className="agent-item-status">
          {agent.status}
          {agent.currentTool ? ` • ${agent.currentTool}` : ''}
          {showIdleClock && (
            <span className="agent-item-idle" style={{ color: idleColor }} title={formatIdleTime(agent.lastActivity)}>
              {' '}⏱ {formatIdleCompact(agent.lastActivity)}
            </span>
          )}
        </div>
      </div>
      <div className={`agent-status-dot ${agent.status}`}></div>
    </div>
  );
});

// ============================================================================
// GlobalSupervisorStatus Component
// ============================================================================

const GlobalSupervisorStatus = memo(function GlobalSupervisorStatus({ agents }: GlobalSupervisorStatusProps) {
  const { t } = useTranslation(['common']);
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const hideCost = state.settings.hideCost;
  const [collapsed, setCollapsed] = useState(() => getStorageBoolean(STORAGE_KEYS.GLOBAL_SUPERVISOR_COLLAPSED));

  const handleToggle = () => {
    const newValue = !collapsed;
    setCollapsed(newValue);
    setStorageBoolean(STORAGE_KEYS.GLOBAL_SUPERVISOR_COLLAPSED, newValue);
  };

  // Get the most recent supervisor history entry for each agent
  const agentStatuses: AgentStatusWithHistory[] = useMemo(() => {
    return agents
      .map(agent => {
        const history = store.getAgentSupervisorHistory(agent.id);
        const latestEntry = history.length > 0 ? history[0] : null;
        return {
          agent,
          entry: latestEntry,
          timestamp: latestEntry?.timestamp || agent.lastActivity || 0,
        };
      })
      .filter(item => item.entry !== null)
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }, [agents, state.supervisor.agentHistories]);

  // Find the most recent timestamp for the header
  const mostRecentTimestamp = agentStatuses.length > 0 ? agentStatuses[0].timestamp : Date.now();

  if (agentStatuses.length === 0) {
    return null;
  }

  return (
    <div className="global-supervisor-status">
      <div className="global-supervisor-header" onClick={handleToggle}>
        <span className="global-supervisor-toggle">{collapsed ? '▶' : '▼'}</span>
        <span className="global-supervisor-title">{t('agentsList.supervisorStatus')}</span>
        <span className="global-supervisor-time">{formatRelativeTime(mostRecentTimestamp)}</span>
      </div>
      {!collapsed && (
        <div className="global-supervisor-list">
          {agentStatuses.map(({ agent, entry }) => {
            const classConfig = getClassConfig(agent.class, customClasses);
            const analysis = entry!.analysis;

            return (
              <div
                key={agent.id}
                className="global-supervisor-item"
                onClick={() => store.selectAgent(agent.id)}
              >
                <div className="global-supervisor-item-header">
                  <span
                    className="global-supervisor-progress-dot"
                    style={{ background: PROGRESS_COLORS[analysis.progress] || '#888' }}
                  />
                  <span className="global-supervisor-agent-icon">{classConfig.icon}</span>
                  <span className="global-supervisor-agent-name">{agent.name}</span>
                  <span className="global-supervisor-item-time">
                    {formatRelativeTime(entry!.timestamp)}
                  </span>
                </div>
                <div className="global-supervisor-status-line">
                  {filterCostText(analysis.statusDescription, hideCost)}
                </div>
                <div className="global-supervisor-summary-text">
                  {filterCostText(analysis.recentWorkSummary, hideCost)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export { AgentListItem, GlobalSupervisorStatus };
