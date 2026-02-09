/**
 * DashboardView - Zone-centric agent management dashboard
 *
 * Groups agents by their DrawingArea (zone), shows context usage,
 * current tasks, and provides quick actions (chat, focus, kill).
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { store, useStore } from '../../store';
import { useAgents, useBuildings, useSelectedAgentIds, useAreas } from '../../store/selectors';
import { matchesShortcut } from '../../store/shortcuts';
import type { Agent } from '@shared/types';
import { AgentCard } from './AgentStatusCards';
import { BuildingPills } from './BuildingStatusOverview';
import {
  groupAgentsByZone,
  groupAgentsByStatus,
  groupAgentsByActivity,
  filterAgentsByStatusAndSearch,
  sortAgentsInGroup,
  sortAgentsInGroupWithOptions,
  findSafePositionInArea,
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
  const [draggedAgent, setDraggedAgent] = useState<Agent | null>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);

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

  // Group agents first by their grouping mode (use all agents)
  const allGroups = useMemo(() => {
    if (grouping === 'zone') {
      return groupAgentsByZone(agents, areas);
    } else if (grouping === 'status') {
      return groupAgentsByStatus(agents);
    }
    return groupAgentsByActivity(agents);
  }, [agents, areas, grouping]);

  // Then filter agents within each group by search and status
  // For 'zone' grouping, show all zones (even if filtered agents list becomes empty)
  // For other groupings, hide groups with no agents after filtering
  const groups = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();
    const filtered = allGroups.map(group => ({
      ...group,
      agents: group.agents.filter(agent => {
        // Status filter
        if (statusFilter === 'working') {
          if (agent.status !== 'working' && agent.status !== 'waiting' && agent.status !== 'waiting_permission') return false;
        } else if (statusFilter === 'error') {
          if (agent.status !== 'error' && agent.status !== 'offline' && agent.status !== 'orphaned') return false;
        }
        // Search filter
        if (lowerSearch && !agent.name.toLowerCase().includes(lowerSearch) && !agent.class.toLowerCase().includes(lowerSearch)) {
          return false;
        }
        return true;
      }),
    }));

    // For zone grouping, keep all zones even if empty (consistency with 3D scene)
    // For other groupings (status, activity), hide empty groups
    if (grouping === 'zone') {
      return filtered;
    }
    return filtered.filter(group => group.agents.length > 0);
  }, [allGroups, statusFilter, search, grouping]);

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

  const handleDragStart = useCallback((agent: Agent) => {
    setDraggedAgent(agent);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, zoneId: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverZoneId(zoneId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverZoneId(null);
  }, []);

  const handleDropOnZone = useCallback((areaId: string | null) => {
    if (!draggedAgent) return;

    // If dropping on unassigned, just unassign
    if (areaId === null) {
      // Unassign from current area if any
      const currentState = store.getState();
      const currentArea = Array.from(currentState.areas.values()).find(a =>
        a.assignedAgentIds.includes(draggedAgent.id)
      );
      if (currentArea) {
        store.unassignAgentFromArea(draggedAgent.id, currentArea.id);
      }
      setDraggedAgent(null);
      setDragOverZoneId(null);
      return;
    }

    const targetArea = areas.get(areaId);
    if (!targetArea) return; // Invalid area

    // Find safe position in target area
    const allAgents = Array.from(agents.values());
    const safePos = findSafePositionInArea(targetArea, allAgents, draggedAgent.position);

    // Update agent position and assign to area
    store.updateAgent({
      ...draggedAgent,
      position: {
        ...draggedAgent.position,
        x: safePos.x,
        z: safePos.z,
      },
    });
    store.assignAgentToArea(draggedAgent.id, areaId);
    setDraggedAgent(null);
    setDragOverZoneId(null);
  }, [draggedAgent, areas, agents]);

  // Handle space key to open terminal in dashboard mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Don't handle space if typing in an input field
      if (isInputFocused) {
        return;
      }

      const shortcuts = store.getShortcuts();
      const openTerminalShortcut = shortcuts.find(s => s.id === 'open-terminal');

      if (matchesShortcut(e, openTerminalShortcut)) {
        const state = store.getState();

        // Don't trigger if terminal is already open
        if (state.terminalOpen) {
          return;
        }

        // If an agent is selected, open terminal for it
        if (state.selectedAgentIds.size === 1) {
          e.preventDefault();
          const agentId = Array.from(state.selectedAgentIds)[0];
          onOpenTerminal?.(agentId);
          return;
        }

        // If no agent selected, try to open for the last selected agent
        if (state.lastSelectedAgentId && state.agents.has(state.lastSelectedAgentId)) {
          e.preventDefault();
          onOpenTerminal?.(state.lastSelectedAgentId);
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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
        <button
          className={`dashboard-view__grouping-btn ${grouping === 'activity' ? 'dashboard-view__grouping-btn--active' : ''}`}
          onClick={() => setGrouping('activity')}
        >
          By Activity
        </button>
      </div>

      {/* Scrollable content */}
      <div className="dashboard-view__content">
        {/* Zone groups */}
        {groups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.label);
          const sorted = grouping === 'status'
            ? sortAgentsInGroupWithOptions(group.agents, { prioritizeRecentlyIdle: true })
            : sortAgentsInGroup(group.agents);
          const workingCount = group.agents.filter(a => a.status === 'working' || a.status === 'waiting' || a.status === 'waiting_permission').length;

          return (
            <div
              key={group.label}
              className={`dashboard-view__zone ${dragOverZoneId === (group.area ? group.area.id : null) && draggedAgent ? 'dashboard-view__zone--drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, group.area ? group.area.id : null)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDropOnZone(group.area ? group.area.id : null)}
            >
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
                      onDragStart={handleDragStart}
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
