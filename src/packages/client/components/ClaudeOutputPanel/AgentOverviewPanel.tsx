/**
 * Agent Overview Panel
 *
 * Displays all agents grouped by area in a collapsible side panel within the Guake Terminal.
 * Shows agent status, last message, recent tool activity, and subagent information.
 * Inspired by the AgentDebugPanel layout.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAgentsArray,
  useAgentsWithUnseenOutput,
  useCustomAgentClassesArray,
  useToolExecutions,
  useSubagents,
  useAreas,
  useFileChanges,
  store,
} from '../../store';
import { TOOL_ICONS, formatTimestamp } from '../../utils/outputRendering';
import { STORAGE_KEYS, getStorage, setStorage } from '../../utils/storage';
import { getClassConfig } from '../../utils/classConfig';
import type { Agent, Subagent, DrawingArea } from '../../../shared/types';
import type { ToolExecution, ClaudeOutput } from '../../store/types';

/** Persisted config shape for the overview panel */
interface AopConfig {
  groupByArea: boolean;
  sortMode: SortMode;
  filterMode: FilterMode;
  allExpanded: boolean; // true = expand all by default, false = collapse all
  sameAreaOnly: boolean; // only show agents in the same area as the active agent
  showSubagents: boolean; // show subagents section in expanded cards
  showRecentActivity: boolean; // show recent activity section in expanded cards
}

interface AgentOverviewPanelProps {
  activeAgentId: string;
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
}

type SortMode = 'name' | 'status' | 'recent';
type FilterMode = 'all' | 'working' | 'idle' | 'error';

const STATUS_ICONS: Record<string, string> = {
  working: '🟢',
  idle: '💤',
  waiting_input: '🟡',
  waiting_permission: '🟠',
  error: '🔴',
  stopped: '⚫',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  working: 'overview.statusLabels.working',
  idle: 'overview.statusLabels.idle',
  waiting_input: 'overview.statusLabels.waitingInput',
  waiting_permission: 'overview.statusLabels.waitingPermission',
  error: 'overview.statusLabels.error',
  stopped: 'overview.statusLabels.stopped',
};

/** Get the last non-streaming, non-tool output for an agent (the last "real" message) */
function getLastMessage(agentId: string): ClaudeOutput | null {
  const outputs = store.getState().agentOutputs.get(agentId);
  if (!outputs || outputs.length === 0) return null;
  for (let i = outputs.length - 1; i >= 0; i--) {
    const o = outputs[i];
    if (o.isStreaming) continue;
    const t = o.text;
    if (t.startsWith('Using tool:') || t.startsWith('Tool input:') || t.startsWith('Tool result:') || t.startsWith('Bash output:')) continue;
    if (t.startsWith('Tokens:') || t.startsWith('Cost:') || t.startsWith('Context:')) continue;
    if (t.trim().length === 0) continue;
    return o;
  }
  return null;
}

/** Count meaningful messages for an agent */
function getMessageCount(agentId: string): number {
  const outputs = store.getState().agentOutputs.get(agentId);
  if (!outputs) return 0;
  let count = 0;
  for (const o of outputs) {
    if (o.isStreaming) continue;
    const t = o.text;
    if (t.startsWith('Using tool:') || t.startsWith('Tool input:') || t.startsWith('Tool result:') || t.startsWith('Bash output:')) continue;
    if (t.startsWith('Tokens:') || t.startsWith('Cost:') || t.startsWith('Context:')) continue;
    if (t.trim().length === 0) continue;
    count++;
  }
  return count;
}

/** True when agent has any explicit user instruction (assigned task or user prompt output) */
function _hasUserInstruction(agent: Agent): boolean {
  if (agent.lastAssignedTask?.trim()) return true;

  const outputs = store.getState().agentOutputs.get(agent.id);
  if (!outputs) return false;

  return outputs.some(o => o.isUserPrompt && o.text.trim().length > 0);
}

/** Truncate text with ellipsis */
function truncate(text: string, maxLen: number): string {
  const line = text.split('\n')[0];
  return line.length > maxLen ? line.slice(0, maxLen) + '...' : line;
}

/** Context about why an agent matched a search query (for non-obvious matches) */
interface SearchMatchContext {
  type: 'task' | 'history' | 'file';
  text: string;
}

interface AreaGroup {
  area: DrawingArea | null;
  agents: Agent[];
}

