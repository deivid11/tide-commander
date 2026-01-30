/**
 * TerminalHeader - Header component for the terminal panel
 *
 * Displays agent info, status, actions buttons, and view mode toggle.
 */

import React from 'react';
import { store, useSupervisor, useSettings, useLastPrompts } from '../../store';
import { filterCostText } from '../../utils/formatting';
import { STORAGE_KEYS, setStorageString } from '../../utils/storage';
import { agentDebugger } from '../../services/agentDebugger';
import { Tooltip } from '../shared/Tooltip';
import type { Agent, AgentAnalysis } from '../../../shared/types';
import type { ViewMode } from './types';
import { VIEW_MODES } from './types';

export interface TerminalHeaderProps {
  selectedAgent: Agent;
  selectedAgentId: string;
  sortedAgents: Agent[];
  swipeOffset: number;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  searchMode: boolean;
  toggleSearch: () => void;
  closeSearch: () => void;
  debugPanelOpen: boolean;
  setDebugPanelOpen: (open: boolean) => void;
  debuggerEnabled: boolean;
  setDebuggerEnabled: (enabled: boolean) => void;
  outputsLength: number;
  setContextConfirm: (action: 'collapse' | 'clear' | 'clear-subordinates' | null) => void;
  headerRef: React.RefObject<HTMLDivElement | null>;
}

