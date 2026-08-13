/**
 * FlatView - Flat UI layout with 3-column design
 *
 * Layout:
 * - Left sidebar: Navigation menu (settings, commander, etc.)
 * - Middle column: Agents, buildings, and areas
 * - Right column: Selected agent's chat view
 */

import React, { useState, useMemo, useCallback, useRef, useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAgents,
  useAgentsArray,
  useSelectedAgentIds,
  useAgent,
  useAreas,
  useBuildings,
  useRunningTestRoots,
  isTestPathRelated,
} from '../../store/selectors';
import { store, useSettings } from '../../store';
import { ConfirmModal } from '../shared/ConfirmModal';
import { CLAUDE_MODELS, CLAUDE_EFFORTS, CODEX_MODELS, DEFAULT_GROK_MODEL } from '../../../shared/types';
import type { Agent, DrawingArea } from '../../../shared/types';
import { providerAssetUrl, providerAgentTitle } from '../../utils/providerDisplay';
import type { Building } from '../../../shared/building-types';
import { BUILDING_TYPES } from '../../../shared/building-types';
import { AgentIcon } from '../AgentIcon';
import { Icon, type IconName } from '../Icon';
import { getBuildingTypeIcon } from '../DashboardView/utils';
import { getAreaLogoUrl } from '../../api/area-logos';
import { TaskProgressDots } from '../shared/TaskProgressDots';
import { SubordinateProgressDots } from '../shared/SubordinateProgressDots';
import { AgentHoverTooltip } from '../shared/AgentHoverTooltip';
import { ContextMenu, type ContextMenuAction } from '../ContextMenu';
import { getAgentStatusColor, getBuildingStatusColor } from '../../utils/colors';
import { getDisplayContextInfo } from '../../utils/context';
import { AgentOverviewPanel } from '../ClaudeOutputPanel/AgentOverviewPanel';
import { AgentTerminalPane, type AgentTerminalPaneHandle } from '../ClaudeOutputPanel/AgentTerminalPane';
import { useAgentSwitchFade } from '../ClaudeOutputPanel/useAgentSwitchFade';
import AgentClassicTerminal from './AgentClassicTerminal';
import { PlanLimitsTooltip } from './PlanLimitsTooltip';
import { AgentDebugPanel } from '../ClaudeOutputPanel/AgentDebugPanel';
import { AreaBuildingsPanel } from '../ClaudeOutputPanel/AreaBuildingsPanel';
import { GuakeGitPanel } from '../ClaudeOutputPanel/GuakeGitPanel';
import { GuakeTaskBanner } from '../ClaudeOutputPanel/GuakeTaskBanner';
import { agentDebugger } from '../../services/agentDebugger';
import { ContextConfirmModal, ImageModal, BashModal, AgentInfoModal, AgentResponseModalWrapper, type BashModalState } from '../ClaudeOutputPanel/TerminalModals';
import { useModalStackRegistration } from '../../hooks/useModalStack';
import { useKeyboardHeight } from '../ClaudeOutputPanel/useKeyboardHeight';
import { useBottomTerminalResize } from '../ClaudeOutputPanel/useBottomTerminalResize';
import { useSidePanelResize } from '../ClaudeOutputPanel/useSidePanelResize';
import { ThemeSelector } from '../ClaudeOutputPanel/ThemeSelector';
import { useGitBranches } from '../ClaudeOutputPanel/useGitBranch';
import { SingleAgentPanel } from '../UnitPanel/SingleAgentPanel';
import { TrackingBoard } from '../ClaudeOutputPanel/TrackingBoard';
import { useWorkspaceFilter, isAgentVisibleInWorkspace, isAreaVisibleInWorkspace } from '../WorkspaceSwitcher';
import type { ViewMode as TerminalViewMode } from '../ClaudeOutputPanel/types';
import TerminalEmbed from '../TerminalEmbed';
import { HttpRequestsBrowser } from '../HttpRequestsBuildingModal';
import { TestsBrowser } from '../TestsBuildingModal';
import { BottomPm2LogContent } from '../ClaudeOutputPanel/BottomPm2LogContent';
import { DatabasePanelInline } from '../database/DatabasePanelInline';
import { getBuildingViewMode, expandBuilding, type DockPanelType } from '../../utils/buildingViewMode';
import {
  BOTTOM_PM2_LOG_RETENTION_OPTIONS,
  readBottomPm2LogRetention,
  writeBottomPm2LogRetention,
} from '../../utils/logRetention';
import { ViewModeToggle } from '../ViewModeToggle/ViewModeToggle';
import { useTwoClickConfirm, useAndroidBackButton } from '../../hooks';
import {
  getStorageBoolean,
  setStorageBoolean,
  getStorageString,
  setStorageString,
  getStorageNumber,
  setStorageNumber,
  STORAGE_KEYS,
} from '../../utils/storage';
import './FlatView.scss';

// ============================================================================
// Layout constants (desktop/tablet resizable splitters: one between
// .flat-middle and .flat-right, one between .flat-right and .flat-inspector
// when it's open). Mirror the CSS fallback values so the drag clamp logic
// agrees with what the responsive stylesheet enforces.
// ============================================================================
const FLAT_SPLITTER_WIDTH = 3;
const FLAT_AGENTS_MIN_WIDTH = 280;
const FLAT_RIGHT_MIN_WIDTH = 320;
const FLAT_INSPECTOR_MIN_WIDTH = 240;
const FLAT_LEFT_GUTTER = 64; // matches .flat-view `padding-left` in FlatView.scss

// ============================================================================
// Types
// ============================================================================

