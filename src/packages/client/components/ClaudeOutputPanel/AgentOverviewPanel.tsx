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
  useAgentCompacting,
  store,
} from '../../store';
import { getToolIconName, formatTimestamp } from '../../utils/outputRendering';
import { STORAGE_KEYS, getStorage, setStorage } from '../../utils/storage';
import { getClassConfig } from '../../utils/classConfig';
import type { Agent, Subagent, DrawingArea } from '../../../shared/types';
import type { ToolExecution, ClaudeOutput } from '../../store/types';
import type { TwoFingerSelectorState } from '../../hooks/useTwoFingerSelector';
import { ContextMenu } from '../ContextMenu';
import type { ContextMenuAction } from '../ContextMenu';
import { WorkspaceSwitcher, useWorkspaceFilter, isAgentVisibleInWorkspace } from '../WorkspaceSwitcher';
import { BulkManageModal } from '../BulkManageModal';
import { AgentIcon } from '../AgentIcon';
import { Icon, type IconName } from '../Icon';

/** Persisted config shape for the overview panel */
interface AopConfig {
  groupByArea: boolean;
  sortMode: SortMode;
  filterMode: FilterMode;
  sameAreaOnly: boolean; // only show agents in the same area as the active agent
  visibleAreaIds: string[] | null; // null = all areas visible; string[] = only these area IDs
}

interface AgentOverviewPanelProps {
  activeAgentId: string;
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
  /** External ref for the agent card list (used by the two-finger selector hook). */
  agentListRef?: React.RefObject<HTMLDivElement | null>;
  /** Two-finger selector state driven from the parent (GuakeOutputPanel). */
  twoFingerState?: TwoFingerSelectorState;
  /** Optional external control of which areas are collapsed. */
  collapsedAreas?: Set<string>;
  /** Optional external handler for area toggle. */
  onToggleArea?: (areaKey: string) => void;
}

type SortMode = 'name' | 'status' | 'recent';
type FilterMode = 'all' | 'working' | 'idle' | 'error';

const EMPTY_TOOL_EXECS: ToolExecution[] = [];
const EMPTY_SUBAGENTS: Subagent[] = [];

const STATUS_ICONS: Record<string, IconName> = {
  working: 'status-working',
  idle: 'status-idle',
  waiting_input: 'status-waiting-input',
  waiting_permission: 'status-waiting-permission',
  error: 'status-error',
  stopped: 'status-stopped',
};

const STATUS_COLORS: Record<string, string> = {
  working: '#4ade80',
  idle: '#a78bfa',
  waiting_input: '#fbbf24',
  waiting_permission: '#fb923c',
  error: '#ef4444',
  stopped: '#9ca3af',
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
  type: 'task' | 'file';
  text: string;
}

interface AreaGroup {
  area: DrawingArea | null;
  agents: Agent[];
}

