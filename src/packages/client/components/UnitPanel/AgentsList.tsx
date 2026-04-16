/**
 * AgentsList - Enhanced list view component showing all agents grouped by area
 * Features: search, status filters, task labels, context bars, provider badges
 * Includes GlobalSupervisorStatus and AgentListItem components
 */

import React, { useState, useRef, useEffect, useMemo, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, store, useCustomAgentClassesArray } from '../../store';
import { getClassConfig } from '../../utils/classConfig';
import { formatIdleTime } from '../../utils/formatting';
import { getIdleTimerColor } from '../../utils/colors';
import { STORAGE_KEYS, getStorageBoolean, setStorageBoolean, getStorageString, setStorageString } from '../../utils/storage';
import { formatIdleCompact, formatRelativeTime, calculateContextInfo, getContextBarColor, groupAgentsByArea, sortAreaIds, sortAgentsByActivity } from './agentUtils';
import type { Agent, AgentSupervisorHistoryEntry } from '../../../shared/types';
import type { AgentsListProps, AgentListItemProps, GlobalSupervisorStatusProps } from './types';
import { SupervisorHistoryItem } from './SingleAgentPanel';
import { AgentIcon } from '../AgentIcon';

// ============================================================================
// Types
// ============================================================================

type StatusFilter = 'all' | 'active' | 'idle' | 'error' | 'waiting';

// ============================================================================
// AgentsList Component
// ============================================================================