interface FlatViewProps {
  onAgentClick: (agentId: string) => void;
  onAgentDoubleClick?: (agentId: string) => void;
  onBuildingClick: (buildingId: string) => void;
  onBuildingDoubleClick?: (buildingId: string) => void;
  /** Open the floating BuildingActionPopup (boss/database/server etc.) anchored at the click. */
  onBuildingPopup?: (buildingId: string, screenPos: { x: number; y: number }) => void;
  onAreaClick?: (areaId: string) => void;
  /** Open the global area context menu — mirrors the right-click area menu used by 2D/3D scenes. */
  onAreaContextMenu?: (areaId: string, screenPos: { x: number; y: number }) => void;
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
  /** Open the inspector on its Tracking tab (current-task banner click-through). */
  onShowTaskBoard: () => void;
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
  agentInfoOpen: boolean;
  onToggleAgentInfo: () => void;
  onHeaderContextMenu: (position: { x: number; y: number }) => void;
  /** Open the building context menu for an area-shortcut button — mirrors the
   * right-click menu on the empty-state map's building chips. */
  onBuildingContextMenu: (buildingId: string, position: { x: number; y: number }) => void;
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

// Per-area persistence of the flat embedded bottom panel — mirrors the guake's
// tide:bottom-panels-v2 map so switching to an agent of another area and back
// restores the panel exactly as it was left.
const FLAT_EMBED_LS_KEY = 'tide:flat-embedded-panels';

function readFlatEmbeddedPanels(): Record<string, { type: DockPanelType; buildingId: string }> {
  try {
    const raw = localStorage.getItem(FLAT_EMBED_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFlatEmbeddedPanel(areaId: string, panel: { type: DockPanelType; buildingId: string } | null): void {
  try {
    const map = readFlatEmbeddedPanels();
    if (panel) map[areaId] = panel;
    else delete map[areaId];
    localStorage.setItem(FLAT_EMBED_LS_KEY, JSON.stringify(map));
  } catch {
    /* quota/private mode — open state just won't stick */
  }
}

function formatCwdShort(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length === 0) return cwd;
  return parts.slice(-2).join('/');
}

// Resolve a compact "Model · Effort" label for the header chip. Claude agents
// have both a model and a reasoning effort; Codex/OpenCode only carry a model.
function getAgentModelLabel(agent: Agent): { model: string; effort?: string } {
  if (agent.provider === 'codex') {
    const id = agent.codexModel || 'gpt-5.6-luna';
    const meta = (CODEX_MODELS as Record<string, { label: string }>)[id];
    return { model: meta?.label || id };
  }
  if (agent.provider === 'opencode') {
    return { model: (agent as unknown as { opencodeModel?: string }).opencodeModel || 'opencode' };
  }
  if (agent.provider === 'grok') {
    const id = (agent as unknown as { grokModel?: string }).grokModel || DEFAULT_GROK_MODEL;
    const effortId = agent.effort;
    const effortMeta = effortId
      ? (CLAUDE_EFFORTS as Record<string, { label: string }>)[effortId]
      : undefined;
    return { model: id, effort: effortMeta?.label };
  }
  if (agent.provider === 'pi') {
    const id = (agent as unknown as { piModel?: string }).piModel || 'pi default';
    const effortId = agent.effort;
    const effortMeta = effortId
      ? (CLAUDE_EFFORTS as Record<string, { label: string }>)[effortId]
      : undefined;
    return { model: id, effort: effortMeta?.label };
  }
  const id = agent.model || agent.detectedModel || 'default';
  const meta = (CLAUDE_MODELS as Record<string, { label: string }>)[id];
  const effortId = agent.effort;
  const effortMeta = effortId
    ? (CLAUDE_EFFORTS as Record<string, { label: string }>)[effortId]
    : undefined;
  return { model: meta?.label || id, effort: effortMeta?.label };
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
  onShowTaskBoard,
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
  agentInfoOpen,
  onToggleAgentInfo,
  onHeaderContextMenu,
  onBuildingContextMenu,
}: ChatViewProps) {
  const agent = useAgent(agentId);
  const buildings = useBuildings();
  const settings = useSettings();
  const paneRef = useRef<AgentTerminalPaneHandle>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Same agent-switch pipeline as the guake terminal: the chrome (header)
  // follows the selection instantly, while the keyed conversation pane
  // crossfades — short fade-out of the outgoing conversation, atomic remount,
  // fade-in of the incoming one after pin.
  const { displayedAgentId, fadingOut } = useAgentSwitchFade(agentId);
  const displayedAgent = useAgent(displayedAgentId);

  // "Classic TUI" view: only offered when interactive-TUI mode is enabled and
  // this is a Claude agent that has a session (i.e. a tc-int-<agentId> tmux
  // session exists). Toggles a local, per-agent embedded-terminal view.
  const classicTuiAvailable =
    !!settings.interactiveMode && (agent?.provider ?? 'claude') === 'claude' && !!agent?.sessionId;
  const [classicTuiOpen, setClassicTuiOpen] = useState(false);
  // Mobile-only bottom sheet that relocates the header action cluster (search /
  // clear / git / buildings / debug / destructive ops) into a thumb-reachable
  // surface. On phones the top-right cluster is hidden (CSS) and a single
  // trigger opens this sheet; desktop keeps the inline cluster. Registered on
  // the modal stack so Escape / Android-back close it.
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const closeActionsSheet = useCallback(() => setActionsSheetOpen(false), []);
  useModalStackRegistration('flat-chat-actions', actionsSheetOpen, closeActionsSheet);
  // Bridge: the mobile bottom-nav "Actions" button lives in App's
  // MobileBottomMenu (a separate React tree), so it toggles this sheet via a
  // window event rather than a prop.
  useEffect(() => {
    const handler = () => setActionsSheetOpen((o) => !o);
    window.addEventListener('tide:toggle-chat-actions', handler);
    return () => window.removeEventListener('tide:toggle-chat-actions', handler);
  }, []);
  // Reset when switching agents or when it stops being available.
  useEffect(() => {
    setClassicTuiOpen(false);
    setActionsSheetOpen(false);
  }, [agentId]);
  useEffect(() => {
    if (!classicTuiAvailable && classicTuiOpen) setClassicTuiOpen(false);
  }, [classicTuiAvailable, classicTuiOpen]);

  // Mouse back/forward button gestures for agent history navigation — mirrors
  // the 3D ClaudeOutputPanel so the Flat view responds to the same physical
  // mouse side-buttons. Scoped to the flat-terminal-wrapper element.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        onNavigateBack();
      } else if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        onNavigateForward();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
      }
    };

    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mousedown', onMouseDown);
    return () => {
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mousedown', onMouseDown);
    };
  }, [onNavigateBack, onNavigateForward]);

  // Mac trackpad two-finger horizontal swipe → prev/next agent. macOS browsers
  // translate the gesture into wheel events with horizontal deltaX; relying on
  // popstate alone is unreliable because Safari/Chrome may not commit a same-
  // URL pushState navigation. We accumulate horizontal delta and fire when
  // dominant horizontal motion crosses a threshold. Skipped when the gesture
  // is consumed by an inner horizontally-scrollable element (e.g. wide code).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    let accumX = 0;
    let lastWheelAt = 0;
    let cooldownUntil = 0;
    const RESET_MS = 250;
    const COOLDOWN_MS = 600;
    const THRESHOLD = 80;
    const DOMINANCE = 1.5;

    const isInHorizontalScroller = (target: EventTarget | null): boolean => {
      let node = target instanceof HTMLElement ? target : null;
      while (node && node !== el) {
        const ox = window.getComputedStyle(node).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now < cooldownUntil) {
        e.preventDefault();
        return;
      }
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * DOMINANCE) {
        accumX = 0;
        return;
      }
      if (isInHorizontalScroller(e.target)) {
        accumX = 0;
        return;
      }
      if (now - lastWheelAt > RESET_MS) accumX = 0;
      lastWheelAt = now;
      accumX += e.deltaX;

      if (accumX <= -THRESHOLD) {
        accumX = 0;
        cooldownUntil = now + COOLDOWN_MS;
        e.preventDefault();
        onNavigateBack();
      } else if (accumX >= THRESHOLD) {
        accumX = 0;
        cooldownUntil = now + COOLDOWN_MS;
        e.preventDefault();
        onNavigateForward();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onNavigateBack, onNavigateForward]);

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

  // Roots with a test run in flight — stable across per-line output updates
  // (only run start/finish changes it), so the statusbar flask can animate
  // while that building's tests execute without re-render storms.
  const runningTestRoots = useRunningTestRoots();
  const areaTestsBuildings = useMemo(() => {
    const area = store.getAreaForAgent(agentId);
    if (!area) return [];
    const result: { id: string; name: string; working: boolean }[] = [];
    for (const building of buildings.values()) {
      if (building.type === 'tests' && store.isPositionInArea(building.position, area)) {
        const working =
          !!building.folderPath &&
          runningTestRoots.some((root) => isTestPathRelated(root, building.folderPath!));
        result.push({ id: building.id, name: building.name, working });
      }
    }
    return result;
  }, [agentId, buildings, runningTestRoots]);

  // HTTP-requests buildings in the agent's area (statusbar shortcut buttons).
  const areaHttpBuildings = useMemo(() => {
    const area = store.getAreaForAgent(agentId);
    if (!area) return [];
    const result: { id: string; name: string }[] = [];
    for (const building of buildings.values()) {
      if (building.type === 'http' && store.isPositionInArea(building.position, area)) {
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

  // Embedded bottom panel — one building surface at a time (terminal, PM2
  // logs, database, tests or HTTP requests), rendered under the chat pane like
  // the Guake statusbar's bottom panels. The statusbar buttons toggle it; the
  // maximize button swaps to the building's rich modal.
  const [embeddedPanel, setEmbeddedPanel] = useState<{ type: DockPanelType; buildingId: string } | null>(null);
  const embeddedBuilding = embeddedPanel ? buildings.get(embeddedPanel.buildingId) : null;
  // PM2-panel chrome state (filter is per-open; retention shared with the guake panel).
  const [embeddedPm2Filter, setEmbeddedPm2Filter] = useState('');
  const [embeddedPm2Retention, setEmbeddedPm2Retention] = useState<number | null>(() => readBottomPm2LogRetention());
  const agentAreaId = useMemo(() => store.getAreaForAgent(agentId)?.id ?? null, [agentId, buildings]);
  // Explicit user actions persist the panel per area; the area-switch restore
  // effect below reads it back. Automatic closes (building removed / area
  // switch) must NOT persist — they'd clobber the user's saved choice.
  const toggleEmbeddedPanel = useCallback((type: DockPanelType, buildingId: string) => {
    setEmbeddedPm2Filter('');
    setEmbeddedPanel((prev) => {
      const next = prev?.buildingId === buildingId ? null : { type, buildingId };
      if (agentAreaId) writeFlatEmbeddedPanel(agentAreaId, next);
      return next;
    });
  }, [agentAreaId]);
  const closeEmbeddedPanel = useCallback(() => {
    setEmbeddedPm2Filter('');
    setEmbeddedPanel(null);
    if (agentAreaId) writeFlatEmbeddedPanel(agentAreaId, null);
  }, [agentAreaId]);
  // PM2 log streaming follows the panel lifecycle (same pattern as the guake
  // bottom panels: start on open, stop on close/swap).
  useEffect(() => {
    if (embeddedPanel?.type !== 'pm2-logs') return;
    const id = embeddedPanel.buildingId;
    store.startLogStreaming(id, 200);
    return () => store.stopLogStreaming(id);
  }, [embeddedPanel]);
  // Shared resizer — same hook the Guake bottom panel uses, so the persisted
  // height is kept in sync across both surfaces.
  const { height: embeddedHeight, onResizeStart: handleEmbeddedResizeStart } = useBottomTerminalResize();

  // Side-panel width — same shared hook + persisted width the Guake terminal
  // uses, so the git/buildings panels resize identically across both views.
  const { sidePanelWidth, handleSidePanelResizeStart } = useSidePanelResize();

  // Side panels (git / area buildings) — reuse the Guake components, persist
  // open-state to the same STORAGE_KEYS so the toggle survives a view swap.
  const [gitPanelOpen, setGitPanelOpen] = useState<boolean>(() =>
    getStorageBoolean(STORAGE_KEYS.GIT_PANEL_OPEN, false)
  );
  const [buildingsPanelOpen, setBuildingsPanelOpen] = useState<boolean>(() =>
    getStorageBoolean(STORAGE_KEYS.BUILDINGS_PANEL_OPEN, false)
  );
  // Debug panel parity with the Guake terminal header: same AgentDebugPanel,
  // same auto-enable-on-open behavior. Not persisted to storage — the Guake
  // version also keeps it session-local.
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const toggleDebugPanel = useCallback(() => {
    setDebugPanelOpen((prev) => {
      const next = !prev;
      if (next) agentDebugger.setEnabled(true);
      return next;
    });
  }, []);
  const closeDebugPanel = useCallback(() => setDebugPanelOpen(false), []);
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

  // Buildings this pane can host, per panel type — drives both the ghost
  // cleanup and the dock-event membership check below.
  const embeddableByType = useMemo<Record<DockPanelType, { id: string }[]>>(() => ({
    terminal: areaTerminalBuildings,
    'pm2-logs': areaPm2Buildings,
    database: areaDatabaseBuildings,
    tests: areaTestsBuildings,
    http: areaHttpBuildings,
  }), [areaTerminalBuildings, areaPm2Buildings, areaDatabaseBuildings, areaTestsBuildings, areaHttpBuildings]);

  // Close the embed automatically if the building leaves the current area or
  // disappears, so the panel doesn't stick around as a stale ghost. Visual
  // close only — no LS write, so the restore effect below can bring the saved
  // panel back when the user returns to its area.
  useEffect(() => {
    if (!embeddedPanel) return;
    const stillInArea = embeddableByType[embeddedPanel.type].some((b) => b.id === embeddedPanel.buildingId);
    if (!stillInArea) {
      setEmbeddedPm2Filter('');
      setEmbeddedPanel(null);
    }
  }, [embeddedPanel, embeddableByType]);

  // Restore the area's saved panel when the pane lands on an agent of a
  // different area (and on mount/reload). Guarded by a ref so it fires once
  // per area change — in-area opens/closes are never overridden.
  const prevEmbedAreaRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevEmbedAreaRef.current === agentAreaId) return;
    prevEmbedAreaRef.current = agentAreaId;
    const saved = agentAreaId ? readFlatEmbeddedPanels()[agentAreaId] : undefined;
    setEmbeddedPm2Filter('');
    if (saved && embeddableByType[saved.type]?.some((b) => b.id === saved.buildingId)) {
      setEmbeddedPanel(saved);
    } else {
      setEmbeddedPanel(null);
    }
  }, [agentAreaId, embeddableByType]);

  // Dock request coming from a modal's minimize button while the flat chat
  // pane is the visible surface. Marking `handled` tells dockBuilding() it
  // doesn't need to fall back to the Guake bottom panel. Buildings outside
  // this pane's area stay unhandled — the still-in-area cleanup above would
  // immediately close them, so the guake dock is the better host.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ buildingId: string; type: DockPanelType; handled?: boolean }>).detail;
      if (!detail?.buildingId || !detail?.type) return;
      if (!embeddableByType[detail.type]?.some((b) => b.id === detail.buildingId)) return;
      detail.handled = true;
      setEmbeddedPm2Filter('');
      const panel = { type: detail.type, buildingId: detail.buildingId };
      setEmbeddedPanel(panel);
      if (agentAreaId) writeFlatEmbeddedPanel(agentAreaId, panel);
    };
    window.addEventListener('tide:dock-building-flat', handler as EventListener);
    return () => window.removeEventListener('tide:dock-building-flat', handler as EventListener);
  }, [embeddableByType, agentAreaId]);

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

  // Context / token usage calculations — shared resolver, same numbers as the
  // 3D overlay footer widget and the agent panels.
  const contextHasData = !!agent.contextStats;
  const {
    totalTokens: contextTotalTokens,
    contextWindow,
    usedPercent: contextUsedPercent,
  } = getDisplayContextInfo(agent);
  const contextUsedPercentDisplay = Math.round(contextUsedPercent * 10) / 10;
  const contextFreePercentDisplay = Math.round((100 - contextUsedPercent) * 10) / 10;
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
    <div
      ref={wrapperRef}
      className={`flat-terminal-wrapper ${gitPanelOpen || buildingsPanelOpen || debugPanelOpen ? 'flat-terminal-wrapper--with-side-panel' : ''} ${fadingOut ? 'pane-fading-out' : ''}`}
      // Clamp to 70% of the (often narrow) Flat chat column so the side panel
      // can't overflow it and push the resize handle off the left edge. Panel
      // width, chat margin, and handle position all read this one var, so they
      // stay in sync. The Guake terminal is full-width and uses the raw px.
      style={{ '--guake-side-panel-width': `min(${sidePanelWidth}px, 70%)` } as React.CSSProperties}
    >
      <div className="flat-terminal-wrapper__header">
        <button
          type="button"
          className={`flat-terminal-wrapper__header-main ${agentInfoOpen ? 'flat-terminal-wrapper__header-main--active' : ''}`}
          onClick={onToggleAgentInfo}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onHeaderContextMenu({ x: e.clientX, y: e.clientY });
          }}
          title={agentInfoOpen ? 'Hide agent info' : 'Show agent info'}
          aria-pressed={agentInfoOpen}
        >
          <span className={`flat-terminal-wrapper__header-avatar${agent.status === 'working' ? ' is-working' : ''}`}>
            <AgentIcon agent={agent} size={28} />
          </span>
          <span className="flat-terminal-wrapper__header-info">
            <span className="flat-terminal-wrapper__header-name">{agent.name}</span>
            <span
              className="flat-terminal-wrapper__header-status"
              style={{ color: getAgentStatusColor(agent.status) }}
              title={agent.status === 'error' && agent.lastError ? agent.lastError : undefined}
            >
              {agent.status}
            </span>
          </span>
          {agent.taskLabel && (
            <span className="flat-terminal-wrapper__header-task" title={agent.taskLabel}>
              📋 {agent.taskLabel}
            </span>
          )}
          <span className="flat-terminal-wrapper__header-model">
            <img
              src={providerAssetUrl(agent.provider, import.meta.env.BASE_URL)}
              alt={agent.provider}
              className="flat-terminal-wrapper__header-provider-icon"
              title={providerAgentTitle(agent.provider)}
            />
            {(() => {
              const { model, effort } = getAgentModelLabel(agent);
              return (
                <span
                  className="flat-terminal-wrapper__header-model-chip"
                  title={effort ? `Model: ${model} · Effort: ${effort}` : `Model: ${model}`}
                >
                  <span className="flat-terminal-wrapper__header-model-name">{model}</span>
                  {effort && (
                    <>
                      <span className="flat-terminal-wrapper__header-model-sep" aria-hidden="true">·</span>
                      <span className="flat-terminal-wrapper__header-model-effort">{effort}</span>
                    </>
                  )}
                </span>
              );
            })()}
          </span>
        </button>
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
                  !classicTuiOpen && terminalViewMode === mode ? 'flat-terminal-wrapper__view-mode-btn--active' : ''
                }`}
                onClick={() => {
                  setClassicTuiOpen(false);
                  onTerminalViewModeChange(mode);
                }}
                title={TERMINAL_VIEW_MODE_DESCRIPTIONS[mode]}
                aria-pressed={!classicTuiOpen && terminalViewMode === mode}
              >
                <span className="flat-terminal-wrapper__view-mode-icon" aria-hidden="true">
                  {TERMINAL_VIEW_MODE_ICONS[mode]}
                </span>
                <span className="flat-terminal-wrapper__view-mode-label">
                  {TERMINAL_VIEW_MODE_LABELS[mode]}
                </span>
              </button>
            ))}
            {classicTuiAvailable && (
              <button
                type="button"
                className={`flat-terminal-wrapper__view-mode-btn ${
                  classicTuiOpen ? 'flat-terminal-wrapper__view-mode-btn--active' : ''
                }`}
                onClick={() => setClassicTuiOpen((open) => !open)}
                title="Classic TUI — attach to the live interactive claude session in a terminal"
                aria-pressed={classicTuiOpen}
              >
                <span className="flat-terminal-wrapper__view-mode-icon" aria-hidden="true">
                  <Icon name="terminal" size={13} />
                </span>
                <span className="flat-terminal-wrapper__view-mode-label">
                  Classic TUI
                </span>
              </button>
            )}
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
                    className={`flat-terminal-wrapper__more-item ${debugPanelOpen ? 'flat-terminal-wrapper__more-item--active' : ''}`}
                    onClick={() => {
                      toggleDebugPanel();
                      setMenuOpen(false);
                    }}
                    title={debugPanelOpen ? 'Hide Debug Panel' : 'Show Debug Panel'}
                  >
                    <Icon name="bug" size={14} />
                    <span>{debugPanelOpen ? 'Hide Debug Panel' : 'Show Debug Panel'}</span>
                  </button>
                  <div className="flat-terminal-wrapper__more-divider" />
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
          <button
            type="button"
            className="flat-terminal-wrapper__close"
            onClick={() => store.deselectAll()}
            title="Close chat"
            aria-label="Close chat"
          >
            <Icon name="cross" size={14} />
          </button>
        </div>
      </div>

      {/* Mobile-only chat-actions bottom sheet — the header cluster relocated
          into a thumb-reachable surface that slides up above the bottom-nav. */}
      {actionsSheetOpen && (
        <div className="flat-chat-actions-sheet-root" role="presentation">
          <div className="flat-chat-actions-sheet__backdrop" onClick={closeActionsSheet} />
          <div className="flat-chat-actions-sheet" role="menu" aria-label="Chat actions">
            <div className="flat-chat-actions-sheet__grabber" aria-hidden="true" />
            <div className="flat-chat-actions-sheet__title-row">
              <span className="flat-chat-actions-sheet__title">{agent.name}</span>
              <button
                type="button"
                className="flat-chat-actions-sheet__done"
                onClick={closeActionsSheet}
              >
                Done
              </button>
            </div>
            <div className="flat-chat-actions-sheet__grid">
              <button
                type="button"
                role="menuitem"
                className={`flat-chat-actions-sheet__item ${searchMode ? 'is-active' : ''}`}
                onClick={() => { handleSearchToggle(); closeActionsSheet(); }}
              >
                <Icon name={searchMode ? 'cross' : 'search'} size={20} />
                <span>{searchMode ? 'Close search' : 'Search'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={`flat-chat-actions-sheet__item ${gitPanelOpen ? 'is-active' : ''}`}
                onClick={() => { toggleGitPanel(); closeActionsSheet(); }}
              >
                <Icon name="git-branch" size={20} />
                <span>Git changes</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={`flat-chat-actions-sheet__item ${buildingsPanelOpen ? 'is-active' : ''}`}
                onClick={() => { toggleBuildingsPanel(); closeActionsSheet(); }}
              >
                <Icon name="buildings" size={20} />
                <span>Buildings</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={`flat-chat-actions-sheet__item ${debugPanelOpen ? 'is-active' : ''}`}
                onClick={() => { toggleDebugPanel(); closeActionsSheet(); }}
              >
                <Icon name="bug" size={20} />
                <span>Debug</span>
              </button>
            </div>
            <div className="flat-chat-actions-sheet__list">
              <button
                type="button"
                role="menuitem"
                className={`flat-chat-actions-sheet__row flat-chat-actions-sheet__row--danger ${isClearArmed ? 'is-armed' : ''}`}
                onClick={() =>
                  clearConfirm.handleClick(CLEAR_CONFIRM_ID, () => {
                    store.clearContext(agentId);
                    paneRef.current?.historyLoader.clearHistory();
                    closeActionsSheet();
                  })
                }
              >
                <Icon name={isClearArmed ? 'question' : 'clear'} size={18} />
                <span>{isClearArmed ? 'Tap again to confirm clear' : 'Clear context'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="flat-chat-actions-sheet__row"
                disabled={agent.status !== 'idle'}
                onClick={() => { store.collapseContext(agentId); closeActionsSheet(); }}
              >
                <Icon name="package" size={18} />
                <span>Collapse context</span>
              </button>
              {hasSubordinates && (
                <button
                  type="button"
                  role="menuitem"
                  className="flat-chat-actions-sheet__row flat-chat-actions-sheet__row--danger"
                  onClick={() => { onRequestClearSubordinates(agentId, subordinateCount); closeActionsSheet(); }}
                >
                  <Icon name="crown" size={18} />
                  <span>Clear {subordinateCount} subordinate{subordinateCount === 1 ? '' : 's'}</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="flat-chat-actions-sheet__row flat-chat-actions-sheet__row--danger"
                onClick={() => { store.killAgent(agentId); closeActionsSheet(); }}
              >
                <Icon name="cross" size={18} />
                <span>Remove agent</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Current-task banner — what this agent is working on right now. */}
      <GuakeTaskBanner agent={agent} onClick={onShowTaskBoard} />

      {classicTuiOpen && classicTuiAvailable ? (
        <AgentClassicTerminal agentId={agentId} />
      ) : displayedAgentId && displayedAgent ? (
        <AgentTerminalPane
          key={displayedAgentId}
          ref={paneRef}
          agentId={displayedAgentId}
          agent={displayedAgent}
          viewMode={terminalViewMode}
          isOpen={true}
          onImageClick={onImageClick}
          onFileClick={onFileClick}
          onBashClick={onBashClick}
          onViewMarkdown={onViewMarkdown}
          keyboard={keyboard}
          hasModalOpen={false}
        />
      ) : null}
      {embeddedPanel && embeddedBuilding && (() => {
        const panelType = embeddedPanel.type;
        const titleIcon: Record<DockPanelType, IconName> = {
          terminal: 'terminal',
          'pm2-logs': 'scroll',
          database: 'hard-drives',
          tests: 'flask',
          http: 'globe',
        };
        const terminalStarting = panelType === 'terminal' && !embeddedBuilding.terminalStatus?.url;
        // Terminals without a URL can't maximize (the modal needs the URL).
        const canMaximize = !terminalStarting;
        return (
          <>
            <div
              className="guake-bottom-terminal-resize"
              onMouseDown={handleEmbeddedResizeStart}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize embedded panel"
            />
            <div
              className="flat-bottom-panel"
              role="region"
              aria-label={`${embeddedBuilding.name} panel`}
              style={{ height: embeddedHeight }}
            >
              <div className="flat-bottom-panel__header">
                <span className="flat-bottom-panel__title">
                  <Icon name={titleIcon[panelType]} size={12} />
                  <span>{embeddedBuilding.name}</span>
                  {terminalStarting && <span className="flat-bottom-panel__muted">(starting...)</span>}
                </span>
                <span className="flat-bottom-panel__header-actions">
                  {panelType === 'pm2-logs' && (
                    <>
                      <input
                        type="text"
                        className="guake-bottom-terminal-filter"
                        value={embeddedPm2Filter}
                        onChange={(e) => setEmbeddedPm2Filter(e.target.value)}
                        placeholder="Filter logs"
                        aria-label={`Filter logs for ${embeddedBuilding.name}`}
                        spellCheck={false}
                      />
                      <select
                        className="guake-bottom-terminal-retention"
                        value={embeddedPm2Retention === null ? 'unlimited' : String(embeddedPm2Retention)}
                        onChange={(e) => {
                          const nextValue = e.target.value === 'unlimited' ? null : Number(e.target.value);
                          setEmbeddedPm2Retention(nextValue);
                          writeBottomPm2LogRetention(nextValue);
                        }}
                        aria-label={`Max log retention for ${embeddedBuilding.name}`}
                      >
                        {BOTTOM_PM2_LOG_RETENTION_OPTIONS.map((option) => (
                          <option key={option === null ? 'unlimited' : option} value={option === null ? 'unlimited' : String(option)}>
                            {option === null ? 'Unlimited' : `${option.toLocaleString()} lines`}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="flat-bottom-panel__close"
                        onClick={() => store.clearStreamingLogs(embeddedPanel.buildingId)}
                        title="Clear logs"
                      >
                        <Icon name="trash" size={12} />
                      </button>
                      <button
                        type="button"
                        className="flat-bottom-panel__close"
                        onClick={() => store.sendBuildingCommand(embeddedPanel.buildingId, 'restart')}
                        title="Restart"
                      >
                        <Icon name="restart" size={12} />
                      </button>
                    </>
                  )}
                  {canMaximize && (
                    <button
                      type="button"
                      className="flat-bottom-panel__close"
                      onClick={() => {
                        closeEmbeddedPanel();
                        expandBuilding(embeddedPanel.buildingId);
                      }}
                      title="Maximize — open as modal"
                      aria-label="Open as modal"
                    >
                      <Icon name="fullscreen" size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="flat-bottom-panel__close"
                    onClick={closeEmbeddedPanel}
                    title="Close panel"
                    aria-label="Close panel"
                  >
                    <Icon name="cross" size={12} />
                  </button>
                </span>
              </div>
              <div className="flat-bottom-panel__body">
                {panelType === 'terminal' ? (
                  embeddedBuilding.terminalStatus?.url ? (
                    <TerminalEmbed
                      terminalUrl={embeddedBuilding.terminalStatus.url}
                      visible={true}
                    />
                  ) : (
                    <div className="flat-bottom-panel__placeholder">Starting terminal...</div>
                  )
                ) : panelType === 'pm2-logs' ? (
                  <BottomPm2LogContent
                    buildingId={embeddedPanel.buildingId}
                    filterText={embeddedPm2Filter}
                    maxRetention={embeddedPm2Retention}
                  />
                ) : panelType === 'database' ? (
                  <DatabasePanelInline building={embeddedBuilding} />
                ) : panelType === 'tests' ? (
                  <div className="tests-panel-host">
                    <TestsBrowser building={embeddedBuilding} autoFocusSearch={false} />
                  </div>
                ) : (
                  <div className="http-requests-panel-host">
                    <HttpRequestsBrowser building={embeddedBuilding} autoFocusSearch={false} />
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}
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
            title={`Open in file explorer: ${cwd}`}
            aria-label={`Open ${cwd} in file explorer`}
            role="button"
            tabIndex={0}
            onClick={() => store.openFileExplorer(cwd)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                store.openFileExplorer(cwd);
              }
            }}
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
        <PlanLimitsTooltip
          agentId={agentId}
          disabled={
            (agent?.provider ?? 'claude') !== 'claude' &&
            (agent?.provider ?? 'claude') !== 'grok'
          }
          contextSummary={
            contextHasData
              ? `Context: ${contextUsedK}k / ${contextLimitK}k tokens (${contextUsedPercentDisplay}% used)`
              : undefined
          }
        >
          <span
            className="flat-terminal-wrapper__context"
            tabIndex={0}
            role="button"
            onClick={() => store.setContextModalAgentId(agentId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                store.setContextModalAgentId(agentId);
              }
            }}
            // Native title only for providers without plan-limits tooltip
            // (Claude/Grok get the richer PlanLimitsTooltip instead).
            title={
              (agent?.provider ?? 'claude') !== 'claude' &&
              (agent?.provider ?? 'claude') !== 'grok'
                ? (contextHasData
                    ? `Context usage: ${contextUsedK}k / ${contextLimitK}k tokens (${contextUsedPercentDisplay}% used). Click to view stats.`
                    : 'Click to fetch context stats')
                : undefined
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
            <span className="flat-terminal-wrapper__context-free">({contextFreePercentDisplay}% free)</span>
            {!contextHasData && (
              <span className="flat-terminal-wrapper__context-warning" title="No context stats yet">
                <Icon name="warn" size={12} />
              </span>
            )}
          </span>
        </PlanLimitsTooltip>
        <div className="flat-terminal-wrapper__statusbar-spacer" aria-hidden="true" />
        {/* Area-scoped building shortcuts — mirrors the Guake statusbar so the
            user can jump into a terminal/PM2 logs/database from any view. */}
        {areaTerminalBuildings.length > 0 && (
          <span className="flat-terminal-wrapper__buildings" role="group" aria-label="Area terminals">
            {areaTerminalBuildings.map((tb) => {
              const isActive = embeddedPanel?.buildingId === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  className={`flat-terminal-wrapper__building-btn ${isActive ? 'flat-terminal-wrapper__building-btn--active' : ''} ${!tb.hasUrl ? 'flat-terminal-wrapper__building-btn--offline' : ''}`}
                  title={`${isActive ? 'Hide' : 'Show'} terminal: ${tb.name}${!tb.hasUrl ? ' (starting...)' : ''}`}
                  onClick={() => {
                    if (isActive) {
                      closeEmbeddedPanel();
                      return;
                    }
                    if (tb.hasUrl && getBuildingViewMode(tb.id) === 'modal') {
                      expandBuilding(tb.id);
                      return;
                    }
                    if (!tb.hasUrl) store.sendBuildingCommand(tb.id, 'start');
                    toggleEmbeddedPanel('terminal', tb.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onBuildingContextMenu(tb.id, { x: e.clientX, y: e.clientY });
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
            {areaPm2Buildings.map((sb) => {
              const isActive = embeddedPanel?.buildingId === sb.id;
              return (
                <button
                  key={sb.id}
                  type="button"
                  className={`flat-terminal-wrapper__building-btn ${isActive ? 'flat-terminal-wrapper__building-btn--active' : ''}`}
                  title={`${isActive ? 'Hide' : 'Show'} logs: ${sb.name}`}
                  onClick={() => {
                    if (isActive) {
                      closeEmbeddedPanel();
                    } else if (getBuildingViewMode(sb.id) === 'modal') {
                      expandBuilding(sb.id);
                    } else {
                      toggleEmbeddedPanel('pm2-logs', sb.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onBuildingContextMenu(sb.id, { x: e.clientX, y: e.clientY });
                  }}
                >
                  <Icon name="scroll" size={14} />
                </button>
              );
            })}
          </span>
        )}
        {areaDatabaseBuildings.length > 0 && (
          <span className="flat-terminal-wrapper__buildings" role="group" aria-label="Area databases">
            {areaDatabaseBuildings.map((db) => {
              const isActive = embeddedPanel?.buildingId === db.id;
              return (
                <button
                  key={db.id}
                  type="button"
                  className={`flat-terminal-wrapper__building-btn ${isActive ? 'flat-terminal-wrapper__building-btn--active' : ''}`}
                  title={`${isActive ? 'Hide' : 'Show'} database: ${db.name}`}
                  onClick={() => {
                    if (isActive) {
                      closeEmbeddedPanel();
                    } else if (getBuildingViewMode(db.id) === 'modal') {
                      expandBuilding(db.id);
                    } else {
                      toggleEmbeddedPanel('database', db.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onBuildingContextMenu(db.id, { x: e.clientX, y: e.clientY });
                  }}
                >
                  <Icon name="hard-drives" size={14} />
                </button>
              );
            })}
          </span>
        )}
        {areaTestsBuildings.length > 0 && (
          <span className="flat-terminal-wrapper__buildings" role="group" aria-label="Area tests">
            {areaTestsBuildings.map((tb) => {
              const isActive = embeddedPanel?.buildingId === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  className={`flat-terminal-wrapper__building-btn ${isActive ? 'flat-terminal-wrapper__building-btn--active' : ''} ${tb.working ? 'flat-terminal-wrapper__building-btn--tests-working' : ''}`}
                  title={tb.working ? `Running tests: ${tb.name}` : `${isActive ? 'Hide' : 'Show'} tests: ${tb.name}`}
                  onClick={() => {
                    if (isActive) {
                      closeEmbeddedPanel();
                    } else if (getBuildingViewMode(tb.id) === 'modal') {
                      expandBuilding(tb.id);
                    } else {
                      toggleEmbeddedPanel('tests', tb.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onBuildingContextMenu(tb.id, { x: e.clientX, y: e.clientY });
                  }}
                >
                  <Icon name="flask" size={14} />
                </button>
              );
            })}
          </span>
        )}
        {areaHttpBuildings.length > 0 && (
          <span className="flat-terminal-wrapper__buildings" role="group" aria-label="Area HTTP requests">
            {areaHttpBuildings.map((hb) => {
              const isActive = embeddedPanel?.buildingId === hb.id;
              return (
                <button
                  key={hb.id}
                  type="button"
                  className={`flat-terminal-wrapper__building-btn ${isActive ? 'flat-terminal-wrapper__building-btn--active' : ''}`}
                  title={`${isActive ? 'Hide' : 'Show'} HTTP requests: ${hb.name}`}
                  onClick={() => {
                    if (isActive) {
                      closeEmbeddedPanel();
                    } else if (getBuildingViewMode(hb.id) === 'modal') {
                      expandBuilding(hb.id);
                    } else {
                      toggleEmbeddedPanel('http', hb.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onBuildingContextMenu(hb.id, { x: e.clientX, y: e.clientY });
                  }}
                >
                  <Icon name="globe" size={14} />
                </button>
              );
            })}
          </span>
        )}
        <div className="flat-terminal-wrapper__theme">
          <ThemeSelector />
        </div>
      </div>
      {/* Side panels — reuse the same GuakeGitPanel / AreaBuildingsPanel the
          3D view uses, so the feature set stays aligned. They position
          absolutely against the .flat-terminal-wrapper (position: relative).
          The git panel renders its own resize handle (glued to its left edge)
          via onResizeStart, so it can't detach from the panel in this layout. */}
      {gitPanelOpen && (
        <GuakeGitPanel
          agentId={agentId}
          agents={agentsMap}
          onClose={closeGitPanel}
          branchInfoMap={areaBranches}
          fetchRemote={fetchGitRemote}
          fetchingDirs={gitFetchingDirs}
          onResizeStart={(e) => handleSidePanelResizeStart(e, 'right')}
        />
      )}
      {buildingsPanelOpen && (
        <AreaBuildingsPanel
          agentId={agentId}
          onClose={closeBuildingsPanel}
        />
      )}
      {debugPanelOpen && (
        <AgentDebugPanel agentId={agentId} onClose={closeDebugPanel} />
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

// Stable empty result for the emptyChatGroups memo while a chat is open — the
// empty-state map isn't rendered then, so the grouping work can be skipped.
const EMPTY_FLAT_MAP_GROUPS: {
  groups: { area: DrawingArea; agents: Agent[]; buildings: Building[] }[];
  gridCols: number;
  gridRows: number;
  positions: Map<string, { row: number; col: number }>;
} = { groups: [], gridCols: 1, gridRows: 1, positions: new Map() };

export function FlatView({
  onAgentClick,
  onBuildingClick,
  onBuildingDoubleClick,
  onBuildingPopup,
  onAreaContextMenu,
  onOpenSpawnModal,
  onOpenBossSpawnModal,
  onOpenAreaModal,
}: FlatViewProps) {
  const { t } = useTranslation(['common']);
  const agents = useAgentsArray();
  const selectedAgentIds = useSelectedAgentIds();

  // Modal state for terminal integration (owned by parent, shown over everything)
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  const [bashModal, setBashModal] = useState<BashModalState | null>(null);
  const [responseModalContent, setResponseModalContent] = useState<string | null>(null);

  // Register the image modal on the shared modal stack so ESC (handled globally
  // in useKeyboardShortcuts → closeTopModal) closes it, matching AgentPanel.
  useModalStackRegistration('flatview-image-modal', imageModal !== null, () => setImageModal(null));
  // Clear-subordinates confirmation modal — reuses the same modal component
  // the 3D overlay uses, so the two views share one source of truth for the
  // destructive action's UX.
  const [clearSubsModal, setClearSubsModal] = useState<{ agentId: string; count: number } | null>(null);
  // Right-click menu on agent chips in the empty-state overview (no selected agent).
  const [emptyAgentContextMenu, setEmptyAgentContextMenu] = useState<{
    agentId: string;
    position: { x: number; y: number };
  } | null>(null);
  // Right-click menu on building chips in the empty-state overview. Mirrors the
  // AreaBuildingsPanel actions (open / start-stop / edit / clone / delete).
  const [buildingContextMenu, setBuildingContextMenu] = useState<{
    buildingId: string;
    position: { x: number; y: number };
  } | null>(null);
  // Remove-agent confirmation modal — replaces the native window.confirm() the
  // delete action used to trigger so the dialog matches the rest of the app.
  const [removeAgentConfirm, setRemoveAgentConfirm] = useState<{
    agentId: string;
    name: string;
  } | null>(null);
  // Agent info modal — opened by clicking the agent avatar/name in the chat
  // header, mirroring the Guake terminal's guake-title-btn behavior.
  const [agentInfoOpen, setAgentInfoOpen] = useState(false);
  const handleToggleAgentInfo = useCallback(() => {
    setAgentInfoOpen((prev) => !prev);
  }, []);
  const handleCloseAgentInfo = useCallback(() => {
    setAgentInfoOpen(false);
  }, []);

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

  // Mobile-only: agents column renders as a slide-in drawer. The toggle
  // button is only visible below the CSS mobile breakpoint, but the state
  // lives here so the drawer can be closed programmatically (e.g. after an
  // agent is tapped from inside it).
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const toggleMobileSidebar = useCallback(() => setMobileSidebarOpen(prev => !prev), []);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('tide-flat-agents-drawer-state', { detail: { open: mobileSidebarOpen } }));
  }, [mobileSidebarOpen]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('tide-flat-inspector-state', { detail: { open: inspectorOpen } }));
  }, [inspectorOpen]);

  useEffect(() => {
    const onToggleAgents = () => setMobileSidebarOpen((prev) => !prev);
    const onToggleInspectorEvt = () => {
      setInspectorOpen((prev) => {
        const next = !prev;
        setStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, next);
        return next;
      });
    };
    const onCloseSideViews = () => {
      setMobileSidebarOpen(false);
      setInspectorOpen(false);
      setStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, false);
    };
    const onCloseAgentsDrawerOnly = () => setMobileSidebarOpen(false);
    const onCloseInspectorOnly = () => {
      setInspectorOpen(false);
      setStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, false);
    };
    window.addEventListener('tide-toggle-flat-agents-drawer', onToggleAgents);
    window.addEventListener('tide-toggle-flat-inspector', onToggleInspectorEvt);
    window.addEventListener('tide-close-flat-side-views', onCloseSideViews);
    window.addEventListener('tide-close-flat-agents-drawer-only', onCloseAgentsDrawerOnly);
    window.addEventListener('tide-close-flat-inspector-only', onCloseInspectorOnly);
    return () => {
      window.removeEventListener('tide-toggle-flat-agents-drawer', onToggleAgents);
      window.removeEventListener('tide-toggle-flat-inspector', onToggleInspectorEvt);
      window.removeEventListener('tide-close-flat-side-views', onCloseSideViews);
      window.removeEventListener('tide-close-flat-agents-drawer-only', onCloseAgentsDrawerOnly);
      window.removeEventListener('tide-close-flat-inspector-only', onCloseInspectorOnly);
    };
  }, []);

  // Desktop/tablet: user-resizable widths for the .flat-middle (agents) and
  // .flat-inspector (right-side details) columns. `null` = use the responsive
  // CSS default; a number is a pixel override applied via a CSS custom
  // property inline on .flat-view so media queries for mobile still win.
  const flatViewRef = useRef<HTMLDivElement>(null);
  const splitterDragRef = useRef<{
    kind: 'middle' | 'inspector';
    startX: number;
    startWidth: number;
    pointerId: number;
  } | null>(null);
  const [middleWidth, setMiddleWidth] = useState<number | null>(() => {
    const saved = getStorageNumber(STORAGE_KEYS.FLAT_MIDDLE_WIDTH, 0);
    return saved >= FLAT_AGENTS_MIN_WIDTH ? saved : null;
  });
  const [inspectorWidth, setInspectorWidth] = useState<number | null>(() => {
    const saved = getStorageNumber(STORAGE_KEYS.FLAT_INSPECTOR_WIDTH, 0);
    return saved >= FLAT_INSPECTOR_MIN_WIDTH ? saved : null;
  });

  // Clamp helpers — the max for each column depends on the other columns'
  // current widths so neither can push the chat column below its min.
  const clampMiddleWidth = useCallback((w: number): number => {
    if (typeof window === 'undefined') return w;
    const inspectorCost =
      inspectorWidth !== null ? FLAT_SPLITTER_WIDTH + inspectorWidth : 0;
    const maxWidth =
      window.innerWidth - FLAT_LEFT_GUTTER - FLAT_SPLITTER_WIDTH - FLAT_RIGHT_MIN_WIDTH - inspectorCost;
    return Math.max(FLAT_AGENTS_MIN_WIDTH, Math.min(Math.max(maxWidth, FLAT_AGENTS_MIN_WIDTH), w));
  }, [inspectorWidth]);

  const clampInspectorWidth = useCallback((w: number): number => {
    if (typeof window === 'undefined') return w;
    const middle = flatViewRef.current?.querySelector<HTMLElement>('.flat-middle');
    const middleActual = middle?.getBoundingClientRect().width ?? FLAT_AGENTS_MIN_WIDTH;
    const maxWidth =
      window.innerWidth - FLAT_LEFT_GUTTER - middleActual - FLAT_SPLITTER_WIDTH - FLAT_RIGHT_MIN_WIDTH - FLAT_SPLITTER_WIDTH;
    return Math.max(FLAT_INSPECTOR_MIN_WIDTH, Math.min(Math.max(maxWidth, FLAT_INSPECTOR_MIN_WIDTH), w));
  }, []);

  // Re-clamp persisted widths if the viewport gets smaller (e.g. window
  // resize). Without this, stored values that no longer fit could hide the
  // chat column entirely.
  useEffect(() => {
    if (middleWidth === null && inspectorWidth === null) return;
    const onResize = () => {
      setMiddleWidth(prev => {
        if (prev === null) return prev;
        const clamped = clampMiddleWidth(prev);
        return clamped === prev ? prev : clamped;
      });
      setInspectorWidth(prev => {
        if (prev === null) return prev;
        const clamped = clampInspectorWidth(prev);
        return clamped === prev ? prev : clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [middleWidth, inspectorWidth, clampMiddleWidth, clampInspectorWidth]);

  const handleMiddleSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const middle = flatViewRef.current?.querySelector<HTMLElement>('.flat-middle');
    if (!middle) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    splitterDragRef.current = {
      kind: 'middle',
      startX: e.clientX,
      startWidth: middle.getBoundingClientRect().width,
      pointerId: e.pointerId,
    };
    document.body.classList.add('flat-splitter-dragging');
  }, []);

  const handleInspectorSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const inspector = flatViewRef.current?.querySelector<HTMLElement>('.flat-inspector');
    if (!inspector) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    splitterDragRef.current = {
      kind: 'inspector',
      startX: e.clientX,
      startWidth: inspector.getBoundingClientRect().width,
      pointerId: e.pointerId,
    };
    document.body.classList.add('flat-splitter-dragging');
  }, []);

  const handleSplitterPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = splitterDragRef.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const deltaX = e.clientX - state.startX;
    if (state.kind === 'middle') {
      setMiddleWidth(clampMiddleWidth(state.startWidth + deltaX));
    } else {
      // Inspector sits at the right edge — dragging its handle LEFT (negative
      // deltaX) widens it, dragging RIGHT narrows it.
      setInspectorWidth(clampInspectorWidth(state.startWidth - deltaX));
    }
  }, [clampMiddleWidth, clampInspectorWidth]);

  const handleSplitterPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = splitterDragRef.current;
    if (!state || e.pointerId !== state.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    splitterDragRef.current = null;
    document.body.classList.remove('flat-splitter-dragging');
    // Skip persistence for a pure click with no drag — the user is probably
    // double-clicking to reset, and a stray persist-on-pointerup would
    // overwrite the reset's "0" between the 2nd click and the dblclick event.
    const moved = Math.abs(e.clientX - state.startX) > 2;
    if (!moved) return;
    // Compute the final width from the same delta math as pointermove so we
    // can write storage directly (no setState updater side effect).
    const deltaX = e.clientX - state.startX;
    if (state.kind === 'middle') {
      const final = clampMiddleWidth(state.startWidth + deltaX);
      setMiddleWidth(final);
      setStorageNumber(STORAGE_KEYS.FLAT_MIDDLE_WIDTH, final);
    } else {
      const final = clampInspectorWidth(state.startWidth - deltaX);
      setInspectorWidth(final);
      setStorageNumber(STORAGE_KEYS.FLAT_INSPECTOR_WIDTH, final);
    }
  }, [clampMiddleWidth, clampInspectorWidth]);

  const handleMiddleSplitterDoubleClick = useCallback(() => {
    setMiddleWidth(null);
    setStorageNumber(STORAGE_KEYS.FLAT_MIDDLE_WIDTH, 0);
  }, []);

  const handleInspectorSplitterDoubleClick = useCallback(() => {
    setInspectorWidth(null);
    setStorageNumber(STORAGE_KEYS.FLAT_INSPECTOR_WIDTH, 0);
  }, []);

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

  // Current-task banner click-through: open the inspector on its Tracking tab
  // (the Flat view's equivalent of the guake terminal's TrackingBoard toggle).
  const handleShowTaskBoard = useCallback(() => {
    setInspectorView('tracking');
    setInspectorOpen(true);
    setStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, true);
  }, [setInspectorView]);

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
    // Reuse the global file-viewer flow from the store. Resolve relative paths
    // against the CWD of the agent whose chat is open (ChatView is scoped to the
    // selected agent) so a path like `tide-api/src/api-core.js` anchors at that
    // agent's repo — NOT the commander's process.cwd(), which is the wrong base
    // and produced the "Tried N candidate locations" miss.
    const ownerId = selectedAgentIds.size > 0 ? Array.from(selectedAgentIds)[0] : null;
    const cwd = ownerId ? store.getState().agents.get(ownerId)?.cwd : undefined;
    store.setFileViewerPath(path, editData, cwd);
  }, [selectedAgentIds]);

  const handleViewMarkdown = useCallback((content: string) => {
    setResponseModalContent(content);
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

  // Stable context-menu handlers for ChatView — inline lambdas here would be
  // the only unstable props and would defeat its React.memo on every render.
  const handleHeaderContextMenu = useCallback((position: { x: number; y: number }) => {
    if (!selectedAgentId) return;
    setEmptyAgentContextMenu({ agentId: selectedAgentId, position });
  }, [selectedAgentId]);

  const handleBuildingContextMenuOpen = useCallback((buildingId: string, position: { x: number; y: number }) => {
    setBuildingContextMenu({ buildingId, position });
  }, []);

  // Close the agent-info modal whenever the selected agent changes so it
  // doesn't linger on top of a different agent's chat.
  useEffect(() => {
    setAgentInfoOpen(false);
  }, [selectedAgentId]);

  // Agent history navigation — mirrors GuakeOutputPanel agent history so Flat
  // view users get the same browser-style back/forward through selected agents.
  const agentNavigationHistoryRef = useRef<string[]>([]);
  const agentNavigationIndexRef = useRef(-1);
  const isHistoryNavigationRef = useRef(false);
  // Tracks the most recently opened agent independently of navigation history
  // so Space/Backspace (and the mobile bottom-nav button) can reopen it even
  // after history is cleared. Seeded from storage so it survives a reload.
  const lastOpenedAgentIdRef = useRef<string | null>(
    getStorageString(STORAGE_KEYS.LAST_OPENED_AGENT, '') || null
  );
  const [canNavigateBack, setCanNavigateBack] = useState(false);
  const [canNavigateForward, setCanNavigateForward] = useState(false);

  // Browser history integration so Alt+Left/Right (and trackpad swipe → popstate
  // and any other browser-driven back/forward) cycles selected agents the same
  // way the prev/next buttons do. Mirrors ClaudeOutputPanel's __guakeAgentNav
  // pattern; uses a distinct __flatAgentNav marker so the two coexist.
  const browserHistoryInitializedRef = useRef(false);
  const lastBrowserHistoryAgentIdRef = useRef<string | null>(null);
  const isBrowserPopNavigationRef = useRef(false);

  const agentIdSet = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);

  // Resolve subordinate Agent objects per boss for the SubordinateProgressDots indicator on the FlatView map.
  const subordinatesByBoss = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const map = new Map<string, Agent[]>();
    for (const agent of agents) {
      if ((agent.isBoss || agent.class === 'boss') && agent.subordinateIds && agent.subordinateIds.length > 0) {
        const subs = agent.subordinateIds
          .map((id) => byId.get(id))
          .filter((a): a is Agent => a !== undefined);
        if (subs.length > 0) map.set(agent.id, subs);
      }
    }
    return map;
  }, [agents]);

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

  // Android system back gesture (Capacitor APK) routes through the same
  // prev-agent stack the FlatView toolbar's Back button uses. When there's
  // no previous agent in the stack, fall back to App.exitApp() so the OS
  // closes the app like users expect. No-op on web. Forward gestures aren't
  // exposed by Android, so only back is wired.
  useAndroidBackButton(useCallback(() => {
    const history = agentNavigationHistoryRef.current;
    const index = agentNavigationIndexRef.current;
    if (history.length > 0 && index > 0) {
      navigateAgentHistory(-1);
      return 'handled';
    }
    return 'exit';
  }, [navigateAgentHistory]));

  const setFlatBrowserHistoryState = useCallback((agentId: string, mode: 'push' | 'replace') => {
    if (typeof window === 'undefined') return;
    const currentState = window.history.state;
    const baseState = typeof currentState === 'object' && currentState !== null ? currentState : {};
    const nextState = {
      ...baseState,
      __flatAgentNav: { agentId },
    };
    if (mode === 'replace') {
      window.history.replaceState(nextState, '', window.location.href);
    } else {
      window.history.pushState(nextState, '', window.location.href);
    }
  }, []);

  // Push (or replace on first init) a browser-history entry every time the
  // selected agent changes — except when the change itself was triggered by
  // a browser pop, in which case the entry already exists.
  useEffect(() => {
    if (!selectedAgentId) {
      browserHistoryInitializedRef.current = false;
      lastBrowserHistoryAgentIdRef.current = null;
      return;
    }

    if (!browserHistoryInitializedRef.current) {
      setFlatBrowserHistoryState(selectedAgentId, 'replace');
      browserHistoryInitializedRef.current = true;
      lastBrowserHistoryAgentIdRef.current = selectedAgentId;
      return;
    }

    if (isBrowserPopNavigationRef.current) {
      isBrowserPopNavigationRef.current = false;
      lastBrowserHistoryAgentIdRef.current = selectedAgentId;
      return;
    }

    if (lastBrowserHistoryAgentIdRef.current === selectedAgentId) return;

    setFlatBrowserHistoryState(selectedAgentId, 'push');
    lastBrowserHistoryAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId, setFlatBrowserHistoryState]);

  // Browser back/forward (Alt+Left/Right, trackpad swipe, mouse side buttons
  // routed through the browser) — listener is installed on FlatView mount and
  // torn down on unmount so it can't leak into other views.
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const targetAgentId = event.state?.__flatAgentNav?.agentId;
      if (!targetAgentId || typeof targetAgentId !== 'string') return;
      if (!agentIdSet.has(targetAgentId)) return;
      if (targetAgentId === selectedAgentId) return;

      isBrowserPopNavigationRef.current = true;
      isHistoryNavigationRef.current = true;

      const history = agentNavigationHistoryRef.current;
      const foundIndex = history.lastIndexOf(targetAgentId);
      if (foundIndex >= 0) {
        agentNavigationIndexRef.current = foundIndex;
      } else {
        history.push(targetAgentId);
        agentNavigationIndexRef.current = history.length - 1;
      }
      updateAgentNavigationAvailability();
      store.selectAgent(targetAgentId);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [agentIdSet, selectedAgentId, updateAgentNavigationAvailability]);

  useEffect(() => {
    if (!selectedAgentId) {
      agentNavigationHistoryRef.current = [];
      agentNavigationIndexRef.current = -1;
      updateAgentNavigationAvailability();
      return;
    }

    // Remember this agent as the last explicitly opened one so Space/Backspace
    // (and the mobile bottom-nav "Last agent" button) can reopen it later when
    // no agent is selected. Persisted so it also survives an app reload.
    lastOpenedAgentIdRef.current = selectedAgentId;
    setStorageString(STORAGE_KEYS.LAST_OPENED_AGENT, selectedAgentId);

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
      // Auto-close the mobile drawer when an agent is picked so the user
      // lands straight in the chat without an extra dismiss tap.
      setMobileSidebarOpen(false);
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

  const showInspector = inspectorOpen;

  const [inspectorMounted, setInspectorMounted] = useState(showInspector);
  const [inspectorAnimateOpen, setInspectorAnimateOpen] = useState(showInspector);

  useEffect(() => {
    if (showInspector) {
      setInspectorMounted(true);
      return;
    }
    setInspectorAnimateOpen(false);
    const timer = setTimeout(() => setInspectorMounted(false), 240);
    return () => clearTimeout(timer);
  }, [showInspector]);

  useEffect(() => {
    if (!inspectorMounted || !showInspector) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setInspectorAnimateOpen(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [inspectorMounted, showInspector]);

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

  // ── Expanded areas state (lifted so empty-chat overview can expand them) ──
  // Only areas in this set render expanded, so every page load starts with
  // all areas collapsed.
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const handleToggleArea = useCallback((areaKey: string) => {
    setExpandedAreas(prev => {
      const next = new Set(prev);
      if (next.has(areaKey)) next.delete(areaKey);
      else next.add(areaKey);
      return next;
    });
  }, []);
  const handleSetExpandedAreas = useCallback((areaKeys: string[]) => {
    setExpandedAreas(new Set(areaKeys));
  }, []);

  // ── Mobile flat-map: areas collapse to readable two-column browse cards;
  // tapping a header expands that area to full width to reveal its contents.
  // Single-selection — only one area is expanded at a time, so tapping a
  // different area collapses the previous one. `null` means everything is
  // collapsed. Desktop continues to use the exact spatial map positions.
  const [isFlatMobile, setIsFlatMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsFlatMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [mobileExpandedAreaId, setMobileExpandedAreaId] = useState<string | null>(null);
  const handleMobileToggleArea = useCallback((areaKey: string) => {
    setMobileExpandedAreaId(prev => prev === areaKey ? null : areaKey);
  }, []);

  // ── Compact area/agent data for the empty-chat state ──
  const areas = useAreas();
  const buildingsMap = useBuildings();
  const [activeWorkspace] = useWorkspaceFilter();
  const emptyChatGroups = useMemo(() => {
    // Only consumed by the empty-chat map (and handleFocusArea, which is only
    // reachable from it) — skip the O(agents×areas + buildings×areas) work
    // while a chat is open.
    if (selectedAgentId) return EMPTY_FLAT_MAP_GROUPS;

    const agentsByAreaId = new Map<string, typeof agents>();
    const unassigned: typeof agents = [];
    for (const agent of agents) {
      const area = store.getAreaForAgent(agent.id);
      // Workspace filter: hide agents whose area isn't part of the active
      // workspace (and unassigned agents while a workspace is active).
      if (!isAgentVisibleInWorkspace(area?.id ?? null)) continue;
      if (!area || area.archived) {
        unassigned.push(agent);
        continue;
      }
      const list = agentsByAreaId.get(area.id);
      if (list) list.push(agent);
      else agentsByAreaId.set(area.id, [agent]);
    }

    // Bucket buildings by area using the same point-in-area test the 3D scene
    // uses, so a building shows up in the area card whose footprint contains
    // its world position.
    const buildingsByAreaId = new Map<string, Building[]>();
    const unassignedBuildings: Building[] = [];
    for (const building of buildingsMap.values()) {
      let matched = false;
      for (const area of areas.values()) {
        if (area.archived) continue;
        if (!isAreaVisibleInWorkspace(area.id)) continue;
        if (store.isPositionInArea(building.position, area)) {
          const list = buildingsByAreaId.get(area.id);
          if (list) list.push(building);
          else buildingsByAreaId.set(area.id, [building]);
          matched = true;
          break;
        }
      }
      if (!matched && isAgentVisibleInWorkspace(null)) {
        unassignedBuildings.push(building);
      }
    }

    const groups: { area: typeof areas extends Map<string, infer V> ? V : never; agents: typeof agents; buildings: Building[] }[] = [];
    for (const [, area] of areas) {
      if (area.archived) continue;
      // Workspace filter: skip areas that aren't part of the active workspace.
      if (!isAreaVisibleInWorkspace(area.id)) continue;
      const list = agentsByAreaId.get(area.id);
      const bList = buildingsByAreaId.get(area.id) ?? [];
      if ((list && list.length > 0) || bList.length > 0) {
        groups.push({ area, agents: list ?? [], buildings: bList });
      }
    }
    if (unassigned.length > 0 || unassignedBuildings.length > 0) {
      groups.push({
        area: { id: '__unassigned__', name: 'Unassigned', color: '#6272a4', center: { x: 0, z: 0 }, type: 'circle', radius: 0, directories: [], archived: false, assignedAgentIds: [], zIndex: 0 } as any,
        agents: unassigned,
        buildings: unassignedBuildings,
      });
    }

    const assignedGroups = groups.filter(g => g.area.id !== '__unassigned__');
    const unassignedGroups = groups.filter(g => g.area.id === '__unassigned__');

    // ── Compute a 2D grid that mirrors the actual scene layout ──
    let gridCols = 1;
    let gridRows = 1;
    const positions = new Map<string, { row: number; col: number }>();

    if (assignedGroups.length > 1) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const g of assignedGroups) {
        minX = Math.min(minX, g.area.center.x);
        maxX = Math.max(maxX, g.area.center.x);
        minZ = Math.min(minZ, g.area.center.z);
        maxZ = Math.max(maxZ, g.area.center.z);
      }
      const spanX = maxX - minX || 1;
      const spanZ = maxZ - minZ || 1;

      // For small numbers of areas, lay them out left-to-right in a single row
      // so the flat view column count matches the 2D scene more directly.
      if (assignedGroups.length <= 4) {
        gridCols = assignedGroups.length;
        gridRows = 1;
        const xSorted = [...assignedGroups].sort((a, b) => a.area.center.x - b.area.center.x);
        for (let i = 0; i < xSorted.length; i++) {
          positions.set(xSorted[i].area.id, { row: 1, col: i + 1 });
        }
      } else {
        // Detect natural columns from x-coordinate gaps
        const xSorted = [...assignedGroups].sort((a, b) => a.area.center.x - b.area.center.x);
        const xGaps: number[] = [];
        for (let i = 1; i < xSorted.length; i++) {
          xGaps.push(xSorted[i].area.center.x - xSorted[i - 1].area.center.x);
        }
        const meanXGap = xGaps.reduce((a, b) => a + b, 0) / xGaps.length || 1;
        let detectedCols = 1;
        for (const gap of xGaps) {
          if (gap > meanXGap * 1.3) detectedCols++;
        }
        gridCols = Math.max(2, Math.min(detectedCols, assignedGroups.length));

        // Detect natural rows from z-coordinate gaps
        const zSorted = [...assignedGroups].sort((a, b) => a.area.center.z - b.area.center.z);
        const zGaps: number[] = [];
        for (let i = 1; i < zSorted.length; i++) {
          zGaps.push(zSorted[i].area.center.z - zSorted[i - 1].area.center.z);
        }
        const meanZGap = zGaps.reduce((a, b) => a + b, 0) / zGaps.length || 1;
        let detectedRows = 1;
        for (const gap of zGaps) {
          if (gap > meanZGap * 1.3) detectedRows++;
        }
        gridRows = Math.max(2, Math.min(detectedRows, assignedGroups.length));

        // Make sure the grid is large enough to hold every area
        gridCols = Math.max(gridCols, Math.ceil(assignedGroups.length / gridRows));
        gridRows = Math.max(gridRows, Math.ceil(assignedGroups.length / gridCols));

        // Snap each area to its nearest grid cell
        const colWidth = spanX / gridCols;
        const rowHeight = spanZ / gridRows;
        const usedCells = new Set<string>();

        for (const g of assignedGroups) {
          let col = Math.min(gridCols - 1, Math.max(0, Math.floor((g.area.center.x - minX) / colWidth)));
          let row = Math.min(gridRows - 1, Math.max(0, Math.floor((g.area.center.z - minZ) / rowHeight)));
          // Resolve collisions: scan forward in reading order (right, then
          // wrap to the next row) until a free cell is found. The previous
          // implementation only shifted right within the same row, so when
          // the preferred column was already the last column, two areas
          // would silently land on the same {row,col} — and CSS grid would
          // stack the second card directly on top of the first, making the
          // agent chips inside the lower card appear to overlap with the
          // one on top.
          let cellKey = `${row},${col}`;
          let scanned = 0;
          const maxCells = gridRows * gridCols;
          while (usedCells.has(cellKey) && scanned < maxCells) {
            col++;
            if (col >= gridCols) {
              col = 0;
              row = (row + 1) % gridRows;
            }
            cellKey = `${row},${col}`;
            scanned++;
          }
          if (usedCells.has(cellKey)) {
            // Every existing cell is taken — append a new row so the card
            // still gets a unique slot instead of stacking on an occupied cell.
            row = gridRows;
            col = 0;
            cellKey = `${row},${col}`;
            gridRows++;
          }
          usedCells.add(cellKey);
          positions.set(g.area.id, { row: row + 1, col: col + 1 }); // CSS grid is 1-based
        }
      }
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

    // The flat map is a browse surface rather than a spatial projection of the
    // battlefield. Keep its reading order stable and predictable regardless of
    // where an area happens to be positioned in the 2D/3D scene.
    const alphabetizedGroups = [...assignedGroups, ...unassignedGroups].sort((a, b) =>
      a.area.name.localeCompare(b.area.name, undefined, { sensitivity: 'base', numeric: true })
        || a.area.id.localeCompare(b.area.id)
    );
    positions.clear();
    alphabetizedGroups.forEach((group, index) => {
      positions.set(group.area.id, {
        row: Math.floor(index / gridCols) + 1,
        col: (index % gridCols) + 1,
      });
    });
    gridRows = Math.max(1, Math.ceil(alphabetizedGroups.length / gridCols));

    return { groups: alphabetizedGroups, gridCols, gridRows, positions };
  }, [agents, areas, buildingsMap, activeWorkspace, selectedAgentId]);

  const emptyChatStats = useMemo(() => {
    let agentCount = 0;
    let workingCount = 0;
    for (const group of emptyChatGroups.groups) {
      agentCount += group.agents.length;
      workingCount += group.agents.filter(agent => agent.status === 'working').length;
    }
    return {
      areaCount: emptyChatGroups.groups.length,
      agentCount,
      workingCount,
    };
  }, [emptyChatGroups]);

  // Right-click menu actions for agent chips in the empty-state overview.
  // Mirrors the Edit Agent / Delete Agent actions wired in AgentOverviewPanel so
  // both surfaces share one UX for per-agent mutations.
  const emptyAgentContextMenuActions = useMemo((): ContextMenuAction[] => {
    if (!emptyAgentContextMenu) return [];
    const agent = agents.find(a => a.id === emptyAgentContextMenu.agentId);
    if (!agent) return [];
    return [
      {
        id: 'edit-agent',
        label: 'Edit Agent',
        icon: <Icon name="edit" size={14} />,
        onClick: () => {
          window.dispatchEvent(new CustomEvent('tide:open-agent-edit', { detail: { agentId: agent.id } }));
        },
      },
      {
        id: 'open-chat',
        label: 'Open Chat',
        icon: <Icon name="chat" size={14} />,
        onClick: () => onAgentClick(agent.id),
      },
      {
        id: 'clone-agent',
        label: 'Clone Agent',
        icon: <Icon name="clipboard" size={14} />,
        onClick: () => store.cloneAgent(agent.id),
      },
      {
        id: 'fork-agent',
        label: 'Fork Agent (with history)',
        icon: <Icon name="git-branch" size={14} />,
        onClick: () => store.forkAgent(agent.id),
      },
      {
        id: 'delete-agent',
        label: 'Delete Agent',
        icon: <Icon name="trash" size={14} />,
        danger: true,
        onClick: () => {
          setRemoveAgentConfirm({ agentId: agent.id, name: agent.name });
        },
      },
    ];
  }, [emptyAgentContextMenu, agents, onAgentClick]);

  // Right-click menu actions for building chips on the empty-state map. Mirrors
  // AreaBuildingsPanel so the two surfaces share one UX for per-building
  // mutations (start/stop/restart, edit, clone, delete, open URLs, etc).
  const buildingContextMenuActions = useMemo((): ContextMenuAction[] => {
    if (!buildingContextMenu) return [];
    const building = buildingsMap.get(buildingContextMenu.buildingId);
    if (!building) return [];

    const actions: ContextMenuAction[] = [];
    const isRunnable = building.type === 'server' || building.type === 'docker' || building.type === 'terminal';
    const isRunning = building.status === 'running';
    const isBoss = building.type === 'boss';

    actions.push({
      id: 'open',
      label: building.type === 'database' ? 'Open Database' :
             building.type === 'folder' ? 'Open Folder' :
             building.type === 'tests' ? 'Open Tests' :
             building.type === 'http' ? 'Open Requests' :
             building.type === 'boss' ? 'View Boss Logs' :
             building.type === 'terminal' ? 'Open Terminal' :
             (building.type === 'server' && building.pm2?.enabled) ? 'View PM2 Logs' :
             'Open',
      icon: <Icon name={building.type === 'database' ? 'database' :
            building.type === 'folder' ? 'folder' :
            building.type === 'tests' ? 'flask' :
            building.type === 'http' ? 'globe' :
            building.type === 'terminal' ? 'terminal' :
            'eye'} size={14} />,
      onClick: () => handleOpenBuilding(building.id),
    });

    if (isRunnable) {
      if (!isRunning) {
        actions.push({
          id: 'start',
          label: 'Start',
          icon: <Icon name="play" size={14} />,
          onClick: () => store.sendBuildingCommand(building.id, 'start'),
        });
      }
      if (isRunning) {
        actions.push({
          id: 'restart',
          label: 'Restart',
          icon: <Icon name="refresh" size={14} />,
          onClick: () => store.sendBuildingCommand(building.id, 'restart'),
        });
        actions.push({
          id: 'stop',
          label: 'Stop',
          icon: <Icon name="stop" size={14} />,
          onClick: () => store.sendBuildingCommand(building.id, 'stop'),
        });
      }
    }

    if (isBoss && building.subordinateBuildingIds && building.subordinateBuildingIds.length > 0) {
      actions.push({
        id: 'start-all',
        label: 'Start All Subordinates',
        icon: <Icon name="launch" size={14} />,
        onClick: () => {
          for (const subId of building.subordinateBuildingIds!) {
            store.sendBuildingCommand(subId, 'start');
          }
        },
      });
      actions.push({
        id: 'stop-all',
        label: 'Stop All Subordinates',
        icon: <Icon name="pause" size={14} />,
        onClick: () => {
          for (const subId of building.subordinateBuildingIds!) {
            store.sendBuildingCommand(subId, 'stop');
          }
        },
      });
      actions.push({
        id: 'restart-all',
        label: 'Restart All Subordinates',
        icon: <Icon name="restart" size={14} />,
        onClick: () => {
          for (const subId of building.subordinateBuildingIds!) {
            store.sendBuildingCommand(subId, 'restart');
          }
        },
      });
    }

    if (isRunnable) {
      actions.push({
        id: 'health-check',
        label: 'Health Check',
        icon: <Icon name="health" size={14} />,
        onClick: () => store.sendBuildingCommand(building.id, 'healthCheck'),
      });
    }

    actions.push({
      id: 'divider-edit',
      label: '',
      divider: true,
      onClick: () => {},
    });

    actions.push({
      id: 'edit',
      label: 'Edit Building',
      icon: <Icon name="edit" size={14} />,
      onClick: () => {
        window.dispatchEvent(new CustomEvent('tide:building-edit', { detail: { buildingId: building.id } }));
      },
    });

    actions.push({
      id: 'clone',
      label: 'Clone Building',
      icon: <Icon name="copy" size={14} />,
      onClick: () => {
        // Drop the clone next to the original so it stays in the same area.
        store.createBuilding({
          name: `${building.name} (Copy)`,
          type: building.type,
          style: building.style,
          color: building.color,
          scale: building.scale,
          position: { x: building.position.x + 2, z: building.position.z + 2 },
          cwd: building.cwd,
          folderPath: building.folderPath,
          commands: building.commands,
          pm2: building.pm2,
          docker: building.docker,
          database: building.database,
          terminal: building.terminal,
          urls: building.urls,
          subordinateBuildingIds: building.subordinateBuildingIds,
        });
      },
    });

    if (building.urls && building.urls.length > 0) {
      for (const link of building.urls) {
        actions.push({
          id: `url-${link.label}`,
          label: link.label,
          icon: <Icon name="link" size={14} />,
          onClick: () => window.open(link.url, '_blank', 'noopener,noreferrer'),
        });
      }
    }

    actions.push({
      id: 'divider-danger',
      label: '',
      divider: true,
      onClick: () => {},
    });

    actions.push({
      id: 'delete',
      label: 'Delete Building',
      icon: <Icon name="trash" size={14} />,
      danger: true,
      onClick: () => store.deleteBuilding(building.id),
    });

    return actions;
  }, [buildingContextMenu, buildingsMap, handleOpenBuilding]);

  // ── Focus an area in the left-panel AgentOverviewPanel ──
  const handleFocusArea = useCallback((areaKey: string) => {
    // 1. Expand only the clicked area (everything else collapses)
    setExpandedAreas(new Set([areaKey]));
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
  }, []);

  return (
    <div
      ref={flatViewRef}
      className={`flat-view ${showInspector ? 'flat-view--with-inspector' : ''} ${selectedAgentId ? 'flat-view--has-chat' : ''} ${mobileSidebarOpen ? 'flat-view--mobile-sidebar-open' : ''}`}
      style={(() => {
        if (middleWidth === null && inspectorWidth === null) return undefined;
        // Typed as a record so the custom CSS properties pass through the
        // React `style` narrowing.
        const s: Record<string, string> = {};
        if (middleWidth !== null) s['--flat-middle-width'] = `${middleWidth}px`;
        if (inspectorWidth !== null) s['--flat-inspector-width'] = `${inspectorWidth}px`;
        return s as React.CSSProperties;
      })()}
    >
      {/* Backdrop that captures taps outside the drawer to close it. Only
          rendered when the drawer is open. Hidden on desktop via CSS. */}
      {mobileSidebarOpen && (
        <div
          className="flat-mobile-sidebar-backdrop"
          onClick={closeMobileSidebar}
          aria-hidden="true"
        />
      )}
      {/* Middle Column - Agents overview. The former in-view SidebarMenu was
          removed because the floating left-side FAB menu (settings/spotlight/
          spawn buttons) already covers navigation. */}
      <div className="flat-middle">
        <div className="flat-middle__header">
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
            expandedAreas={expandedAreas}
            onToggleArea={handleToggleArea}
            onSetExpandedAreas={handleSetExpandedAreas}
            agentListRef={agentListRef}
          />
        </div>
      </div>

      {/* Draggable splitter between .flat-middle and .flat-right. Hidden on
          mobile by the `@media (max-width: 1024px)` block in FlatView.scss.
          Double-click to reset to the CSS default. */}
      <div
        className="flat-splitter flat-splitter--middle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize agents panel"
        title="Drag to resize · Double-click to reset"
        onPointerDown={handleMiddleSplitterPointerDown}
        onPointerMove={handleSplitterPointerMove}
        onPointerUp={handleSplitterPointerUp}
        onPointerCancel={handleSplitterPointerUp}
        onDoubleClick={handleMiddleSplitterDoubleClick}
      />

      {/* Right Column - Chat/Details */}
      <div className="flat-right">
        {/* Mobile-only: toggle button for the agents drawer. Rendered as the
            first child of flat-right so it docks above whatever content the
            right column shows (chat header, or flat-map empty state). Hidden
            on desktop via CSS. */}
        <button
          type="button"
          className="flat-mobile-sidebar-toggle"
          aria-label={mobileSidebarOpen ? 'Close agents sidebar' : 'Open agents sidebar'}
          aria-expanded={mobileSidebarOpen}
          onClick={toggleMobileSidebar}
        >
          <Icon name="list" size={18} />
          <span className="flat-mobile-sidebar-toggle__label">Agents</span>
        </button>
        {selectedAgentId ? (
          <ChatView
            agentId={selectedAgentId}
            terminalViewMode={terminalViewMode}
            onTerminalViewModeChange={handleTerminalViewModeChange}
            inspectorOpen={inspectorOpen}
            onToggleInspector={handleToggleInspector}
            onShowTaskBoard={handleShowTaskBoard}
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
            agentInfoOpen={agentInfoOpen}
            onToggleAgentInfo={handleToggleAgentInfo}
            onHeaderContextMenu={handleHeaderContextMenu}
            onBuildingContextMenu={handleBuildingContextMenuOpen}
          />
        ) : (
          <div className="flat-chat flat-chat--empty">
            <div className="flat-map">
              <div className="flat-map__header">
                <span className="flat-map__title">🗺️ Areas</span>
                <span className="flat-map__hint">Click an area to focus it, or an agent to chat</span>
                <span className="flat-map__stats">
                  <span>{emptyChatStats.areaCount} areas</span>
                  <span>{emptyChatStats.agentCount} agents</span>
                  {emptyChatStats.workingCount > 0 && (
                    <span className="flat-map__stats-working">
                      <span className="flat-map__stats-dot" aria-hidden="true" />
                      {emptyChatStats.workingCount} working
                    </span>
                  )}
                </span>
                <ViewModeToggle className="flat-map__view-mode" />
              </div>
              <div
                className="flat-map__grid"
                style={{
                  gridTemplateColumns: isFlatMobile
                    ? 'repeat(2, minmax(0, 1fr))'
                    : `repeat(${emptyChatGroups.gridCols}, 1fr)`,
                }}
              >
                {emptyChatGroups.groups.length === 0 ? (
                  <div className="flat-map__empty">
                    <span>No areas or agents yet</span>
                  </div>
                ) : (
                  (() => {
                    // Mobile keeps the map's broad spatial reading order, but
                    // removes empty scene cells so every card has enough room
                    // for its name and status. Desktop keeps exact positions.
                    const visibleGroups = isFlatMobile
                      ? [...emptyChatGroups.groups].sort((a, b) => {
                          const aPos = emptyChatGroups.positions.get(a.area.id);
                          const bPos = emptyChatGroups.positions.get(b.area.id);
                          if (!aPos && !bPos) return 0;
                          if (!aPos) return 1;
                          if (!bPos) return -1;
                          return aPos.row - bPos.row || aPos.col - bPos.col;
                        })
                      : emptyChatGroups.groups;
                    return visibleGroups.map(group => {
                    const areaKey = group.area.id;
                    const pos = emptyChatGroups.positions.get(areaKey);
                    const workingAgentCount = group.agents.filter(agent => agent.status === 'working').length;
                    const hasWorkingAgents = workingAgentCount > 0;
                    const isMobileCollapsed = isFlatMobile && mobileExpandedAreaId !== areaKey;
                    const isMobileExpanded = isFlatMobile && !isMobileCollapsed;
                    return (
                      <div
                        key={areaKey}
                        className={`flat-map-area-card${hasWorkingAgents ? ' flat-map-area-card--working' : ''}${isMobileCollapsed ? ' flat-map-area-card--collapsed' : ''}${isMobileExpanded ? ' flat-map-area-card--expanded' : ''}`}
                        style={{
                          '--area-color': group.area.color,
                          gridRow: isFlatMobile ? undefined : pos?.row,
                          gridColumn: isFlatMobile ? undefined : pos?.col,
                        } as React.CSSProperties}
                        onContextMenu={(e) => {
                          if (!onAreaContextMenu) return;
                          e.preventDefault();
                          e.stopPropagation();
                          onAreaContextMenu(areaKey, { x: e.clientX, y: e.clientY });
                        }}
                      >
                        <button
                          type="button"
                          className="flat-map-area-card__header"
                          onClick={() => isFlatMobile ? handleMobileToggleArea(areaKey) : handleFocusArea(areaKey)}
                          title={isFlatMobile
                            ? (isMobileCollapsed ? `Expand ${group.area.name}` : `Collapse ${group.area.name}`)
                            : `Focus ${group.area.name} in left panel`}
                          aria-expanded={isFlatMobile ? !isMobileCollapsed : undefined}
                        >
                          <span
                            className="flat-map-area-card__color"
                            style={{ background: group.area.color }}
                          />
                          {group.area.logo?.filename && (
                            <img
                              className="flat-map-area-card__logo"
                              src={getAreaLogoUrl(group.area.logo.filename)}
                              alt=""
                              aria-hidden="true"
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          )}
                          <span className="flat-map-area-card__name">{group.area.name}</span>
                          <span
                            className="flat-map-area-card__count"
                            title={`${group.agents.length} agent${group.agents.length === 1 ? '' : 's'}`}
                            aria-label={`${group.agents.length} agent${group.agents.length === 1 ? '' : 's'}`}
                          >
                            <Icon name="users" size={10} />
                            {group.agents.length}
                          </span>
                          {hasWorkingAgents && (
                            <span
                              className="flat-map-area-card__working"
                              title={`${workingAgentCount} working agent${workingAgentCount === 1 ? '' : 's'}`}
                              aria-label={`${workingAgentCount} working agent${workingAgentCount === 1 ? '' : 's'}`}
                            >
                              <span className="flat-map-area-card__working-bars" aria-hidden="true">
                                <i />
                                <i />
                                <i />
                              </span>
                              <span className="flat-map-area-card__working-count">{workingAgentCount}</span>
                            </span>
                          )}
                          {isFlatMobile && (
                            <Icon
                              name={isMobileCollapsed ? 'caret-down' : 'caret-up'}
                              size={11}
                              className="flat-map-area-card__caret"
                            />
                          )}
                        </button>
                        <div className="flat-map-area-card__agents">
                          {group.agents.map(agent => {
                            const isBoss = agent.isBoss || agent.class === 'boss';
                            const subs = isBoss ? subordinatesByBoss.get(agent.id) : undefined;
                            const ctx = getDisplayContextInfo(agent);
                            const ctxColor =
                              ctx.usedPercent >= 80 ? '#ff4a4a'
                                : ctx.usedPercent >= 60 ? '#ff9e4a'
                                  : ctx.usedPercent >= 40 ? '#ffd700'
                                    : '#4aff9e';
                            const ctxTitle = `Context: ${(ctx.totalTokens / 1000).toFixed(1)}k / ${(ctx.contextWindow / 1000).toFixed(1)}k (${ctx.usedPercent}% used, ${ctx.freePercent}% free)`;
                            const hasHoverContent = (agent.latestTodos && agent.latestTodos.length > 0) || (subs && subs.length > 0);
                            return (
                              <AgentHoverTooltip
                                key={agent.id}
                                todos={agent.latestTodos}
                                subordinates={subs}
                                position="top"
                              >
                              <button
                                type="button"
                                className={`flat-map-agent-chip ${agent.status}`}
                                onClick={() => onAgentClick(agent.id)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEmptyAgentContextMenu({
                                    agentId: agent.id,
                                    position: { x: e.clientX, y: e.clientY },
                                  });
                                }}
                                title={hasHoverContent ? undefined : `${isBoss ? 'Boss · ' : ''}Open chat with ${agent.name}\n${ctxTitle}`}
                              >
                                <AgentIcon agent={agent} size={16} />
                                {isBoss && (
                                  <span className="flat-map-agent-chip__crown" aria-hidden="true">
                                    <Icon name="crown" size={11} color="#ffd700" weight="fill" />
                                  </span>
                                )}
                                <span className="flat-map-agent-chip__name">{agent.name}</span>
                                <img
                                  src={providerAssetUrl(agent.provider, import.meta.env.BASE_URL)}
                                  alt={agent.provider}
                                  className="flat-map-agent-chip__provider-icon"
                                  title={providerAgentTitle(agent.provider)}
                                />
                                <span
                                  className="flat-map-agent-chip__dot"
                                  style={{ backgroundColor: getAgentStatusColor(agent.status) }}
                                />
                                {agent.latestTodos && agent.latestTodos.length > 0 && (
                                  <TaskProgressDots todos={agent.latestTodos} maxDots={6} />
                                )}
                                {isBoss && subs && subs.length > 0 && (
                                  <SubordinateProgressDots subordinates={subs} maxDots={6} />
                                )}
                                <span
                                  className="flat-map-agent-chip__context-bar"
                                  aria-hidden="true"
                                >
                                  <span
                                    className="flat-map-agent-chip__context-bar-fill"
                                    style={{ width: `${ctx.usedPercent}%`, backgroundColor: ctxColor }}
                                  />
                                </span>
                              </button>
                              </AgentHoverTooltip>
                            );
                          })}
                        </div>
                        {group.area.directories.length > 0 && (
                          <div className="flat-map-area-card__folders" role="group" aria-label={`${group.area.name} folders`}>
                            {group.area.directories.map(dir => {
                              const dirLabel = dir.split('/').filter(Boolean).pop() || dir;
                              return (
                                <button
                                  key={dir}
                                  type="button"
                                  className="flat-map-folder-chip"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    store.openFileExplorerForAreaFolder(areaKey, dir);
                                  }}
                                  title={`Open in file explorer: ${dir}`}
                                >
                                  <Icon name="folder-open" size={12} />
                                  <span className="flat-map-folder-chip__name">{dirLabel}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {group.buildings.length > 0 && (
                          <div className="flat-map-area-card__buildings">
                            {group.buildings.map(building => {
                              const typeColor = BUILDING_TYPES[building.type]?.color;
                              return (
                              <button
                                key={building.id}
                                type="button"
                                className={`flat-map-building-chip flat-map-building-chip--${building.status}`}
                                style={typeColor ? ({ '--building-type-color': typeColor } as React.CSSProperties) : undefined}
                                onClick={(e) => {
                                  if (onBuildingPopup) {
                                    // Anchor the popup at the chip's right edge so it
                                    // visually points at what was clicked rather than at
                                    // the cursor's exact pixel.
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    onBuildingPopup(building.id, {
                                      x: rect.right,
                                      y: rect.top + rect.height / 2,
                                    });
                                  } else {
                                    handleOpenBuilding(building.id);
                                  }
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setBuildingContextMenu({
                                    buildingId: building.id,
                                    position: { x: e.clientX, y: e.clientY },
                                  });
                                }}
                                title={`${building.name} · ${building.type} · ${building.status}`}
                              >
                                <Icon
                                  name={getBuildingTypeIcon(building.type)}
                                  size={12}
                                  color={typeColor}
                                />
                                <span className="flat-map-building-chip__name">{building.name}</span>
                                <span
                                  className="flat-map-building-chip__dot"
                                  style={{ backgroundColor: getBuildingStatusColor(building.status) }}
                                />
                              </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                  })()
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Draggable splitter between .flat-right and .flat-inspector. Only
          rendered while the inspector is open. Hidden on mobile via the
          `@media (max-width: 1024px)` block in FlatView.scss. */}
      {showInspector && (
        <div
          className="flat-splitter flat-splitter--inspector"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector panel"
          title="Drag to resize · Double-click to reset"
          onPointerDown={handleInspectorSplitterPointerDown}
          onPointerMove={handleSplitterPointerMove}
          onPointerUp={handleSplitterPointerUp}
          onPointerCancel={handleSplitterPointerUp}
          onDoubleClick={handleInspectorSplitterDoubleClick}
        />
      )}

      {/* Inspector Column - Pushes chat column rather than overlaying.
          Independent of chat/selection state: stays visible even when no
          agent is selected so the tracking board remains available. The
          Agent tab shows an empty-state when there's no selection. */}
      {inspectorMounted && (
        <aside className={`flat-inspector ${inspectorAnimateOpen ? 'flat-inspector--open' : 'flat-inspector--closing'}`} aria-label="Inspector panel">
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
                onSelectAgent={(agentId) => {
                  onAgentClick(agentId);
                  if (window.innerWidth <= 768) {
                    handleCloseInspector();
                  }
                }}
              />
            ) : (() => {
              if (!selectedAgentId) {
                return (
                  <div className="flat-inspector__empty">
                    <span>Select an agent to inspect</span>
                  </div>
                );
              }
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
                  onFocusAgent={(agentId) => {
                    onAgentClick(agentId);
                    if (window.innerWidth <= 768) {
                      handleCloseInspector();
                    }
                  }}
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
      <AgentResponseModalWrapper
        agent={selectedAgentId ? agents.find((a) => a.id === selectedAgentId) ?? null : null}
        content={responseModalContent}
        onClose={() => setResponseModalContent(null)}
      />
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
      <AgentInfoModal
        agent={selectedAgentId ? agents.find((a) => a.id === selectedAgentId) ?? null : null}
        isOpen={agentInfoOpen && !!selectedAgentId}
        onClose={handleCloseAgentInfo}
      />

      <ContextMenu
        isOpen={emptyAgentContextMenu !== null}
        position={emptyAgentContextMenu?.position ?? { x: 0, y: 0 }}
        worldPosition={{ x: 0, z: 0 }}
        actions={emptyAgentContextMenuActions}
        onClose={() => setEmptyAgentContextMenu(null)}
      />

      <ContextMenu
        isOpen={buildingContextMenu !== null}
        position={buildingContextMenu?.position ?? { x: 0, y: 0 }}
        worldPosition={{ x: 0, z: 0 }}
        actions={buildingContextMenuActions}
        onClose={() => setBuildingContextMenu(null)}
      />

      <ConfirmModal
        isOpen={removeAgentConfirm !== null}
        title={t('common:confirm.removeAgentTitle')}
        message={t('common:confirm.removeAgentMessage', { name: removeAgentConfirm?.name ?? '' })}
        confirmLabel={t('common:buttons.remove')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        onConfirm={() => {
          if (removeAgentConfirm) {
            store.removeAgentFromServer(removeAgentConfirm.agentId);
          }
        }}
        onClose={() => setRemoveAgentConfirm(null)}
      />
    </div>
  );
}
