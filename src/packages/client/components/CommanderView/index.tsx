/**
 * CommanderView - Grid view for managing multiple agents
 *
 * Structure:
 * - index.tsx (this file): Main component orchestration
 * - types.ts: Types and constants
 * - AgentPanel.tsx: Individual agent panel (uses ClaudeOutputPanel components)
 * - SpawnForm.tsx: Agent creation form
 * - useAgentHistory.ts: History loading hook
 * - useAgentInput.ts: Input management hook
 *
 * Note: Message/output rendering is shared with ClaudeOutputPanel (Guake terminal)
 * via HistoryLine and OutputLine components from ../ClaudeOutputPanel/
 */

import React, { useEffect, useRef, useState, useMemo, useCallback, memo } from 'react';
import { useAgents, useAreas, useAgentOutputs, store } from '../../store';
import type { Agent } from '../../../shared/types';
import { FileExplorerPanel } from '../FileExplorerPanel';
import { matchesShortcut } from '../../store/shortcuts';
import { STORAGE_KEYS, getStorageString, setStorageString } from '../../utils/storage';
import { useAgentHistory } from './useAgentHistory';
import { AgentPanel } from './AgentPanel';
import { SpawnForm } from './SpawnForm';
import type { TabId, TabConfig, AgentFilters, AgentStatusFilter, AgentActivityFilter, AgentSortOption } from './types';
import type { AgentHistory } from './types';
import { AGENTS_PER_PAGE, GRID_COLS, DEFAULT_FILTERS, ACTIVITY_THRESHOLDS } from './types';

/**
 * Wrapper component that isolates output updates to prevent parent re-renders.
 * Each AgentPanelWrapper only re-renders when its own agent's outputs change.
 *
 * Uses agentId-based callbacks to allow parent to use stable callback references.
 */