export function AgentsList({ onOpenAreaExplorer }: AgentsListProps) {
  const { t } = useTranslation(['common']);
  const state = useStore();
  const agentsArray = Array.from(state.agents.values());
  const areasArray = Array.from(state.areas.values());

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const stored = getStorageString(STORAGE_KEYS.COMMANDER_FILTERS, 'all');
    // Migrate legacy 'working' filter to 'active'
    if (stored === 'working') return 'active';
    return (stored as StatusFilter) || 'all';
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // Agents with unseen output (completed work but user hasn't viewed yet)
  const unseenAgents = state.agentsWithUnseenOutput;

  // Compute status counts for filter chips
  const statusCounts = useMemo(() => {
    const counts = { all: 0, active: 0, idle: 0, error: 0, waiting: 0 };
    for (const agent of agentsArray) {
      counts.all++;
      // "Active" = working OR has unread output
      if (agent.status === 'working' || unseenAgents.has(agent.id)) counts.active++;
      if (agent.status === 'idle' && !unseenAgents.has(agent.id)) counts.idle++;
      if (agent.status === 'error' || agent.status === 'orphaned' || agent.status === 'offline') counts.error++;
      if (agent.status === 'waiting' || agent.status === 'waiting_permission') counts.waiting++;
    }
    return counts;
  }, [agentsArray, unseenAgents]);

  // Filter agents by search query and status
  const filteredAgents = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return agentsArray.filter(agent => {
      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && agent.status !== 'working' && !unseenAgents.has(agent.id)) return false;
        if (statusFilter === 'idle' && (agent.status !== 'idle' || unseenAgents.has(agent.id))) return false;
        if (statusFilter === 'error' && agent.status !== 'error' && agent.status !== 'orphaned' && agent.status !== 'offline') return false;
        if (statusFilter === 'waiting' && agent.status !== 'waiting' && agent.status !== 'waiting_permission') return false;
      }
      // Search filter
      if (query) {
        const nameMatch = agent.name.toLowerCase().includes(query);
        const taskMatch = agent.taskLabel?.toLowerCase().includes(query) || false;
        const classMatch = agent.class.toLowerCase().includes(query);
        const toolMatch = agent.currentTool?.toLowerCase().includes(query) || false;
        return nameMatch || taskMatch || classMatch || toolMatch;
      }
      return true;
    });
  }, [agentsArray, searchQuery, statusFilter, unseenAgents]);

  // Sort filtered agents by activity (working first, then by recency)
  const sortedAgents = useMemo(() => sortAgentsByActivity(filteredAgents), [filteredAgents]);

  // Group sorted agents by area
  const agentsByArea = groupAgentsByArea(sortedAgents, (id) => store.getAreaForAgent(id));

  // Make sure all areas are included (even empty ones) only when not filtering
  if (!searchQuery && statusFilter === 'all') {
    for (const area of areasArray) {
      if (!agentsByArea.has(area.id)) {
        agentsByArea.set(area.id, []);
      }
    }
  }

  // Sort: areas first (alphabetically), then unassigned
  const sortedAreaIds = sortAreaIds(
    Array.from(agentsByArea.keys()),
    (id) => state.areas.get(id)
  );

  const handleFilterChange = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter);
    setStorageString(STORAGE_KEYS.COMMANDER_FILTERS, filter);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

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

  const isFiltering = searchQuery || statusFilter !== 'all';
  const filteredCount = filteredAgents.length;
  const totalCount = agentsArray.length;

  return (
    <div className="agents-list">
      {/* Quick Stats Summary */}
      <div className="agents-stats-bar">
        <div className="agents-stats-item">
          <span className="agents-stats-count">{totalCount}</span>
          <span className="agents-stats-label">{t('agentsList.total')}</span>
        </div>
        {statusCounts.active > 0 && (
          <div className="agents-stats-item working">
            <span className="agents-stats-count">{statusCounts.active}</span>
            <span className="agents-stats-label">{t('agentsList.statusActive')}</span>
          </div>
        )}
        {statusCounts.idle > 0 && (
          <div className="agents-stats-item idle">
            <span className="agents-stats-count">{statusCounts.idle}</span>
            <span className="agents-stats-label">{t('agentsList.statusIdle')}</span>
          </div>
        )}
        {statusCounts.waiting > 0 && (
          <div className="agents-stats-item waiting">
            <span className="agents-stats-count">{statusCounts.waiting}</span>
            <span className="agents-stats-label">{t('agentsList.statusWaiting')}</span>
          </div>
        )}
        {statusCounts.error > 0 && (
          <div className="agents-stats-item error">
            <span className="agents-stats-count">{statusCounts.error}</span>
            <span className="agents-stats-label">{t('agentsList.statusError')}</span>
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="agents-search-bar">
        <span className="agents-search-icon">🔍</span>
        <input
          ref={searchInputRef}
          type="text"
          className="agents-search-input"
          placeholder={t('agentsList.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="agents-search-clear" onClick={handleClearSearch}>×</button>
        )}
      </div>

      {/* Status Filter Chips */}
      <div className="agents-filter-chips">
        {(['all', 'active', 'idle', 'waiting', 'error'] as StatusFilter[]).map(filter => {
          const count = statusCounts[filter];
          if (filter !== 'all' && count === 0) return null;
          return (
            <button
              key={filter}
              className={`agents-filter-chip ${filter} ${statusFilter === filter ? 'selected' : ''}`}
              onClick={() => handleFilterChange(filter)}
            >
              {t(`agentsList.filter_${filter}`)}
              <span className="agents-filter-chip-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Filtering indicator */}
      {isFiltering && (
        <div className="agents-filter-info">
          {t('agentsList.showing', { count: filteredCount, total: totalCount })}
          <button className="agents-filter-clear" onClick={() => { setSearchQuery(''); handleFilterChange('all'); }}>
            {t('agentsList.clearFilters')}
          </button>
        </div>
      )}

      {/* Grouped Agent List */}
      <div className="agents-list-scroll">
        {sortedAreaIds.map((areaId) => {
          const agents = agentsByArea.get(areaId)!;
          const area = areaId ? state.areas.get(areaId) : null;

          // Hide empty groups when filtering
          if (isFiltering && agents.length === 0) return null;

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
                    <AgentListItem key={agent.id} agent={agent} area={area} searchQuery={searchQuery} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* No results */}
        {isFiltering && filteredCount === 0 && (
          <div className="agents-no-results">
            <span className="agents-no-results-icon">🔎</span>
            <span>{t('agentsList.noResults')}</span>
          </div>
        )}

        {/* Supervisor History Timeline - below agent list */}
        {agentsArray.length > 0 && (
          <GlobalSupervisorStatus agents={agentsArray} />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// AgentListItem Component (Enhanced)
// ============================================================================

interface EnhancedAgentListItemProps extends AgentListItemProps {
  searchQuery?: string;
}

const AgentListItem = memo(function AgentListItem({ agent, area: _area, searchQuery = '' }: EnhancedAgentListItemProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const classConfig = getClassConfig(agent.class, customClasses);
  const isSelected = state.selectedAgentIds.has(agent.id);
  const hasUnread = state.agentsWithUnseenOutput.has(agent.id);
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

  // Context info for mini bar
  const contextInfo = calculateContextInfo(agent);
  const contextBarColor = getContextBarColor(contextInfo.remainingPercent);

  // Provider info
  const providerLabel = agent.provider === 'codex' ? 'CX' : agent.provider === 'opencode' ? 'OC' : 'CL';
  const providerTitle = agent.provider === 'codex' ? 'OpenAI Codex' : agent.provider === 'opencode' ? 'OpenCode' : 'Claude';

  // Highlight matching text
  const highlightText = (text: string) => {
    if (!searchQuery.trim()) return text;
    const query = searchQuery.trim();
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="agents-search-highlight">{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className={`agent-item ${isSelected ? 'selected' : ''} ${hasUnread ? 'unread' : ''} ${agent.status}`} onClick={handleClick}>
      {/* Icon */}
      <div className="agent-item-icon" style={{ background: `${classConfig.color}20` }}>
        <AgentIcon agent={agent} size={18} />
        {hasUnread && <span className="agent-item-unread-dot" />}
      </div>

      {/* Main info */}
      <div className="agent-item-info">
        <div className="agent-item-top-row">
          <span className="agent-item-name">{highlightText(agent.name)}</span>
          <span className={`agent-item-provider ${agent.provider}`} title={providerTitle}>
            {providerLabel}
          </span>
        </div>

        {/* Task label */}
        {agent.taskLabel && (
          <div className="agent-item-task">{highlightText(agent.taskLabel)}</div>
        )}

        {/* Status line */}
        <div className="agent-item-status">
          <span className={`agent-item-status-badge ${agent.status}`}>{agent.status}</span>
          {showIdleClock && (
            <span className="agent-item-idle" style={{ color: idleColor }} title={formatIdleTime(agent.lastActivity)}>
              ⏱ {formatIdleCompact(agent.lastActivity)}
            </span>
          )}
          {agent.isBoss && (
            <span className="agent-item-boss-badge" title="Boss agent">B</span>
          )}
        </div>

        {/* Mini context bar */}
        <div className="agent-item-context-bar" title={`Context: ${Math.round(contextInfo.usedPercent)}% used`}>
          <div
            className="agent-item-context-fill"
            style={{
              width: `${contextInfo.usedPercent}%`,
              background: contextBarColor,
            }}
          />
        </div>
      </div>

      {/* Status dot */}
      <div className={`agent-status-dot ${agent.status}`} />
    </div>
  );
});

// ============================================================================
// GlobalSupervisorStatus Component
// ============================================================================

interface CombinedTimelineEntry {
  agent: Agent;
  entry: AgentSupervisorHistoryEntry;
}

const GlobalSupervisorStatus = memo(function GlobalSupervisorStatus({ agents }: GlobalSupervisorStatusProps) {
  const { t } = useTranslation(['common']);
  const state = useStore();
  const [collapsed, setCollapsed] = useState(() => getStorageBoolean(STORAGE_KEYS.GLOBAL_SUPERVISOR_COLLAPSED));

  const handleToggle = () => {
    const newValue = !collapsed;
    setCollapsed(newValue);
    setStorageBoolean(STORAGE_KEYS.GLOBAL_SUPERVISOR_COLLAPSED, newValue);
  };

  // Build combined timeline: merge all entries from all agents, sorted by timestamp
  const combinedTimeline: CombinedTimelineEntry[] = useMemo(() => {
    const allEntries: CombinedTimelineEntry[] = [];

    for (const agent of agents) {
      const history = store.getAgentSupervisorHistory(agent.id);
      for (const entry of history) {
        allEntries.push({ agent, entry });
      }
    }

    // Sort by timestamp descending (most recent first)
    allEntries.sort((a, b) => b.entry.timestamp - a.entry.timestamp);

    // Limit to 30 entries for performance
    return allEntries.slice(0, 30);
  }, [agents, state.supervisor.agentHistories]);

  const handleAgentClick = useCallback((agentId: string) => {
    store.selectAgent(agentId);
  }, []);

  const mostRecentTimestamp = combinedTimeline.length > 0 ? combinedTimeline[0].entry.timestamp : Date.now();

  return (
    <div className="global-supervisor-status">
      <div className="global-supervisor-header" onClick={handleToggle}>
        <span className="global-supervisor-toggle">{collapsed ? '▶' : '▼'}</span>
        <span className="global-supervisor-title">{t('agentsList.supervisorStatus')}</span>
        {combinedTimeline.length > 0 && (
          <span className="global-supervisor-count">{combinedTimeline.length}</span>
        )}
        {combinedTimeline.length > 0 && (
          <span className="global-supervisor-time">{formatRelativeTime(mostRecentTimestamp)}</span>
        )}
      </div>
      {!collapsed && (
        <div className="global-supervisor-list global-supervisor-timeline">
          {combinedTimeline.length === 0 ? (
            <div className="global-supervisor-empty">{t('unitPanel.noSupervisorReports')}</div>
          ) : (
            combinedTimeline.map(({ agent, entry }) => (
              <SupervisorHistoryItem
                key={entry.id}
                entry={entry}
                agent={agent}
                onAgentClick={handleAgentClick}
                defaultExpanded={false}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
});

export { AgentListItem, GlobalSupervisorStatus };
