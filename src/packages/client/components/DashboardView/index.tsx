/**
 * DashboardView - Zone-centric agent management dashboard
 *
 * Groups agents by their DrawingArea (zone), shows context usage,
 * current tasks, and provides quick actions (chat, focus, kill).
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../../store';
import { useAgents, useBuildings, useSelectedAgentIds, useAreas, useAgentsWithUnseenOutput } from '../../store/selectors';
import { matchesShortcut } from '../../store/shortcuts';
import type { Agent } from '@shared/types';
import { AgentCard } from './AgentStatusCards';
import { BuildingPills } from './BuildingStatusOverview';
import {
  groupAgentsByZone,
  groupAgentsByStatus,
  groupAgentsByActivity,
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
  const { t } = useTranslation(['dashboard', 'common']);
  const agents = useAgents();
  const buildings = useBuildings();
  const areas = useAreas();
  const selectedAgentIds = useSelectedAgentIds();
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [grouping, setGrouping] = useState<GroupingMode>('zone');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [draggedAgent, setDraggedAgent] = useState<Agent | null>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [keyboardSelectorEnabled, setKeyboardSelectorEnabled] = useState(false);
  const [keyboardFocusedAgentId, setKeyboardFocusedAgentId] = useState<string | null>(null);

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

  const getGroupKey = useCallback((group: { area: { id: string } | null; label: string }): string => {
    if (group.area) {
      return `area:${group.area.id}`;
    }
    return `${grouping}:${group.label}`;
  }, [grouping]);

  const visibleAgents = useMemo(() => {
    const agentsInView: Agent[] = [];
    groups.forEach((group) => {
      const groupKey = getGroupKey(group);
      if (collapsedGroups.has(groupKey)) {
        return;
      }
      const sorted = grouping === 'status'
        ? sortAgentsInGroupWithOptions(group.agents, { prioritizeRecentlyIdle: true })
        : sortAgentsInGroup(group.agents);
      agentsInView.push(...sorted);
    });
    return agentsInView;
  }, [groups, collapsedGroups, grouping, getGroupKey]);

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
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

  // Keep keyboard focus anchored to available cards.
  useEffect(() => {
    if (visibleAgents.length === 0) {
      setKeyboardSelectorEnabled(false);
      setKeyboardFocusedAgentId(null);
      return;
    }

    if (!keyboardSelectorEnabled) {
      return;
    }

    if (!keyboardFocusedAgentId || !visibleAgents.some(agent => agent.id === keyboardFocusedAgentId)) {
      setKeyboardFocusedAgentId(visibleAgents[0].id);
      onSelectAgent?.(visibleAgents[0].id);
    }
  }, [visibleAgents, keyboardSelectorEnabled, keyboardFocusedAgentId, onSelectAgent]);

  // Dashboard keyboard shortcuts: selector + vim nav + open terminal.
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT'
        || target.isContentEditable;
    };

    const isGuakeElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return !!target.closest('.guake-terminal') || target.classList.contains('guake-input') || target.classList.contains('agent-panel-input');
    };

    const scrollCardIntoView = (agentId: string): void => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('.dash-card[data-agent-id]'))
        .find((node) => node.dataset.agentId === agentId);
      card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    const moveFocus = (
      currentId: string,
      direction: 'left' | 'right' | 'up' | 'down'
    ): string => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.dash-card[data-agent-id]'))
        .map((node) => {
          const id = node.dataset.agentId;
          if (!id) return null;
          const rect = node.getBoundingClientRect();
          return {
            id,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            height: rect.height,
          };
        })
        .filter((entry): entry is { id: string; centerX: number; centerY: number; height: number } => entry !== null)
        .sort((a, b) => (a.centerY - b.centerY) || (a.centerX - b.centerX));

      if (cards.length === 0) return currentId;

      const avgHeight = cards.reduce((sum, card) => sum + card.height, 0) / cards.length;
      const rowTolerance = Math.max(18, avgHeight * 0.6);

      const rows: Array<Array<{ id: string; centerX: number; centerY: number }>> = [];
      for (const card of cards) {
        const lastRow = rows[rows.length - 1];
        if (!lastRow) {
          rows.push([{ id: card.id, centerX: card.centerX, centerY: card.centerY }]);
          continue;
        }
        const rowCenterY = lastRow.reduce((sum, item) => sum + item.centerY, 0) / lastRow.length;
        if (Math.abs(card.centerY - rowCenterY) <= rowTolerance) {
          lastRow.push({ id: card.id, centerX: card.centerX, centerY: card.centerY });
        } else {
          rows.push([{ id: card.id, centerX: card.centerX, centerY: card.centerY }]);
        }
      }

      rows.forEach((row) => row.sort((a, b) => a.centerX - b.centerX));

      const currentRowIndex = rows.findIndex((row) => row.some((card) => card.id === currentId));
      if (currentRowIndex === -1) {
        return rows[0]?.[0]?.id ?? currentId;
      }

      const currentRow = rows[currentRowIndex];
      const currentColIndex = currentRow.findIndex((card) => card.id === currentId);
      if (currentColIndex === -1) {
        return rows[0]?.[0]?.id ?? currentId;
      }

      if (direction === 'left') {
        return currentRow[Math.max(0, currentColIndex - 1)]?.id ?? currentId;
      }
      if (direction === 'right') {
        return currentRow[Math.min(currentRow.length - 1, currentColIndex + 1)]?.id ?? currentId;
      }

      const targetRowIndex = direction === 'up'
        ? Math.max(0, currentRowIndex - 1)
        : Math.min(rows.length - 1, currentRowIndex + 1);
      const targetRow = rows[targetRowIndex];
      const currentCenterX = currentRow[currentColIndex].centerX;

      let best = targetRow[0];
      let bestDistance = Math.abs(best.centerX - currentCenterX);
      for (const candidate of targetRow) {
        const distance = Math.abs(candidate.centerX - currentCenterX);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }

      return best?.id ?? currentId;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = store.getShortcuts();
      const selectorShortcut = shortcuts.find(s => s.id === 'dashboard-selector-toggle');
      const leftShortcut = shortcuts.find(s => s.id === 'dashboard-vim-left');
      const downShortcut = shortcuts.find(s => s.id === 'dashboard-vim-down');
      const upShortcut = shortcuts.find(s => s.id === 'dashboard-vim-up');
      const rightShortcut = shortcuts.find(s => s.id === 'dashboard-vim-right');
      const openTerminalShortcut = shortcuts.find(s => s.id === 'open-terminal');
      const state = store.getState();

      if (isTypingTarget(e.target)) {
        // If terminal is closed but focus is still on hidden guake input, reclaim focus for dashboard navigation.
        if (!state.terminalOpen && isGuakeElement(e.target) && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        } else {
          return;
        }
      }

      if (matchesShortcut(e, selectorShortcut)) {
        if (visibleAgents.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        setKeyboardSelectorEnabled(true);
        setKeyboardFocusedAgentId((previousFocused) => {
          const focused = previousFocused && visibleAgents.some(agent => agent.id === previousFocused)
            ? previousFocused
            : visibleAgents[0].id;
          onSelectAgent?.(focused);
          window.setTimeout(() => scrollCardIntoView(focused), 0);
          return focused;
        });
        return;
      }

      const navDirection = matchesShortcut(e, leftShortcut) || e.key === 'ArrowLeft'
        ? 'left'
        : (matchesShortcut(e, downShortcut) || e.key === 'ArrowDown')
          ? 'down'
          : (matchesShortcut(e, upShortcut) || e.key === 'ArrowUp')
            ? 'up'
            : (matchesShortcut(e, rightShortcut) || e.key === 'ArrowRight')
              ? 'right'
              : null;

      if (navDirection && keyboardSelectorEnabled && keyboardFocusedAgentId) {
        e.preventDefault();
        e.stopPropagation();
        const nextAgentId = moveFocus(keyboardFocusedAgentId, navDirection);
        if (nextAgentId !== keyboardFocusedAgentId) {
          setKeyboardFocusedAgentId(nextAgentId);
          onSelectAgent?.(nextAgentId);
          window.setTimeout(() => scrollCardIntoView(nextAgentId), 0);
        }
        return;
      }

      if (matchesShortcut(e, openTerminalShortcut)) {
        // Don't trigger if terminal is already open
        if (state.terminalOpen) {
          return;
        }

        // If keyboard selector is active, open terminal for focused card.
        if (keyboardSelectorEnabled && keyboardFocusedAgentId && state.agents.has(keyboardFocusedAgentId)) {
          e.preventDefault();
          onOpenTerminal?.(keyboardFocusedAgentId);
          return;
        }

        // If an agent is selected, open terminal for it.
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

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visibleAgents, keyboardSelectorEnabled, keyboardFocusedAgentId, onOpenTerminal, onSelectAgent]);

  // Dashboard mode should not keep hidden terminal input focused.
  useEffect(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active.closest('.guake-terminal') && !store.getState().terminalOpen) {
      active.blur();
    }
  }, []);

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
            <span className="dashboard-view__metric-label">{t('common:labels.agents')}</span>
          </button>
          <button
            className={`dashboard-view__metric-btn dashboard-view__metric-btn--working ${statusFilter === 'working' ? 'dashboard-view__metric-btn--active' : ''}`}
            onClick={() => setStatusFilter('working')}
          >
            <span className="dashboard-view__metric-value">{metrics.working}</span>
            <span className="dashboard-view__metric-label">{t('common:status.working')}</span>
          </button>
          <button
            className={`dashboard-view__metric-btn dashboard-view__metric-btn--idle ${statusFilter === 'all' ? '' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            <span className="dashboard-view__metric-value">{metrics.idle}</span>
            <span className="dashboard-view__metric-label">{t('common:status.idle')}</span>
          </button>
          <button
            className={`dashboard-view__metric-btn dashboard-view__metric-btn--error ${statusFilter === 'error' ? 'dashboard-view__metric-btn--active' : ''}`}
            onClick={() => setStatusFilter('error')}
          >
            <span className="dashboard-view__metric-value">{metrics.error}</span>
            <span className="dashboard-view__metric-label">{t('common:status.error')}</span>
          </button>
        </div>

        <input
          className="dashboard-view__search"
          type="text"
          placeholder={t('searchPlaceholder')}
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
          {t('grouping.byZone')}
        </button>
        <button
          className={`dashboard-view__grouping-btn ${grouping === 'status' ? 'dashboard-view__grouping-btn--active' : ''}`}
          onClick={() => setGrouping('status')}
        >
          {t('grouping.byStatus')}
        </button>
        <button
          className={`dashboard-view__grouping-btn ${grouping === 'activity' ? 'dashboard-view__grouping-btn--active' : ''}`}
          onClick={() => setGrouping('activity')}
        >
          {t('grouping.byActivity')}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="dashboard-view__content">
        {/* Zone groups */}
        {groups.map((group) => {
          const groupKey = getGroupKey(group);
          const isCollapsed = collapsedGroups.has(groupKey);
          const sorted = grouping === 'status'
            ? sortAgentsInGroupWithOptions(group.agents, { prioritizeRecentlyIdle: true })
            : sortAgentsInGroup(group.agents);
          const workingCount = group.agents.filter(a => a.status === 'working' || a.status === 'waiting' || a.status === 'waiting_permission').length;
          const unseenCount = group.agents.filter(a => agentsWithUnseenOutput.has(a.id)).length;

          return (
            <div
              key={groupKey}
              className={`dashboard-view__zone ${dragOverZoneId === (group.area ? group.area.id : null) && draggedAgent ? 'dashboard-view__zone--drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, group.area ? group.area.id : null)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDropOnZone(group.area ? group.area.id : null)}
            >
              <div
                className="dashboard-view__zone-header"
                onClick={() => toggleGroup(groupKey)}
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
                    {t('agentCount', { count: group.agents.length })}
                    {workingCount > 0 && <span className="dashboard-view__zone-working"> · {workingCount} {t('working')}</span>}
                    {unseenCount > 0 && <span className="dashboard-view__zone-unseen"> · {unseenCount} Unseen</span>}
                  </span>
                </div>
                {group.area && onFocusZone && (
                  <button
                    className="dashboard-view__zone-focus"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFocusZone(group.area!.id);
                    }}
                    title={t('focusZone')}
                  >
                    {t('focusZone')}
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
                      isKeyboardFocused={keyboardSelectorEnabled && keyboardFocusedAgentId === agent.id}
                      onSelect={() => {
                        onSelectAgent?.(agent.id);
                        setKeyboardSelectorEnabled(true);
                        setKeyboardFocusedAgentId(agent.id);
                      }}
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
            {search ? t('noAgentsMatching', { search }) : t('noAgentsSpawned')}
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