export function AgentOverviewPanel({ activeAgentId, onClose, onSelectAgent, agentListRef: externalAgentListRef, twoFingerState, collapsedAreas: externalCollapsedAreas, onToggleArea: externalOnToggleArea }: AgentOverviewPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const allAgents = useAgentsArray();
  const [activeWorkspace] = useWorkspaceFilter();
  const agents = useMemo(() => {
    if (!activeWorkspace) return allAgents;
    return allAgents.filter(a => {
      const area = store.getAreaForAgent(a.id);
      return isAgentVisibleInWorkspace(area?.id ?? null);
    });
  }, [allAgents, activeWorkspace]);
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();
  const toolExecutions = useToolExecutions();
  const subagents = useSubagents();
  const areas = useAreas();
  const fileChanges = useFileChanges();

  // Load persisted config from localStorage
  const savedConfig = useMemo(() => getStorage<AopConfig>(STORAGE_KEYS.AOP_CONFIG, {
    groupByArea: true,
    sortMode: 'recent',
    filterMode: 'all',
    sameAreaOnly: false,
    visibleAreaIds: null,
  }), []);

  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => new Set());
  const [internalCollapsedAreas, setInternalCollapsedAreas] = useState<Set<string>>(new Set());
  const collapsedAreas = externalCollapsedAreas ?? internalCollapsedAreas;
  const [editingPromptAreaId, setEditingPromptAreaId] = useState<string | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>(savedConfig.sortMode);
  const [filterMode, setFilterMode] = useState<FilterMode>(savedConfig.filterMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByArea, setGroupByArea] = useState(savedConfig.groupByArea);
  const [sameAreaOnly, setSameAreaOnly] = useState(savedConfig.sameAreaOnly);
  const [visibleAreaIds, setVisibleAreaIds] = useState<Set<string> | null>(
    savedConfig.visibleAreaIds ? new Set(savedConfig.visibleAreaIds) : null
  );
  const [areaFilterOpen, setAreaFilterOpen] = useState(false);
  const [areaFilterSearch, setAreaFilterSearch] = useState('');
  const [bulkManageOpen, setBulkManageOpen] = useState(false);
  const areaFilterRef = useRef<HTMLDivElement>(null);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  const [mobileFiltersCollapsed, setMobileFiltersCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  const [areaContextMenu, setAreaContextMenu] = useState<{
    areaId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [agentContextMenu, setAgentContextMenu] = useState<{
    agentId: string;
    position: { x: number; y: number };
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const internalAgentListRef = useRef<HTMLDivElement>(null);
  const agentListRef = externalAgentListRef || internalAgentListRef;
  const hasCenteredActiveRef = useRef(false);
  /** Tracks the last stable sort order (agent IDs) per sort key, to avoid re-sorting on every tick. */
  const prevSortOrderRef = useRef<Map<string, string[]>>(new Map());

  // Two-finger state comes from the parent (detected on terminal, applied here)
  const twoFingerSelector = twoFingerState || { isActive: false, hoveredAgentId: null };

  // Ref-wrap the parent callback so each card receives a stable reference — even
  // if the parent re-creates `onSelectAgent` on every render.
  const onSelectAgentRef = useRef(onSelectAgent);
  useEffect(() => { onSelectAgentRef.current = onSelectAgent; }, [onSelectAgent]);
  const handleCardSelect = useCallback((agentId: string) => {
    onSelectAgentRef.current(agentId);
  }, []);
  const handleCardClearContext = useCallback((agentId: string) => {
    store.clearContext(agentId);
  }, []);
  const handleCardContextMenu = useCallback((agentId: string, position: { x: number; y: number }) => {
    setAgentContextMenu({ agentId, position });
  }, []);

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

  // Close area filter dropdown on outside click
  useEffect(() => {
    if (!areaFilterOpen) { setAreaFilterSearch(''); return; }
    const handleClick = (e: MouseEvent) => {
      if (areaFilterRef.current && !areaFilterRef.current.contains(e.target as Node)) {
        setAreaFilterOpen(false);
        setAreaFilterSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [areaFilterOpen]);

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
      sameAreaOnly,
      visibleAreaIds: visibleAreaIds ? Array.from(visibleAreaIds) : null,
    } as AopConfig);
  }, [groupByArea, sortMode, filterMode, sameAreaOnly, visibleAreaIds]);

  // List of non-archived areas for the filter dropdown
  const availableAreas = useMemo(() => {
    const result: { id: string; name: string; color: string }[] = [];
    for (const [, area] of areas) {
      if (!area.archived) result.push({ id: area.id, name: area.name, color: area.color });
    }
    result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return result;
  }, [areas]);

  // Area filter helpers
  const isAllAreasVisible = visibleAreaIds === null;
  const toggleAreaVisibility = useCallback((areaId: string) => {
    setVisibleAreaIds(prev => {
      if (prev === null) {
        // Switch from "all" to "all except this one"
        const ids = new Set(availableAreas.map(a => a.id));
        ids.add('__unassigned__');
        ids.delete(areaId);
        return ids;
      }
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      // If all areas + unassigned are now selected, switch back to null (= "all")
      if (next.size >= availableAreas.length + 1) return null;
      return next;
    });
  }, [availableAreas]);

  const toggleAllAreas = useCallback(() => {
    setVisibleAreaIds(prev => (prev === null ? new Set<string>() : null));
  }, []);

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

  // Filter agents — deep search through file changes and user tasks
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

  // Sort agents within groups — uses stable ordering to prevent scroll-jumping.
  // A full re-sort only happens when the agent set changes (add/remove) or when
  // sort-critical properties change (status bucket, boss flag). Within the same
  // bucket, previously-established order is preserved to avoid DOM churn.
  const sortAgents = useCallback((list: Agent[], groupKey: string = '__default__') => {
    const currentIds = new Set(list.map(a => a.id));
    const prevOrder = prevSortOrderRef.current.get(groupKey);

    // Determine if we need a full re-sort: new/removed agents, or first render for this group
    const needsFullSort = !prevOrder
      || prevOrder.length !== list.length
      || prevOrder.some(id => !currentIds.has(id));

    // Build a sort-bucket key for each agent to detect bucket changes
    const getBucketKey = (agent: Agent): string => {
      const isBoss = !!(agent.isBoss || agent.class === 'boss');
      if (sortMode === 'name') return `${isBoss ? '0' : '1'}`;
      if (sortMode === 'status') {
        const statusOrder = ['working', 'waiting_input', 'waiting_permission', 'error', 'idle', 'stopped'];
        const statusIdx = statusOrder.indexOf(agent.status);
        const unread = agentsWithUnseenOutput.has(agent.id) ? '0' : '1';
        return `${isBoss ? '0' : '1'}-${statusIdx}-${unread}`;
      }
      // 'recent' mode
      return `${isBoss ? '0' : '1'}`;
    };

    // Check if any agent changed sort bucket since last order
    let bucketChanged = false;
    if (prevOrder && !needsFullSort) {
      const prevBuckets = prevSortOrderRef.current.get(groupKey + '__buckets');
      if (prevBuckets) {
        for (const agent of list) {
          const idx = prevOrder.indexOf(agent.id);
          if (idx >= 0 && prevBuckets[idx] !== getBucketKey(agent)) {
            bucketChanged = true;
            break;
          }
        }
      } else {
        bucketChanged = true;
      }
    }

    let sorted: Agent[];
    if (needsFullSort || bucketChanged || sortMode === 'recent') {
      // Full sort
      sorted = [...list].sort((a, b) => {
        const aIsBoss = !!(a.isBoss || a.class === 'boss');
        const bIsBoss = !!(b.isBoss || b.class === 'boss');
        if (aIsBoss !== bIsBoss) return aIsBoss ? -1 : 1;

        if (sortMode === 'name') return a.name.localeCompare(b.name);
        if (sortMode === 'status') {
          const statusOrder = ['working', 'waiting_input', 'waiting_permission', 'error', 'idle', 'stopped'];
          const statusCmp = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
          if (statusCmp !== 0) return statusCmp;

          const aUnread = agentsWithUnseenOutput.has(a.id);
          const bUnread = agentsWithUnseenOutput.has(b.id);
          if (aUnread !== bUnread) return aUnread ? -1 : 1;

          if (a.status === 'working' && b.status === 'working') {
            return a.name.localeCompare(b.name);
          }

          if (a.status === 'idle' && b.status === 'idle') {
            const aHasTask = !!a.taskLabel;
            const bHasTask = !!b.taskLabel;
            if (aHasTask !== bHasTask) return aHasTask ? -1 : 1;
            return (b.lastActivity || 0) - (a.lastActivity || 0);
          }

          return (b.lastActivity || 0) - (a.lastActivity || 0);
        }
        const aTime = (toolsByAgent.get(a.id) || [])[0]?.timestamp || a.lastActivity || 0;
        const bTime = (toolsByAgent.get(b.id) || [])[0]?.timestamp || b.lastActivity || 0;
        return bTime - aTime;
      });
    } else {
      // Stable: reuse previous order
      const agentMap = new Map(list.map(a => [a.id, a]));
      sorted = prevOrder!.map(id => agentMap.get(id)!).filter(Boolean);
    }

    // Cache the order and bucket keys for next comparison
    const sortedIds = sorted.map(a => a.id);
    const sortedBuckets = sorted.map(a => getBucketKey(a));
    prevSortOrderRef.current.set(groupKey, sortedIds);
    prevSortOrderRef.current.set(groupKey + '__buckets', sortedBuckets);

    return sorted;
  }, [sortMode, toolsByAgent, agentsWithUnseenOutput]);

  // Build area groups (or flat list), applying the area visibility filter
  const areaGroups = useMemo(() => {
    if (!groupByArea) {
      // Flat list: single group with no area
      return [{ area: null, agents: sortAgents(filteredAgents, '__flat__') }] as AreaGroup[];
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
      // Apply area visibility filter
      if (visibleAreaIds && !visibleAreaIds.has(areaId)) continue;
      const areaAgents = agentsByAreaId.get(areaId) || [];
      if (areaAgents.length > 0) {
        groups.push({ area, agents: sortAgents(areaAgents, `area_${areaId}`) });
      }
    }

    // Unassigned agents: show when no filter or when filter explicitly allows __unassigned__
    if (unassignedAgents.length > 0 && (!visibleAreaIds || visibleAreaIds.has('__unassigned__'))) {
      groups.push({ area: null, agents: sortAgents(unassignedAgents, '__unassigned__') });
    }

    return groups;
  }, [areas, filteredAgents, sortAgents, groupByArea, visibleAreaIds]);

  const renderAgentCards = useCallback((groupAgents: Agent[]) => {
    const isUnreadAgent = (agent: Agent) => agentsWithUnseenOutput.has(agent.id);
    const firstUnreadIndex = groupAgents.findIndex(agent => isUnreadAgent(agent) && agent.status !== 'working');
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
          isTwoFingerHovered={twoFingerSelector.hoveredAgentId === agent.id}
          showAreaChip={!groupByArea}
          toolExecs={toolsByAgent.get(agent.id) || EMPTY_TOOL_EXECS}
          subagents={subagentsByParent.get(agent.id) || EMPTY_SUBAGENTS}
          areaInfo={agentAreaInfo.get(agent.id)}
          matchContext={searchMatchContexts.get(agent.id)}
          onSelect={handleCardSelect}
          onClearContext={handleCardClearContext}
          onContextMenu={handleCardContextMenu}
        />
      </React.Fragment>
    ));
  }, [
    t,
    activeAgentId,
    expandedAgents,
    isMobileViewport,
    agentsWithUnseenOutput,
    twoFingerSelector.hoveredAgentId,
    groupByArea,
    toolsByAgent,
    subagentsByParent,
    agentAreaInfo,
    searchMatchContexts,
    handleCardSelect,
    handleCardClearContext,
    handleCardContextMenu,
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
    if (externalOnToggleArea) {
      externalOnToggleArea(areaKey);
      return;
    }
    setInternalCollapsedAreas(prev => {
      const next = new Set(prev);
      if (next.has(areaKey)) next.delete(areaKey);
      else next.add(areaKey);
      return next;
    });
  };

  const requestSpawnForArea = useCallback((area: DrawingArea) => {
    window.dispatchEvent(new CustomEvent('tide:open-spawn-modal', {
      detail: {
        areaId: area.id,
        position: {
          x: area.center.x,
          z: area.center.z,
        },
      },
    }));
  }, []);

  const openAreaContextMenu = useCallback((area: DrawingArea, position: { x: number; y: number }) => {
    setAreaContextMenu({
      areaId: area.id,
      position,
    });
  }, []);

  const areaContextMenuActions = useMemo((): ContextMenuAction[] => {
    if (!areaContextMenu) return [];
    const area = areas.get(areaContextMenu.areaId);
    if (!area) return [];

    return [
      {
        id: 'spawn-agent',
        label: t('common:agentBar.newAgent'),
        icon: '+',
        onClick: () => requestSpawnForArea(area),
      },
    ];
  }, [areaContextMenu, areas, requestSpawnForArea, t]);

  const agentContextMenuActions = useMemo((): ContextMenuAction[] => {
    if (!agentContextMenu) return [];
    const agent = agents.find(a => a.id === agentContextMenu.agentId);
    if (!agent) return [];
    const isExpanded = expandedAgents.has(agent.id);

    return [
      {
        id: 'toggle-expand',
        label: isExpanded ? t('terminal:overview.collapse', { defaultValue: 'Collapse' }) : t('terminal:overview.expand', { defaultValue: 'Expand' }),
        icon: <Icon name={isExpanded ? 'caret-down' : 'caret-right'} size={14} />,
        onClick: () => toggleAgent(agent.id),
      },
      {
        id: 'clear-context',
        label: t('terminal:overview.clearContext', { defaultValue: 'Clear context' }),
        icon: <Icon name="clear" size={14} />,
        onClick: () => store.clearContext(agent.id),
      },
      {
        id: 'remove-agent',
        label: t('terminal:overview.removeAgent', { defaultValue: 'Remove agent' }),
        icon: <Icon name="trash" size={14} />,
        danger: true,
        onClick: () => store.removeAgent(agent.id),
      },
    ];
  }, [agentContextMenu, agents, expandedAgents, t]);

  // Keep the active agent card centered in the overview scroll container when the
  // selected agent changes.  We intentionally depend only on activeAgentId (not on
  // areaGroups) so that routine data updates don't hijack the user's scroll position.
  useEffect(() => {
    const container = agentListRef.current;
    if (!container) return;

    // Small delay so React can flush the DOM update before we measure.
    const raf = requestAnimationFrame(() => {
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
    });

    return () => cancelAnimationFrame(raf);
  }, [activeAgentId]);

  return (
    <div className={`agent-overview-panel${isMobileViewport && mobileFiltersCollapsed ? ' mobile-filters-collapsed' : ''}`}>
      {/* Stats + Search + Close — minimal top row */}
      <div className="aop-stats-row">
        <span className="stat">{t('terminal:overview.agents', { count: statusSummary.total })}</span>
        {statusSummary.working > 0 && <span className="stat stat-working"><Icon name="status-working" size={11} color={STATUS_COLORS.working} weight="fill" /> {statusSummary.working}</span>}
        {statusSummary.idle > 0 && <span className="stat stat-idle"><Icon name="status-idle" size={11} color={STATUS_COLORS.idle} weight="fill" /> {statusSummary.idle}</span>}
        {statusSummary.error > 0 && <span className="stat stat-error"><Icon name="status-error" size={11} color={STATUS_COLORS.error} weight="fill" /> {statusSummary.error}</span>}

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
            <Icon name="search" size={14} />
          </button>
          <button
            type="button"
            className={`aop-filters-toggle${mobileFiltersCollapsed ? ' collapsed' : ''}`}
            onClick={() => setMobileFiltersCollapsed(v => !v)}
            title={mobileFiltersCollapsed ? 'Show filters' : 'Hide filters'}
          >
            {mobileFiltersCollapsed ? 'Filters' : 'Hide filters'}
          </button>
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
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      {/* Actions — filter, sort, workspace, toggles */}
      <div className="aop-actions">
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
        <WorkspaceSwitcher />
        <button onClick={() => setGroupByArea(v => !v)} className={`action-btn action-btn--toggle${groupByArea ? ' active' : ''}`} title={t('terminal:overview.areas')}>
          {t('terminal:overview.areas')}
        </button>
        {groupByArea && availableAreas.length > 0 && (
          <div className="aop-area-filter" ref={areaFilterRef}>
            <button
              className={`action-btn action-btn--toggle${!isAllAreasVisible ? ' active' : ''}`}
              onClick={() => setAreaFilterOpen(v => !v)}
              title="Filter areas"
            >
              {isAllAreasVisible ? 'All areas' : `${visibleAreaIds!.size} areas`}
              <span className="aop-area-filter-caret"><Icon name={areaFilterOpen ? 'caret-up' : 'caret-down'} size={10} /></span>
            </button>
            {areaFilterOpen && (
              <div className="aop-area-filter-dropdown">
                {availableAreas.length >= 5 && (
                  <div className="aop-area-filter-search">
                    <input
                      type="text"
                      placeholder="Filter areas..."
                      value={areaFilterSearch}
                      onChange={(e) => setAreaFilterSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  </div>
                )}
                {(() => {
                  const search = areaFilterSearch.toLowerCase().trim();
                  const filtered = search
                    ? availableAreas.filter(a => a.name.toLowerCase().includes(search))
                    : availableAreas;
                  const showUnassigned = !search || 'unassigned'.includes(search);
                  return (
                    <>
                      {!search && (
                        <>
                          <label className="aop-area-filter-option" onClick={(e) => { e.preventDefault(); toggleAllAreas(); }}>
                            <input type="checkbox" checked={isAllAreasVisible} readOnly />
                            <span className="aop-area-filter-color" style={{ background: '#6272a4' }} />
                            <span>All</span>
                          </label>
                          <div className="aop-area-filter-divider" />
                        </>
                      )}
                      {filtered.map(area => {
                        const checked = isAllAreasVisible || (visibleAreaIds?.has(area.id) ?? false);
                        return (
                          <label key={area.id} className="aop-area-filter-option" onClick={(e) => { e.preventDefault(); toggleAreaVisibility(area.id); }}>
                            <input type="checkbox" checked={checked} readOnly />
                            <span className="aop-area-filter-color" style={{ background: area.color }} />
                            <span className="aop-area-filter-name">{area.name}</span>
                          </label>
                        );
                      })}
                      {showUnassigned && (
                        <>
                          <div className="aop-area-filter-divider" />
                          <label className="aop-area-filter-option" onClick={(e) => { e.preventDefault(); toggleAreaVisibility('__unassigned__'); }}>
                            <input type="checkbox" checked={isAllAreasVisible || (visibleAreaIds?.has('__unassigned__') ?? false)} readOnly />
                            <span className="aop-area-filter-color" style={{ background: '#6272a4' }} />
                            <span className="aop-area-filter-name">Unassigned</span>
                          </label>
                        </>
                      )}
                      {search && filtered.length === 0 && !showUnassigned && (
                        <div className="aop-area-filter-empty">No matching areas</div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
        <button onClick={() => setSameAreaOnly(v => !v)} className={`action-btn action-btn--toggle${sameAreaOnly ? ' active' : ''}`} title={t('terminal:overview.sameAreaOnly')}>
          {t('terminal:overview.sameAreaOnly')}
        </button>
        <button onClick={() => setBulkManageOpen(true)} className="action-btn" title="Bulk manage agents">
          Bulk Manage
        </button>
      </div>

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
                    data-area-id={areaKey}
                    onClick={() => toggleArea(areaKey)}
                    style={{ borderLeftColor: areaColor }}
                  >
                    <span className="aop-area-expand"><Icon name={isCollapsed ? 'caret-right' : 'caret-down'} size={10} /></span>
                    <span className="aop-area-color" style={{ background: areaColor }} />
                    <span
                      className="aop-area-name"
                      onContextMenu={(event) => {
                        if (!group.area) return;
                        event.preventDefault();
                        event.stopPropagation();
                        openAreaContextMenu(group.area, {
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      {areaName}
                    </span>
                    <button
                      type="button"
                      className="aop-area-eye-btn"
                      title="Hide area"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleAreaVisibility(areaKey);
                      }}
                    >
                      <Icon name="target" size={14} />
                    </button>
                    {group.area && (
                      <button
                        type="button"
                        className="aop-area-eye-btn"
                        title="Edit area prompt"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const area = group.area!;
                          if (editingPromptAreaId === area.id) {
                            setEditingPromptAreaId(null);
                          } else {
                            setEditingPromptText(area.prompt || '');
                            setEditingPromptAreaId(area.id);
                          }
                        }}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                    )}
                    {group.area && (() => {
                      const area = group.area;
                      return (
                      <button
                        type="button"
                        className="aop-area-add-btn"
                        title={t('common:agentBar.newAgent')}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          openAreaContextMenu(area, {
                            x: rect.left,
                            y: rect.bottom + 6,
                          });
                        }}
                      >
                        +
                      </button>
                      );
                    })()}
                    <span className="aop-area-count">{group.agents.length}</span>
                  </div>
                )}
                {editingPromptAreaId === areaKey && group.area && (
                  <div className="aop-area-prompt-editor" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      className="aop-area-prompt-textarea"
                      value={editingPromptText}
                      onChange={(e) => setEditingPromptText(e.target.value)}
                      placeholder="System prompt for agents in this area..."
                      rows={3}
                      autoFocus
                    />
                    <div className="aop-area-prompt-actions">
                      <button
                        className="aop-area-prompt-save"
                        onClick={() => {
                          store.updateArea(group.area!.id, { prompt: editingPromptText });
                          setEditingPromptAreaId(null);
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="aop-area-prompt-cancel"
                        onClick={() => setEditingPromptAreaId(null)}
                      >
                        Cancel
                      </button>
                    </div>
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

      <ContextMenu
        isOpen={areaContextMenu !== null}
        position={areaContextMenu?.position ?? { x: 0, y: 0 }}
        worldPosition={{ x: 0, z: 0 }}
        actions={areaContextMenuActions}
        onClose={() => setAreaContextMenu(null)}
      />

      <ContextMenu
        isOpen={agentContextMenu !== null}
        position={agentContextMenu?.position ?? { x: 0, y: 0 }}
        worldPosition={{ x: 0, z: 0 }}
        actions={agentContextMenuActions}
        onClose={() => setAgentContextMenu(null)}
      />

      <BulkManageModal isOpen={bulkManageOpen} onClose={() => setBulkManageOpen(false)} />

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
  isTwoFingerHovered: boolean;
  showAreaChip: boolean;
  toolExecs: ToolExecution[];
  subagents: Subagent[];
  areaInfo?: { color: string; name: string };
  matchContext?: SearchMatchContext;
  onSelect: (agentId: string) => void;
  onClearContext: (agentId: string) => void;
  onContextMenu: (agentId: string, position: { x: number; y: number }) => void;
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

const AgentCard = React.memo(function AgentCard({
  agent,
  isActive,
  isExpanded,
  isMobile,
  hasPendingRead,
  isTwoFingerHovered,
  showAreaChip,
  toolExecs,
  subagents,
  areaInfo,
  matchContext,
  onSelect,
  onClearContext,
  onContextMenu,
}: AgentCardProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const customClasses = useCustomAgentClassesArray();
  const classConfig = getClassConfig(agent.class, customClasses);
  const isBossAgent = agent.isBoss || agent.class === 'boss';
  const isCompacting = useAgentCompacting(agent.id);
  const _statusIcon = STATUS_ICONS[agent.status] || '❓';
  const _statusLabel = STATUS_LABEL_KEYS[agent.status] ? t(`terminal:${STATUS_LABEL_KEYS[agent.status]}`) : agent.status;
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
  const hasVisibleSubagents = allSubagentEntries.length > 0;
  const hasVisibleRecentActivity = recentTools.length > 0;
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

    onSelect(agent.id);
  }, [onSelect, agent.id, swipeRevealed]);

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
    onClearContext(agent.id);
    setSwipeRevealed(false);
    setSwipeOffset(0);
    suppressNextClickRef.current = true;
  }, [onClearContext, agent.id]);

  return (
    <div className={`aop-agent-swipe${isMobile ? ' swipe-enabled' : ''}${swipeRevealed ? ' revealed' : ''}`}>
      {isMobile && (
        <button
          type="button"
          className="aop-swipe-clear-action"
          onClick={handleClearContext}
          title={t('terminal:overview.clearContext', { defaultValue: 'Clear context' })}
        >
          <Icon name="clear" size={14} /> {t('terminal:overview.clearContext', { defaultValue: 'Clear' })}
        </button>
      )}
      <div
        className={`aop-agent-card ${isBossAgent ? 'boss' : ''} ${isActive ? 'active' : ''} ${agent.status} ${hasPendingRead ? 'unread' : ''}${isTwoFingerHovered ? ' two-finger-hover' : ''}${isCompacting ? ' compacting' : ''}`}
        data-agent-id={agent.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-agent-id', agent.id);
          e.dataTransfer.effectAllowed = 'copy';
          (e.currentTarget as HTMLElement).style.opacity = '0.5';
        }}
        onDragEnd={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '';
        }}
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
        {/* Left avatar — PNG icon or emoji, with provider badge */}
        <div
          className={`aop-card-avatar${classConfig.iconPath ? '' : ' emoji'}`}
          style={!classConfig.iconPath ? { background: `${classConfig.color}25` } : undefined}
        >
          <AgentIcon agent={agent} size="100%" customClasses={customClasses} />
          <img
            src={agent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : agent.provider === 'opencode' ? `${import.meta.env.BASE_URL}assets/opencode.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
            alt={agent.provider}
            className="aop-provider-icon"
            title={agent.provider === 'codex' ? 'Codex Agent' : agent.provider === 'opencode' ? 'OpenCode Agent' : 'Claude Agent'}
          />
        </div>
        <div className="aop-card-content">
        {/* Card Header - always visible */}
        <div className="aop-agent-header" onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(agent.id, { x: e.clientX, y: e.clientY });
        }}>
        <span
          className="aop-agent-name"
          title={t('terminal:overview.clickToSwitch')}
          style={areaInfo ? { background: `${areaInfo.color}12`, borderColor: `${areaInfo.color}28` } : undefined}
        >
          {isBossAgent && <span className="aop-boss-crown" aria-hidden="true"><Icon name="crown" size={12} color="#ffd700" weight="fill" /></span>}
          {agent.name}
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
            <span className="task-prefix"><Icon name="task" size={12} /></span>
            <span className="task-text">{truncate(agent.taskLabel, trunc)}</span>
          </div>
        )}

        {/* Last message preview - hide assistant messages when collapsed */}
        {lastMsg && (isExpanded || lastMsg.isUserPrompt) && (
          <div
            className={`aop-last-message ${lastMsg.isUserPrompt ? 'user' : 'assistant'}`}
            title={lastMsg.text.split('\n')[0]}
          >
            <span className="lm-prefix"><Icon name={lastMsg.isUserPrompt ? 'caret-right' : 'caret-left'} size={10} /></span>
            <span className="lm-text">{truncate(lastMsg.text, trunc)}</span>
            <span className="lm-time">{formatTimestamp(lastMsg.timestamp)}</span>
          </div>
        )}

        {/* Search match context — shows why agent matched a deep search */}
        {matchContext && (
          <div className={`aop-match-context aop-match-context--${matchContext.type}`} title={matchContext.text}>
            <span className="match-icon">
              <Icon name={matchContext.type === 'file' ? 'file-text' : 'chat'} size={12} />
            </span>
            <span className="match-label">
              {matchContext.type === 'file' ? 'file' : 'task'}
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
                      {sub.status === 'completed' ? <Icon name="success" size={12} color="#4ade80" weight="fill" /> : sub.status === 'failed' ? <Icon name="failure" size={12} color="#ef4444" weight="fill" /> : sub.status === 'unknown' ? <Icon name="status-pending" size={12} /> : <Icon name="subitem" size={12} />}
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
                      <span className="tl-icon"><Icon name={getToolIconName(exec.toolName)} size={14} /></span>
                      <span className="tl-tool">{exec.toolName}</span>
                      {param && <span className="tl-param">{param}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {!hasAnyVisibleSection && (
              <div className="aop-no-activity">{t('terminal:overview.noToolActivity')}</div>
            )}
          </div>
        )}

        </div>{/* end aop-card-content */}

        {/* Context usage bar - spans full card width at bottom */}
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
});
