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
  useCompactingAgents,
  store,
} from '../../store';
import { getToolIconName, formatTimestamp } from '../../utils/outputRendering';
import { STORAGE_KEYS, getStorage, setStorage } from '../../utils/storage';
import { getClassConfig } from '../../utils/classConfig';
import { makeAgentOverviewComparator } from './agentOverviewSort';
import { AgentActivityDock } from './AgentActivityDock';
import { useAgentDockPosition } from './agentDockPosition';
import { prefetchAgentHistory } from './useHistoryLoader';
import type { Agent, Subagent, DrawingArea, CustomAgentClass } from '../../../shared/types';
import type { ToolExecution, ClaudeOutput } from '../../store/types';
import type { TwoFingerSelectorState } from '../../hooks/useTwoFingerSelector';
import { ContextMenu } from '../ContextMenu';
import type { ContextMenuAction } from '../ContextMenu';
import { buildAgentContextMenuActions } from './agentContextMenuActions';
import { findFreeAreaSpot } from '../../utils/areaPlacement';
import { AREA_COLORS } from '../../utils/colors';
import { WorkspaceSwitcher, useWorkspaceFilter, isAgentVisibleInWorkspace } from '../WorkspaceSwitcher';
import { BulkManageModal } from '../BulkManageModal';
import { AgentIcon } from '../AgentIcon';
import { Icon, type IconName } from '../Icon';
import { useHasDraft } from '../../utils/agentDrafts';
import { ConfirmModal } from '../shared/ConfirmModal';
import { TaskProgressDots } from '../shared/TaskProgressDots';
import { SubordinateProgressDots } from '../shared/SubordinateProgressDots';
import { AgentHoverTooltip } from '../shared/AgentHoverTooltip';
import { ActivityGlyph } from '../shared/ActivityGlyph';
import { providerAssetUrl, providerLabel } from '../../utils/providerDisplay';
import { ProviderIcon } from '../ProviderIcon';

/** Persisted config shape for the overview panel */
interface AopConfig {
  groupByArea: boolean;
  sortMode: SortMode;
  filterMode: FilterMode;
  sameAreaOnly: boolean; // only show agents in the same area as the active agent
  visibleAreaIds: string[] | null; // null = all areas visible; string[] = only these area IDs
  visibleProviders: string[] | null; // null = all runtimes visible; string[] = only these providers
  splitAreas: boolean;
}

interface AgentOverviewPanelProps {
  activeAgentId: string;
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
  /** External ref for the agent card list (used by the two-finger selector hook). */
  agentListRef?: React.RefObject<HTMLDivElement | null>;
  /** Two-finger selector state driven from the parent (GuakeOutputPanel). */
  twoFingerState?: TwoFingerSelectorState;
  /** Optional external control of which areas are expanded (all others render collapsed). */
  expandedAreas?: Set<string>;
  /** Optional external handler for area toggle. */
  onToggleArea?: (areaKey: string) => void;
  /** Optional bulk replace of the expanded set ([] collapses everything), exposed by surfaces that own expanded state. */
  onSetExpandedAreas?: (areaKeys: string[]) => void;
}

type SortMode = 'name' | 'status' | 'recent';
type FilterMode = 'all' | 'working' | 'idle' | 'error';

const EMPTY_TOOL_EXECS: ToolExecution[] = [];
const EMPTY_SUBAGENTS: Subagent[] = [];
const EMPTY_SUBORDINATES: Agent[] = [];

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

/** Cached card summary for an immutable per-agent output array. */
interface AgentMessageSummary {
  lastMessage: ClaudeOutput | null;
  messageCount: number;
}

const EMPTY_MESSAGE_SUMMARY: AgentMessageSummary = { lastMessage: null, messageCount: 0 };
const messageSummaryCache = new WeakMap<ClaudeOutput[], AgentMessageSummary>();

function isMeaningfulMessage(output: ClaudeOutput): boolean {
  if (output.isStreaming) return false;
  const text = output.text;
  if (
    text.startsWith('Using tool:')
    || text.startsWith('Tool input:')
    || text.startsWith('Tool result:')
    || text.startsWith('Bash output:')
    || text.startsWith('Tokens:')
    || text.startsWith('Cost:')
    || text.startsWith('Context:')
  ) {
    return false;
  }
  return text.trim().length > 0;
}

/**
 * Compute the count and latest meaningful message in one pass. Output actions
 * replace arrays immutably, so the array identity is a safe cache key. This is
 * especially important when selecting a boss: dozens of subordinate cards can
 * update together, but their unchanged histories should not be rescanned.
 */
