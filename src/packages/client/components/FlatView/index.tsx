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
  useAgents,
  useAgentsArray,
  useSelectedAgentIds,
  useAgent,
  useAreas,
  useBuildings,
} from '../../store/selectors';
import { store } from '../../store';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';
import { getAgentStatusColor } from '../../utils/colors';
import { AgentOverviewPanel } from '../ClaudeOutputPanel/AgentOverviewPanel';
import { AgentTerminalPane, type AgentTerminalPaneHandle } from '../ClaudeOutputPanel/AgentTerminalPane';
import { AreaBuildingsPanel } from '../ClaudeOutputPanel/AreaBuildingsPanel';
import { GuakeGitPanel } from '../ClaudeOutputPanel/GuakeGitPanel';
import { ContextConfirmModal, ImageModal, BashModal, type BashModalState } from '../ClaudeOutputPanel/TerminalModals';
import { useKeyboardHeight } from '../ClaudeOutputPanel/useKeyboardHeight';
import { useBottomTerminalResize } from '../ClaudeOutputPanel/useBottomTerminalResize';
import { ThemeSelector } from '../ClaudeOutputPanel/ThemeSelector';
import { useGitBranches } from '../ClaudeOutputPanel/useGitBranch';
import { SingleAgentPanel } from '../UnitPanel/SingleAgentPanel';
import { TrackingBoard } from '../ClaudeOutputPanel/TrackingBoard';
import type { ViewMode as TerminalViewMode } from '../ClaudeOutputPanel/types';
import TerminalEmbed from '../TerminalEmbed';
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
  onOpenBuilding: (buildingId: string) => void;
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
  onOpenBuilding,
  keyboard,
  canNavigateBack,
  canNavigateForward,
  onNavigateBack,
  onNavigateForward,
}: ChatViewProps) {
  const agent = useAgent(agentId);
  const buildings = useBuildings();
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

  // ── Area-scoped buildings for the statusbar (terminal / PM2 / database) ──
  // Mirrors ClaudeOutputPanel so the chat statusbar surfaces the same shortcut
  // buttons for buildings in the agent's working area.
  const areaTerminalBuildings = useMemo(() => {
    const area = store.getAreaForAgent(agentId);
    if (!area) return [];
    const result: { id: string; name: string; hasUrl: boolean }[] = [];
    for (const building of buildings.values()) {
      if (building.type === 'terminal' && store.isPositionInArea(building.position, area)) {
        result.push({
          id: building.id,
          name: building.name,
          hasUrl: !!building.terminalStatus?.url,
        });
      }
    }
    return result;
  }, [agentId, buildings]);

  const areaPm2Buildings = useMemo(() => {
    const area = store.getAreaForAgent(agentId);
    if (!area) return [];
    const result: { id: string; name: string }[] = [];
    for (const building of buildings.values()) {
      if (building.type === 'server' && building.pm2?.enabled && store.isPositionInArea(building.position, area)) {
        result.push({ id: building.id, name: building.name });
      }
    }
    return result;
  }, [agentId, buildings]);

  const areaDatabaseBuildings = useMemo(() => {
    const area = store.getAreaForAgent(agentId);
    if (!area) return [];
    const result: { id: string; name: string }[] = [];
    for (const building of buildings.values()) {
      if (building.type === 'database' && building.database && store.isPositionInArea(building.position, area)) {
        result.push({ id: building.id, name: building.name });
      }
    }
    return result;
  }, [agentId, buildings]);

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

  // Embedded bottom panel — currently just a single terminal at a time,
  // rendered under the chat pane like the Guake statusbar's bottom panels.
  // Logs/database buttons still fall back to the global modal.
  const [embeddedTerminalBuildingId, setEmbeddedTerminalBuildingId] = useState<string | null>(null);
  const embeddedTerminalBuilding = embeddedTerminalBuildingId
    ? buildings.get(embeddedTerminalBuildingId)
    : null;
  // Shared resizer — same hook the Guake bottom panel uses, so the persisted
  // height is kept in sync across both surfaces.
  const { height: embeddedHeight, onResizeStart: handleEmbeddedResizeStart } = useBottomTerminalResize();

  // Side panels (git / area buildings) — reuse the Guake components, persist
  // open-state to the same STORAGE_KEYS so the toggle survives a view swap.
  const [gitPanelOpen, setGitPanelOpen] = useState<boolean>(() =>
    getStorageBoolean(STORAGE_KEYS.GIT_PANEL_OPEN, false)
  );
  const [buildingsPanelOpen, setBuildingsPanelOpen] = useState<boolean>(() =>
    getStorageBoolean(STORAGE_KEYS.BUILDINGS_PANEL_OPEN, false)
  );
  const toggleGitPanel = useCallback(() => {
    setGitPanelOpen((prev) => {
      const next = !prev;
      setStorageBoolean(STORAGE_KEYS.GIT_PANEL_OPEN, next);
      return next;
    });
  }, []);
  const toggleBuildingsPanel = useCallback(() => {
    setBuildingsPanelOpen((prev) => {
      const next = !prev;
      setStorageBoolean(STORAGE_KEYS.BUILDINGS_PANEL_OPEN, next);
      return next;
    });
  }, []);
  const closeGitPanel = useCallback(() => {
    setGitPanelOpen(false);
    setStorageBoolean(STORAGE_KEYS.GIT_PANEL_OPEN, false);
  }, []);
  const closeBuildingsPanel = useCallback(() => {
    setBuildingsPanelOpen(false);
    setStorageBoolean(STORAGE_KEYS.BUILDINGS_PANEL_OPEN, false);
  }, []);

  // Agents Map needed by GuakeGitPanel's diff viewer lookups.
  const agentsMap = useAgents();

  // Close the embed automatically if the building leaves the current area or
  // disappears, so the panel doesn't stick around as a stale ghost.
  useEffect(() => {
    if (!embeddedTerminalBuildingId) return;
    const stillInArea = areaTerminalBuildings.some((tb) => tb.id === embeddedTerminalBuildingId);
    if (!stillInArea) setEmbeddedTerminalBuildingId(null);
  }, [embeddedTerminalBuildingId, areaTerminalBuildings]);

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
      <div className="flat-chat flat-chat--empty">
        <div className="flat-chat__placeholder">
          <span className="flat-chat__placeholder-icon">💬</span>
          <span className="flat-chat__placeholder-text">Select an agent to start chatting</span>
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
    <div className={`flat-terminal-wrapper ${gitPanelOpen || buildingsPanelOpen ? 'flat-terminal-wrapper--with-side-panel' : ''}`}>
      <div className="flat-terminal-wrapper__header">
        <div className="flat-terminal-wrapper__header-main">
          <AgentIcon agent={agent} size={28} />
          <div className="flat-terminal-wrapper__header-info">
            <span className="flat-terminal-wrapper__header-name">{agent.name}</span>
            <span
              className="flat-terminal-wrapper__header-status"
              style={{ color: getAgentStatusColor(agent.status) }}
            >
              {agent.status}
            </span>
          </div>
          {agent.taskLabel && (
            <span className="flat-terminal-wrapper__header-task" title={agent.taskLabel}>
              📋 {agent.taskLabel}
            </span>
          )}
        </div>
        <div className="flat-terminal-wrapper__header-meta">
          <div
            className="flat-terminal-wrapper__view-mode"
            role="group"
            aria-label="Message view mode"
          >
            {TERMINAL_VIEW_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`flat-terminal-wrapper__view-mode-btn ${
                  terminalViewMode === mode ? 'flat-terminal-wrapper__view-mode-btn--active' : ''
                }`}
                onClick={() => onTerminalViewModeChange(mode)}
                title={TERMINAL_VIEW_MODE_DESCRIPTIONS[mode]}
                aria-pressed={terminalViewMode === mode}
              >
                <span className="flat-terminal-wrapper__view-mode-icon" aria-hidden="true">
                  {TERMINAL_VIEW_MODE_ICONS[mode]}
                </span>
                <span className="flat-terminal-wrapper__view-mode-label">
                  {TERMINAL_VIEW_MODE_LABELS[mode]}
                </span>
              </button>
            ))}
          </div>
          {/* Applicable guake-actions — back/forward, search, clear-context, more-menu */}
          <div className="flat-terminal-wrapper__actions" role="group" aria-label="Terminal actions">
            <button
              type="button"
              className="flat-terminal-wrapper__action-btn"
              onClick={onNavigateBack}
              disabled={!canNavigateBack}
              title="Back to previous agent"
              aria-label="Back to previous agent"
            >
              <Icon name="arrow-left" size={14} />
            </button>
            <button
              type="button"
              className="flat-terminal-wrapper__action-btn"
              onClick={onNavigateForward}
              disabled={!canNavigateForward}
              title="Forward to next agent"
              aria-label="Forward to next agent"
            >
              <Icon name="arrow-right" size={14} />
            </button>
            <button
              type="button"
              className={`flat-terminal-wrapper__action-btn ${searchMode ? 'flat-terminal-wrapper__action-btn--active' : ''}`}
              onClick={handleSearchToggle}
              title={searchMode ? 'Close search' : 'Search messages'}
              aria-pressed={searchMode}
            >
              <Icon name={searchMode ? 'cross' : 'search'} size={14} />
            </button>
            <button
              type="button"
              className={`flat-terminal-wrapper__action-btn flat-terminal-wrapper__action-btn--danger ${isClearArmed ? 'flat-terminal-wrapper__action-btn--confirm' : ''}`}
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
            <button
              type="button"
              className={`flat-terminal-wrapper__action-btn ${gitPanelOpen ? 'flat-terminal-wrapper__action-btn--active' : ''}`}
              onClick={toggleGitPanel}
              title={gitPanelOpen ? 'Hide git panel' : 'Show git changes'}
              aria-pressed={gitPanelOpen}
            >
              <Icon name="git-branch" size={14} />
            </button>
            <button
              type="button"
              className={`flat-terminal-wrapper__action-btn ${buildingsPanelOpen ? 'flat-terminal-wrapper__action-btn--active' : ''}`}
              onClick={toggleBuildingsPanel}
              title={buildingsPanelOpen ? 'Hide buildings panel' : 'Show area buildings'}
              aria-pressed={buildingsPanelOpen}
            >
              <Icon name="buildings" size={14} />
            </button>
            <div className="flat-terminal-wrapper__more" ref={menuRef}>
              <button
                type="button"
                className={`flat-terminal-wrapper__action-btn ${menuOpen ? 'flat-terminal-wrapper__action-btn--active' : ''}`}
                onClick={() => setMenuOpen((o) => !o)}
                title="More actions"
                aria-expanded={menuOpen}
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="flat-terminal-wrapper__more-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="flat-terminal-wrapper__more-item"
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
                      className="flat-terminal-wrapper__more-item flat-terminal-wrapper__more-item--danger"
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
                  <div className="flat-terminal-wrapper__more-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="flat-terminal-wrapper__more-item flat-terminal-wrapper__more-item--danger"
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
            className={`flat-terminal-wrapper__inspector-toggle ${
              inspectorOpen ? 'flat-terminal-wrapper__inspector-toggle--active' : ''
            }`}
            onClick={onToggleInspector}
            title={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            aria-label={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            aria-pressed={inspectorOpen}
          >
            <span className="flat-terminal-wrapper__inspector-icon" aria-hidden="true">
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
            <span className="flat-terminal-wrapper__inspector-label">Inspector</span>
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
      {embeddedTerminalBuilding && (
        <>
          <div
            className="guake-bottom-terminal-resize"
            onMouseDown={handleEmbeddedResizeStart}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize embedded terminal"
          />
          <div
            className="flat-bottom-panel"
            role="region"
            aria-label={`Embedded terminal: ${embeddedTerminalBuilding.name}`}
            style={{ height: embeddedHeight }}
          >
            <div className="flat-bottom-panel__header">
              <span className="flat-bottom-panel__title">
                <Icon name="terminal" size={12} />
                <span>{embeddedTerminalBuilding.name}</span>
                {!embeddedTerminalBuilding.terminalStatus?.url && (
                  <span className="flat-bottom-panel__muted">(starting...)</span>
                )}
              </span>
              <button
                type="button"
                className="flat-bottom-panel__close"
                onClick={() => setEmbeddedTerminalBuildingId(null)}
                title="Close embedded terminal"
                aria-label="Close embedded terminal"
              >
                <Icon name="cross" size={12} />
              </button>
            </div>
            <div className="flat-bottom-panel__body">
              {embeddedTerminalBuilding.terminalStatus?.url ? (
                <TerminalEmbed
                  terminalUrl={embeddedTerminalBuilding.terminalStatus.url}
                  visible={true}
                />
              ) : (
                <div className="flat-bottom-panel__placeholder">Starting terminal...</div>
              )}
            </div>
          </div>
        </>
      )}
      <div className="flat-terminal-wrapper__statusbar" role="contentinfo">
        {agent.isDetached && (
          <span
            className="flat-terminal-wrapper__detached"
            title="Reattaching session..."
          >
            <Icon name="refresh" size={12} />
            <span>Reattaching</span>
          </span>
        )}
        {cwd && cwdShort && (
          <span
            className="flat-terminal-wrapper__cwd"
            title={cwd}
            onClick={() => store.setFileViewerPath(cwd)}
          >
            <span className="flat-terminal-wrapper__cwd-icon">
              <Icon name="folder" size={12} />
            </span>
            <span className="flat-terminal-wrapper__cwd-text">{cwdShort}</span>
          </span>
        )}
        {agentAreaDirectories && agentAreaDirectories.map(({ areaId, areaName, dir }) => {
          const branchInfo = areaBranches.get(dir);
          const isFetching = gitFetchingDirs.has(dir);
          const dirLabel = dir.split('/').filter(Boolean).pop() || dir;
          return (
            <span
              key={`${areaId}:${dir}`}
              className="flat-terminal-wrapper__area-dir"
              title={`${areaName}: ${dir}${branchInfo ? ` (${branchInfo.branch}${branchInfo.ahead ? ` ↑${branchInfo.ahead}` : ''}${branchInfo.behind ? ` ↓${branchInfo.behind}` : ''})` : ''}`}
              onClick={() => store.openFileExplorerForAreaFolder(areaId, dir)}
            >
              <Icon name="folder-open" size={12} />
              <span className="flat-terminal-wrapper__area-dir-name">{dirLabel}</span>
              {branchInfo && (
                <>
                  <span className="flat-terminal-wrapper__area-dir-branch">
                    <Icon name="git-branch" size={10} /> {branchInfo.branch}
                  </span>
                  {branchInfo.ahead > 0 && (
                    <span className="flat-terminal-wrapper__branch-ahead" title={`${branchInfo.ahead} ahead`}>
                      <Icon name="arrow-up" size={9} />{branchInfo.ahead}
                    </span>
                  )}
                  {branchInfo.behind > 0 && (
                    <span className="flat-terminal-wrapper__branch-behind" title={`${branchInfo.behind} behind`}>
                      <Icon name="arrow-down" size={9} />{branchInfo.behind}
                    </span>
                  )}
                  <span
                    className={`flat-terminal-wrapper__area-fetch ${isFetching ? 'flat-terminal-wrapper__area-fetch--fetching' : ''}`}
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
          className="flat-terminal-wrapper__context"
          onClick={() => store.setContextModalAgentId(agentId)}
          title={
            contextHasData
              ? `Context usage: ${contextUsedK}k / ${contextLimitK}k tokens (${contextUsedPercent}% used). Click to view stats.`
              : 'Click to fetch context stats'
          }
        >
          <span className="flat-terminal-wrapper__context-icon">
            <Icon name="dashboard" size={12} />
          </span>
          <span className="flat-terminal-wrapper__context-label">Ctx:</span>
          <span className="flat-terminal-wrapper__context-bar">
            <span
              className="flat-terminal-wrapper__context-bar-fill"
              style={{ width: `${contextUsedPercent}%`, backgroundColor: contextColor }}
            />
          </span>
          <span
            className="flat-terminal-wrapper__context-tokens"
            style={{ color: contextColor }}
          >
            {contextUsedK}k/{contextLimitK}k
          </span>
          <span className="flat-terminal-wrapper__context-free">({contextFreePercent}% free)</span>
          {!contextHasData && (
            <span className="flat-terminal-wrapper__context-warning" title="No context stats yet">
              <Icon name="warn" size={12} />
            </span>
          )}
        </span>
        <div className="flat-terminal-wrapper__statusbar-spacer" aria-hidden="true" />
        {/* Area-scoped building shortcuts — mirrors the Guake statusbar so the
            user can jump into a terminal/PM2 logs/database from any view. */}
        {areaTerminalBuildings.length > 0 && (
          <span className="flat-terminal-wrapper__buildings" role="group" aria-label="Area terminals">
            {areaTerminalBuildings.map((tb) => {
              const isActive = embeddedTerminalBuildingId === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  className={`flat-terminal-wrapper__building-btn ${isActive ? 'flat-terminal-wrapper__building-btn--active' : ''} ${!tb.hasUrl ? 'flat-terminal-wrapper__building-btn--offline' : ''}`}
                  title={`${isActive ? 'Hide' : 'Show'} terminal: ${tb.name}${!tb.hasUrl ? ' (starting...)' : ''}`}
                  onClick={() => {
                    if (isActive) {
                      setEmbeddedTerminalBuildingId(null);
                      return;
                    }
                    if (!tb.hasUrl) store.sendBuildingCommand(tb.id, 'start');
                    setEmbeddedTerminalBuildingId(tb.id);
                  }}
                >
                  <Icon name="terminal" size={14} />
                </button>
              );
            })}
          </span>
        )}
        {areaPm2Buildings.length > 0 && (
          <span className="flat-terminal-wrapper__buildings" role="group" aria-label="Area PM2 logs">
            {areaPm2Buildings.map((sb) => (
              <button
                key={sb.id}
                type="button"
                className="flat-terminal-wrapper__building-btn"
                title={`Open logs: ${sb.name}`}
                onClick={() => onOpenBuilding(sb.id)}
              >
                <Icon name="scroll" size={14} />
              </button>
            ))}
          </span>
        )}
        {areaDatabaseBuildings.length > 0 && (
          <span className="flat-terminal-wrapper__buildings" role="group" aria-label="Area databases">
            {areaDatabaseBuildings.map((db) => (
              <button
                key={db.id}
                type="button"
                className="flat-terminal-wrapper__building-btn"
                title={`Open database: ${db.name}`}
                onClick={() => onOpenBuilding(db.id)}
              >
                <Icon name="hard-drives" size={14} />
              </button>
            ))}
          </span>
        )}
        <div className="flat-terminal-wrapper__theme">
          <ThemeSelector />
        </div>
      </div>
      {/* Side panels — reuse the same GuakeGitPanel / AreaBuildingsPanel the
          3D view uses, so the feature set stays aligned. They position
          absolutely against the .flat-terminal-wrapper (position: relative). */}
      {gitPanelOpen && (
        <GuakeGitPanel
          agentId={agentId}
          agents={agentsMap}
          onClose={closeGitPanel}
          branchInfoMap={areaBranches}
          fetchRemote={fetchGitRemote}
          fetchingDirs={gitFetchingDirs}
        />
      )}
      {buildingsPanelOpen && (
        <AreaBuildingsPanel
          agentId={agentId}
          onClose={closeBuildingsPanel}
        />
      )}
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

  const handleOpenBuilding = useCallback((buildingId: string) => {
    // Delegate to the app-level double-click handler so the appropriate modal
    // (PM2 logs, database panel, file explorer, etc.) opens based on the
    // building's type — identical to what happens when the user double-clicks
    // a building in the 3D scene.
    if (onBuildingDoubleClick) {
      onBuildingDoubleClick(buildingId);
    } else {
      onBuildingClick(buildingId);
    }
  }, [onBuildingClick, onBuildingDoubleClick]);

  // Get first selected agent for chat view
  const selectedAgentId = useMemo(() => {
    return selectedAgentIds.size > 0 ? Array.from(selectedAgentIds)[0] : null;
  }, [selectedAgentIds]);

  // Agent history navigation — mirrors GuakeOutputPanel agent history so Flat
  // view users get the same browser-style back/forward through selected agents.
  const agentNavigationHistoryRef = useRef<string[]>([]);
  const agentNavigationIndexRef = useRef(-1);
  const isHistoryNavigationRef = useRef(false);
  // Tracks the most recently opened agent independently of navigation history
  // so Space/Backspace can reopen it even after history is cleared.
  const lastOpenedAgentIdRef = useRef<string | null>(null);
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

    // Remember this agent as the last explicitly opened one so Space/Backspace
    // can reopen it later when no agent is selected.
    lastOpenedAgentIdRef.current = selectedAgentId;

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

  // ── Ref for scrolling the left-panel AgentOverviewPanel ──
  const agentListRef = useRef<HTMLDivElement>(null);

  // ── Space / Backspace reopen last agent when empty-chat view is showing ──
  useEffect(() => {
    if (selectedAgentId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Backspace') return;
      // Ignore when typing in inputs, textareas, or contenteditable elements
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      const lastId = lastOpenedAgentIdRef.current;
      if (!lastId || !agentIdSet.has(lastId)) return;
      event.preventDefault();
      store.selectAgent(lastId);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedAgentId, agentIdSet]);

  // ── Collapsed areas state (lifted so empty-chat overview can expand them) ──
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const handleToggleArea = useCallback((areaKey: string) => {
    setCollapsedAreas(prev => {
      const next = new Set(prev);
      if (next.has(areaKey)) next.delete(areaKey);
      else next.add(areaKey);
      return next;
    });
  }, []);

  // ── Track how many CSS grid columns the overview actually has ──
  const overviewGridRef = useRef<HTMLDivElement>(null);
  const [overviewGridCols, setOverviewGridCols] = useState(2);

  useEffect(() => {
    const el = overviewGridRef.current;
    if (!el) return;
    const computeCols = () => {
      const w = el.clientWidth;
      const colWidth = 240;
      const gap = 10;
      const cols = Math.max(1, Math.floor((w + gap) / (colWidth + gap)));
      setOverviewGridCols(cols);
    };
    computeCols();
    const ro = new ResizeObserver(computeCols);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Compact area/agent data for the empty-chat state ──
  const areas = useAreas();
  const emptyChatGroups = useMemo(() => {
    const agentsByAreaId = new Map<string, typeof agents>();
    const unassigned: typeof agents = [];
    for (const agent of agents) {
      const area = store.getAreaForAgent(agent.id);
      if (!area || area.archived) {
        unassigned.push(agent);
        continue;
      }
      const list = agentsByAreaId.get(area.id);
      if (list) list.push(agent);
      else agentsByAreaId.set(area.id, [agent]);
    }
    const groups: { area: typeof areas extends Map<string, infer V> ? V : never; agents: typeof agents }[] = [];
    for (const [, area] of areas) {
      if (area.archived) continue;
      const list = agentsByAreaId.get(area.id);
      if (list && list.length > 0) {
        groups.push({ area, agents: list });
      }
    }
    if (unassigned.length > 0) {
      groups.push({
        area: { id: '__unassigned__', name: 'Unassigned', color: '#6272a4', center: { x: 0, z: 0 }, type: 'circle', radius: 0, directories: [], archived: false, assignedAgentIds: [], zIndex: 0 } as any,
        agents: unassigned,
      });
    }

    // ── Spatial sort so the grid order mirrors the 2D/3D scene layout ──
    const assignedGroups = groups.filter(g => g.area.id !== '__unassigned__');
    const unassignedGroups = groups.filter(g => g.area.id === '__unassigned__');

    if (assignedGroups.length > 1) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const g of assignedGroups) {
        minX = Math.min(minX, g.area.center.x);
        maxX = Math.max(maxX, g.area.center.x);
        minZ = Math.min(minZ, g.area.center.z);
        maxZ = Math.max(maxZ, g.area.center.z);
      }
      const spanZ = maxZ - minZ || 1;
      // Use the actual CSS grid column count so each conceptual row aligns
      // with a real CSS grid row.  Areas are grouped into horizontal bands
      // (by z / scene vertical position) and sorted left-to-right within
      // each band so the card grid visually maps to the 2D canvas layout.
      const cols = Math.max(1, overviewGridCols);
      const bands = Math.max(1, Math.ceil(assignedGroups.length / cols));
      const bandHeight = spanZ / bands;

      assignedGroups.sort((a, b) => {
        const bandA = Math.min(bands - 1, Math.floor((a.area.center.z - minZ) / bandHeight));
        const bandB = Math.min(bands - 1, Math.floor((b.area.center.z - minZ) / bandHeight));
        if (bandA !== bandB) return bandA - bandB;
        return a.area.center.x - b.area.center.x;
      });
    }

    // Sort agents inside each group by their scene position (z then x)
    const sortAgents = (list: typeof agents) => {
      list.sort((a, b) => {
        const zDiff = (a.position?.z ?? 0) - (b.position?.z ?? 0);
        if (zDiff !== 0) return zDiff;
        return (a.position?.x ?? 0) - (b.position?.x ?? 0);
      });
    };
    for (const g of assignedGroups) sortAgents(g.agents);
    for (const g of unassignedGroups) sortAgents(g.agents);

    return [...assignedGroups, ...unassignedGroups];
  }, [agents, areas, overviewGridCols]);

  // ── Focus an area in the left-panel AgentOverviewPanel ──
  const handleFocusArea = useCallback((areaKey: string) => {
    // 1. Collapse every area except the clicked one
    const allOtherKeys = new Set(emptyChatGroups.map(g => g.area.id));
    allOtherKeys.delete(areaKey);
    setCollapsedAreas(allOtherKeys);
    // 2. After React flushes, scroll the area header into view
    requestAnimationFrame(() => {
      const container = agentListRef.current;
      if (!container) return;
      const header = container.querySelector<HTMLElement>(`[data-area-id="${areaKey}"]`);
      if (!header) return;
      const containerRect = container.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const offset = headerRect.top - containerRect.top + container.scrollTop - 8;
      container.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
    });
  }, [emptyChatGroups]);

  return (
    <div
      className={`flat-view ${showInspector ? 'flat-view--with-inspector' : ''}`}
    >
      {/* Middle Column - Agents overview. The former in-view SidebarMenu was
          removed because the floating left-side FAB menu (settings/spotlight/
          spawn buttons) already covers navigation. */}
      <div className="flat-middle">
        <div className="flat-middle__header">
          <h2 className="flat-middle__title">👥 Agents</h2>
          <div className="flat-middle__actions">
            <button
              className="flat-cta-btn flat-cta-btn--agent"
              onClick={onOpenSpawnModal}
              title="Create new agent"
            >
              + Agent
            </button>
            <button
              className="flat-cta-btn flat-cta-btn--boss"
              onClick={onOpenBossSpawnModal}
              title="Create new boss agent"
            >
              + Boss
            </button>
            <button
              className="flat-cta-btn flat-cta-btn--area"
              onClick={onOpenAreaModal}
              title="Create new area"
            >
              + Area
            </button>
          </div>
        </div>
        <div className="flat-middle__content">
          <AgentOverviewPanel
            activeAgentId={overviewActiveAgentId}
            onClose={noopOverviewClose}
            onSelectAgent={handleOverviewSelectAgent}
            collapsedAreas={collapsedAreas}
            onToggleArea={handleToggleArea}
            agentListRef={agentListRef}
          />
        </div>
      </div>

      {/* Right Column - Chat/Details */}
      <div className="flat-right">
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
            onOpenBuilding={handleOpenBuilding}
            keyboard={keyboard}
            canNavigateBack={canNavigateBack}
            canNavigateForward={canNavigateForward}
            onNavigateBack={handleNavigateBack}
            onNavigateForward={handleNavigateForward}
          />
        ) : (
          <div className="flat-chat flat-chat--empty">
            <div className="flat-empty-overview">
              <div className="flat-empty-overview__header">
                <span className="flat-empty-overview__title">🗺️ Areas</span>
                <span className="flat-empty-overview__hint">Click an area to focus it, or an agent to chat</span>
              </div>
              <div className="flat-empty-overview__grid" ref={overviewGridRef}>
                {emptyChatGroups.length === 0 ? (
                  <div className="flat-empty-overview__empty">
                    <span>No areas or agents yet</span>
                  </div>
                ) : (
                  emptyChatGroups.map(group => {
                    const areaKey = group.area.id;
                    return (
                      <div
                        key={areaKey}
                        className="flat-empty-area-card"
                        style={{ '--area-color': group.area.color } as React.CSSProperties}
                      >
                        <button
                          type="button"
                          className="flat-empty-area-card__header"
                          onClick={() => handleFocusArea(areaKey)}
                          title={`Focus ${group.area.name} in left panel`}
                        >
                          <span
                            className="flat-empty-area-card__color"
                            style={{ background: group.area.color }}
                          />
                          <span className="flat-empty-area-card__name">{group.area.name}</span>
                          <span className="flat-empty-area-card__count">{group.agents.length}</span>
                        </button>
                        <div className="flat-empty-area-card__agents">
                          {group.agents.map(agent => (
                            <button
                              key={agent.id}
                              type="button"
                              className={`flat-empty-agent-chip ${agent.status}`}
                              onClick={() => onAgentClick(agent.id)}
                              title={`Open chat with ${agent.name}`}
                            >
                              <AgentIcon agent={agent} size={16} />
                              <span className="flat-empty-agent-chip__name">{agent.name}</span>
                              <span
                                className="flat-empty-agent-chip__dot"
                                style={{ backgroundColor: getAgentStatusColor(agent.status) }}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inspector Column - Pushes chat column rather than overlaying */}
      {showInspector && selectedAgentId && (
        <aside className="flat-inspector" aria-label="Inspector panel">
          <div className="flat-inspector__header">
            <div className="flat-inspector__tabs" role="tablist" aria-label="Inspector view">
              <button
                type="button"
                role="tab"
                aria-selected={inspectorView === 'agent'}
                className={`flat-inspector__tab ${inspectorView === 'agent' ? 'flat-inspector__tab--active' : ''}`}
                onClick={() => setInspectorView('agent')}
              >
                Agent
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorView === 'tracking'}
                className={`flat-inspector__tab ${inspectorView === 'tracking' ? 'flat-inspector__tab--active' : ''}`}
                onClick={() => setInspectorView('tracking')}
              >
                Tracking
              </button>
            </div>
            <button
              type="button"
              className="flat-inspector__close"
              onClick={handleCloseInspector}
              title="Close inspector"
              aria-label="Close inspector"
            >
              ✕
            </button>
          </div>
          <div className="flat-inspector__body">
            {inspectorView === 'tracking' ? (
              <TrackingBoard
                activeAgentId={selectedAgentId ?? ''}
                onSelectAgent={(agentId) => onAgentClick(agentId)}
              />
            ) : (() => {
              const selectedAgent = agents.find((a) => a.id === selectedAgentId);
              if (!selectedAgent) {
                return (
                  <div className="flat-inspector__empty">
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