export function TerminalHeader({
  selectedAgent,
  selectedAgentId,
  sortedAgents,
  swipeOffset,
  viewMode,
  setViewMode,
  searchMode,
  toggleSearch,
  closeSearch,
  debugPanelOpen,
  setDebugPanelOpen,
  debuggerEnabled,
  setDebuggerEnabled,
  outputsLength,
  setContextConfirm,
  headerRef,
}: TerminalHeaderProps) {
  const supervisor = useSupervisor();
  const settings = useSettings();
  const lastPrompts = useLastPrompts();

  const handleViewModeToggle = () => {
    const currentIndex = VIEW_MODES.indexOf(viewMode);
    const nextMode = VIEW_MODES[(currentIndex + 1) % VIEW_MODES.length];
    setViewMode(nextMode);
    setStorageString(STORAGE_KEYS.VIEW_MODE, nextMode);
  };

  const handleDebugToggle = () => {
    const newOpen = !debugPanelOpen;
    setDebugPanelOpen(newOpen);
    if (newOpen && !debuggerEnabled) {
      setDebuggerEnabled(true);
      agentDebugger.setEnabled(true);
    }
  };

  const handleSearchToggle = () => {
    if (searchMode) {
      closeSearch();
    } else {
      toggleSearch();
    }
  };

  // Get status info
  const lastInput =
    selectedAgent.currentTask ||
    selectedAgent.lastAssignedTask ||
    lastPrompts.get(selectedAgentId)?.text;

  const agentAnalysis = supervisor.lastReport?.agentSummaries.find(
    (a: AgentAnalysis) => a.agentId === selectedAgent.id || a.agentName === selectedAgent.name
  );

  const progressColors: Record<string, string> = {
    on_track: '#4aff9e',
    stalled: '#ff9e4a',
    blocked: '#ff4a4a',
    completed: '#4a9eff',
    idle: '#888',
  };

  const filteredStatus = agentAnalysis?.statusDescription
    ? filterCostText(agentAnalysis.statusDescription, settings.hideCost)
    : null;

  // Check if selected agent is a boss with subordinates
  const isBoss = selectedAgent.class === 'boss' || selectedAgent.isBoss;
  const hasSubordinates = isBoss && selectedAgent.subordinateIds && selectedAgent.subordinateIds.length > 0;

  return (
    <div
      className={`guake-header ${sortedAgents.length > 1 ? 'has-multiple-agents' : ''} ${swipeOffset > 0.1 ? 'swiping-right' : ''} ${swipeOffset < -0.1 ? 'swiping-left' : ''}`}
      ref={headerRef}
    >
      <div className="guake-header-left">
        {selectedAgent.status === 'working' && (
          <span className={`guake-working-indicator ${selectedAgent.isDetached ? 'detached' : ''}`}>
            <span className="guake-working-dot"></span>
            <span className="guake-working-dot"></span>
            <span className="guake-working-dot"></span>
          </span>
        )}
        {selectedAgent.isDetached && (
          <Tooltip
            content={
              <>
                <div className="tide-tooltip__title">Detached Mode</div>
                <div className="tide-tooltip__text">
                  This agent's Claude process is running independently. This happens when Tide Commander
                  restarts while an agent is working. Output is being recovered from the session file.
                  Send a new message to fully reattach.
                </div>
              </>
            }
            position="bottom"
            className="tide-tooltip--detached"
          >
            <span className="guake-detached-badge">📡</span>
          </Tooltip>
        )}
        <span className="guake-title">{selectedAgent.name}</span>
        {(lastInput || agentAnalysis) && (
          <span
            className="guake-status-line"
            title={`${lastInput || 'No task'}${agentAnalysis ? `\n\n🎖️ ${agentAnalysis.statusDescription}\n${agentAnalysis.recentWorkSummary}` : ''}`}
          >
            {agentAnalysis && (
              <span
                className="guake-supervisor-badge"
                style={{ color: progressColors[agentAnalysis.progress] || '#888' }}
              >
                🎖️ {agentAnalysis.progress.replace('_', ' ')}
              </span>
            )}
            {filteredStatus && <span className="guake-supervisor-summary">{filteredStatus}</span>}
            {!filteredStatus && lastInput && <span className="guake-last-input">{lastInput}</span>}
          </span>
        )}
      </div>
      <div className="guake-actions">
        <button
          className={`guake-debug-toggle hide-on-mobile ${debugPanelOpen ? 'active' : ''}`}
          onClick={handleDebugToggle}
          title={debugPanelOpen ? 'Hide Debug Panel' : 'Show Debug Panel'}
        >
          🐛
        </button>
        <button
          className={`guake-search-toggle hide-on-mobile ${searchMode ? 'active' : ''}`}
          onClick={handleSearchToggle}
          title="Search (Ctrl+F)"
        >
          🔍
        </button>
        <button
          className={`guake-view-toggle hide-on-mobile ${viewMode !== 'simple' ? 'active' : ''} view-mode-${viewMode}`}
          onClick={handleViewModeToggle}
          title={
            viewMode === 'simple'
              ? 'Simple: Shows tools and responses'
              : viewMode === 'chat'
                ? 'Chat: Shows only user messages and final responses'
                : 'Advanced: Shows all details including tool inputs/outputs'
          }
        >
          {viewMode === 'simple' ? '○ Simple' : viewMode === 'chat' ? '◐ Chat' : '◉ Advanced'}
        </button>
        {/* Mobile view mode toggle - compact icon button */}
        <button
          className={`guake-mode-btn show-on-mobile view-mode-${viewMode}`}
          onClick={handleViewModeToggle}
          title={`View: ${viewMode}`}
        >
          {viewMode === 'simple' ? '○' : viewMode === 'chat' ? '◐' : '◉'}
        </button>
        {outputsLength > 0 && (
          <button
            className="guake-clear"
            onClick={() => store.clearOutputs(selectedAgentId)}
            title="Clear output"
          >
            🗑
          </button>
        )}
        <button
          className="guake-context-btn hide-on-mobile"
          onClick={() => setContextConfirm('collapse')}
          title="Collapse context - summarize conversation to save tokens"
          disabled={selectedAgent.status !== 'idle'}
        >
          📦 Collapse
        </button>
        <button
          className="guake-context-btn danger hide-on-mobile"
          onClick={() => setContextConfirm('clear')}
          title="Clear context - start fresh session"
        >
          🗑️ Clear Context
        </button>
        {/* Boss-only: Clear all subordinates' context */}
        {hasSubordinates && (
          <button
            className="guake-context-btn danger hide-on-mobile"
            onClick={() => setContextConfirm('clear-subordinates')}
            title="Clear context for all subordinate agents"
          >
            👑🗑️ Clear All Subordinates
          </button>
        )}
        {/* Mobile close button - switch to 3D view */}
        <button
          className="guake-close-btn show-on-mobile"
          onClick={() => store.setMobileView('3d')}
          title="Close terminal"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// Search bar component
export interface SearchBarProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  handleSearch: () => void;
  closeSearch: () => void;
  searchLoading: boolean;
  searchResultsCount: number;
}

export function SearchBar({
  searchInputRef,
  searchQuery,
  setSearchQuery,
  handleSearch,
  closeSearch,
  searchLoading,
  searchResultsCount,
}: SearchBarProps) {
  return (
    <div className="guake-search">
      <input
        ref={searchInputRef}
        type="text"
        placeholder="Search conversation... (Esc to close)"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSearch();
          if (e.key === 'Escape') closeSearch();
        }}
      />
      <button onClick={handleSearch} disabled={searchLoading}>
        {searchLoading ? '...' : 'Search'}
      </button>
      {searchResultsCount > 0 && <span className="guake-search-count">{searchResultsCount} results</span>}
    </div>
  );
}