function getMessageSummary(agentId: string): AgentMessageSummary {
  const outputs = store.getState().agentOutputs.get(agentId);
  if (!outputs || outputs.length === 0) return EMPTY_MESSAGE_SUMMARY;
  const cached = messageSummaryCache.get(outputs);
  if (cached) return cached;

  let lastMessage: ClaudeOutput | null = null;
  let messageCount = 0;
  for (const output of outputs) {
    if (!isMeaningfulMessage(output)) continue;
    lastMessage = output;
    messageCount++;
  }

  const summary = { lastMessage, messageCount };
  messageSummaryCache.set(outputs, summary);
  return summary;
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

// ── Identity preservation for derived collections ──
// This panel re-renders on every agent update while agents work (it lists
// them, sorted by recency). Everything derived from `agents` is recomputed
// then, but most of it comes out identical — returning the PREVIOUS
// collection when the new one is element-wise equal keeps `renderAgentCards`
// (and the memoized area sections / AgentCards below it) stable, so a single
// agent update rebuilds one section instead of the whole list.
function sameArray<T>(a: readonly T[] | undefined, b: readonly T[]): a is T[] {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function keepArray<T>(prev: readonly T[] | undefined, next: T[]): T[] {
  return sameArray(prev, next) ? (prev as T[]) : next;
}
function keepMap<K, V>(prev: Map<K, V>, next: Map<K, V>, eq: (a: V, b: V) => boolean = (a, b) => a === b): Map<K, V> {
  if (prev.size !== next.size) return next;
  for (const [k, v] of next) {
    const pv = prev.get(k);
    if (pv === undefined || !eq(pv, v)) return next;
  }
  return prev;
}
function keepSet<T>(prev: Set<T> | null, next: Set<T> | null): Set<T> | null {
  if (!prev || !next) return prev === next ? prev : next;
  if (prev.size !== next.size) return next;
  for (const v of next) if (!prev.has(v)) return next;
  return prev;
}

// ── Area group section ──
// One `.aop-area-group` (header + optional prompt editor + cards). Memoized so
// that, on an agent update, only the section whose `group` object changed
// rebuilds its element tree — element creation for every group on every
// update was ~80% of the panel's render time.
interface AreaGroupSectionProps {
  group: AreaGroup;
  groupByArea: boolean;
  isCollapsed: boolean;
  unassignedLabel: string;
  isEditingPrompt: boolean;
  /** '' unless this section is the one being edited (keeps the prop stable). */
  editingPromptText: string;
  setEditingPromptText: (text: string) => void;
  setEditingPromptAreaId: (areaId: string | null) => void;
  toggleArea: (areaKey: string) => void;
  openAreaContextMenu: (area: DrawingArea, position: { x: number; y: number }) => void;
  toggleAreaVisibility: (areaId: string) => void;
  renderAgentCards: (groupAgents: Agent[]) => React.ReactNode;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const AreaGroupSection = React.memo(function AreaGroupSection({
  group,
  groupByArea,
  isCollapsed,
  unassignedLabel,
  isEditingPrompt,
  editingPromptText,
  setEditingPromptText,
  setEditingPromptAreaId,
  toggleArea,
  openAreaContextMenu,
  toggleAreaVisibility,
  renderAgentCards,
  t,
}: AreaGroupSectionProps) {
  const areaKey = group.area?.id || '__unassigned__';
  const areaName = group.area?.name || (groupByArea ? unassignedLabel : '');
  const areaColor = group.area?.color || '#6272a4';
  const workingAgentCount = group.agents.filter(agent => agent.status === 'working').length;
  return (
    <div className="aop-area-group">
      {/* Only show area header when grouping is on */}
      {groupByArea && (
        <div
          className={`aop-area-header${workingAgentCount > 0 ? ' aop-area-header--working' : ''}`}
          data-area-id={areaKey}
          onClick={() => toggleArea(areaKey)}
          onContextMenu={(event) => {
            if (!group.area) return;
            event.preventDefault();
            event.stopPropagation();
            openAreaContextMenu(group.area, {
              x: event.clientX,
              y: event.clientY,
            });
          }}
          style={{
            borderLeftColor: areaColor,
            '--aop-area-color': areaColor,
          } as React.CSSProperties}
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
                if (isEditingPrompt) {
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
          {workingAgentCount > 0 && (
            <span
              className="aop-area-working"
              title={`${workingAgentCount} working agent${workingAgentCount === 1 ? '' : 's'}`}
              aria-label={`${workingAgentCount} working agent${workingAgentCount === 1 ? '' : 's'}`}
            >
              <ActivityGlyph animated size={12} className="aop-area-working-glyph" />
              <span>{workingAgentCount}</span>
            </span>
          )}
          <span className="aop-area-count">{group.agents.length}</span>
        </div>
      )}
      {isEditingPrompt && group.area && (
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
});

interface AgentCardSelectionState {
  activeAgentId: string;
  subordinateAgentIds: Set<string> | null;
  subordinateLabel: string;
}

const AgentCardSelectionContext = React.createContext<AgentCardSelectionState>({
  activeAgentId: '',
  subordinateAgentIds: null,
  subordinateLabel: 'Reports to selected boss',
});

/**
 * Selection-only state lives in a tiny context consumer inside each card.
 * Selecting a boss can change the subordinate marker on dozens of rows; keeping
 * that bit out of AgentCard's props prevents every card from rescanning history
 * and rebuilding its full content just to toggle one class/badge.
 */
const AgentCardSelectionMarker = React.memo(function AgentCardSelectionMarker({ agentId }: { agentId: string }) {
  const selection = React.useContext(AgentCardSelectionContext);
  const isActive = selection.activeAgentId === agentId;
  const isSubordinate = selection.subordinateAgentIds?.has(agentId) ?? false;
  if (!isActive && !isSubordinate) return null;

  return (
    <>
      {isActive && <span className="aop-agent-state-marker--active" aria-hidden="true" />}
      {isSubordinate && (
        <span
          className="aop-subordinate-badge"
          title={selection.subordinateLabel}
          aria-label={selection.subordinateLabel}
        >
          <Icon name="link" size={10} color="#ffd700" weight="bold" />
        </span>
      )}
    </>
  );
});

/** Tiny SVG activity cue; rotating its 13px texture avoids card-sized paints. */
const AgentCardWorkingIndicator = React.memo(function AgentCardWorkingIndicator({
  label,
}: {
  label: string;
}) {
  return (
    <span className="aop-agent-working-glyph" title={label} aria-label={label}>
      <ActivityGlyph animated size={13} />
    </span>
  );
});

export function AgentOverviewPanel({ activeAgentId, onClose, onSelectAgent, agentListRef: externalAgentListRef, twoFingerState, expandedAreas: externalExpandedAreas, onToggleArea: externalOnToggleArea, onSetExpandedAreas }: AgentOverviewPanelProps) {
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
  // These collections are shared by every card. One parent subscription avoids
  // two store listeners per row (a large fan-out during streamed output).
  const customAgentClasses = useCustomAgentClassesArray();
  const compactingAgents = useCompactingAgents();
  const dockPosition = useAgentDockPosition();

  // Resolve subordinate Agent objects per boss for the SubordinateProgressDots indicator.
  const prevSubordinatesByBossRef = useRef<Map<string, Agent[]>>(new Map());
  const subordinatesByBoss = useMemo(() => {
    const byId = new Map(allAgents.map((a) => [a.id, a]));
    const map = new Map<string, Agent[]>();
    const prev = prevSubordinatesByBossRef.current;
    for (const agent of allAgents) {
      if ((agent.isBoss || agent.class === 'boss') && agent.subordinateIds && agent.subordinateIds.length > 0) {
        const subs = agent.subordinateIds
          .map((id) => byId.get(id))
          .filter((a): a is Agent => a !== undefined);
        if (subs.length > 0) {
          // Keep the previous array when the subordinate objects are the same
          // (AgentCard prop → memo stability across unrelated agent updates).
          map.set(agent.id, keepArray(prev.get(agent.id), subs));
        }
      }
    }
    const kept = keepMap(prev, map);
    prevSubordinatesByBossRef.current = kept;
    return kept;
  }, [allAgents]);

  // When the currently selected agent is a boss, highlight its subordinates in the panel
  // so the user can quickly see which agents report to the boss they just clicked.
  const prevSubordinatesOfActiveBossRef = useRef<Set<string> | null>(null);
  const subordinatesOfActiveBoss = useMemo(() => {
    const active = allAgents.find((a) => a.id === activeAgentId);
    let next: Set<string> | null = null;
    if (active) {
      const isBoss = active.isBoss || active.class === 'boss';
      if (isBoss && active.subordinateIds && active.subordinateIds.length > 0) next = new Set(active.subordinateIds);
    }
    const kept = keepSet(prevSubordinatesOfActiveBossRef.current, next);
    prevSubordinatesOfActiveBossRef.current = kept;
    return kept;
  }, [allAgents, activeAgentId]);

  // Load persisted config from localStorage
  const savedConfig = useMemo(() => getStorage<AopConfig>(STORAGE_KEYS.AOP_CONFIG, {
    groupByArea: true,
    sortMode: 'recent',
    filterMode: 'all',
    sameAreaOnly: false,
    visibleAreaIds: null,
    visibleProviders: null,
    splitAreas: false,
  }), []);

  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => new Set());
  // Areas render collapsed unless present in this set, so every page load
  // starts with all areas collapsed.
  const [internalExpandedAreas, setInternalExpandedAreas] = useState<Set<string>>(new Set());
  const expandedAreas = externalExpandedAreas ?? internalExpandedAreas;
  const [editingPromptAreaId, setEditingPromptAreaId] = useState<string | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>(savedConfig.sortMode);
  const [filterMode, setFilterMode] = useState<FilterMode>(savedConfig.filterMode);
  const [searchQuery, setSearchQuery] = useState('');
  // Quick "search area" filter — narrows the list to agents whose area name
  // matches. Focused with Ctrl/Cmd+L and cleared automatically once an agent
  // is selected.
  const [areaSearchQuery, setAreaSearchQuery] = useState('');
  const [groupByArea, setGroupByArea] = useState(savedConfig.groupByArea);
  const [sameAreaOnly, setSameAreaOnly] = useState(savedConfig.sameAreaOnly);
  const [splitAreas, setSplitAreas] = useState(savedConfig.splitAreas === true);
  const [visibleAreaIds, setVisibleAreaIds] = useState<Set<string> | null>(
    savedConfig.visibleAreaIds ? new Set(savedConfig.visibleAreaIds) : null
  );
  const [visibleProviders, setVisibleProviders] = useState<Set<string> | null>(
    savedConfig.visibleProviders ? new Set(savedConfig.visibleProviders) : null
  );
  const [areaFilterOpen, setAreaFilterOpen] = useState(false);
  const [areaFilterSearch, setAreaFilterSearch] = useState('');
  const [runtimeFilterOpen, setRuntimeFilterOpen] = useState(false);
  const [bulkManageOpen, setBulkManageOpen] = useState(false);
  const areaFilterRef = useRef<HTMLDivElement>(null);
  const runtimeFilterRef = useRef<HTMLDivElement>(null);
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
  // Remove-agent confirmation — replaces native window.confirm() so the dialog
  // matches the rest of the TC modals (dark theme, escape-to-close, focus trap).
  const [removeAgentConfirm, setRemoveAgentConfirm] = useState<{
    agentId: string;
    name: string;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const areaSearchInputRef = useRef<HTMLInputElement>(null);
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
    // Selecting an agent dismisses the transient "search area" filter.
    setAreaSearchQuery('');
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

  // Close runtime filter dropdown on outside click
  useEffect(() => {
    if (!runtimeFilterOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (runtimeFilterRef.current && !runtimeFilterRef.current.contains(e.target as Node)) {
        setRuntimeFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [runtimeFilterOpen]);

  // Focus overview search with Alt+Shift+F, or the "search area" input with
  // Ctrl/Cmd+L, when the panel is open.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isFocusSearchShortcut = event.altKey
        && event.shiftKey
        && !event.ctrlKey
        && !event.metaKey
        && event.code === 'KeyF';

      const isFocusAreaSearchShortcut = (event.ctrlKey || event.metaKey)
        && !event.altKey
        && !event.shiftKey
        && event.code === 'KeyL';

      if (isFocusAreaSearchShortcut) {
        event.preventDefault();
        areaSearchInputRef.current?.focus();
        areaSearchInputRef.current?.select();
        return;
      }

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
      visibleProviders: visibleProviders ? Array.from(visibleProviders) : null,
      splitAreas,
    } as AopConfig);
  }, [groupByArea, sortMode, filterMode, sameAreaOnly, visibleAreaIds, visibleProviders, splitAreas]);

  // List of non-archived areas for the filter dropdown
  const availableAreas = useMemo(() => {
    const result: { id: string; name: string; color: string }[] = [];
    for (const [, area] of areas) {
      if (!area.archived) result.push({ id: area.id, name: area.name, color: area.color });
    }
    result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return result;
  }, [areas]);
  const recentAreas = useMemo(() => {
    const lastUsedByArea = new Map<string, number>();
    for (const agent of agents) {
      const area = store.getAreaForAgent(agent.id);
      if (!area || area.archived) continue;
      lastUsedByArea.set(area.id, Math.max(lastUsedByArea.get(area.id) ?? 0, agent.lastActivity));
    }
    return availableAreas
      .filter((area) => lastUsedByArea.has(area.id))
      .sort((a, b) => (lastUsedByArea.get(b.id) ?? 0) - (lastUsedByArea.get(a.id) ?? 0))
      .slice(0, 5);
  }, [agents, availableAreas]);

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

  // Distinct agent runtimes (providers) currently present, in a stable order.
  // Drives the runtime filter dropdown — hidden entirely when only one runtime
  // is in use, since filtering by it would be a no-op.
  const availableProviders = useMemo(() => {
    const present = new Set<string>();
    for (const agent of agents) present.add(agent.provider || 'claude');
    const order = ['claude', 'codex', 'opencode', 'grok', 'pi'];
    const known = order.filter(p => present.has(p));
    const extras = Array.from(present).filter(p => !order.includes(p)).sort();
    return [...known, ...extras];
  }, [agents]);

  // Runtime filter helpers (mirror the area filter: null = show all runtimes)
  const isAllRuntimesVisible = visibleProviders === null;
  const toggleProviderVisibility = useCallback((provider: string) => {
    setVisibleProviders(prev => {
      if (prev === null) {
        // Switch from "all" to "all except this one"
        const next = new Set(availableProviders);
        next.delete(provider);
        return next;
      }
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      // If every available runtime is now selected, collapse back to null (= "all")
      if (next.size >= availableProviders.length) return null;
      return next;
    });
  }, [availableProviders]);

  const toggleAllRuntimes = useCallback(() => {
    setVisibleProviders(prev => (prev === null ? new Set<string>() : null));
  }, []);

  // Map agent -> area info (color + name) for badge display
  // One getAreaForAgent pass per (agents, areas) change feeds three lookups
  // (badge info, search name, area id) — this panel re-renders on every agent
  // update while agents work, and three separate O(agents) area walks per
  // render were the top memo cost in the profiler.
  const prevAgentAreaInfoRef = useRef<Map<string, { color: string; name: string }>>(new Map());
  const prevAgentAreaSearchNameRef = useRef<Map<string, string>>(new Map());
  const prevAgentToAreaIdRef = useRef<Map<string, string>>(new Map());
  const { agentAreaInfo, agentAreaSearchName, agentToAreaId } = useMemo(() => {
    const info = new Map<string, { color: string; name: string }>();
    // Search path includes archived (disabled) areas so the area search
    // matches across ALL areas, regardless of their enabled/disabled state;
    // the badge/grouping maps exclude them.
    const searchName = new Map<string, string>();
    const areaId = new Map<string, string>();
    const prevInfo = prevAgentAreaInfoRef.current;
    for (const agent of agents) {
      const area = store.getAreaForAgent(agent.id);
      if (!area) continue;
      searchName.set(agent.id, area.name);
      if (area.archived) continue;
      // Reuse the previous {color,name} object when unchanged — it is an
      // AgentCard prop, and a fresh object per agent per render made every
      // card re-render on every agent update.
      const before = prevInfo.get(agent.id);
      info.set(agent.id, before && before.color === area.color && before.name === area.name
        ? before
        : { color: area.color, name: area.name });
      areaId.set(agent.id, area.id);
    }
    const keptInfo = keepMap(prevAgentAreaInfoRef.current, info);
    const keptSearchName = keepMap(prevAgentAreaSearchNameRef.current, searchName);
    const keptAreaId = keepMap(prevAgentToAreaIdRef.current, areaId);
    prevAgentAreaInfoRef.current = keptInfo;
    prevAgentAreaSearchNameRef.current = keptSearchName;
    prevAgentToAreaIdRef.current = keptAreaId;
    return { agentAreaInfo: keptInfo, agentAreaSearchName: keptSearchName, agentToAreaId: keptAreaId };
  }, [agents, areas]);

  // Group tool executions by agent. Per-agent arrays keep their identity when
  // that agent's executions did not change: a new array for EVERY agent on
  // each tool start/finish defeated AgentCard's memo across the whole panel
  // (every card re-rendered on every tool event of any agent).
  const prevToolsByAgentRef = useRef<Map<string, ToolExecution[]>>(new Map());
  const toolsByAgent = useMemo(() => {
    const map = new Map<string, ToolExecution[]>();
    for (const exec of toolExecutions) {
      const list = map.get(exec.agentId) || [];
      list.push(exec);
      map.set(exec.agentId, list);
    }
    const prev = prevToolsByAgentRef.current;
    for (const [id, list] of map) map.set(id, keepArray(prev.get(id), list));
    const kept = keepMap(prev, map);
    prevToolsByAgentRef.current = kept;
    return kept;
  }, [toolExecutions]);

  // Group subagents by parent (same identity preservation as toolsByAgent).
  const prevSubagentsByParentRef = useRef<Map<string, Subagent[]>>(new Map());
  const subagentsByParent = useMemo(() => {
    const map = new Map<string, Subagent[]>();
    for (const [, sub] of subagents) {
      const list = map.get(sub.parentAgentId) || [];
      list.push(sub);
      map.set(sub.parentAgentId, list);
    }
    const prev = prevSubagentsByParentRef.current;
    for (const [id, list] of map) map.set(id, keepArray(prev.get(id), list));
    const kept = keepMap(prev, map);
    prevSubagentsByParentRef.current = kept;
    return kept;
  }, [subagents]);

  // Filter agents — deep search through file changes and user tasks
  const prevSearchMatchContextsRef = useRef<Map<string, SearchMatchContext>>(new Map());
  const [filteredAgents, searchMatchContexts] = useMemo(() => {
    const activeAreaId = agentToAreaId.get(activeAgentId) ?? null;
    const contexts = new Map<string, SearchMatchContext>();

    const result = agents.filter(a => {
      if (filterMode === 'working' && a.status !== 'working') return false;
      if (filterMode === 'idle' && a.status !== 'idle') return false;
      if (filterMode === 'error' && a.status !== 'error') return false;
      if (visibleProviders && !visibleProviders.has(a.provider || 'claude')) return false;
      if (sameAreaOnly) {
        const aAreaId = agentToAreaId.get(a.id) ?? null;
        if (aAreaId !== activeAreaId) return false;
      }
      if (areaSearchQuery.trim()) {
        const aq = areaSearchQuery.toLowerCase().trim();
        const areaName = agentAreaSearchName.get(a.id)?.toLowerCase() ?? '';
        if (!areaName.includes(aq)) return false;
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

    const keptContexts = keepMap(prevSearchMatchContextsRef.current, contexts, (a, b) => a.type === b.type && a.text === b.text);
    prevSearchMatchContextsRef.current = keptContexts;
    return [result, keptContexts] as const;
  }, [agents, filterMode, searchQuery, areaSearchQuery, agentAreaSearchName, sameAreaOnly, agentToAreaId, activeAgentId, fileChanges, visibleProviders]);

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
      // Full sort — shared with the Spotlight "Areas" tab via makeAgentOverviewComparator
      // so both surfaces order agents identically.
      sorted = [...list].sort(makeAgentOverviewComparator({
        sortMode,
        agentsWithUnseenOutput,
        getLatestToolTimestamp: (id) => (toolsByAgent.get(id) || [])[0]?.timestamp,
      }));
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
  const prevAreaGroupsRef = useRef<Map<string, AreaGroup>>(new Map());
  const areaGroups = useMemo(() => {
    if (!groupByArea) {
      // Flat list: single group with no area
      const before = prevAreaGroupsRef.current.get('__flat__');
      const sorted = keepArray(before?.agents, sortAgents(filteredAgents, '__flat__'));
      const group = before && before.agents === sorted ? before : { area: null, agents: sorted };
      prevAreaGroupsRef.current = new Map([['__flat__', group]]);
      return [group] as AreaGroup[];
    }

    const agentsByAreaId = new Map<string, Agent[]>();
    const unassignedAgents: Agent[] = [];
    for (const agent of filteredAgents) {
      // agentToAreaId already excludes archived areas (same rule as before);
      // reusing it avoids a second point-in-area walk over every agent.
      const areaId = agentToAreaId.get(agent.id);
      if (!areaId) {
        unassignedAgents.push(agent);
        continue;
      }
      const list = agentsByAreaId.get(areaId);
      if (list) list.push(agent);
      else agentsByAreaId.set(areaId, [agent]);
    }

    const groups: AreaGroup[] = [];
    // Reuse the previous group object (and its sorted array) when nothing in
    // it changed — the area sections below are memoized on it.
    const prevGroups = prevAreaGroupsRef.current;
    const nextGroups = new Map<string, AreaGroup>();
    const keepGroup = (key: string, area: DrawingArea | null, sorted: Agent[]): AreaGroup => {
      const before = prevGroups.get(key);
      const agentsKept = keepArray(before?.agents, sorted);
      const group = before && before.area === area && before.agents === agentsKept ? before : { area, agents: agentsKept };
      nextGroups.set(key, group);
      return group;
    };

    for (const [areaId, area] of areas) {
      if (area.archived) continue;
      // Apply area visibility filter
      if (visibleAreaIds && !visibleAreaIds.has(areaId)) continue;
      const areaAgents = agentsByAreaId.get(areaId) || [];
      if (areaAgents.length > 0) {
        groups.push(keepGroup(`area_${areaId}`, area, sortAgents(areaAgents, `area_${areaId}`)));
      }
    }

    // Unassigned agents: show when no filter or when filter explicitly allows __unassigned__
    if (unassignedAgents.length > 0 && (!visibleAreaIds || visibleAreaIds.has('__unassigned__'))) {
      groups.push(keepGroup('__unassigned__', null, sortAgents(unassignedAgents, '__unassigned__')));
    }
    prevAreaGroupsRef.current = nextGroups;

    groups.sort((a, b) => {
      // Keep Unassigned after named areas, while ordering named areas A-Z.
      if (!a.area && !b.area) return 0;
      if (!a.area) return 1;
      if (!b.area) return -1;
      return a.area.name.localeCompare(b.area.name, undefined, { sensitivity: 'base' });
    });

    return groups;
  }, [areas, filteredAgents, sortAgents, groupByArea, visibleAreaIds, agentToAreaId]);
  const displayedAreaGroups = useMemo(() => {
    if (!splitAreas || !groupByArea) return areaGroups;
    const byId = new Map(areaGroups.map((group) => [group.area?.id || '__unassigned__', group]));
    const recent = recentAreas.map((area) => byId.get(area.id)).filter((group): group is AreaGroup => !!group);
    // Deliberately repeat recent areas: the first section is a quick-access
    // shortlist, while the section after the divider is always the full list.
    return [...recent, ...areaGroups];
  }, [areaGroups, groupByArea, recentAreas, splitAreas]);
  const splitAreaDividerIndex = splitAreas && groupByArea
    ? recentAreas.filter((area) => areaGroups.some((group) => group.area?.id === area.id)).length
    : -1;

  const renderAgentCards = useCallback((groupAgents: Agent[]) => {
    return groupAgents.map((agent) => (
      <React.Fragment key={agent.id}>
        <AgentCard
          agent={agent}
          isExpanded={expandedAgents.has(agent.id)}
          isMobile={isMobileViewport}
          hasPendingRead={agentsWithUnseenOutput.has(agent.id)}
          isTwoFingerHovered={twoFingerSelector.hoveredAgentId === agent.id}
          showAreaChip={!groupByArea}
          toolExecs={toolsByAgent.get(agent.id) || EMPTY_TOOL_EXECS}
          subagents={subagentsByParent.get(agent.id) || EMPTY_SUBAGENTS}
          subordinates={subordinatesByBoss.get(agent.id) || EMPTY_SUBORDINATES}
          areaInfo={agentAreaInfo.get(agent.id)}
          matchContext={searchMatchContexts.get(agent.id)}
          customClasses={customAgentClasses}
          isCompacting={compactingAgents.has(agent.id)}
          onSelect={handleCardSelect}
          onClearContext={handleCardClearContext}
          onContextMenu={handleCardContextMenu}
        />
      </React.Fragment>
    ));
  }, [
    expandedAgents,
    isMobileViewport,
    agentsWithUnseenOutput,
    twoFingerSelector.hoveredAgentId,
    groupByArea,
    toolsByAgent,
    subagentsByParent,
    subordinatesByBoss,
    agentAreaInfo,
    searchMatchContexts,
    customAgentClasses,
    compactingAgents,
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

  const unassignedLabel = t('terminal:overview.unassigned');
  const toggleArea = useCallback((areaKey: string) => {
    if (splitAreas && groupByArea) {
      // Accordion: opening an area closes every other one; closing the open
      // area leaves everything collapsed.
      const nextKeys = expandedAreas.has(areaKey) ? [] : [areaKey];
      if (onSetExpandedAreas) onSetExpandedAreas(nextKeys);
      else setInternalExpandedAreas(new Set(nextKeys));
      return;
    }
    if (externalOnToggleArea) {
      externalOnToggleArea(areaKey);
      return;
    }
    setInternalExpandedAreas(prev => {
      const next = new Set(prev);
      if (next.has(areaKey)) next.delete(areaKey);
      else next.add(areaKey);
      return next;
    });
  }, [splitAreas, groupByArea, expandedAreas, onSetExpandedAreas, externalOnToggleArea]);

  // When the selected agent changes, make sure its area is expanded so the
  // card is actually visible. Without this, selecting an agent from another
  // surface (TrackingBoard, FlatView chat, 3D scene) would silently highlight
  // a hidden card inside a collapsed area.
  useEffect(() => {
    if (!activeAgentId) return;
    const areaKey = agentToAreaId.get(activeAgentId) ?? '__unassigned__';
    if (expandedAreas.has(areaKey)) return;
    // Expanding a large area can mount dozens of rich AgentCards. It is useful
    // follow-up UI, but not part of the critical click→chat response, so keep
    // it in a transition that React may yield or supersede on rapid switching.
    React.startTransition(() => {
      if (splitAreas && groupByArea) {
        // Accordion mode: the selected agent's area replaces the open one
        // instead of piling up next to it.
        if (onSetExpandedAreas) onSetExpandedAreas([areaKey]);
        else setInternalExpandedAreas(new Set([areaKey]));
      } else if (externalOnToggleArea) {
        externalOnToggleArea(areaKey);
      } else {
        setInternalExpandedAreas(prev => {
          if (prev.has(areaKey)) return prev;
          return new Set(prev).add(areaKey);
        });
      }
    });
    // Depend only on the agent id so a later user-driven collapse of the same
    // area is respected; we re-expand only when the selection itself changes.
  }, [activeAgentId]);

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

  const requestBossSpawnForArea = useCallback((area: DrawingArea) => {
    window.dispatchEvent(new CustomEvent('tide:open-boss-spawn-modal', {
      detail: {
        areaId: area.id,
        position: {
          x: area.center.x,
          z: area.center.z,
        },
      },
    }));
  }, []);

  const createNewAreaNear = useCallback((origin: { x: number; z: number } | null) => {
    const DEFAULT_SIZE = 8;
    const allAreas = Array.from(store.getState().areas.values());
    const spot = findFreeAreaSpot(allAreas, DEFAULT_SIZE, DEFAULT_SIZE, origin ?? { x: 0, z: 0 });
    const visibleCount = allAreas.filter(a => !a.archived).length;
    const randomSuffix = Math.random().toString(36).slice(2, 11);
    const newArea: DrawingArea = {
      id: `area_${Date.now()}_${randomSuffix}`,
      name: `Area ${visibleCount + 1}`,
      type: 'rectangle',
      center: spot,
      width: DEFAULT_SIZE,
      height: DEFAULT_SIZE,
      color: AREA_COLORS[visibleCount % AREA_COLORS.length],
      zIndex: store.getNextZIndex(),
      assignedAgentIds: [],
      directories: [],
    };
    store.addArea(newArea);
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
      {
        id: 'spawn-boss',
        label: t('terminal:overview.newBoss', { defaultValue: 'New Boss' }),
        icon: <Icon name="crown" size={14} />,
        onClick: () => requestBossSpawnForArea(area),
      },
      {
        id: 'new-area',
        label: t('terminal:overview.newArea', { defaultValue: 'New Area' }),
        icon: <Icon name="target" size={14} />,
        onClick: () => createNewAreaNear(area.center),
      },
    ];
  }, [areaContextMenu, areas, requestSpawnForArea, requestBossSpawnForArea, createNewAreaNear, t]);

  const agentContextMenuActions = useMemo((): ContextMenuAction[] => {
    if (!agentContextMenu) return [];
    const agent = agents.find(a => a.id === agentContextMenu.agentId);
    if (!agent) return [];
    const isExpanded = expandedAgents.has(agent.id);

    return buildAgentContextMenuActions({
      agent,
      t,
      onDelete: () => setRemoveAgentConfirm({ agentId: agent.id, name: agent.name }),
      extraActions: [
        {
          id: 'toggle-expand',
          label: isExpanded ? t('terminal:overview.collapse', { defaultValue: 'Collapse' }) : t('terminal:overview.expand', { defaultValue: 'Expand' }),
          icon: <Icon name={isExpanded ? 'caret-down' : 'caret-right'} size={14} />,
          onClick: () => toggleAgent(agent.id),
        },
      ],
    });
  }, [agentContextMenu, agents, expandedAgents, t]);

  // Keep the active agent card centered in the overview scroll container when the
  // selected agent changes.  We intentionally depend only on activeAgentId (not on
  // areaGroups) so that routine data updates don't hijack the user's scroll position.
  useEffect(() => {
    const container = agentListRef.current;
    if (!container) return;

    // Small delay so React can flush the DOM update before we measure.
    const raf = requestAnimationFrame(() => {
      const activeCard = container.querySelector<HTMLElement>(
        '.aop-agent-card.active, .aop-agent-card:has(.aop-agent-state-marker--active)'
      );
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

  const cardSelectionState = useMemo<AgentCardSelectionState>(() => ({
    activeAgentId,
    subordinateAgentIds: subordinatesOfActiveBoss,
    subordinateLabel: t('terminal:overview.subordinateOfSelectedBoss', { defaultValue: 'Reports to selected boss' }),
  }), [activeAgentId, subordinatesOfActiveBoss, t]);

  return (
    <AgentCardSelectionContext.Provider value={cardSelectionState}>
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
              setAreaSearchQuery('');
            }}
            className="search-input"
          />
          <input
            ref={areaSearchInputRef}
            type="text"
            placeholder={t('terminal:overview.searchArea')}
            value={areaSearchQuery}
            onChange={e => setAreaSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setAreaSearchQuery('');
                areaSearchInputRef.current?.blur();
                return;
              }
              if (e.key !== 'Enter') return;
              if (e.nativeEvent.isComposing) return;
              if (areaSearchQuery.trim().length === 0) return;
              if (filteredAgents.length === 0) return;

              e.preventDefault();
              onSelectAgent(filteredAgents[0].id);
              setAreaSearchQuery('');
            }}
            className="search-input area-search-input"
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
        <button
          type="button"
          className={`action-btn action-btn--toggle${splitAreas ? ' active' : ''}`}
          onClick={() => {
            const enabling = !splitAreas;
            setSplitAreas(enabling);
            // Entering accordion mode with several areas already expanded
            // would violate the one-open-area invariant; keep only the
            // active agent's area (when expanded) and collapse the rest.
            if (enabling && groupByArea && expandedAreas.size > 1) {
              const activeAreaKey = agentToAreaId.get(activeAgentId) ?? '__unassigned__';
              const keep = expandedAreas.has(activeAreaKey) ? [activeAreaKey] : [];
              if (onSetExpandedAreas) onSetExpandedAreas(keep);
              else setInternalExpandedAreas(new Set(keep));
            }
          }}
          title="Show areas in the bottom dock"
          aria-pressed={splitAreas}
        >
          Split areas
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
        {availableProviders.length > 1 && (
          <div className="aop-runtime-filter" ref={runtimeFilterRef}>
            <button
              className={`action-btn action-btn--toggle${!isAllRuntimesVisible ? ' active' : ''}`}
              onClick={() => setRuntimeFilterOpen(v => !v)}
              title="Filter runtimes"
            >
              {isAllRuntimesVisible ? 'All runtimes' : `${visibleProviders!.size} runtimes`}
              <span className="aop-area-filter-caret"><Icon name={runtimeFilterOpen ? 'caret-up' : 'caret-down'} size={10} /></span>
            </button>
            {runtimeFilterOpen && (
              <div className="aop-area-filter-dropdown">
                <label className="aop-area-filter-option" onClick={(e) => { e.preventDefault(); toggleAllRuntimes(); }}>
                  <input type="checkbox" checked={isAllRuntimesVisible} readOnly />
                  <span className="aop-area-filter-color" style={{ background: '#6272a4' }} />
                  <span>All</span>
                </label>
                <div className="aop-area-filter-divider" />
                {availableProviders.map(provider => {
                  const checked = isAllRuntimesVisible || (visibleProviders?.has(provider) ?? false);
                  return (
                    <label key={provider} className="aop-area-filter-option" onClick={(e) => { e.preventDefault(); toggleProviderVisibility(provider); }}>
                      <input type="checkbox" checked={checked} readOnly />
                      <img src={providerAssetUrl(provider, import.meta.env.BASE_URL)} alt="" className="aop-runtime-filter-icon" />
                      <span className="aop-area-filter-name">{providerLabel(provider)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {groupByArea && onSetExpandedAreas && areaGroups.length > 0 && (
          <button
            type="button"
            onClick={() => onSetExpandedAreas([])}
            className="action-btn"
            title="Collapse all areas"
          >
            Collapse all
          </button>
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
          displayedAreaGroups.map((group, groupIndex) => {
            const areaKey = group.area?.id || '__unassigned__';
            const isEditingPrompt = editingPromptAreaId === areaKey && !!group.area;
            // The same area may appear once in Recent and once in All, so the
            // section is part of its identity. Its array index is NOT: recency
            // reorders changed every downstream key, remounting whole card
            // subtrees and greatly amplifying detached-DOM retention in React
            // DevTools. Stable section+area keys let React move existing nodes.
            const sectionKey = splitAreas && groupIndex < splitAreaDividerIndex ? 'recent' : 'all';
            return (
              <React.Fragment key={`${sectionKey}-${areaKey}`}>
              {splitAreaDividerIndex > 0 && groupIndex === splitAreaDividerIndex && (
                <div className="aop-split-areas-divider"><span>All areas</span></div>
              )}
              <AreaGroupSection
                group={group}
                groupByArea={groupByArea}
                isCollapsed={!expandedAreas.has(areaKey)}
                unassignedLabel={unassignedLabel}
                isEditingPrompt={isEditingPrompt}
                editingPromptText={isEditingPrompt ? editingPromptText : ''}
                setEditingPromptText={setEditingPromptText}
                setEditingPromptAreaId={setEditingPromptAreaId}
                toggleArea={toggleArea}
                openAreaContextMenu={openAreaContextMenu}
                toggleAreaVisibility={toggleAreaVisibility}
                renderAgentCards={renderAgentCards}
                t={t}
              />
              </React.Fragment>
            );
          })
        )}
      </div>

      {dockPosition === 'overview' && (
        <AgentActivityDock activeAgentId={activeAgentId} onSelectAgent={onSelectAgent} />
      )}

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

      <ConfirmModal
        isOpen={removeAgentConfirm !== null}
        title={t('common:confirm.removeAgentTitle')}
        message={t('common:confirm.removeAgentMessage', { name: removeAgentConfirm?.name ?? '' })}
        confirmLabel={t('common:buttons.remove')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        onConfirm={() => {
          if (removeAgentConfirm) store.removeAgentFromServer(removeAgentConfirm.agentId);
        }}
        onClose={() => setRemoveAgentConfirm(null)}
      />
    </div>
    </AgentCardSelectionContext.Provider>
  );
}

// ============================================================================
// Agent Card sub-component
// ============================================================================

interface AgentCardProps {
  agent: Agent;
  isExpanded: boolean;
  isMobile: boolean;
  hasPendingRead: boolean;
  isTwoFingerHovered: boolean;
  showAreaChip: boolean;
  toolExecs: ToolExecution[];
  subagents: Subagent[];
  subordinates: Agent[];
  areaInfo?: { color: string; name: string };
  matchContext?: SearchMatchContext;
  customClasses: CustomAgentClass[];
  isCompacting: boolean;
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
  isExpanded,
  isMobile,
  hasPendingRead,
  isTwoFingerHovered,
  showAreaChip,
  toolExecs,
  subagents,
  subordinates,
  areaInfo,
  matchContext,
  customClasses,
  isCompacting,
  onSelect,
  onClearContext,
  onContextMenu,
}: AgentCardProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const classConfig = getClassConfig(agent.class, customClasses);
  const isBossAgent = agent.isBoss || agent.class === 'boss';
  const hasDraft = useHasDraft(agent.id);
  const _statusIcon = STATUS_ICONS[agent.status] || '❓';
  const _statusLabel = STATUS_LABEL_KEYS[agent.status] ? t(`terminal:${STATUS_LABEL_KEYS[agent.status]}`) : agent.status;
  const recentTools = toolExecs.slice(0, isMobile ? 4 : 8);
  const { lastMessage: lastMsg, messageCount: msgCount } = getMessageSummary(agent.id);
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
        className={`aop-agent-card ${isBossAgent ? 'boss' : ''} ${agent.status} ${hasPendingRead ? 'unread' : ''}${isTwoFingerHovered ? ' two-finger-hover' : ''}${isCompacting ? ' compacting' : ''}`}
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
        // Warm the history cache during hover (same as the pinned bar) so a
        // click switches to an already-cached conversation.
        onMouseEnter={() => prefetchAgentHistory(agent.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(agent.id, { x: e.clientX, y: e.clientY });
        }}
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
          <ProviderIcon
            agent={agent}
            alt={`${agent.name} provider`}
            className="aop-provider-icon"
          />
        </div>
        <div className="aop-card-content">
        {/* Card Header - always visible */}
        <AgentHoverTooltip todos={agent.latestTodos} subordinates={isBossAgent ? subordinates : undefined} position="bottom">
        <div className="aop-agent-header">
        <span
          className="aop-agent-name"
          title={t('terminal:overview.clickToSwitch')}
        >
          {isBossAgent && <span className="aop-boss-crown" aria-hidden="true"><Icon name="crown" size={12} color="#ffd700" weight="fill" /></span>}
          <AgentCardSelectionMarker agentId={agent.id} />
          {agent.name}
        </span>
        {(agent.status === 'working' || isCompacting) && (
          <AgentCardWorkingIndicator
            label={isCompacting ? 'Compacting context' : 'Working'}
          />
        )}
        {hasPendingRead && (
          <span className="aop-pending-read-indicator" title="Pending read">!</span>
        )}
        {hasDraft && (
          <span
            className="aop-draft-indicator"
            title={t('terminal:overview.hasDraft', { defaultValue: 'Has unsent draft' })}
            aria-label={t('terminal:overview.hasDraft', { defaultValue: 'Has unsent draft' })}
          >
            <Icon name="edit" size={10} />
          </span>
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
        {agent.latestTodos && agent.latestTodos.length > 0 && (
          <TaskProgressDots todos={agent.latestTodos} />
        )}
        {isBossAgent && subordinates.length > 0 && (
          <SubordinateProgressDots subordinates={subordinates} />
        )}
        </div>
        </AgentHoverTooltip>

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