export function AgentOverviewPanel({ activeAgentId, onClose, onSelectAgent }: AgentOverviewPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const agents = useAgentsArray();
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();
  const toolExecutions = useToolExecutions();
  const subagents = useSubagents();
  const areas = useAreas();
  const fileChanges = useFileChanges();

  // Request supervisor history for all agents (enables deep search)
  useEffect(() => {
    for (const agent of agents) {
      if (!store.hasHistoryBeenFetched(agent.id) && !store.isLoadingHistoryForAgent(agent.id)) {
        store.requestAgentSupervisorHistory(agent.id);
      }
    }
  }, [agents]);

  // Load persisted config from localStorage
  const savedConfig = useMemo(() => getStorage<AopConfig>(STORAGE_KEYS.AOP_CONFIG, {
    groupByArea: true,
    sortMode: 'recent',
    filterMode: 'all',
    allExpanded: false,
    sameAreaOnly: false,
    showSubagents: true,
    showRecentActivity: true,
  }), []);

  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() =>
    savedConfig.allExpanded ? new Set(agents.map(a => a.id)) : new Set([activeAgentId])
  );
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>(savedConfig.sortMode);
  const [filterMode, setFilterMode] = useState<FilterMode>(savedConfig.filterMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByArea, setGroupByArea] = useState(savedConfig.groupByArea);
  const [allExpanded, setAllExpanded] = useState(savedConfig.allExpanded);
  const [sameAreaOnly, setSameAreaOnly] = useState(savedConfig.sameAreaOnly);
  const [showSubagents, setShowSubagents] = useState(savedConfig.showSubagents);
  const [showRecentActivity, setShowRecentActivity] = useState(savedConfig.showRecentActivity);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  const [mobileFiltersCollapsed, setMobileFiltersCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const agentListRef = useRef<HTMLDivElement>(null);
  const hasCenteredActiveRef = useRef(false);

  // Track mobile breakpoint to enable compact filter controls by default on phones.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(max-width: 768px)');
    const apply = (matches: boolean) => {
      setIsMobileViewport(matches);
      setMobileFiltersCollapsed(matches);
    };

    apply(media.matches);

    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Focus overview search with Alt+Shift+F when panel is open.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isFocusSearchShortcut = event.altKey
        && event.shiftKey
        && !event.ctrlKey
        && !event.metaKey
        && event.code === 'KeyF';

      if (!isFocusSearchShortcut) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Persist config changes to localStorage
  useEffect(() => {
    setStorage(STORAGE_KEYS.AOP_CONFIG, {
      groupByArea,
      sortMode,
      filterMode,
      allExpanded,
      sameAreaOnly,
      showSubagents,
      showRecentActivity,
    } as AopConfig);
  }, [groupByArea, sortMode, filterMode, allExpanded, sameAreaOnly, showSubagents, showRecentActivity]);

  // Map agent -> area info (color + name) for badge display
  const agentAreaInfo = useMemo(() => {
    const map = new Map<string, { color: string; name: string }>();
    for (const agent of agents) {
      const area = store.getAreaForAgent(agent.id);
      if (!area || area.archived) continue;
      map.set(agent.id, { color: area.color, name: area.name });
    }
    return map;
  }, [agents, areas]);

  // Group tool executions by agent
  const toolsByAgent = useMemo(() => {
    const map = new Map<string, ToolExecution[]>();
    for (const exec of toolExecutions) {
      const list = map.get(exec.agentId) || [];
      list.push(exec);
      map.set(exec.agentId, list);
    }
    return map;
  }, [toolExecutions]);

  // Group subagents by parent
  const subagentsByParent = useMemo(() => {
    const map = new Map<string, Subagent[]>();
    for (const [, sub] of subagents) {
      const list = map.get(sub.parentAgentId) || [];
      list.push(sub);
      map.set(sub.parentAgentId, list);
    }
    return map;
  }, [subagents]);

  // Map agent ID → area ID for efficient lookups
  const agentToAreaId = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      const area = store.getAreaForAgent(agent.id);
      if (!area || area.archived) continue;
      map.set(agent.id, area.id);
    }
    return map;
  }, [agents, areas]);

  // Filter agents — deep search through supervisor history, file changes, and user tasks
  const [filteredAgents, searchMatchContexts] = useMemo(() => {
    const activeAreaId = agentToAreaId.get(activeAgentId) ?? null;
    const contexts = new Map<string, SearchMatchContext>();

    const result = agents.filter(a => {
      if (filterMode === 'working' && a.status !== 'working') return false;
      if (filterMode === 'idle' && a.status !== 'idle') return false;
      if (filterMode === 'error' && a.status !== 'error') return false;
      if (sameAreaOnly) {
        const aAreaId = agentToAreaId.get(a.id) ?? null;
        if (aAreaId !== activeAreaId) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();

        // Basic fields (match is visible directly in the card UI)
        if (
          a.name.toLowerCase().includes(q)
          || a.id.includes(q)
          || (a.class || '').toLowerCase().includes(q)
          || (a.taskLabel || '').toLowerCase().includes(q)
        ) {
          return true;
        }

        // Full user instruction (lastAssignedTask is longer than taskLabel)
        const task = a.lastAssignedTask || '';
        if (task.toLowerCase().includes(q)) {
          contexts.set(a.id, { type: 'task', text: task });
          return true;
        }

        // Supervisor history (status descriptions + work summaries)
        const history = store.getAgentSupervisorHistory(a.id);
        for (const entry of history) {
          const summary = entry.analysis.recentWorkSummary;
          const desc = entry.analysis.statusDescription;
          if (summary.toLowerCase().includes(q)) {
            contexts.set(a.id, { type: 'history', text: summary });
            return true;
          }
          if (desc.toLowerCase().includes(q)) {
            contexts.set(a.id, { type: 'history', text: desc });
            return true;
          }
        }

        // File changes
        for (const fc of fileChanges) {
          if (fc.agentId === a.id && fc.filePath.toLowerCase().includes(q)) {
            contexts.set(a.id, { type: 'file', text: fc.filePath });
            return true;
          }
        }

        return false;
      }
      return true;
    });

    return [result, contexts] as const;
  }, [agents, filterMode, searchQuery, sameAreaOnly, agentToAreaId, activeAgentId, fileChanges]);

  // Sort agents within groups
  const sortAgents = useCallback((list: Agent[]) => {
    return [...list].sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'status') {
        // 1. Status order
        const statusOrder = ['working', 'waiting_input', 'waiting_permission', 'error', 'idle', 'stopped'];
        const statusCmp = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
        if (statusCmp !== 0) return statusCmp;

        // 2. Unread notifications first
        const aUnread = agentsWithUnseenOutput.has(a.id);
        const bUnread = agentsWithUnseenOutput.has(b.id);
        if (aUnread !== bUnread) return aUnread ? -1 : 1;

        // 3. Most recently active first
        return (b.lastActivity || 0) - (a.lastActivity || 0);
      }
      const aTime = (toolsByAgent.get(a.id) || [])[0]?.timestamp || 0;
      const bTime = (toolsByAgent.get(b.id) || [])[0]?.timestamp || 0;
      return bTime - aTime;
    });
  }, [sortMode, toolsByAgent, agentsWithUnseenOutput]);

  // Build area groups (or flat list)
  const areaGroups = useMemo(() => {
    if (!groupByArea) {
      // Flat list: single group with no area
      return [{ area: null, agents: sortAgents(filteredAgents) }] as AreaGroup[];
    }

    const agentsByAreaId = new Map<string, Agent[]>();
    const unassignedAgents: Agent[] = [];
    for (const agent of filteredAgents) {
      const area = store.getAreaForAgent(agent.id);
      if (!area || area.archived) {
        unassignedAgents.push(agent);
        continue;
      }
      const list = agentsByAreaId.get(area.id);
      if (list) list.push(agent);
      else agentsByAreaId.set(area.id, [agent]);
    }

    const groups: AreaGroup[] = [];

    for (const [areaId, area] of areas) {
      if (area.archived) continue;
      const areaAgents = agentsByAreaId.get(areaId) || [];
      if (areaAgents.length > 0) {
        groups.push({ area, agents: sortAgents(areaAgents) });
      }
    }

    if (unassignedAgents.length > 0) {
      groups.push({ area: null, agents: sortAgents(unassignedAgents) });
    }

    return groups;
  }, [areas, filteredAgents, sortAgents, groupByArea]);

  const renderAgentCards = useCallback((groupAgents: Agent[]) => {
    const isUnreadAgent = (agent: Agent) => agentsWithUnseenOutput.has(agent.id);
    const firstUnreadIndex = groupAgents.findIndex(agent => agentsWithUnseenOutput.has(agent.id));
    const hasUnreadAgents = firstUnreadIndex >= 0;
    // Idle separator should only apply to "read idle" agents.
    const firstReadIdleIndex = groupAgents.findIndex(agent => agent.status === 'idle' && !isUnreadAgent(agent));
    const hasIdleSeparator = firstReadIdleIndex >= 0
      && groupAgents.slice(0, firstReadIdleIndex).some(agent => agent.status === 'working' || isUnreadAgent(agent));

    return groupAgents.map((agent, index) => (
      <React.Fragment key={agent.id}>
        {hasUnreadAgents && index === firstUnreadIndex && (
          <div className="aop-status-separator aop-status-separator--unread" role="separator" aria-label="unread notifications">
            <span>Unread notifications</span>
          </div>
        )}
        {hasIdleSeparator && index === firstReadIdleIndex && (
          <div className="aop-status-separator" role="separator" aria-label="idle agents">
            <span>{t('terminal:overview.statusLabels.idle')}</span>
          </div>
        )}
        <AgentCard
          agent={agent}
          isActive={agent.id === activeAgentId}
          isExpanded={expandedAgents.has(agent.id)}
          isMobile={isMobileViewport}
          hasPendingRead={agentsWithUnseenOutput.has(agent.id)}
          showSubagents={showSubagents}
          showRecentActivity={showRecentActivity}
          showAreaChip={!groupByArea}
          toolExecs={toolsByAgent.get(agent.id) || []}
          subagents={subagentsByParent.get(agent.id) || []}
          areaInfo={agentAreaInfo.get(agent.id)}
          matchContext={searchMatchContexts.get(agent.id)}
          onToggle={() => toggleAgent(agent.id)}
          onSelect={() => onSelectAgent(agent.id)}
          onClearContext={() => store.clearContext(agent.id)}
        />
      </React.Fragment>
    ));
  }, [
    t,
    activeAgentId,
    expandedAgents,
    agentsWithUnseenOutput,
    showSubagents,
    showRecentActivity,
    groupByArea,
    toolsByAgent,
    subagentsByParent,
    agentAreaInfo,
    searchMatchContexts,
    onSelectAgent,
  ]);

  // Status summary
  const statusSummary = useMemo(() => {
    const summary = { total: agents.length, working: 0, idle: 0, error: 0 };
    for (const a of agents) {
      if (a.status === 'working') summary.working++;
      else if (a.status === 'error') summary.error++;
      else if (a.status === 'idle') summary.idle++;
    }
    return summary;
  }, [agents]);

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const toggleArea = (areaKey: string) => {
    setCollapsedAreas(prev => {
      const next = new Set(prev);
      if (next.has(areaKey)) next.delete(areaKey);
      else next.add(areaKey);
      return next;
    });
  };

  const expandAll = () => { setExpandedAgents(new Set(agents.map(a => a.id))); setAllExpanded(true); };
  const collapseAll = () => { setExpandedAgents(new Set()); setAllExpanded(false); };

  // Keep the active agent card centered in the overview scroll container when selection changes.
  useEffect(() => {
    const container = agentListRef.current;
    if (!container) return;

    const activeCard = container.querySelector<HTMLElement>('.aop-agent-card.active');
    if (!activeCard) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = activeCard.getBoundingClientRect();
    const offsetWithinContainer = activeRect.top - containerRect.top;
    const targetTop = container.scrollTop + offsetWithinContainer - ((containerRect.height - activeRect.height) / 2);
    const clampedTargetTop = Math.max(0, targetTop);
    const delta = Math.abs(container.scrollTop - clampedTargetTop);
    if (delta < 2) return;

    container.scrollTo({
      top: clampedTargetTop,
      behavior: hasCenteredActiveRef.current ? 'smooth' : 'auto',
    });
    hasCenteredActiveRef.current = true;
  }, [activeAgentId, areaGroups]);

  return (
    <div className={`agent-overview-panel${isMobileViewport && mobileFiltersCollapsed ? ' mobile-filters-collapsed' : ''}`}>
      {/* Stats + Filters + Close — single compact row */}
      <div className="aop-stats-row">
        <span className="stat">{t('terminal:overview.agents', { count: statusSummary.total })}</span>
        {statusSummary.working > 0 && <span className="stat stat-working">🟢 {statusSummary.working}</span>}
        {statusSummary.idle > 0 && <span className="stat stat-idle">💤 {statusSummary.idle}</span>}
        {statusSummary.error > 0 && <span className="stat stat-error">🔴 {statusSummary.error}</span>}

        <div className="aop-row-controls">
          <button
            type="button"
            className="aop-search-toggle"
            onClick={() => {
              setMobileFiltersCollapsed(false);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            title="Search agents"
          >
            🔍
          </button>
          <button
            type="button"
            className={`aop-filters-toggle${mobileFiltersCollapsed ? ' collapsed' : ''}`}
            onClick={() => setMobileFiltersCollapsed(v => !v)}
            title={mobileFiltersCollapsed ? 'Show filters' : 'Hide filters'}
          >
            {mobileFiltersCollapsed ? 'Filters' : 'Hide filters'}
          </button>
          <select
            value={filterMode}
            onChange={e => setFilterMode(e.target.value as FilterMode)}
            className="filter-select"
          >
            <option value="all">{t('terminal:overview.allStatus')}</option>
            <option value="working">{t('terminal:overview.statusLabels.working')}</option>
            <option value="idle">{t('terminal:overview.statusLabels.idle')}</option>
            <option value="error">{t('terminal:overview.statusLabels.error')}</option>
          </select>
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="filter-select"
          >
            <option value="recent">{t('terminal:overview.mostRecent')}</option>
            <option value="status">{t('terminal:overview.byStatus')}</option>
            <option value="name">{t('terminal:overview.byName')}</option>
          </select>
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('terminal:overview.searchAgents')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              if (e.nativeEvent.isComposing) return;
              if (searchQuery.trim().length === 0) return;
              if (filteredAgents.length === 0) return;

              e.preventDefault();
              onSelectAgent(filteredAgents[0].id);
              setSearchQuery('');
            }}
            className="search-input"
          />
          <button className="close-btn" onClick={onClose} title={t('common:buttons.close')}>
            ✕
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="aop-actions">
        <button onClick={expandAll} className="action-btn" title={t('common:buttons.expand')}>
          {t('common:buttons.expand')}
        </button>
        <button onClick={collapseAll} className="action-btn" title={t('common:buttons.collapse')}>
          {t('common:buttons.collapse')}
        </button>
        <button onClick={() => setGroupByArea(v => !v)} className={`action-btn action-btn--toggle${groupByArea ? ' active' : ''}`} title={t('terminal:overview.areas')}>
          {t('terminal:overview.areas')}
        </button>
        <button onClick={() => setSameAreaOnly(v => !v)} className={`action-btn action-btn--toggle${sameAreaOnly ? ' active' : ''}`} title={t('terminal:overview.sameAreaOnly')}>
          {t('terminal:overview.sameAreaOnly')}
        </button>
        <button onClick={() => setShowSubagents(v => !v)} className={`action-btn action-btn--toggle${showSubagents ? ' active' : ''}`} title="Subagents">
          Subagents
        </button>
        <button onClick={() => setShowRecentActivity(v => !v)} className={`action-btn action-btn--toggle${showRecentActivity ? ' active' : ''}`} title={t('terminal:overview.recentActivity')}>
          Activity
        </button>
      </div>

      {/* Agent List grouped by area */}
      <div className="aop-agent-list" ref={agentListRef}>
        {areaGroups.length === 0 ? (
          <div className="aop-empty">
            {agents.length === 0 ? t('terminal:overview.noAgentsDeployed') : t('terminal:overview.noAgentsMatch')}
          </div>
        ) : (
          areaGroups.map(group => {
            const areaKey = group.area?.id || '__unassigned__';
            const areaName = group.area?.name || (groupByArea ? t('terminal:overview.unassigned') : '');
            const areaColor = group.area?.color || '#6272a4';
            const isCollapsed = collapsedAreas.has(areaKey);

            return (
              <div key={areaKey} className="aop-area-group">
                {/* Only show area header when grouping is on */}
                {groupByArea && (
                  <div
                    className="aop-area-header"
                    onClick={() => toggleArea(areaKey)}
                    style={{ borderLeftColor: areaColor }}
                  >
                    <span className="aop-area-expand">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="aop-area-color" style={{ background: areaColor }} />
                    <span className="aop-area-name">{areaName}</span>
                    <span className="aop-area-count">{group.agents.length}</span>
                  </div>
                )}
                {(!groupByArea || !isCollapsed) && (
                  <div className={groupByArea ? 'aop-area-content' : undefined}>
                    {renderAgentCards(group.agents)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Agent Card sub-component
// ============================================================================

interface AgentCardProps {
  agent: Agent;
  isActive: boolean;
  isExpanded: boolean;
  isMobile: boolean;
  hasPendingRead: boolean;
  showSubagents: boolean;
  showRecentActivity: boolean;
  showAreaChip: boolean;
  toolExecs: ToolExecution[];
  subagents: Subagent[];
  areaInfo?: { color: string; name: string };
  matchContext?: SearchMatchContext;
  onToggle: () => void;
  onSelect: () => void;
  onClearContext: () => void;
}

/** Unified subagent entry combining live store data and tool execution history */
interface SubagentEntry {
  id: string;
  name: string;
  type: string;
  description?: string;
  status: 'working' | 'spawning' | 'completed' | 'failed' | 'unknown';
  timestamp: number;
}

function AgentCard({
  agent,
  isActive,
  isExpanded,
  isMobile,
  hasPendingRead,
  showSubagents,
  showRecentActivity,
  showAreaChip,
  toolExecs,
  subagents,
  areaInfo,
  matchContext,
  onToggle,
  onSelect,
  onClearContext,
}: AgentCardProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const customClasses = useCustomAgentClassesArray();
  const classConfig = getClassConfig(agent.class, customClasses);
  const statusIcon = STATUS_ICONS[agent.status] || '❓';
  const statusLabel = STATUS_LABEL_KEYS[agent.status] ? t(`terminal:${STATUS_LABEL_KEYS[agent.status]}`) : agent.status;
  const recentTools = toolExecs.slice(0, isMobile ? 4 : 8);
  const lastMsg = getLastMessage(agent.id);
  const msgCount = getMessageCount(agent.id);
  const trunc = isMobile ? 40 : 80;

  // Build unified subagent list: live subagents + Task tool execs not in live store
  const allSubagentEntries = useMemo((): SubagentEntry[] => {
    const entries: SubagentEntry[] = [];
    const seenNames = new Set<string>();

    // First: live subagents from the store (most accurate status)
    for (const sub of subagents) {
      entries.push({
        id: sub.id,
        name: sub.name,
        type: sub.subagentType,
        description: sub.description,
        status: sub.status,
        timestamp: sub.startedAt,
      });
      seenNames.add(sub.name);
    }

    // Second: Task tool executions that don't have a matching live subagent
    for (const exec of toolExecs) {
      if (exec.toolName !== 'Task' && exec.toolName !== 'Agent') continue;
      const desc = (exec.toolInput?.description as string) || (exec.toolInput?.name as string) || '';
      const name = desc || (exec.toolInput?.prompt as string)?.slice(0, 40) || 'Task';
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      entries.push({
        id: `task-${exec.timestamp}`,
        name,
        type: (exec.toolInput?.subagent_type as string) || 'unknown',
        description: (exec.toolInput?.prompt as string)?.slice(0, 100),
        status: 'completed',
        timestamp: exec.timestamp,
      });
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  }, [subagents, toolExecs]);

  const activeSubagents = allSubagentEntries.filter(s => s.status === 'working' || s.status === 'spawning');
  const hasVisibleSubagents = showSubagents && allSubagentEntries.length > 0;
  const hasVisibleRecentActivity = showRecentActivity && recentTools.length > 0;
  const hasAnyVisibleSection = hasVisibleSubagents || hasVisibleRecentActivity;
  const contextUsageRatio = agent.contextLimit > 0 ? agent.contextUsed / agent.contextLimit : 0;
  const contextUsagePercent = Math.min(100, contextUsageRatio * 100);
  const clampedContextRatio = Math.min(1, Math.max(0, contextUsageRatio));
  const contextHue = Math.round((1 - clampedContextRatio) * 120); // 120=green, 0=red
  const contextFillColor = `hsl(${contextHue} 80% 45% / 0.55)`;
  const swipeRevealWidth = 112;
  const swipeRevealThreshold = 56;
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeRevealed, setSwipeRevealed] = useState(false);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const touchStartOffsetRef = useRef(0);
  const hasDirectionRef = useRef(false);
  const isHorizontalSwipeRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    if (isMobile) return;
    setSwipeOffset(0);
    setSwipeRevealed(false);
    setIsSwiping(false);
  }, [isMobile]);

  const handleSelect = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    if (swipeRevealed) {
      setSwipeOffset(0);
      setSwipeRevealed(false);
      suppressNextClickRef.current = true;
      return;
    }

    onSelect();
  }, [onSelect, swipeRevealed]);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchStartOffsetRef.current = swipeRevealed ? swipeRevealWidth : 0;
    hasDirectionRef.current = false;
    isHorizontalSwipeRef.current = false;
    setIsSwiping(true);
  }, [isMobile, swipeRevealed]);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || !isSwiping || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - touchStartXRef.current;
    const deltaY = touch.clientY - touchStartYRef.current;

    if (!hasDirectionRef.current) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      hasDirectionRef.current = true;
      isHorizontalSwipeRef.current = Math.abs(deltaX) > Math.abs(deltaY);
    }

    if (!isHorizontalSwipeRef.current) return;

    event.preventDefault();
    const nextOffset = Math.max(0, Math.min(swipeRevealWidth, touchStartOffsetRef.current - deltaX));
    setSwipeOffset(nextOffset);
  }, [isMobile, isSwiping]);

  const finishSwipe = useCallback(() => {
    if (!isMobile || !isSwiping) return;
    setIsSwiping(false);

    if (!isHorizontalSwipeRef.current) {
      if (!swipeRevealed) setSwipeOffset(0);
      return;
    }

    const reveal = swipeOffset >= swipeRevealThreshold;
    const changed = reveal !== swipeRevealed || swipeOffset !== (reveal ? swipeRevealWidth : 0);
    setSwipeRevealed(reveal);
    setSwipeOffset(reveal ? swipeRevealWidth : 0);
    if (changed) suppressNextClickRef.current = true;
  }, [isMobile, isSwiping, swipeOffset, swipeRevealed]);

  const handleClearContext = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClearContext();
    setSwipeRevealed(false);
    setSwipeOffset(0);
    suppressNextClickRef.current = true;
  }, [onClearContext]);

  return (
    <div className={`aop-agent-swipe${isMobile ? ' swipe-enabled' : ''}${swipeRevealed ? ' revealed' : ''}`}>
      {isMobile && (
        <button
          type="button"
          className="aop-swipe-clear-action"
          onClick={handleClearContext}
          title={t('terminal:overview.clearContext', { defaultValue: 'Clear context' })}
        >
          🧹 {t('terminal:overview.clearContext', { defaultValue: 'Clear' })}
        </button>
      )}
      <div
        className={`aop-agent-card ${isActive ? 'active' : ''} ${agent.status} ${hasPendingRead ? 'unread' : ''}`}
        onClick={handleSelect}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={finishSwipe}
        onTouchCancel={finishSwipe}
        style={isMobile ? {
          transform: `translateX(-${swipeOffset}px)`,
          transition: isSwiping ? 'none' : 'transform 0.18s ease',
        } : undefined}
      >
        {/* Card Header - always visible */}
        <div className="aop-agent-header">
        <button
          type="button"
          className="aop-expand-icon"
          aria-label={isExpanded ? 'Collapse agent' : 'Expand agent'}
          onClick={e => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        <span className="aop-agent-status" title={statusLabel}>{statusIcon}</span>
        <img
          src={agent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
          alt={agent.provider}
          className="aop-provider-icon"
          title={agent.provider === 'codex' ? 'Codex Agent' : 'Claude Agent'}
        />
        <span
          className="aop-agent-name"
          title={t('terminal:overview.clickToSwitch')}
          style={areaInfo ? { background: `${areaInfo.color}12`, borderColor: `${areaInfo.color}28` } : undefined}
        >
          {agent.name}
        </span>
        <span className="aop-agent-class-icon" style={{ color: `color-mix(in srgb, ${classConfig.color} 60%, var(--text-muted))` }} title={agent.class || 'agent'}>
          {classConfig.icon}
        </span>
        {hasPendingRead && (
          <span className="aop-pending-read-indicator" title="Pending read">!</span>
        )}
        {msgCount > 0 && (
          <span className="aop-msg-count" title={t('terminal:overview.messages', { count: msgCount })}>
            {msgCount}
          </span>
        )}
        {activeSubagents.length > 0 && (
          <span className="aop-subagent-count" title={activeSubagents.map(s => `${s.name}: ${s.description || s.type}`).join('\n')}>
            ⑂{activeSubagents.length}
          </span>
        )}
        {allSubagentEntries.length > 0 && activeSubagents.length === 0 && (
          <span className="aop-subagent-count" title={t('terminal:overview.subagentsCompleted', { count: allSubagentEntries.length })} style={{ opacity: 0.5 }}>
            ⑂{allSubagentEntries.length}
          </span>
        )}
        {agent.class && (
          <span
            className="aop-agent-class"
            style={{ color: `color-mix(in srgb, ${classConfig.color} 65%, var(--text-muted))`, background: `${classConfig.color}10`, borderColor: `${classConfig.color}25` }}
          >
            {agent.class}
          </span>
        )}
        {showAreaChip && areaInfo && (
          <span
            className="aop-area-chip"
            style={{ background: `${areaInfo.color}10`, borderColor: `${areaInfo.color}25`, color: `color-mix(in srgb, ${areaInfo.color} 65%, var(--text-muted))` }}
          >
            {areaInfo.name}
          </span>
        )}
        </div>

        {/* Task label preview - always visible when available */}
        {agent.taskLabel && (
          <div className="aop-task-label" title={agent.taskLabel}>
            <span className="task-prefix">📋</span>
            <span className="task-text">{truncate(agent.taskLabel, trunc)}</span>
          </div>
        )}

        {/* Last message preview - hide assistant messages when collapsed */}
        {lastMsg && (isExpanded || lastMsg.isUserPrompt) && (
          <div
            className={`aop-last-message ${lastMsg.isUserPrompt ? 'user' : 'assistant'}`}
            title={lastMsg.text.split('\n')[0]}
          >
            <span className="lm-prefix">{lastMsg.isUserPrompt ? '▶' : '◀'}</span>
            <span className="lm-text">{truncate(lastMsg.text, trunc)}</span>
            <span className="lm-time">{formatTimestamp(lastMsg.timestamp)}</span>
          </div>
        )}

        {/* Search match context — shows why agent matched a deep search */}
        {matchContext && (
          <div className={`aop-match-context aop-match-context--${matchContext.type}`} title={matchContext.text}>
            <span className="match-icon">
              {matchContext.type === 'history' ? '📜' : matchContext.type === 'file' ? '📄' : '💬'}
            </span>
            <span className="match-label">
              {matchContext.type === 'history' ? 'history' : matchContext.type === 'file' ? 'file' : 'task'}
            </span>
            <span className="match-text">{truncate(matchContext.text, trunc)}</span>
          </div>
        )}

        {/* Expanded Content */}
        {isExpanded && (
          <div className="aop-agent-body">
            {/* Subagents (live + historical from tool execs) */}
            {hasVisibleSubagents && (
              <div className="aop-subagents">
                <div className="aop-section-label">{t('terminal:overview.subagents', { count: allSubagentEntries.length })}</div>
                {allSubagentEntries.map(sub => (
                  <div key={sub.id} className={`aop-subagent-item ${sub.status}`}>
                    <span className="sub-icon">
                      {sub.status === 'completed' ? '✅' : sub.status === 'failed' ? '❌' : sub.status === 'unknown' ? '⬜' : '⑂'}
                    </span>
                    <span className="sub-name">{sub.name}</span>
                    <span className="sub-type">{sub.type}</span>
                    {sub.description && (
                      <span className="sub-desc" title={sub.description}>{truncate(sub.description, isMobile ? 30 : 50)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Recent tool activity timeline */}
            {hasVisibleRecentActivity && (
              <div className="aop-tool-timeline">
                <div className="aop-section-label">{t('terminal:overview.recentActivity')}</div>
                {recentTools.map((exec, i) => {
                  const param = exec.toolInput
                    ? (exec.toolInput.file_path as string)
                      || (exec.toolInput.command as string)?.slice(0, 40)
                      || (exec.toolInput.pattern as string)
                      || (exec.toolInput.description as string)
                      || (exec.toolInput.prompt as string)?.slice(0, 50)
                      || ''
                    : '';
                  return (
                    <div key={`${exec.timestamp}-${i}`} className="aop-timeline-entry">
                      <span className="tl-time">{formatTimestamp(exec.timestamp)}</span>
                      <span className="tl-icon">{TOOL_ICONS[exec.toolName] || TOOL_ICONS.default}</span>
                      <span className="tl-tool">{exec.toolName}</span>
                      {param && <span className="tl-param">{param}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {!hasAnyVisibleSection && (showSubagents || showRecentActivity) && (
              <div className="aop-no-activity">{t('terminal:overview.noToolActivity')}</div>
            )}
          </div>
        )}

        {/* Context usage bar */}
        {agent.contextLimit > 0 && (
          <div
            className="aop-context-bar"
            title={`${Math.round(contextUsageRatio * 100)}% context used (${Math.round(agent.contextUsed / 1000)}k / ${Math.round(agent.contextLimit / 1000)}k)`}
          >
            <div
              className="aop-context-fill"
              style={{ width: `${contextUsagePercent}%`, backgroundColor: contextFillColor }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
