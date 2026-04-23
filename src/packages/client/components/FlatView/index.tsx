/**
 * FlatView - Flat UI layout with 3-column design
 *
 * Layout:
 * - Left sidebar: Navigation menu (settings, commander, etc.)
 * - Middle column: Agents, buildings, and areas
 * - Right column: Selected agent's chat view
 */

import React, { useState, useMemo, useCallback, useRef, useEffect, useReducer } from 'react';
import {
  useAgentsArray,
  useSelectedAgentIds,
  useAgent,
  useAreas,
} from '../../store/selectors';
import { store } from '../../store';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';
import { getAgentStatusColor } from '../../utils/colors';
import { AgentOverviewPanel } from '../ClaudeOutputPanel/AgentOverviewPanel';
import { AgentTerminalPane, type AgentTerminalPaneHandle } from '../ClaudeOutputPanel/AgentTerminalPane';
import { ContextConfirmModal, ImageModal, BashModal, type BashModalState } from '../ClaudeOutputPanel/TerminalModals';
import { useKeyboardHeight } from '../ClaudeOutputPanel/useKeyboardHeight';
import { ThemeSelector } from '../ClaudeOutputPanel/ThemeSelector';
import { useGitBranches } from '../ClaudeOutputPanel/useGitBranch';
import { SingleAgentPanel } from '../UnitPanel/SingleAgentPanel';
import { TrackingBoard } from '../ClaudeOutputPanel/TrackingBoard';
import type { ViewMode as TerminalViewMode } from '../ClaudeOutputPanel/types';
import { useTwoClickConfirm } from '../../hooks';
import {
  getStorageBoolean,
  setStorageBoolean,
  getStorageString,
  setStorageString,
  STORAGE_KEYS,
} from '../../utils/storage';
import './FlatView.scss';

// ============================================================================
// Types
// ============================================================================

interface FlatViewProps {
  onAgentClick: (agentId: string) => void;
  onAgentDoubleClick?: (agentId: string) => void;
  onBuildingClick: (buildingId: string) => void;
  onBuildingDoubleClick?: (buildingId: string) => void;
  onAreaClick?: (areaId: string) => void;
  // Creation modal callbacks
  onOpenSpawnModal?: () => void;
  onOpenBossSpawnModal?: () => void;
  onOpenBuildingModal?: () => void;
  onOpenAreaModal?: () => void;
}

// ============================================================================
// Rich Chat View — reuses AgentTerminalPane from 3D view
// ============================================================================

interface ChatViewProps {
  agentId: string;
  terminalViewMode: TerminalViewMode;
  onTerminalViewModeChange: (mode: TerminalViewMode) => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onImageClick: (url: string, name: string) => void;
  onFileClick: (path: string, editData?: any) => void;
  onBashClick: (command: string, output: string) => void;
  onViewMarkdown: (content: string) => void;
  onRequestClearSubordinates: (agentId: string, count: number) => void;
  keyboard: ReturnType<typeof useKeyboardHeight>;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
}

const TERMINAL_VIEW_MODES: TerminalViewMode[] = ['simple', 'chat', 'advanced'];
const TERMINAL_VIEW_MODE_LABELS: Record<TerminalViewMode, string> = {
  simple: 'Simple',
  chat: 'Chat',
  advanced: 'Advanced',
};
const TERMINAL_VIEW_MODE_ICONS: Record<TerminalViewMode, string> = {
  simple: '○',
  chat: '◐',
  advanced: '◉',
};
const TERMINAL_VIEW_MODE_DESCRIPTIONS: Record<TerminalViewMode, string> = {
  simple: 'Simple view — clean messages only',
  chat: 'Chat view — assistant replies (no tool calls)',
  advanced: 'Advanced view — everything including tools',
};

const CLEAR_CONFIRM_ID = 'flat-clear-context';

function formatCwdShort(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length === 0) return cwd;
  return parts.slice(-2).join('/');
}

