/**
 * DashboardView - Zone-centric agent management dashboard
 *
 * Groups agents by their DrawingArea (zone), shows context usage,
 * current tasks, and provides quick actions (chat, focus, kill).
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useAgents, useBuildings, useSelectedAgentIds, useAreas } from '../../store/selectors';
import { AgentCard } from './AgentStatusCards';
import { BuildingPills } from './BuildingStatusOverview';
import {
  groupAgentsByZone,
  groupAgentsByStatus,
  filterAgentsByStatusAndSearch,
  sortAgentsInGroup,
} from './utils';
import type { DashboardViewProps, GroupingMode, StatusFilter } from './types';
import './DashboardView.scss';

export function DashboardView({
  onSelectAgent,
  onFocusAgent,
  onKillAgent,
  onSelectBuilding,
  onOpenTerminal,
  onFocusZone,
}: DashboardViewProps) {
  const agents = useAgents();
  const buildings = useBuildings();
  const areas = useAreas();
  const selectedAgentIds = useSelectedAgentIds();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [grouping, setGrouping] = useState<GroupingMode>('zone');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Metrics
  const metrics = useMemo(() => {
    const all = Array.from(agents.values());
    return {
      total: all.length,
      working: all.filter(a => a.status === 'working' || a.status === 'waiting' || a.status === 'waiting_permission').length,
      idle: all.filter(a => a.status === 'idle').length,
      error: all.filter(a => a.status === 'error' || a.status === 'offline' || a.status === 'orphaned').length,
    };
  }, [agents]);

  // Filter agents first, then group
  const filteredAgents = useMemo(
    () => filterAgentsByStatusAndSearch(agents, statusFilter, search),
    [agents, statusFilter, search],
  );

  const groups = useMemo(() => {
    if (grouping === 'zone') {
      return groupAgentsByZone(filteredAgents, areas);
    }
    return groupAgentsByStatus(filteredAgents);
  }, [filteredAgents, areas, grouping]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const handleDoubleClick = useCallback((agentId: string) => {
    onOpenTerminal?.(agentId);
  }, [onOpenTerminal]);

  return (
    <div className="dashboard-view">
      {/* Top bar: metrics + search */}
      <div className="dashboard-view__topbar">
        <div className="dashboard-view__metrics">
          <button
            className={`dashboard-view__metric-btn ${statusFilter === 'all' ? 'dashboard-view__metric-btn--active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            <span className="dashboard-view__metric-value">{metrics.total}</span>
            <span className="dashboard-view__metric-label">Agents</span>
          </button>
          <button
            className={`dashboard-view__metric-btn dashboard-view__metric-btn--working ${statusFilter === 'working' ? 'dashboard-view__metric-btn--active' : ''}`}
            onClick={() => setStatusFilter('working')}
          >
            <span className="dashboard-view__metric-value">{metrics.working}</span>
            <span className="dashboard-view__metric-label">Working</span>
          </button>
          <button
            className={`dashboard-view__metric-btn dashboard-view__metric-btn--idle ${statusFilter === 'all' ? '' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            <span className="dashboard-view__metric-value">{metrics.idle}</span>
            <span className="dashboard-view__metric-label">Idle</span>
          </button>
          <button
            className={`dashboard-view__metric-btn dashboard-view__metric-btn--error ${statusFilter === 'error' ? 'dashboard-view__metric-btn--active' : ''}`}
            onClick={() => setStatusFilter('error')}
          >
            <span className="dashboard-view__metric-value">{metrics.error}</span>
            <span className="dashboard-view__metric-label">Errors</span>
          </button>
        </div>

        <input
          className="dashboard-view__search"
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Grouping toggle */}
      <div className="dashboard-view__grouping">
        <button
          className={`dashboard-view__grouping-btn ${grouping === 'zone' ? 'dashboard-view__grouping-btn--active' : ''}`}
          onClick={() => setGrouping('zone')}
        >
          By Zone
        </button>
        <button
          className={`dashboard-view__grouping-btn ${grouping === 'status' ? 'dashboard-view__grouping-btn--active' : ''}`}
          onClick={() => setGrouping('status')}
        >
          By Status
        </button>
      </div>

      {/* Scrollable content */}
      <div className="dashboard-view__content">
        {/* Zone groups */}
        {groups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.label);
          const sorted = sortAgentsInGroup(group.agents);
          const workingCount = group.agents.filter(a => a.status === 'working' || a.status === 'waiting' || a.status === 'waiting_permission').length;

          return (
            <div key={group.label} className="dashboard-view__zone">
              <div
                className="dashboard-view__zone-header"
                onClick={() => toggleGroup(group.label)}
              >
                <div className="dashboard-view__zone-left">
                  <span className={`dashboard-view__zone-chevron ${isCollapsed ? 'dashboard-view__zone-chevron--collapsed' : ''}`}>
                    ▼
                  </span>
                  <span
                    className="dashboard-view__zone-dot"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="dashboard-view__zone-name">{group.label}</span>
                  <span className="dashboard-view__zone-count">
                    {group.agents.length} agent{group.agents.length !== 1 ? 's' : ''}
                    {workingCount > 0 && <span className="dashboard-view__zone-working"> · {workingCount} working</span>}
                  </span>
                </div>
                {group.area && onFocusZone && (
                  <button
                    className="dashboard-view__zone-focus"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFocusZone(group.area!.id);
                    }}
                    title="Focus zone in 3D view"
                  >
                    Focus Zone
                  </button>
                )}
              </div>

              {!isCollapsed && (
                <div className="dashboard-view__zone-grid">
                  {sorted.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      isSelected={selectedAgentIds.has(agent.id)}
                      onSelect={() => onSelectAgent?.(agent.id)}
                      onDoubleClick={() => handleDoubleClick(agent.id)}
                      onChat={() => onOpenTerminal?.(agent.id)}
                      onFocus={onFocusAgent ? () => onFocusAgent(agent.id) : undefined}
                      onKill={onKillAgent ? () => onKillAgent(agent.id) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {groups.length === 0 && (
          <div className="dashboard-view__empty">
            {search ? `No agents matching "${search}"` : 'No agents spawned yet'}
          </div>
        )}

        {/* Buildings section */}
        {buildings.size > 0 && (
          <BuildingPills
            buildings={buildings}
            onSelectBuilding={onSelectBuilding}
          />
        )}
      </div>
    </div>
  );
}
