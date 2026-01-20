/**
 * CommanderView - Grid view for managing multiple agents
 *
 * Structure:
 * - index.tsx (this file): Main component orchestration
 * - types.ts: Types and constants
 * - AgentPanel.tsx: Individual agent panel
 * - MessageLine.tsx: History message rendering
 * - OutputLine.tsx: Live output rendering
 * - SpawnForm.tsx: Agent creation form
 * - useAgentHistory.ts: History loading hook
 * - useAgentInput.ts: Input management hook
 * - viewFilters.ts: View mode filtering utilities
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useStore, store } from '../../store';
import type { Agent } from '../../../shared/types';
import { FileExplorerPanel } from '../FileExplorerPanel';
import { matchesShortcut } from '../../store/shortcuts';
import { STORAGE_KEYS, getStorageString, setStorageString } from '../../utils/storage';
import { useAgentHistory } from './useAgentHistory';
import { AgentPanel } from './AgentPanel';
import { SpawnForm } from './SpawnForm';
import type { TabId, TabConfig } from './types';
import { AGENTS_PER_PAGE, GRID_COLS } from './types';

interface CommanderViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommanderView({ isOpen, onClose }: CommanderViewProps) {
  const state = useStore();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    return getStorageString(STORAGE_KEYS.COMMANDER_TAB, 'all');
  });
  const [page, setPage] = useState(0);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [fileExplorerAreaId, setFileExplorerAreaId] = useState<string | null>(null);
  const [advancedView, setAdvancedView] = useState(false);
  const [, forceUpdate] = useState(0);
  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const visibleAgentsRef = useRef<Agent[]>([]);

  // Use the custom hook for history management
  const { histories, loadMoreHistory } = useAgentHistory({
    isOpen,
    agents: state.agents,
  });

  // Subscribe to store changes when opened (areas are loaded from server via WebSocket)
  useEffect(() => {
    if (!isOpen) return;
    return store.subscribe(() => {
      forceUpdate(n => n + 1);
    });
  }, [isOpen]);

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
    const areasArray = Array.from(state.areas.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const tabList: TabConfig[] = [{ id: 'all', name: 'All' }];
    for (const area of areasArray) {
      tabList.push({ id: area.id, name: area.name, color: area.color });
    }
    tabList.push({ id: 'unassigned', name: 'Unassigned' });
    return tabList;
  }, [state.areas]);

  // Get current area for spawn
  const currentArea = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'unassigned') return null;
    return state.areas.get(activeTab) || null;
  }, [activeTab, state.areas]);

  // Sort and filter agents by active tab
  // Bosses always appear first, then sorted by creation time
  const filteredAgents = useMemo(() => {
    const isBoss = (agent: Agent) => agent.isBoss === true || agent.class === 'boss';
    const agents = Array.from(state.agents.values()).sort((a, b) => {
      // Bosses first
      if (isBoss(a) && !isBoss(b)) return -1;
      if (!isBoss(a) && isBoss(b)) return 1;
      // Then by creation time
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    if (activeTab === 'all') return agents;
    if (activeTab === 'unassigned') {
      return agents.filter(agent => !store.getAreaForAgent(agent.id));
    }
    // Filter by specific area
    return agents.filter(agent => {
      const area = store.getAreaForAgent(agent.id);
      return area?.id === activeTab;
    });
  }, [state.agents, activeTab]);

  const totalPages = Math.ceil(filteredAgents.length / AGENTS_PER_PAGE);
  const visibleAgents = filteredAgents.slice(page * AGENTS_PER_PAGE, (page + 1) * AGENTS_PER_PAGE);

  // Keep ref in sync for focus effect (avoids re-focusing on terminal updates)
  visibleAgentsRef.current = visibleAgents;

  // Reset page and save tab when switching tabs
  useEffect(() => {
    setPage(0);
    setStorageString(STORAGE_KEYS.COMMANDER_TAB, activeTab);
  }, [activeTab]);

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
              tab.id !== 'all' && tab.id !== 'unassigned' ? state.areas.get(tab.id) : null;
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
                    ? state.agents.size
                    : tab.id === 'unassigned'
                      ? Array.from(state.agents.values()).filter(a => !store.getAreaForAgent(a.id))
                          .length
                      : Array.from(state.agents.values()).filter(
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
              const agent = state.agents.get(expandedAgentId);
              if (!agent) return null;
              return (
                <AgentPanel
                  key={agent.id}
                  agent={agent}
                  history={histories.get(agent.id)}
                  outputs={store.getOutputs(agent.id)}
                  isExpanded={true}
                  isFocused={true}
                  advancedView={advancedView}
                  onExpand={() => setExpandedAgentId(null)}
                  inputRef={el => {
                    if (el) inputRefs.current.set(agent.id, el);
                  }}
                  onLoadMore={() => loadMoreHistory(agent.id)}
                />
              );
            })()
          ) : (
            visibleAgents.map((agent, index) => (
              <AgentPanel
                key={agent.id}
                agent={agent}
                history={histories.get(agent.id)}
                outputs={store.getOutputs(agent.id)}
                isExpanded={false}
                isFocused={index === focusedIndex}
                advancedView={advancedView}
                onExpand={() => setExpandedAgentId(agent.id)}
                onFocus={() => setFocusedIndex(index)}
                inputRef={el => {
                  if (el) inputRefs.current.set(agent.id, el);
                }}
                onLoadMore={() => loadMoreHistory(agent.id)}
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