interface AgentPanelWrapperProps {
  agent: Agent;
  history?: AgentHistory;
  isExpanded: boolean;
  isFocused: boolean;
  advancedView: boolean;
  index: number;
  onExpand: (agentId: string) => void;
  onCollapse: () => void;
  onFocus: (index: number) => void;
  onInputRef: (agentId: string, el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onLoadMore: (agentId: string) => void;
}

const AgentPanelWrapper = memo(function AgentPanelWrapper({
  agent,
  history,
  isExpanded,
  isFocused,
  advancedView,
  index,
  onExpand,
  onCollapse,
  onFocus,
  onInputRef,
  onLoadMore,
}: AgentPanelWrapperProps) {
  // Use the hook here so only this component re-renders when outputs change
  const outputs = useAgentOutputs(agent.id);

  // Create stable callbacks that include agentId
  const handleExpand = useCallback(() => {
    if (isExpanded) {
      onCollapse();
    } else {
      onExpand(agent.id);
    }
  }, [agent.id, isExpanded, onExpand, onCollapse]);

  const handleFocus = useCallback(() => {
    onFocus(index);
  }, [index, onFocus]);

  const handleInputRef = useCallback((el: HTMLInputElement | HTMLTextAreaElement | null) => {
    onInputRef(agent.id, el);
  }, [agent.id, onInputRef]);

  const handleLoadMore = useCallback(() => {
    onLoadMore(agent.id);
  }, [agent.id, onLoadMore]);

  return (
    <AgentPanel
      agent={agent}
      history={history}
      outputs={outputs}
      isExpanded={isExpanded}
      isFocused={isFocused}
      advancedView={advancedView}
      onExpand={handleExpand}
      onFocus={handleFocus}
      inputRef={handleInputRef}
      onLoadMore={handleLoadMore}
    />
  );
});

interface CommanderViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommanderView({ isOpen, onClose }: CommanderViewProps) {
  // Use granular selectors to prevent re-renders from unrelated state changes
  const agents = useAgents();
  const areas = useAreas();

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    return getStorageString(STORAGE_KEYS.COMMANDER_TAB, 'all');
  });
  const [page, setPage] = useState(0);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [fileExplorerAreaId, setFileExplorerAreaId] = useState<string | null>(null);
  const [advancedView, setAdvancedView] = useState(false);
  const [filters, setFilters] = useState<AgentFilters>(() => {
    try {
      const saved = getStorageString(STORAGE_KEYS.COMMANDER_FILTERS, '');
      if (saved) return { ...DEFAULT_FILTERS, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_FILTERS;
  });
  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const visibleAgentsRef = useRef<Agent[]>([]);

  // Use the custom hook for history management
  const { histories, loadMoreHistory } = useAgentHistory({
    isOpen,
    agents,
  });

  // Clear state when closing
  useEffect(() => {
    if (!isOpen) {
      setExpandedAgentId(null);
      setFocusedIndex(0);
      setShowSpawnForm(false);
    }
  }, [isOpen]);

  // Build tabs list: All, areas sorted alphabetically, Unassigned
  const tabs = useMemo((): TabConfig[] => {
    const areasArray = Array.from(areas.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const tabList: TabConfig[] = [{ id: 'all', name: 'All' }];
    for (const area of areasArray) {
      tabList.push({ id: area.id, name: area.name, color: area.color });
    }
    tabList.push({ id: 'unassigned', name: 'Unassigned' });
    return tabList;
  }, [areas]);

  // Get current area for spawn
  const currentArea = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'unassigned') return null;
    return areas.get(activeTab) || null;
  }, [activeTab, areas]);

  // Filter helpers
  const hasActiveFilters = filters.status !== 'all' || filters.activity !== 'all' || filters.sort !== 'activity';
  const activeFilterCount = (filters.status !== 'all' ? 1 : 0)
    + (filters.activity !== 'all' ? 1 : 0)
    + (filters.sort !== 'activity' ? 1 : 0);

  // Sort and filter agents by active tab + filters
  const filteredAgents = useMemo(() => {
    const isBoss = (agent: Agent) => agent.isBoss === true || agent.class === 'boss';
    const now = Date.now();

    let result = Array.from(agents.values());

    // Tab filter
    if (activeTab === 'unassigned') {
      result = result.filter(agent => !store.getAreaForAgent(agent.id));
    } else if (activeTab !== 'all') {
      result = result.filter(agent => {
        const area = store.getAreaForAgent(agent.id);
        return area?.id === activeTab;
      });
    }

    // Status filter
    if (filters.status !== 'all') {
      result = result.filter(agent => {
        switch (filters.status) {
          case 'working': return agent.status === 'working';
          case 'idle': return agent.status === 'idle';
          case 'error': return agent.status === 'error' || agent.status === 'waiting' || agent.status === 'waiting_permission';
          case 'offline': return agent.status === 'offline' || agent.status === 'orphaned';
          default: return true;
        }
      });
    }

    // Activity filter
    if (filters.activity !== 'all') {
      const threshold = ACTIVITY_THRESHOLDS[filters.activity];
      result = result.filter(agent => (now - (agent.lastActivity || 0)) < threshold);
    }

    // Sort
    result.sort((a, b) => {
      // Bosses always first
      if (isBoss(a) && !isBoss(b)) return -1;
      if (!isBoss(a) && isBoss(b)) return 1;

      switch (filters.sort) {
        case 'activity':
          return (b.lastActivity || 0) - (a.lastActivity || 0);
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return (a.createdAt || 0) - (b.createdAt || 0);
        case 'context': {
          const aCtx = a.contextStats?.usedPercent ?? ((a.contextUsed || 0) / (a.contextLimit || 200000) * 100);
          const bCtx = b.contextStats?.usedPercent ?? ((b.contextUsed || 0) / (b.contextLimit || 200000) * 100);
          return bCtx - aCtx; // Most used first
        }
        default:
          return (b.lastActivity || 0) - (a.lastActivity || 0);
      }
    });

    return result;
  }, [agents, activeTab, filters]);

  const totalPages = Math.ceil(filteredAgents.length / AGENTS_PER_PAGE);
  const visibleAgents = filteredAgents.slice(page * AGENTS_PER_PAGE, (page + 1) * AGENTS_PER_PAGE);

  // Keep ref in sync for focus effect (avoids re-focusing on terminal updates)
  visibleAgentsRef.current = visibleAgents;

  // Stable callbacks for AgentPanelWrapper to prevent unnecessary re-renders
  const handleCollapseExpanded = useCallback(() => setExpandedAgentId(null), []);
  const handleExpandAgent = useCallback((agentId: string) => setExpandedAgentId(agentId), []);
  const handleFocusAgent = useCallback((index: number) => setFocusedIndex(index), []);
  const handleInputRef = useCallback((agentId: string, el: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (el) inputRefs.current.set(agentId, el);
  }, []);

  // Reset page and save tab when switching tabs
  useEffect(() => {
    setPage(0);
    setStorageString(STORAGE_KEYS.COMMANDER_TAB, activeTab);
  }, [activeTab]);

  // Persist filters to localStorage
  useEffect(() => {
    setStorageString(STORAGE_KEYS.COMMANDER_FILTERS, JSON.stringify(filters));
    setPage(0);
  }, [filters]);

  // Focus input when focusedIndex changes or when expanded (not on terminal updates)
  useEffect(() => {
    if (!isOpen) return;
    const agentId = expandedAgentId || visibleAgentsRef.current[focusedIndex]?.id;
    if (agentId) {
      const input = inputRefs.current.get(agentId);
      if (input && document.activeElement !== input) {
        setTimeout(() => input.focus(), 50);
      }
    }
  }, [isOpen, focusedIndex, expandedAgentId]);

  // Keyboard shortcuts (use capture phase to handle before inputs)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = store.getShortcuts();
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const maxIndex = visibleAgents.length - 1;

      // Escape: collapse or close
      const closeShortcut = shortcuts.find(s => s.id === 'commander-close');
      if (matchesShortcut(e, closeShortcut)) {
        e.preventDefault();
        e.stopPropagation();
        if (expandedAgentId) {
          setExpandedAgentId(null);
        } else {
          onClose();
        }
        return;
      }

      // Vim-style navigation
      const vimLeftShortcut = shortcuts.find(s => s.id === 'commander-vim-left');
      if (matchesShortcut(e, vimLeftShortcut) && !expandedAgentId) {
        e.preventDefault();
        setFocusedIndex(i => (i > 0 ? i - 1 : i));
        return;
      }

      const vimRightShortcut = shortcuts.find(s => s.id === 'commander-vim-right');
      if (matchesShortcut(e, vimRightShortcut) && !expandedAgentId) {
        e.preventDefault();
        setFocusedIndex(i => (i < maxIndex ? i + 1 : i));
        return;
      }

      const vimUpShortcut = shortcuts.find(s => s.id === 'commander-vim-up');
      if (matchesShortcut(e, vimUpShortcut) && !expandedAgentId) {
        e.preventDefault();
        setFocusedIndex(i => (i >= GRID_COLS ? i - GRID_COLS : i));
        return;
      }

      const vimDownShortcut = shortcuts.find(s => s.id === 'commander-vim-down');
      if (matchesShortcut(e, vimDownShortcut) && !expandedAgentId) {
        e.preventDefault();
        setFocusedIndex(i => (i + GRID_COLS <= maxIndex ? i + GRID_COLS : i));
        return;
      }

      // Toggle expand
      const expandShortcut = shortcuts.find(s => s.id === 'commander-expand');
      if (matchesShortcut(e, expandShortcut)) {
        e.preventDefault();
        if (expandedAgentId) {
          setExpandedAgentId(null);
        } else if (visibleAgents[focusedIndex]) {
          setExpandedAgentId(visibleAgents[focusedIndex].id);
        }
        return;
      }

      // New agent
      const newAgentShortcut = shortcuts.find(s => s.id === 'commander-new-agent');
      if (matchesShortcut(e, newAgentShortcut)) {
        e.preventDefault();
        setShowSpawnForm(true);
        return;
      }

      // Tab key to cycle through area tabs
      const nextTabShortcut = shortcuts.find(s => s.id === 'commander-next-tab');
      const prevTabShortcut = shortcuts.find(s => s.id === 'commander-prev-tab');
      if (!isInputFocused) {
        if (matchesShortcut(e, nextTabShortcut)) {
          e.preventDefault();
          e.stopPropagation();
          const currentIndex = tabs.findIndex(t => t.id === activeTab);
          const nextIndex = (currentIndex + 1) % tabs.length;
          setActiveTab(tabs[nextIndex].id);
          setFocusedIndex(0);
          return;
        }
        if (matchesShortcut(e, prevTabShortcut)) {
          e.preventDefault();
          e.stopPropagation();
          const currentIndex = tabs.findIndex(t => t.id === activeTab);
          const nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          setActiveTab(tabs[nextIndex].id);
          setFocusedIndex(0);
          return;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, expandedAgentId, visibleAgents, focusedIndex, tabs, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="commander-overlay" onClick={onClose}>
      <div className="commander-view" onClick={e => e.stopPropagation()}>
        <div className="commander-header">
          <div className="commander-title-section">
            <h2 className="commander-title">Commander View</h2>
            <span className="commander-shortcuts">
              Tab switch areas • ⌥H/J/K/L nav • ⌥O expand • ⌥N new
            </span>
          </div>
          <div className="commander-controls">
            <button
              className={`commander-view-toggle ${advancedView ? 'active' : ''}`}
              onClick={() => setAdvancedView(!advancedView)}
              title={advancedView ? 'Show simple view' : 'Show advanced view'}
            >
              {advancedView ? '◉ Advanced' : '○ Simple'}
            </button>
            <button
              className="commander-add-btn"
              onClick={() => setShowSpawnForm(true)}
              title="Add Agent (⌥N)"
            >
              + Add Agent
            </button>
            <button className="commander-close" onClick={onClose}>
              Close (Esc)
            </button>
          </div>
        </div>

        {/* Area Tabs */}
        <div className="commander-tabs">
          {tabs.map(tab => {
            const area =
              tab.id !== 'all' && tab.id !== 'unassigned' ? areas.get(tab.id) : null;
            const hasDirectories = area && area.directories && area.directories.length > 0;

            return (
              <button
                key={tab.id}
                className={`commander-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(tab.id);
                  setFocusedIndex(0);
                }}
                style={
                  tab.color
                    ? { borderBottomColor: activeTab === tab.id ? tab.color : 'transparent' }
                    : undefined
                }
              >
                {tab.color && (
                  <span className="commander-tab-dot" style={{ background: tab.color }} />
                )}
                <span>{tab.name}</span>
                <span className="commander-tab-count">
                  {tab.id === 'all'
                    ? agents.size
                    : tab.id === 'unassigned'
                      ? Array.from(agents.values()).filter(a => !store.getAreaForAgent(a.id))
                          .length
                      : Array.from(agents.values()).filter(
                          a => store.getAreaForAgent(a.id)?.id === tab.id
                        ).length}
                </span>
                {hasDirectories && (
                  <span
                    className="commander-tab-folder"
                    onClick={e => {
                      e.stopPropagation();
                      setFileExplorerAreaId(tab.id);
                    }}
                    title="Open file explorer"
                  >
                    📁
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filter Bar */}
        <div className="commander-filters">
          <div className="commander-filter-group">
            <span className="commander-filter-label">Status</span>
            {(['all', 'working', 'idle', 'error', 'offline'] as AgentStatusFilter[]).map(s => (
              <button
                key={s}
                className={`commander-filter-btn ${filters.status === s ? 'active' : ''}`}
                onClick={() => setFilters(f => ({ ...f, status: s }))}
              >
                {s === 'all' ? 'All' : s === 'error' ? 'Needs Attn' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="commander-filter-group">
            <span className="commander-filter-label">Active</span>
            {(['all', '1h', '6h', '24h'] as AgentActivityFilter[]).map(a => (
              <button
                key={a}
                className={`commander-filter-btn ${filters.activity === a ? 'active' : ''}`}
                onClick={() => setFilters(f => ({ ...f, activity: a }))}
              >
                {a === 'all' ? 'Any' : `< ${a}`}
              </button>
            ))}
          </div>
          <div className="commander-filter-group">
            <span className="commander-filter-label">Sort</span>
            {(['activity', 'name', 'created', 'context'] as AgentSortOption[]).map(s => (
              <button
                key={s}
                className={`commander-filter-btn ${filters.sort === s ? 'active' : ''}`}
                onClick={() => setFilters(f => ({ ...f, sort: s }))}
              >
                {s === 'activity' ? 'Recent' : s === 'context' ? 'Context' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button
              className="commander-filter-clear"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              title="Clear all filters"
            >
              Clear ({activeFilterCount})
            </button>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="commander-pagination">
            <button
              className="commander-page-btn"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              ← Prev
            </button>
            <span className="commander-page-info">
              Page {page + 1} of {totalPages} ({filteredAgents.length} agents)
            </span>
            <button
              className="commander-page-btn"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
            >
              Next →
            </button>
          </div>
        )}

        <div
          className={`commander-grid ${expandedAgentId ? 'has-expanded' : ''}`}
          data-agent-count={visibleAgents.length}
        >
          {visibleAgents.length === 0 ? (
            <div className="commander-empty">
              {activeTab === 'all'
                ? 'No agents deployed. Press ⌥N to add an agent.'
                : activeTab === 'unassigned'
                  ? 'No unassigned agents.'
                  : `No agents in this area. Press ⌥N to add one.`}
            </div>
          ) : expandedAgentId ? (
            // Show only expanded agent
            (() => {
              const agent = agents.get(expandedAgentId);
              if (!agent) return null;
              return (
                <AgentPanelWrapper
                  key={agent.id}
                  agent={agent}
                  history={histories.get(agent.id)}
                  isExpanded={true}
                  isFocused={true}
                  advancedView={advancedView}
                  index={0}
                  onExpand={handleExpandAgent}
                  onCollapse={handleCollapseExpanded}
                  onFocus={handleFocusAgent}
                  onInputRef={handleInputRef}
                  onLoadMore={loadMoreHistory}
                />
              );
            })()
          ) : (
            visibleAgents.map((agent, index) => (
              <AgentPanelWrapper
                key={agent.id}
                agent={agent}
                history={histories.get(agent.id)}
                isExpanded={false}
                isFocused={index === focusedIndex}
                advancedView={advancedView}
                index={index}
                onExpand={handleExpandAgent}
                onCollapse={handleCollapseExpanded}
                onFocus={handleFocusAgent}
                onInputRef={handleInputRef}
                onLoadMore={loadMoreHistory}
              />
            ))
          )}
        </div>

        {/* Spawn Form Modal */}
        {showSpawnForm && (
          <SpawnForm currentArea={currentArea} onClose={() => setShowSpawnForm(false)} />
        )}

        {/* File Explorer Panel */}
        {fileExplorerAreaId && (
          <FileExplorerPanel
            isOpen={true}
            areaId={fileExplorerAreaId}
            onClose={() => setFileExplorerAreaId(null)}
            onChangeArea={newAreaId => setFileExplorerAreaId(newAreaId)}
          />
        )}
      </div>
    </div>
  );
}