// Geometry helper — mirrors ClaudeOutputPanel/index.tsx so the area-dir chips
// (and the agent→area resolution) behave identically to the Guake statusbar.
function flatIsPositionInArea(
  pos: { x: number; z: number },
  area: { type: string; center: { x: number; z: number }; width?: number; height?: number; radius?: number }
): boolean {
  if (area.type === 'rectangle' && area.width && area.height) {
    const halfW = area.width / 2;
    const halfH = area.height / 2;
    return (
      pos.x >= area.center.x - halfW &&
      pos.x <= area.center.x + halfW &&
      pos.z >= area.center.z - halfH &&
      pos.z <= area.center.z + halfH
    );
  }
  if (area.type === 'circle' && area.radius) {
    const dx = pos.x - area.center.x;
    const dz = pos.z - area.center.z;
    return dx * dx + dz * dz <= area.radius * area.radius;
  }
  return false;
}

const ChatView = React.memo(function ChatView({
  agentId,
  terminalViewMode,
  onTerminalViewModeChange,
  inspectorOpen,
  onToggleInspector,
  onImageClick,
  onFileClick,
  onBashClick,
  onViewMarkdown,
  onRequestClearSubordinates,
  keyboard,
  canNavigateBack,
  canNavigateForward,
  onNavigateBack,
  onNavigateForward,
}: ChatViewProps) {
  const agent = useAgent(agentId);
  const paneRef = useRef<AgentTerminalPaneHandle>(null);

  // ── Statusbar: area folder lookup (mirrors the Guake statusbar deriv) ────
  const areas = useAreas();
  const agentAreaDirectories = useMemo(() => {
    if (!agent) return null;
    const matchedIds = new Set<string>();
    const matched: { id: string; name: string; directories: string[] }[] = [];
    for (const area of areas.values()) {
      if (area.archived || area.directories.length === 0) continue;
      if (area.assignedAgentIds.includes(agentId)) {
        matchedIds.add(area.id);
        matched.push(area);
      }
    }
    // Fallback: include areas containing the agent's position — keeps the
    // folder badges visible when assignment state is stale.
    for (const area of areas.values()) {
      if (area.archived || area.directories.length === 0 || matchedIds.has(area.id)) continue;
      if (flatIsPositionInArea({ x: agent.position.x, z: agent.position.z }, area)) {
        matchedIds.add(area.id);
        matched.push(area);
      }
    }
    if (matched.length === 0) return null;
    return matched.flatMap((a) =>
      a.directories
        .filter((d) => d && d.trim().length > 0)
        .map((d) => ({ areaId: a.id, areaName: a.name, dir: d }))
    );
  }, [agent, agentId, areas]);
  const { branches: areaBranches, fetchRemote: fetchGitRemote, fetchingDirs: gitFetchingDirs } =
    useGitBranches(agentAreaDirectories);

  // Search-mode mirror: paneRef owns the search state, but header buttons
  // need to re-render to reflect the active style when toggled. A counter
  // forces a re-render after we call toggleSearch().
  const [, bumpTick] = useReducer((x: number) => x + 1, 0);
  const searchMode = paneRef.current?.search.searchMode ?? false;
  const handleSearchToggle = useCallback(() => {
    paneRef.current?.search.toggleSearch();
    bumpTick();
  }, []);

  // Clear-context confirmation (two-click arm/confirm, shared hook so the
  // behavior matches the tracking board and the 3D header).
  const clearConfirm = useTwoClickConfirm();
  const isClearArmed = clearConfirm.isPending(CLEAR_CONFIRM_ID);

  // More-actions menu (kebab) for collapse/remove/clear-subs
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  if (!agent) {
    return (
      <div className="exp-chat exp-chat--empty">
        <div className="exp-chat__placeholder">
          <span className="exp-chat__placeholder-icon">💬</span>
          <span className="exp-chat__placeholder-text">Select an agent to start chatting</span>
        </div>
      </div>
    );
  }

  // Context / token usage calculations (mirrors the 3D overlay footer widget)
  const contextStats = agent.contextStats;
  const contextHasData = !!contextStats;
  const contextTotalTokens = contextStats
    ? contextStats.totalTokens
    : agent.contextUsed || 0;
  const contextWindow = contextStats
    ? contextStats.contextWindow
    : agent.contextLimit || 200000;
  const contextUsedPercentRaw = contextStats
    ? contextStats.usedPercent
    : Math.round((contextTotalTokens / contextWindow) * 100);
  const contextUsedPercent = Math.max(0, Math.min(100, contextUsedPercentRaw));
  const contextFreePercent = Math.max(0, 100 - contextUsedPercent);
  const contextColor =
    contextUsedPercent >= 80
      ? '#ff4a4a'
      : contextUsedPercent >= 60
        ? '#ff9e4a'
        : contextUsedPercent >= 40
          ? '#ffd700'
          : '#4aff9e';
  const contextUsedK = (contextTotalTokens / 1000).toFixed(1);
  const contextLimitK = (contextWindow / 1000).toFixed(1);

  const cwd = agent.cwd;
  const cwdShort = cwd ? formatCwdShort(cwd) : null;
  const subordinateCount = agent.subordinateIds?.length || 0;
  const hasSubordinates = subordinateCount > 0;

  return (
    <div className="exp-terminal-wrapper">
      <div className="exp-terminal-wrapper__header">
        <div className="exp-terminal-wrapper__header-main">
          <AgentIcon agent={agent} size={28} />
          <div className="exp-terminal-wrapper__header-info">
            <span className="exp-terminal-wrapper__header-name">{agent.name}</span>
            <span
              className="exp-terminal-wrapper__header-status"
              style={{ color: getAgentStatusColor(agent.status) }}
            >
              {agent.status}
            </span>
          </div>
          {agent.taskLabel && (
            <span className="exp-terminal-wrapper__header-task" title={agent.taskLabel}>
              📋 {agent.taskLabel}
            </span>
          )}
        </div>
        <div className="exp-terminal-wrapper__header-meta">
          <div
            className="exp-terminal-wrapper__view-mode"
            role="group"
            aria-label="Message view mode"
          >
            {TERMINAL_VIEW_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`exp-terminal-wrapper__view-mode-btn ${
                  terminalViewMode === mode ? 'exp-terminal-wrapper__view-mode-btn--active' : ''
                }`}
                onClick={() => onTerminalViewModeChange(mode)}
                title={TERMINAL_VIEW_MODE_DESCRIPTIONS[mode]}
                aria-pressed={terminalViewMode === mode}
              >
                <span className="exp-terminal-wrapper__view-mode-icon" aria-hidden="true">
                  {TERMINAL_VIEW_MODE_ICONS[mode]}
                </span>
                <span className="exp-terminal-wrapper__view-mode-label">
                  {TERMINAL_VIEW_MODE_LABELS[mode]}
                </span>
              </button>
            ))}
          </div>
          {/* Applicable guake-actions — back/forward, search, clear-context, more-menu */}
          <div className="exp-terminal-wrapper__actions" role="group" aria-label="Terminal actions">
            <button
              type="button"
              className="exp-terminal-wrapper__action-btn"
              onClick={onNavigateBack}
              disabled={!canNavigateBack}
              title="Back to previous agent"
              aria-label="Back to previous agent"
            >
              <Icon name="arrow-left" size={14} />
            </button>
            <button
              type="button"
              className="exp-terminal-wrapper__action-btn"
              onClick={onNavigateForward}
              disabled={!canNavigateForward}
              title="Forward to next agent"
              aria-label="Forward to next agent"
            >
              <Icon name="arrow-right" size={14} />
            </button>
            <button
              type="button"
              className={`exp-terminal-wrapper__action-btn ${searchMode ? 'exp-terminal-wrapper__action-btn--active' : ''}`}
              onClick={handleSearchToggle}
              title={searchMode ? 'Close search' : 'Search messages'}
              aria-pressed={searchMode}
            >
              <Icon name={searchMode ? 'cross' : 'search'} size={14} />
            </button>
            <button
              type="button"
              className={`exp-terminal-wrapper__action-btn exp-terminal-wrapper__action-btn--danger ${isClearArmed ? 'exp-terminal-wrapper__action-btn--confirm' : ''}`}
              onClick={() =>
                clearConfirm.handleClick(CLEAR_CONFIRM_ID, () => {
                  store.clearContext(agentId);
                  paneRef.current?.historyLoader.clearHistory();
                })
              }
              title={isClearArmed ? 'Click again to confirm clear context' : 'Clear context'}
            >
              <Icon name={isClearArmed ? 'question' : 'clear'} size={14} />
            </button>
            <div className="exp-terminal-wrapper__more" ref={menuRef}>
              <button
                type="button"
                className={`exp-terminal-wrapper__action-btn ${menuOpen ? 'exp-terminal-wrapper__action-btn--active' : ''}`}
                onClick={() => setMenuOpen((o) => !o)}
                title="More actions"
                aria-expanded={menuOpen}
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="exp-terminal-wrapper__more-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="exp-terminal-wrapper__more-item"
                    onClick={() => {
                      store.collapseContext(agentId);
                      setMenuOpen(false);
                    }}
                    disabled={agent.status !== 'idle'}
                    title={agent.status !== 'idle' ? 'Agent must be idle to collapse context' : 'Collapse context'}
                  >
                    <Icon name="package" size={14} />
                    <span>Collapse context</span>
                  </button>
                  {hasSubordinates && (
                    <button
                      type="button"
                      role="menuitem"
                      className="exp-terminal-wrapper__more-item exp-terminal-wrapper__more-item--danger"
                      onClick={() => {
                        // Route through the shared ContextConfirmModal so the
                        // destructive action has the same confirm-step UX as
                        // the 3D view (and so users get visible feedback).
                        onRequestClearSubordinates(agentId, subordinateCount);
                        setMenuOpen(false);
                      }}
                    >
                      <Icon name="crown" size={14} />
                      <span>
                        Clear {subordinateCount} subordinate{subordinateCount === 1 ? '' : 's'}
                      </span>
                    </button>
                  )}
                  <div className="exp-terminal-wrapper__more-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="exp-terminal-wrapper__more-item exp-terminal-wrapper__more-item--danger"
                    onClick={() => {
                      store.killAgent(agentId);
                      setMenuOpen(false);
                    }}
                  >
                    <Icon name="cross" size={14} />
                    <span>Remove agent</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            className={`exp-terminal-wrapper__inspector-toggle ${
              inspectorOpen ? 'exp-terminal-wrapper__inspector-toggle--active' : ''
            }`}
            onClick={onToggleInspector}
            title={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            aria-label={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            aria-pressed={inspectorOpen}
          >
            <span className="exp-terminal-wrapper__inspector-icon" aria-hidden="true">
              {/* Sidebar-right icon */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                <line x1="10" y1="2.5" x2="10" y2="13.5" />
              </svg>
            </span>
            <span className="exp-terminal-wrapper__inspector-label">Inspector</span>
          </button>
        </div>
      </div>
      <AgentTerminalPane
        ref={paneRef}
        agentId={agentId}
        agent={agent}
        viewMode={terminalViewMode}
        isOpen={true}
        onImageClick={onImageClick}
        onFileClick={onFileClick}
        onBashClick={onBashClick}
        onViewMarkdown={onViewMarkdown}
        keyboard={keyboard}
        hasModalOpen={false}
      />
      <div className="exp-terminal-wrapper__statusbar" role="contentinfo">
        {agent.isDetached && (
          <span
            className="exp-terminal-wrapper__detached"
            title="Reattaching session..."
          >
            <Icon name="refresh" size={12} />
            <span>Reattaching</span>
          </span>
        )}
        {cwd && cwdShort && (
          <span
            className="exp-terminal-wrapper__cwd"
            title={cwd}
            onClick={() => store.setFileViewerPath(cwd)}
          >
            <span className="exp-terminal-wrapper__cwd-icon">
              <Icon name="folder" size={12} />
            </span>
            <span className="exp-terminal-wrapper__cwd-text">{cwdShort}</span>
          </span>
        )}
        {agentAreaDirectories && agentAreaDirectories.map(({ areaId, areaName, dir }) => {
          const branchInfo = areaBranches.get(dir);
          const isFetching = gitFetchingDirs.has(dir);
          const dirLabel = dir.split('/').filter(Boolean).pop() || dir;
          return (
            <span
              key={`${areaId}:${dir}`}
              className="exp-terminal-wrapper__area-dir"
              title={`${areaName}: ${dir}${branchInfo ? ` (${branchInfo.branch}${branchInfo.ahead ? ` ↑${branchInfo.ahead}` : ''}${branchInfo.behind ? ` ↓${branchInfo.behind}` : ''})` : ''}`}
              onClick={() => store.openFileExplorerForAreaFolder(areaId, dir)}
            >
              <Icon name="folder-open" size={12} />
              <span className="exp-terminal-wrapper__area-dir-name">{dirLabel}</span>
              {branchInfo && (
                <>
                  <span className="exp-terminal-wrapper__area-dir-branch">
                    <Icon name="git-branch" size={10} /> {branchInfo.branch}
                  </span>
                  {branchInfo.ahead > 0 && (
                    <span className="exp-terminal-wrapper__branch-ahead" title={`${branchInfo.ahead} ahead`}>
                      <Icon name="arrow-up" size={9} />{branchInfo.ahead}
                    </span>
                  )}
                  {branchInfo.behind > 0 && (
                    <span className="exp-terminal-wrapper__branch-behind" title={`${branchInfo.behind} behind`}>
                      <Icon name="arrow-down" size={9} />{branchInfo.behind}
                    </span>
                  )}
                  <span
                    className={`exp-terminal-wrapper__area-fetch ${isFetching ? 'exp-terminal-wrapper__area-fetch--fetching' : ''}`}
                    title="Git fetch"
                    onClick={(e) => { e.stopPropagation(); fetchGitRemote(dir); }}
                  >
                    <Icon name={isFetching ? 'hourglass' : 'download'} size={12} />
                  </span>
                </>
              )}
            </span>
          );
        })}
        <span
          className="exp-terminal-wrapper__context"
          onClick={() => store.setContextModalAgentId(agentId)}
          title={
            contextHasData
              ? `Context usage: ${contextUsedK}k / ${contextLimitK}k tokens (${contextUsedPercent}% used). Click to view stats.`
              : 'Click to fetch context stats'
          }
        >
          <span className="exp-terminal-wrapper__context-icon">
            <Icon name="dashboard" size={12} />
          </span>
          <span className="exp-terminal-wrapper__context-label">Ctx:</span>
          <span className="exp-terminal-wrapper__context-bar">
            <span
              className="exp-terminal-wrapper__context-bar-fill"
              style={{ width: `${contextUsedPercent}%`, backgroundColor: contextColor }}
            />
          </span>
          <span
            className="exp-terminal-wrapper__context-tokens"
            style={{ color: contextColor }}
          >
            {contextUsedK}k/{contextLimitK}k
          </span>
          <span className="exp-terminal-wrapper__context-free">({contextFreePercent}% free)</span>
          {!contextHasData && (
            <span className="exp-terminal-wrapper__context-warning" title="No context stats yet">
              <Icon name="warn" size={12} />
            </span>
          )}
        </span>
        <div className="exp-terminal-wrapper__statusbar-spacer" aria-hidden="true" />
        <div className="exp-terminal-wrapper__theme">
          <ThemeSelector />
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export function FlatView({
  onAgentClick,
  onAgentDoubleClick,
  onBuildingClick,
  onBuildingDoubleClick,
  onAreaClick,
  onOpenSpawnModal,
  onOpenBossSpawnModal,
  onOpenBuildingModal,
  onOpenAreaModal,
}: FlatViewProps) {
  const agents = useAgentsArray();
  const selectedAgentIds = useSelectedAgentIds();

  // Modal state for terminal integration (owned by parent, shown over everything)
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  const [bashModal, setBashModal] = useState<BashModalState | null>(null);
  // Clear-subordinates confirmation modal — reuses the same modal component
  // the 3D overlay uses, so the two views share one source of truth for the
  // destructive action's UX.
  const [clearSubsModal, setClearSubsModal] = useState<{ agentId: string; count: number } | null>(null);

  // Terminal view-mode (simple/chat/advanced). Shared with the 3D overlay via
  // STORAGE_KEYS.VIEW_MODE so users don't have to re-configure their preference.
  const [terminalViewMode, setTerminalViewModeState] = useState<TerminalViewMode>(() => {
    const saved = getStorageString(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'simple' || saved === 'chat' || saved === 'advanced') {
      return saved;
    }
    return 'simple';
  });

  // Persist changes and keep in sync if another surface (3D overlay) updates it.
  const handleTerminalViewModeChange = useCallback((mode: TerminalViewMode) => {
    setTerminalViewModeState(mode);
    setStorageString(STORAGE_KEYS.VIEW_MODE, mode);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEYS.VIEW_MODE) return;
      const value = event.newValue;
      if (value === 'simple' || value === 'chat' || value === 'advanced') {
        setTerminalViewModeState(value);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Inspector side-panel state (pushes the chat column rather than overlaying)
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() =>
    getStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, false)
  );

  // Inspector tab — matches the traditional sidebar's Agents/Tracking toggle.
  const [inspectorView, setInspectorViewState] = useState<'agent' | 'tracking'>(() => {
    const saved = getStorageString(STORAGE_KEYS.FLAT_INSPECTOR_VIEW);
    return saved === 'tracking' ? 'tracking' : 'agent';
  });

  const setInspectorView = useCallback((view: 'agent' | 'tracking') => {
    setInspectorViewState(view);
    setStorageString(STORAGE_KEYS.FLAT_INSPECTOR_VIEW, view);
  }, []);

  const handleToggleInspector = useCallback(() => {
    setInspectorOpen((prev) => {
      const next = !prev;
      setStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, next);
      return next;
    });
  }, []);

  const handleCloseInspector = useCallback(() => {
    setInspectorOpen(false);
    setStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, false);
  }, []);

  // Shared keyboard-height hook for mobile (must be stable across rerenders)
  const keyboard = useKeyboardHeight();

  // Modal callbacks for the terminal pane
  const handleImageClick = useCallback((url: string, name: string) => {
    setImageModal({ url, name });
  }, []);

  const handleBashClick = useCallback((command: string, output: string) => {
    setBashModal({ command, output, isLive: false });
  }, []);

  const handleFileClick = useCallback((path: string, editData?: any) => {
    // Reuse the global file-viewer flow from the store
    store.setFileViewerPath(path, editData);
  }, []);

  const handleViewMarkdown = useCallback((_content: string) => {
    // No markdown modal wired in this view yet; no-op keeps the pane happy.
  }, []);

  const handleRequestClearSubordinates = useCallback((agentId: string, count: number) => {
    setClearSubsModal({ agentId, count });
  }, []);

  // Get first selected agent for chat view
  const selectedAgentId = useMemo(() => {
    return selectedAgentIds.size > 0 ? Array.from(selectedAgentIds)[0] : null;
  }, [selectedAgentIds]);

  // Agent history navigation — mirrors GuakeOutputPanel agent history so Flat
  // view users get the same browser-style back/forward through selected agents.
  const agentNavigationHistoryRef = useRef<string[]>([]);
  const agentNavigationIndexRef = useRef(-1);
  const isHistoryNavigationRef = useRef(false);
  const [canNavigateBack, setCanNavigateBack] = useState(false);
  const [canNavigateForward, setCanNavigateForward] = useState(false);

  const agentIdSet = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);

  const updateAgentNavigationAvailability = useCallback(() => {
    const history = agentNavigationHistoryRef.current;
    const index = agentNavigationIndexRef.current;
    setCanNavigateBack(index > 0);
    setCanNavigateForward(index >= 0 && index < history.length - 1);
  }, []);

  const navigateAgentHistory = useCallback(
    (direction: -1 | 1) => {
      const history = agentNavigationHistoryRef.current;
      if (history.length === 0) return;

      let nextIndex = agentNavigationIndexRef.current + direction;
      while (nextIndex >= 0 && nextIndex < history.length) {
        const targetAgentId = history[nextIndex];
        if (agentIdSet.has(targetAgentId)) {
          isHistoryNavigationRef.current = true;
          agentNavigationIndexRef.current = nextIndex;
          updateAgentNavigationAvailability();
          store.selectAgent(targetAgentId);
          return;
        }
        nextIndex += direction;
      }
    },
    [agentIdSet, updateAgentNavigationAvailability]
  );

  const handleNavigateBack = useCallback(() => navigateAgentHistory(-1), [navigateAgentHistory]);
  const handleNavigateForward = useCallback(() => navigateAgentHistory(1), [navigateAgentHistory]);

  useEffect(() => {
    if (!selectedAgentId) {
      agentNavigationHistoryRef.current = [];
      agentNavigationIndexRef.current = -1;
      updateAgentNavigationAvailability();
      return;
    }

    if (isHistoryNavigationRef.current) {
      isHistoryNavigationRef.current = false;
      updateAgentNavigationAvailability();
      return;
    }

    const history = agentNavigationHistoryRef.current;
    const currentIndex = agentNavigationIndexRef.current;
    if (currentIndex >= 0 && history[currentIndex] === selectedAgentId) {
      updateAgentNavigationAvailability();
      return;
    }

    const trimmedHistory =
      currentIndex < history.length - 1
        ? history.slice(0, currentIndex + 1)
        : history.slice();

    trimmedHistory.push(selectedAgentId);
    const MAX_AGENT_HISTORY = 100;
    if (trimmedHistory.length > MAX_AGENT_HISTORY) {
      trimmedHistory.shift();
    }

    agentNavigationHistoryRef.current = trimmedHistory;
    agentNavigationIndexRef.current = trimmedHistory.length - 1;
    updateAgentNavigationAvailability();
  }, [selectedAgentId, updateAgentNavigationAvailability]);

  const handleAgentClick = useCallback(
    (agentId: string) => {
      onAgentClick(agentId);
    },
    [onAgentClick]
  );

  // Empty-string sentinel keeps the Guake AgentOverviewPanel happy when nothing
  // is selected — it just means no card is highlighted.
  const overviewActiveAgentId = selectedAgentId ?? '';
  const noopOverviewClose = useCallback(() => {
    // The overview panel IS the middle column in the Flat UI; the panel can't
    // be dismissed from inside (no in-view nav), so the close hook is a no-op.
  }, []);
  const handleOverviewSelectAgent = useCallback(
    (agentId: string) => {
      handleAgentClick(agentId);
    },
    [handleAgentClick]
  );

  const showInspector = inspectorOpen && !!selectedAgentId;

  return (
    <div
      className={`flat-view ${showInspector ? 'flat-view--with-inspector' : ''}`}
    >
      {/* Middle Column - Agents overview. The former in-view SidebarMenu was
          removed because the floating left-side FAB menu (settings/spotlight/
          spawn buttons) already covers navigation. */}
      <div className="exp-middle">
        <div className="exp-middle__header">
          <h2 className="exp-middle__title">👥 Agents</h2>
          <div className="exp-middle__actions">
            <button
              className="exp-cta-btn exp-cta-btn--agent"
              onClick={onOpenSpawnModal}
              title="Create new agent"
            >
              + Agent
            </button>
            <button
              className="exp-cta-btn exp-cta-btn--boss"
              onClick={onOpenBossSpawnModal}
              title="Create new boss agent"
            >
              + Boss
            </button>
            <button
              className="exp-cta-btn exp-cta-btn--area"
              onClick={onOpenAreaModal}
              title="Create new area"
            >
              + Area
            </button>
          </div>
        </div>
        <div className="exp-middle__content">
          <AgentOverviewPanel
            activeAgentId={overviewActiveAgentId}
            onClose={noopOverviewClose}
            onSelectAgent={handleOverviewSelectAgent}
          />
        </div>
      </div>

      {/* Right Column - Chat/Details */}
      <div className="exp-right">
        {selectedAgentId ? (
          <ChatView
            agentId={selectedAgentId}
            terminalViewMode={terminalViewMode}
            onTerminalViewModeChange={handleTerminalViewModeChange}
            inspectorOpen={inspectorOpen}
            onToggleInspector={handleToggleInspector}
            onImageClick={handleImageClick}
            onFileClick={handleFileClick}
            onBashClick={handleBashClick}
            onViewMarkdown={handleViewMarkdown}
            onRequestClearSubordinates={handleRequestClearSubordinates}
            keyboard={keyboard}
            canNavigateBack={canNavigateBack}
            canNavigateForward={canNavigateForward}
            onNavigateBack={handleNavigateBack}
            onNavigateForward={handleNavigateForward}
          />
        ) : (
          <div className="exp-chat exp-chat--empty">
            <div className="exp-chat__placeholder">
              <span className="exp-chat__placeholder-icon">💬</span>
              <span className="exp-chat__placeholder-text">Select an agent to start chatting</span>
            </div>
          </div>
        )}
      </div>

      {/* Inspector Column - Pushes chat column rather than overlaying */}
      {showInspector && selectedAgentId && (
        <aside className="exp-inspector" aria-label="Inspector panel">
          <div className="exp-inspector__header">
            <div className="exp-inspector__tabs" role="tablist" aria-label="Inspector view">
              <button
                type="button"
                role="tab"
                aria-selected={inspectorView === 'agent'}
                className={`exp-inspector__tab ${inspectorView === 'agent' ? 'exp-inspector__tab--active' : ''}`}
                onClick={() => setInspectorView('agent')}
              >
                Agent
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorView === 'tracking'}
                className={`exp-inspector__tab ${inspectorView === 'tracking' ? 'exp-inspector__tab--active' : ''}`}
                onClick={() => setInspectorView('tracking')}
              >
                Tracking
              </button>
            </div>
            <button
              type="button"
              className="exp-inspector__close"
              onClick={handleCloseInspector}
              title="Close inspector"
              aria-label="Close inspector"
            >
              ✕
            </button>
          </div>
          <div className="exp-inspector__body">
            {inspectorView === 'tracking' ? (
              <TrackingBoard
                activeAgentId={selectedAgentId ?? ''}
                onSelectAgent={(agentId) => onAgentClick(agentId)}
              />
            ) : (() => {
              const selectedAgent = agents.find((a) => a.id === selectedAgentId);
              if (!selectedAgent) {
                return (
                  <div className="exp-inspector__empty">
                    <span>Agent not found</span>
                  </div>
                );
              }
              return (
                <SingleAgentPanel
                  agent={selectedAgent}
                  onFocusAgent={(agentId) => onAgentClick(agentId)}
                  onKillAgent={(agentId) => store.killAgent(agentId)}
                />
              );
            })()}
          </div>
        </aside>
      )}

      {/* Terminal modals — portal-based, so position here is fine */}
      {imageModal && (
        <ImageModal
          url={imageModal.url}
          name={imageModal.name}
          onClose={() => setImageModal(null)}
        />
      )}
      {bashModal && (
        <BashModal
          state={bashModal}
          onClose={() => setBashModal(null)}
        />
      )}
      {clearSubsModal && (
        <ContextConfirmModal
          action="clear-subordinates"
          selectedAgentId={clearSubsModal.agentId}
          subordinateCount={clearSubsModal.count}
          onClose={() => setClearSubsModal(null)}
          onClearHistory={() => {
            // No local history is loaded for subordinates in this view — the
            // store action invalidates their cached outputs and clears them
            // server-side, so there is nothing extra to reset here.
          }}
        />
      )}
    </div>
  );
}
