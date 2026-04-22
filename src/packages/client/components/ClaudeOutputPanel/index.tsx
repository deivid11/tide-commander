/**
 * GuakeOutputPanel - Main component
 *
 * A Guake-style terminal interface for interacting with Claude agents.
 * Features:
 * - Conversation history with pagination
 * - Live streaming output
 * - Search functionality
 * - View modes (simple, chat, advanced)
 * - Permission request handling
 * - File attachments and image paste
 * - Resizable terminal height
 * - Agent switcher bar
 */

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
// NOTE: useLayoutEffect used by BottomPm2LogContent and remaining parent effects
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useAgents,
  useAgent,
  useSelectedAgentIds,
  useTerminalOpen,
  useMobileView,
  store,
  useFileViewerPath,
  useContextModalAgentId,
  useOverviewPanelOpen,
  useTrackingBoardVisible,
  useAreas,
  useBuildings,
  useStore,
} from '../../store';
import {
  STORAGE_KEYS,
  apiUrl,
  authFetch,
  getStorageBoolean,
  getStorageNumber,
  getStorageString,
  setStorageBoolean,
  setStorageNumber,
} from '../../utils/storage';
import { resolveAgentFileReference } from '../../utils/filePaths';
import {
  BOTTOM_PM2_LOG_RETENTION_OPTIONS,
  readBottomPm2LogRetention,
  trimLogBufferByLines,
  writeBottomPm2LogRetention,
} from '../../utils/logRetention';
import { ansiToHtml } from '../../utils/ansiToHtml';
import { ContextMenu } from '../ContextMenu';
import type { ContextMenuAction } from '../ContextMenu';
import { Icon } from '../Icon';
import { ModalPortal } from '../shared/ModalPortal';
import { DatabasePanelInline } from '../database/DatabasePanelInline';

// Import types
import type { ViewMode } from './types';

// Import extracted hooks
import { useKeyboardHeight } from './useKeyboardHeight';
import { useTerminalResize } from './useTerminalResize';
import { useMobileOverviewResize } from './useMobileOverviewResize';
import { useSwipeNavigation } from './useSwipeNavigation';
import { useGitBranches } from './useGitBranch';
import { useModalStackRegistration, hasModalsAbove } from '../../hooks/useModalStack';

// Import extracted components
import { TerminalHeader } from './TerminalHeader';
import {
  ImageModal,
  BashModal,
  ContextConfirmModal,
  ContextModalFromGuake,
  FileViewerFromGuake,
  AgentInfoModal,
  AgentResponseModalWrapper,
  type BashModalState,
} from './TerminalModals';
import { AgentDebugPanel } from './AgentDebugPanel';
import { GuakeGitPanel } from './GuakeGitPanel';
import { AgentOverviewPanel } from './AgentOverviewPanel';
import { type AgentTerminalPaneHandle } from './AgentTerminalPane';
import { SplitTerminalLayout } from './SplitTerminalLayout';
import { AreaBuildingsPanel } from './AreaBuildingsPanel';
import { WorkflowPanel } from '../WorkflowPanel';
import { useTwoFingerSelector } from '../../hooks/useTwoFingerSelector';
import { agentDebugger } from '../../services/agentDebugger';
import { ThemeSelector } from './ThemeSelector';
import { Tooltip } from '../shared/Tooltip';
import TerminalEmbed from '../TerminalEmbed';
import { TrackingBoard } from './TrackingBoard';

const MOBILE_CLOSE_SWIPE_MAX_OFFSET_PX = 128;
const MOBILE_CLOSE_SWIPE_RELEASE_MS = 95;

function isPositionInArea(
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

/** A single bottom panel descriptor */
type BottomPanelType = 'terminal' | 'pm2-logs' | 'database';

interface BottomPanel {
  id: string;
  type: BottomPanelType;
  buildingId: string;
  areaId?: string;
}

type SplitDirection = 'horizontal' | 'vertical';

let nextPanelId = 1;
function makePanelId(): string {
  return `bp-${nextPanelId++}`;
}

/** Inline PM2 log viewer for the bottom panel */
const BottomPm2LogContent = memo(function BottomPm2LogContent({
  buildingId,
  filterText,
  maxRetention,
}: {
  buildingId: string;
  filterText: string;
  maxRetention: number | null;
}) {
  const { streamingBuildingLogs } = useStore();
  const logs = streamingBuildingLogs.get(buildingId) || '';
  const logRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);
  const previousScrollHeightRef = useRef(0);
  const normalizedFilter = filterText.trim().toLowerCase();
  const bottomThreshold = 30;

  const updateStickToBottom = useCallback(() => {
    const el = logRef.current;
    if (!el) return;

    const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - bottomThreshold;
    isUserScrolledUpRef.current = !isNearBottom;
  }, []);

  const retainedLogs = useMemo(() => trimLogBufferByLines(logs, maxRetention), [logs, maxRetention]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;

    const previousScrollHeight = previousScrollHeightRef.current;
    const nextScrollHeight = el.scrollHeight;

    if (isUserScrolledUpRef.current) {
      const removedHeight = previousScrollHeight - nextScrollHeight;
      if (removedHeight > 0) {
        el.scrollTop = Math.max(0, el.scrollTop - removedHeight);
      }
    } else {
      el.scrollTop = nextScrollHeight;
    }

    previousScrollHeightRef.current = el.scrollHeight;
  }, [retainedLogs, normalizedFilter]);

  const visibleLogs = useMemo(() => {
    if (!retainedLogs) return '';
    if (!normalizedFilter) return retainedLogs;

    return retainedLogs
      .split('\n')
      .filter((line) => line.toLowerCase().includes(normalizedFilter))
      .join('\n');
  }, [retainedLogs, normalizedFilter]);

  const visibleLines = useMemo(() => (
    visibleLogs ? visibleLogs.split('\n') : []
  ), [visibleLogs]);

  const lineHtml = useMemo(() => (
    visibleLines.map((line) => ansiToHtml(line || ' '))
  ), [visibleLines]);

  const emptyMessage = useMemo(() => {
    if (!retainedLogs) return 'Waiting for logs...';
    if (normalizedFilter && !visibleLogs) return 'No log lines match the current filter.';
    return null;
  }, [retainedLogs, normalizedFilter, visibleLogs]);

  const virtualizer = useVirtualizer({
    count: lineHtml.length,
    getScrollElement: () => logRef.current,
    estimateSize: () => 20,
    overscan: 12,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={logRef}
      className="guake-bottom-pm2-logs"
      onScroll={updateStickToBottom}
    >
      {emptyMessage ? (
        <div className="guake-bottom-pm2-logs-empty">{emptyMessage}</div>
      ) : (
        <div
          className="guake-bottom-pm2-logs-inner"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((virtualItem) => (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              className="guake-bottom-pm2-log-line"
              data-index={virtualItem.index}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
              dangerouslySetInnerHTML={{ __html: lineHtml[virtualItem.index] }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const _BottomTerminalIframe = memo(function BottomTerminalIframe({
  src,
  title,
}: {
  src: string;
  title: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  // Defer src assignment so the UI paints first, then the iframe loads in the background
  const [deferredSrc, setDeferredSrc] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(false);
    setDeferredSrc(null);
    // Delay iframe src assignment so the UI transition/animation completes first.
    // requestIdleCallback fires too soon; use a fixed 400ms delay to let the
    // area-switch paint settle before xterm.js starts blocking the main thread.
    const timer = setTimeout(() => setDeferredSrc(src), 400);
    return () => clearTimeout(timer);
  }, [src]);

  const suppressIframeFocus = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (document.activeElement === iframe) iframe.blur();
    try { iframe.contentWindow?.blur(); } catch { /* cross-origin */ }
  }, []);

  const restoreGuakeInputFocus = useCallback(() => {
    const container = document.querySelector('.guake-input-container') as HTMLDivElement | null;
    const input = container?.querySelector('textarea, input') as HTMLTextAreaElement | HTMLInputElement | null;
    container?.focus({ preventScroll: true });
    input?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!deferredSrc) return;
    const startedAt = Date.now();
    const handleFocusSteal = () => {
      if (Date.now() - startedAt > 1500) return;
      suppressIframeFocus();
      restoreGuakeInputFocus();
    };
    window.addEventListener('focus', handleFocusSteal, true);
    document.addEventListener('focusin', handleFocusSteal, true);
    return () => {
      window.removeEventListener('focus', handleFocusSteal, true);
      document.removeEventListener('focusin', handleFocusSteal, true);
    };
  }, [restoreGuakeInputFocus, suppressIframeFocus, deferredSrc]);

  return (
    <>
      {!loaded && (
        <div className="guake-bottom-terminal-starting"><span>Loading terminal...</span></div>
      )}
      <iframe
        ref={iframeRef}
        src={deferredSrc ?? undefined}
        className={`guake-bottom-terminal-iframe${loaded ? '' : ' iframe-loading'}`}
        title={title}
        allow="clipboard-read; clipboard-write"
        loading="lazy"
        tabIndex={-1}
        onLoad={() => {
          setLoaded(true);
          suppressIframeFocus();
          restoreGuakeInputFocus();
        }}
      />
    </>
  );
});

export const GuakeOutputPanel = memo(function GuakeOutputPanel() {
  const { t } = useTranslation(['terminal', 'common']);
  // Store selectors
  const agents = useAgents();
  const selectedAgentIds = useSelectedAgentIds();
  const terminalOpen = useTerminalOpen();
  const mobileView = useMobileView();
  const fileViewerPath = useFileViewerPath();
  const contextModalAgentId = useContextModalAgentId();

  // Get selected agent
  const selectedAgentIdsArray = Array.from(selectedAgentIds);
  const isSingleSelection = selectedAgentIdsArray.length === 1;
  const selectedAgentId = isSingleSelection ? selectedAgentIdsArray[0] : null;
  const selectedAgent = useAgent(selectedAgentId) || null;

  const activeAgent = selectedAgent;
  const activeAgentId = selectedAgentId;
  const trackingBoardVisible = useTrackingBoardVisible();

  const handleTrackingBoardSelectAgent = useCallback((agentId: string) => {
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(agentId);
    if (window.innerWidth <= 768) {
      store.setTrackingBoardVisible(false);
    }
  }, []);

  // Get area folders for the active agent
  const areas = useAreas();
  const buildings = useBuildings();
  const agentAreaDirectories = useMemo(() => {
    if (!activeAgentId) return null;
    const matchedAreaIds = new Set<string>();
    const matchedAreas: { id: string; name: string; directories: string[] }[] = [];

    for (const area of areas.values()) {
      if (area.archived || area.directories.length === 0) continue;
      if (area.assignedAgentIds.includes(activeAgentId)) {
        matchedAreaIds.add(area.id);
        matchedAreas.push(area);
      }
    }

    // Also include areas containing the agent position.
    // This keeps folder badges visible when area assignment state is stale.
    const agent = agents.get(activeAgentId);
    if (agent) {
      for (const area of areas.values()) {
        if (area.archived || area.directories.length === 0 || matchedAreaIds.has(area.id)) continue;
        if (isPositionInArea({ x: agent.position.x, z: agent.position.z }, area)) {
          matchedAreaIds.add(area.id);
          matchedAreas.push(area);
        }
      }
    }

    if (matchedAreas.length === 0) return null;

    return matchedAreas.flatMap((area) => area.directories
      .filter((dir) => dir && dir.trim().length > 0)
      .map((dir) => ({ areaId: area.id, areaName: area.name, dir })));
  }, [activeAgentId, areas, agents]);

  // Terminal buildings in the active agent's area (for status-bar toggle buttons)
  const areaTerminalBuildings = useMemo(() => {
    if (!activeAgentId) return [];
    const area = store.getAreaForAgent(activeAgentId);
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
  }, [activeAgentId, buildings, areas]);

  // PM2 server buildings in the active agent's area (for status-bar log buttons)
  const areaPm2Buildings = useMemo(() => {
    if (!activeAgentId) return [];
    const area = store.getAreaForAgent(activeAgentId);
    if (!area) return [];
    const result: { id: string; name: string }[] = [];
    for (const building of buildings.values()) {
      if (building.type === 'server' && building.pm2?.enabled && store.isPositionInArea(building.position, area)) {
        result.push({ id: building.id, name: building.name });
      }
    }
    return result;
  }, [activeAgentId, buildings, areas]);

  // Database buildings in the active agent's area (for status-bar database buttons)
  const areaDatabaseBuildings = useMemo(() => {
    if (!activeAgentId) return [];
    const area = store.getAreaForAgent(activeAgentId);
    if (!area) return [];
    const result: { id: string; name: string }[] = [];
    for (const building of buildings.values()) {
      if (building.type === 'database' && building.database && store.isPositionInArea(building.position, area)) {
        result.push({ id: building.id, name: building.name });
      }
    }
    return result;
  }, [activeAgentId, buildings, areas]);

  // Fetch git branch names for area directories
  const { branches: areaBranches, fetchRemote: fetchGitRemote, fetchingDirs: gitFetchingDirs } = useGitBranches(agentAreaDirectories);

  // Use extracted hooks
  const { terminalHeight, terminalRef, handleResizeStart } = useTerminalResize();
  const { mobileOverviewHeight, handleResizeMouseDown: handleOverviewResizeMouseDown, handleResizeTouchStart: handleOverviewResizeTouchStart } = useMobileOverviewResize();
  const keyboard = useKeyboardHeight();

  // Side panel width (shared by overview, git, buildings, debug panels)
  const [sidePanelWidth, setSidePanelWidth] = useState(() => {
    const saved = getStorageNumber(STORAGE_KEYS.SIDE_PANEL_WIDTH, 420);
    return Math.max(280, Math.min(700, saved));
  });
  const sidePanelResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const handleSidePanelResizeStart = useCallback((e: React.MouseEvent, side: 'left' | 'right') => {
    e.preventDefault();
    sidePanelResizeRef.current = { startX: e.clientX, startW: sidePanelWidth };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    store.setTerminalResizing(true);
    let lastWidth = sidePanelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!sidePanelResizeRef.current) return;
      const dx = moveEvent.clientX - sidePanelResizeRef.current.startX;
      // For left-side panels (overview): dragging right = shrink, dragging left = grow
      // For right-side panels (git/buildings): dragging left = grow, dragging right = shrink
      const delta = side === 'left' ? -dx : dx;
      lastWidth = Math.max(280, Math.min(700, sidePanelResizeRef.current.startW + delta));
      setSidePanelWidth(lastWidth);
    };
    const onMouseUp = () => {
      sidePanelResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      store.setTerminalResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setStorageNumber(STORAGE_KEYS.SIDE_PANEL_WIDTH, lastWidth);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidePanelWidth]);

  // Ref for the AgentTerminalPane (exposes per-agent scroll, history, search, input)
  const paneRef = useRef<AgentTerminalPaneHandle>(null);

  // Ref for the agent overview list (shared with two-finger selector)
  const agentListRef = useRef<HTMLDivElement>(null);

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = getStorageString(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'simple' || saved === 'chat' || saved === 'advanced') {
      return saved;
    }
    const oldSaved = getStorageString(STORAGE_KEYS.ADVANCED_VIEW);
    if (oldSaved === 'true') return 'advanced';
    return 'simple';
  });
  const [isFullscreen, setIsFullscreen] = useState(() =>
    getStorageBoolean(STORAGE_KEYS.TERMINAL_FULLSCREEN, false)
  );

  // Modal states
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  const [bashModal, setBashModal] = useState<BashModalState | null>(null);
  const [contextConfirm, setContextConfirm] = useState<'collapse' | 'clear' | 'clear-subordinates' | null>(null);
  const [responseModalContent, setResponseModalContent] = useState<string | null>(null);
  const [agentInfoOpen, setAgentInfoOpen] = useState(false);

  // Register terminal-local modals so global Escape can close the top-most one first.
  // Without these, closeTopModal() in useKeyboardShortcuts would skip past the modal
  // and close the terminal itself (since 'terminal' is also on the stack).
  useModalStackRegistration('guake-image-modal', imageModal !== null, () => setImageModal(null));
  useModalStackRegistration('guake-bash-modal', bashModal !== null, () => setBashModal(null));
  useModalStackRegistration('guake-response-modal', responseModalContent !== null, () => setResponseModalContent(null));
  useModalStackRegistration('guake-context-confirm', contextConfirm !== null, () => setContextConfirm(null));
  useModalStackRegistration('guake-agent-info', agentInfoOpen, () => setAgentInfoOpen(false));

  // Debug panel state
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debuggerEnabled, setDebuggerEnabled] = useState(() => agentDebugger.isEnabled());

  // Git panel state (persisted in localStorage)
  const [gitPanelOpen, setGitPanelOpenRaw] = useState(() => getStorageBoolean(STORAGE_KEYS.GIT_PANEL_OPEN, false));
  const setGitPanelOpen = useCallback((open: boolean) => {
    setGitPanelOpenRaw(open);
    setStorageBoolean(STORAGE_KEYS.GIT_PANEL_OPEN, open);
  }, []);

  // Buildings panel state (persisted in localStorage)
  const [buildingsPanelOpen, setBuildingsPanelOpenRaw] = useState(() => getStorageBoolean(STORAGE_KEYS.BUILDINGS_PANEL_OPEN, false));
  const setBuildingsPanelOpen = useCallback((open: boolean) => {
    setBuildingsPanelOpenRaw(open);
    setStorageBoolean(STORAGE_KEYS.BUILDINGS_PANEL_OPEN, open);
  }, []);

  // Workflow panel state (persisted in localStorage)
  const [workflowPanelOpen, setWorkflowPanelOpenRaw] = useState(() => getStorageBoolean(STORAGE_KEYS.WORKFLOW_PANEL_OPEN, false));
  const setWorkflowPanelOpen = useCallback((open: boolean) => {
    setWorkflowPanelOpenRaw(open);
    setStorageBoolean(STORAGE_KEYS.WORKFLOW_PANEL_OPEN, open);
  }, []);

  // Check if active agent owns a workflow via API (store not populated via WebSocket yet)
  const [hasWorkflowForAgent, setHasWorkflowForAgent] = useState(false);
  useEffect(() => {
    if (!activeAgentId) { setHasWorkflowForAgent(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(apiUrl('/api/workflows/definitions'));
        if (cancelled || !res.ok) return;
        const defs = await res.json();
        const found = (defs as Array<{ states: Array<{ action?: { type: string; agentId?: string } }> }>)
          .some(def => def.states.some(s => s.action?.type === 'agent_task' && s.action?.agentId === activeAgentId));
        if (!cancelled) setHasWorkflowForAgent(found);
      } catch { if (!cancelled) setHasWorkflowForAgent(false); }
    })();
    return () => { cancelled = true; };
  }, [activeAgentId]);

  // Agent overview panel state (persisted in store across agent switches)
  const overviewPanelOpen = useOverviewPanelOpen();
  const setOverviewPanelOpen = useCallback((open: boolean) => store.setOverviewPanelOpen(open), []);

  // Bottom split panels - supports multiple panels (terminal + PM2 logs side by side)
  const [bottomPanels, setBottomPanels] = useState<BottomPanel[]>([]);
  const [bottomPanelFilters, setBottomPanelFilters] = useState<Record<string, string>>({});
  const [bottomPm2LogRetention, setBottomPm2LogRetention] = useState<number | null>(() => readBottomPm2LogRetention());
  const [splitDirection, setSplitDirection] = useState<SplitDirection>(() => {
    try {
      const saved = localStorage.getItem('tide:bottom-split-direction');
      return (saved === 'vertical' ? 'vertical' : 'horizontal') as SplitDirection;
    } catch { return 'horizontal' as SplitDirection; }
  });
  const [bottomTerminalHeight, setBottomTerminalHeight] = useState(() => {
    try {
      const h = localStorage.getItem('tide:bottom-terminal-height');
      return h ? Math.max(120, Math.min(600, Number(h))) : 250;
    } catch { return 250; }
  });
  const bottomTerminalResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  // Split panel ratios (flex values for each panel, default equal)
  const [splitRatios, setSplitRatios] = useState<number[]>([1]);
  const splitResizeRef = useRef<{ index: number; startPos: number; startRatios: number[] } | null>(null);
  const bottomPanelsContainerRef = useRef<HTMLDivElement>(null);

  // Split context menu state
  const [splitContextMenu, setSplitContextMenu] = useState<{
    position: { x: number; y: number };
    buildingId: string;
    type: BottomPanelType;
  } | null>(null);

  // Track which area's bottom panels are currently visible
  const [activeBottomAreaId, setActiveBottomAreaId] = useState<string | null>(null);

  // Derived: quick access to which building IDs are in bottom panels
  // Only show building IDs from the active area for button state
  const activeAreaPanels = useMemo(() => bottomPanels.filter(p => p.areaId === activeBottomAreaId), [bottomPanels, activeBottomAreaId]);
  const bottomPanelBuildingIds = useMemo(() => new Set(activeAreaPanels.map(p => p.buildingId)), [activeAreaPanels]);

  // Load per-area bottom panels map from localStorage on mount
  const bottomPanelsMapRef = useRef<Map<string, Array<{ id: string; type: BottomPanelType; buildingId: string }>>>(new Map());
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tide:bottom-panels-v2');
      if (saved) {
        const entries = JSON.parse(saved) as [string, Array<{ id?: string; type: BottomPanelType; buildingId: string }>][];
        bottomPanelsMapRef.current = new Map(
          entries.map(([areaId, panels]) => [
            areaId,
            panels.map(p => ({ id: p.id ?? makePanelId(), type: p.type, buildingId: p.buildingId })),
          ])
        );
      } else {
        // Migrate from old format (single terminal per area)
        const old = localStorage.getItem('tide:bottom-terminals');
        if (old) {
          const oldEntries = JSON.parse(old) as [string, string][];
          for (const [areaId, buildingId] of oldEntries) {
            bottomPanelsMapRef.current.set(areaId, [{ id: makePanelId(), type: 'terminal', buildingId }]);
          }
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Helper to persist the panels for the current area
  const persistBottomPanels = useCallback((panels: BottomPanel[]) => {
    if (!activeAgentId) return;
    const area = store.getAreaForAgent(activeAgentId);
    if (!area) return;
    try {
      if (panels.length > 0) {
        bottomPanelsMapRef.current.set(area.id, panels.map(p => ({ id: p.id, type: p.type, buildingId: p.buildingId })));
      } else {
        bottomPanelsMapRef.current.delete(area.id);
      }
      const entries = Array.from(bottomPanelsMapRef.current.entries());
      localStorage.setItem('tide:bottom-panels-v2', JSON.stringify(entries));
    } catch { /* ignore */ }
  }, [activeAgentId]);

  // Helper: get the current area ID for the active agent
  const getActiveAreaId = useCallback((): string | null => {
    if (!activeAgentId) return null;
    const area = store.getAreaForAgent(activeAgentId);
    return area?.id ?? null;
  }, [activeAgentId]);

  const openBottomPanel = useCallback((buildingId: string, type: BottomPanelType) => {
    const areaId = getActiveAreaId();
    setBottomPanelFilters({});
    setBottomPanels(prev => {
      // Stop streaming for PM2 panels in the same area being removed
      for (const p of prev) {
        if (p.areaId === areaId && p.type === 'pm2-logs') {
          store.stopLogStreaming(p.buildingId);
        }
      }
      // Remove old panels from this area, keep panels from other areas
      const otherAreaPanels = prev.filter(p => p.areaId !== areaId);
      const newPanel: BottomPanel = { id: makePanelId(), type, buildingId, areaId: areaId ?? undefined };
      const newPanels = [...otherAreaPanels, newPanel];
      persistBottomPanels([newPanel]);
      return newPanels;
    });
  }, [persistBottomPanels, getActiveAreaId]);

  // Add a panel via split (horizontal or vertical)
  const splitBottomPanel = useCallback((buildingId: string, type: BottomPanelType, direction: SplitDirection) => {
    const areaId = getActiveAreaId();
    setSplitDirection(direction);
    try { localStorage.setItem('tide:bottom-split-direction', direction); } catch { /* ignore */ }
    setBottomPanels(prev => {
      const areaPanels = prev.filter(p => p.areaId === areaId);
      if (areaPanels.length >= 4) return prev; // max 4 panels per area
      // Don't add duplicate building in same area
      if (areaPanels.some(p => p.buildingId === buildingId)) return prev;
      const newPanel: BottomPanel = { id: makePanelId(), type, buildingId, areaId: areaId ?? undefined };
      const newPanels = [...prev, newPanel];
      persistBottomPanels(areaPanels.concat(newPanel));
      return newPanels;
    });
  }, [persistBottomPanels, getActiveAreaId]);

  // Close a specific panel by panel id
  const closeBottomPanel = useCallback((panelId: string) => {
    setBottomPanelFilters((prev) => {
      if (!(panelId in prev)) return prev;
      const next = { ...prev };
      delete next[panelId];
      return next;
    });
    setBottomPanels(prev => {
      const panel = prev.find(p => p.id === panelId);
      if (panel?.type === 'pm2-logs') {
        store.stopLogStreaming(panel.buildingId);
      }
      const newPanels = prev.filter(p => p.id !== panelId);
      const areaId = panel?.areaId;
      if (areaId) {
        persistBottomPanels(newPanels.filter(p => p.areaId === areaId));
      }
      return newPanels;
    });
  }, [persistBottomPanels]);

  // Close all bottom panels
  const _closeAllBottomPanels = useCallback(() => {
    setBottomPanelFilters({});
    setBottomPanels(prev => {
      for (const p of prev) {
        if (p.type === 'pm2-logs') {
          store.stopLogStreaming(p.buildingId);
        }
      }
      persistBottomPanels([]);
      return [];
    });
  }, [persistBottomPanels]);

  // When active agent changes, update active area and load panels from saved map if needed
  useEffect(() => {
    if (!activeAgentId) {
      setActiveBottomAreaId(null);
      return;
    }
    const area = store.getAreaForAgent(activeAgentId);
    if (!area) {
      setActiveBottomAreaId(null);
      return;
    }
    setActiveBottomAreaId(area.id);

    // Check if we already have panels for this area in state
    setBottomPanels(prev => {
      const existingForArea = prev.filter(p => p.areaId === area.id);
      if (existingForArea.length > 0) return prev; // Already mounted, nothing to do

      // Load from saved map
      const savedPanels = bottomPanelsMapRef.current.get(area.id);
      if (!savedPanels || savedPanels.length === 0) return prev;

      const newPanels = savedPanels.map((panel) => ({
        id: panel.id,
        type: panel.type,
        buildingId: panel.buildingId,
        areaId: area.id,
      }));

      return [...prev, ...newPanels];
    });
  }, [activeAgentId]);

  // Listen for open-bottom-terminal events (single open, replaces all)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ buildingId: string }>).detail;
      if (detail?.buildingId) {
        openBottomPanel(detail.buildingId, 'terminal');
      }
    };
    window.addEventListener('tide:open-bottom-terminal', handler as EventListener);
    return () => window.removeEventListener('tide:open-bottom-terminal', handler as EventListener);
  }, [openBottomPanel]);

  // Listen for open-bottom-pm2-logs events (single open, replaces all)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ buildingId: string }>).detail;
      if (detail?.buildingId) {
        openBottomPanel(detail.buildingId, 'pm2-logs');
      }
    };
    window.addEventListener('tide:open-bottom-pm2-logs', handler as EventListener);
    return () => window.removeEventListener('tide:open-bottom-pm2-logs', handler as EventListener);
  }, [openBottomPanel]);

  // Listen for open-bottom-database events (single open, replaces all)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ buildingId: string }>).detail;
      if (detail?.buildingId) {
        openBottomPanel(detail.buildingId, 'database');
      }
    };
    window.addEventListener('tide:open-bottom-database', handler as EventListener);
    return () => window.removeEventListener('tide:open-bottom-database', handler as EventListener);
  }, [openBottomPanel]);

  // Listen for split-bottom-panel events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ buildingId: string; type: BottomPanelType; direction: SplitDirection }>).detail;
      if (detail?.buildingId && detail?.type && detail?.direction) {
        if (activeAreaPanels.length === 0) {
          openBottomPanel(detail.buildingId, detail.type);
        } else {
          splitBottomPanel(detail.buildingId, detail.type, detail.direction);
        }
      }
    };
    window.addEventListener('tide:split-bottom-panel', handler as EventListener);
    return () => window.removeEventListener('tide:split-bottom-panel', handler as EventListener);
  }, [activeAreaPanels.length, openBottomPanel, splitBottomPanel]);

  // Keep split ratios in sync with active area panel count
  useEffect(() => {
    setSplitRatios(prev => {
      if (prev.length === activeAreaPanels.length) return prev;
      if (activeAreaPanels.length <= 1) return [1];
      // When adding a panel, give equal space
      if (activeAreaPanels.length > prev.length) {
        return Array(activeAreaPanels.length).fill(1);
      }
      // When removing, redistribute equally
      return Array(activeAreaPanels.length).fill(1);
    });
  }, [activeAreaPanels.length]);

  // Handle split divider drag
  const handleSplitResizeStart = useCallback((e: React.MouseEvent, dividerIndex: number) => {
    e.preventDefault();
    const isHorizontal = splitDirection === 'horizontal';
    splitResizeRef.current = {
      index: dividerIndex,
      startPos: isHorizontal ? e.clientX : e.clientY,
      startRatios: [...splitRatios],
    };
    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    // Disable pointer events on iframes during resize so they don't steal mouse events
    const iframes = bottomPanelsContainerRef.current?.querySelectorAll('iframe');
    iframes?.forEach(f => (f as HTMLElement).style.pointerEvents = 'none');

    const container = bottomPanelsContainerRef.current;
    const totalSize = container
      ? (isHorizontal ? container.offsetWidth : container.offsetHeight)
      : 1;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const ref = splitResizeRef.current;
      if (!ref || !container) return;
      const pos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
      const delta = pos - ref.startPos;
      const totalRatio = ref.startRatios.reduce((a, b) => a + b, 0);
      const deltaRatio = (delta / totalSize) * totalRatio;

      const newRatios = [...ref.startRatios];
      const minRatio = 0.1 * totalRatio; // 10% minimum
      newRatios[dividerIndex] = Math.max(minRatio, ref.startRatios[dividerIndex] + deltaRatio);
      newRatios[dividerIndex + 1] = Math.max(minRatio, ref.startRatios[dividerIndex + 1] - deltaRatio);
      setSplitRatios(newRatios);
    };
    const onMouseUp = () => {
      splitResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      iframes?.forEach(f => (f as HTMLElement).style.pointerEvents = '');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [splitDirection, splitRatios]);

  // Start PM2 log streaming for newly added PM2 panels
  const prevPm2PanelIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentPm2Ids = new Set(
      bottomPanels.filter(p => p.type === 'pm2-logs').map(p => p.buildingId)
    );
    // Start streaming for newly added
    for (const id of currentPm2Ids) {
      if (!prevPm2PanelIdsRef.current.has(id)) {
        store.startLogStreaming(id, 200);
      }
    }
    prevPm2PanelIdsRef.current = currentPm2Ids;
  }, [bottomPanels]);

  // Track which terminal panels had URLs (for auto-close on stop)
  const terminalHadUrlRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const terminalPanels = bottomPanels.filter(p => p.type === 'terminal');
    for (const panel of terminalPanels) {
      const building = buildings.get(panel.buildingId);
      const hasUrl = !!building?.terminalStatus?.url;
      if (hasUrl) {
        terminalHadUrlRef.current.add(panel.buildingId);
      } else if (terminalHadUrlRef.current.has(panel.buildingId)) {
        // Terminal stopped — remove this panel
        terminalHadUrlRef.current.delete(panel.buildingId);
        closeBottomPanel(panel.id);
      }
    }
    // Clean up refs for panels that no longer exist
    const activeBuildingIds = new Set(terminalPanels.map(p => p.buildingId));
    for (const id of terminalHadUrlRef.current) {
      if (!activeBuildingIds.has(id)) {
        terminalHadUrlRef.current.delete(id);
      }
    }
  }, [bottomPanels, buildings, closeBottomPanel]);

  // Bottom terminal resize handler
  const handleBottomTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    bottomTerminalResizeRef.current = { startY: e.clientY, startH: bottomTerminalHeight };
    let lastHeight = bottomTerminalHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!bottomTerminalResizeRef.current) return;
      const dy = bottomTerminalResizeRef.current.startY - moveEvent.clientY;
      lastHeight = Math.max(120, Math.min(600, bottomTerminalResizeRef.current.startH + dy));
      setBottomTerminalHeight(lastHeight);
    };
    const onMouseUp = () => {
      bottomTerminalResizeRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      try { localStorage.setItem('tide:bottom-terminal-height', String(lastHeight)); } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [bottomTerminalHeight]);

  // Drag-and-drop file attach
  const [draggingOver, setDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Use store's terminal state
  const isOpen = terminalOpen && activeAgent !== null;
  const agentNavigationHistoryRef = useRef<string[]>([]);
  const agentNavigationIndexRef = useRef(-1);
  const isHistoryNavigationRef = useRef(false);
  const isBrowserPopNavigationRef = useRef(false);
  const browserHistoryInitializedRef = useRef(false);
  const lastBrowserHistoryAgentIdRef = useRef<string | null>(null);
  const [canNavigateBack, setCanNavigateBack] = useState(false);
  const [canNavigateForward, setCanNavigateForward] = useState(false);

  const updateAgentNavigationAvailability = useCallback(() => {
    const history = agentNavigationHistoryRef.current;
    const index = agentNavigationIndexRef.current;
    setCanNavigateBack(index > 0);
    setCanNavigateForward(index >= 0 && index < history.length - 1);
  }, []);

  const navigateAgentHistory = useCallback((direction: -1 | 1) => {
    const history = agentNavigationHistoryRef.current;
    if (history.length === 0) return;

    let nextIndex = agentNavigationIndexRef.current + direction;
    while (nextIndex >= 0 && nextIndex < history.length) {
      const targetAgentId = history[nextIndex];
      if (agents.has(targetAgentId)) {
        isHistoryNavigationRef.current = true;
        agentNavigationIndexRef.current = nextIndex;
        updateAgentNavigationAvailability();
        store.selectAgent(targetAgentId);
        return;
      }
      // Skip removed/non-existent agents in history
      nextIndex += direction;
    }
  }, [agents, updateAgentNavigationAvailability]);

  const handleNavigateBack = useCallback(() => {
    navigateAgentHistory(-1);
  }, [navigateAgentHistory]);

  const handleNavigateForward = useCallback(() => {
    navigateAgentHistory(1);
  }, [navigateAgentHistory]);

  const setGuakeBrowserHistoryState = useCallback((agentId: string, mode: 'push' | 'replace') => {
    if (typeof window === 'undefined') return;
    const currentState = window.history.state;
    const baseState = typeof currentState === 'object' && currentState !== null ? currentState : {};
    const nextState = {
      ...baseState,
      __guakeAgentNav: { agentId },
    };
    if (mode === 'replace') {
      window.history.replaceState(nextState, '', window.location.href);
    } else {
      window.history.pushState(nextState, '', window.location.href);
    }
  }, []);

  const handleFullscreenToggle = useCallback(() => {
    setIsFullscreen((previous) => {
      const next = !previous;
      setStorageBoolean(STORAGE_KEYS.TERMINAL_FULLSCREEN, next);
      return next;
    });
  }, []);

  // Swipe navigation hook (horizontal agent switching)
  // Uses paneRef for output ref and loading state from the pane
  const swipe = useSwipeNavigation({
    agents,
    selectedAgentId: activeAgentId,
    isOpen,
    overviewPanelOpen,
    loadingHistory: paneRef.current?.historyLoader.fetchingHistory ?? false,
    hasModalOpen: !!(imageModal || bashModal || responseModalContent || fileViewerPath || contextModalAgentId),
    outputRef: paneRef.current?.outputScrollRef ?? { current: null },
  });

  // Mouse back/forward button gestures for agent history navigation (scoped to guake terminal)
  useEffect(() => {
    const el = terminalRef.current;
    if (!el || !isOpen) return;

    const onMouseUp = (e: MouseEvent) => {
      // Mouse button 3 = back, button 4 = forward (standard extended mouse buttons)
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        handleNavigateBack();
      } else if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        handleNavigateForward();
      }
    };

    // Prevent the browser's default context menu / navigation for back/forward buttons
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
  }, [isOpen, handleNavigateBack, handleNavigateForward]);

  // Two-finger scroll agent selector (mobile: gesture on terminal, cursor on overview)
  const handleTwoFingerSelect = useCallback((agentId: string) => {
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(agentId);
  }, []);
  const twoFingerEnabled = typeof window !== 'undefined' && window.innerWidth <= 768 && overviewPanelOpen && isOpen;
  const twoFingerSelector = useTwoFingerSelector({
    gestureRef: paneRef.current?.outputScrollRef ?? { current: null },
    agentListRef,
    enabled: twoFingerEnabled,
    onSelect: handleTwoFingerSelect,
  });

  // Auto-enable debugger when panel opens
  useEffect(() => {
    if (debugPanelOpen && !debuggerEnabled) {
      setDebuggerEnabled(true);
      agentDebugger.setEnabled(true);
    }
  }, [debugPanelOpen, debuggerEnabled]);

  useEffect(() => {
    if (!isOpen) {
      setAgentInfoOpen(false);
    }
  }, [isOpen]);

  // Auto-update bash modal when output arrives (reads deduped history from pane)
  useEffect(() => {
    if (!bashModal?.isLive || !bashModal.command) return;
    const dedupedHistory = paneRef.current?.getDedupedHistory() ?? [];
    for (const msg of dedupedHistory) {
      if (msg._bashCommand === bashModal.command && msg._bashOutput) {
        setBashModal({ command: bashModal.command, output: msg._bashOutput, isLive: false });
        return;
      }
    }
  }, [bashModal]);

  // Memoized callbacks
  const handleImageClick = useCallback((url: string, name: string) => {
    setImageModal({ url, name });
  }, []);

  const handleFileClick = useCallback((path: string, editData?: { oldString?: string; newString?: string; operation?: string; unifiedDiff?: string; highlightRange?: { offset: number; limit: number }; targetLine?: number }) => {
    const ref = resolveAgentFileReference(path, activeAgent?.cwd);
    const mergedEditData = ref.line
      ? { ...(editData || {}), targetLine: ref.line }
      : editData;
    store.setFileViewerPath(ref.path, mergedEditData, activeAgent?.cwd);
  }, [activeAgent?.cwd]);

  const handleBashClick = useCallback((command: string, output: string) => {
    const isLive = output === 'Running...';
    setBashModal({ command, output, isLive });
  }, []);

  const handleViewMarkdown = useCallback((content: string) => {
    setResponseModalContent(content);
  }, []);

  const toggleAgentInfo = useCallback(() => {
    setAgentInfoOpen(prev => !prev);
  }, []);

  // Mobile swipe-close state (parent-only, not part of per-agent pane)
  const [mobileSwipeCloseOffset, setMobileSwipeCloseOffset] = useState(0);
  const [isMobileSwipeClosing, setIsMobileSwipeClosing] = useState(false);

  const handleMobileSwipeClose = useCallback(() => {
    if (typeof window === 'undefined' || window.innerWidth > 768) return;
    setIsMobileSwipeClosing(true);
    setMobileSwipeCloseOffset(MOBILE_CLOSE_SWIPE_MAX_OFFSET_PX);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setTimeout(() => {
      store.setMobileView('3d');
      setIsMobileSwipeClosing(false);
      setMobileSwipeCloseOffset(0);
    }, MOBILE_CLOSE_SWIPE_RELEASE_MS);
  }, []);

  const handleMobileSwipeCloseOffsetChange = useCallback((offset: number) => {
    if (isMobileSwipeClosing) return;
    setMobileSwipeCloseOffset(offset);
  }, [isMobileSwipeClosing]);

  // Reset mobile swipe close offset on agent change
  useEffect(() => {
    setMobileSwipeCloseOffset(0);
    setIsMobileSwipeClosing(false);
  }, [activeAgentId]);

  useEffect(() => {
    if (!activeAgentId) {
      agentNavigationHistoryRef.current = [];
      agentNavigationIndexRef.current = -1;
      updateAgentNavigationAvailability();
      browserHistoryInitializedRef.current = false;
      lastBrowserHistoryAgentIdRef.current = null;
      return;
    }

    const history = agentNavigationHistoryRef.current;
    if (isHistoryNavigationRef.current) {
      isHistoryNavigationRef.current = false;
      updateAgentNavigationAvailability();
      return;
    }

    const currentIndex = agentNavigationIndexRef.current;
    if (currentIndex >= 0 && history[currentIndex] === activeAgentId) {
      updateAgentNavigationAvailability();
      return;
    }

    const trimmedHistory = currentIndex < history.length - 1
      ? history.slice(0, currentIndex + 1)
      : history.slice();

    trimmedHistory.push(activeAgentId);
    const MAX_AGENT_HISTORY = 100;
    if (trimmedHistory.length > MAX_AGENT_HISTORY) {
      trimmedHistory.shift();
    }

    agentNavigationHistoryRef.current = trimmedHistory;
    agentNavigationIndexRef.current = trimmedHistory.length - 1;
    updateAgentNavigationAvailability();
  }, [activeAgentId, updateAgentNavigationAvailability]);

  useEffect(() => {
    if (!isOpen || !activeAgentId) return;

    if (!browserHistoryInitializedRef.current) {
      setGuakeBrowserHistoryState(activeAgentId, 'replace');
      browserHistoryInitializedRef.current = true;
      lastBrowserHistoryAgentIdRef.current = activeAgentId;
      return;
    }

    if (isBrowserPopNavigationRef.current) {
      isBrowserPopNavigationRef.current = false;
      lastBrowserHistoryAgentIdRef.current = activeAgentId;
      return;
    }

    if (lastBrowserHistoryAgentIdRef.current === activeAgentId) return;

    setGuakeBrowserHistoryState(activeAgentId, 'push');
    lastBrowserHistoryAgentIdRef.current = activeAgentId;
  }, [isOpen, activeAgentId, setGuakeBrowserHistoryState]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePopState = (event: PopStateEvent) => {
      const targetAgentId = event.state?.__guakeAgentNav?.agentId;
      if (!targetAgentId || typeof targetAgentId !== 'string') return;
      if (!agents.has(targetAgentId)) return;
      if (targetAgentId === selectedAgentId) return;

      // Route browser history navigation through the same terminal selection flow.
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
  }, [isOpen, agents, selectedAgentId, updateAgentNavigationAvailability]);

  // Clear unseen badge when terminal is open and agent is visible
  useEffect(() => {
    if (isOpen && selectedAgentId) {
      store.clearUnseenForAgent(selectedAgentId);
    }
  }, [isOpen, selectedAgentId]);

  // Keyboard shortcut to toggle terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.ctrlKey && !e.altKey && activeAgent) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          store.toggleTerminal();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeAgent]);

  useEffect(() => {
    if (!isOpen) return;

    const handleHistoryNavigation = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      if (event.key === 'ArrowLeft' && canNavigateBack) {
        event.preventDefault();
        handleNavigateBack();
      } else if (event.key === 'ArrowRight' && canNavigateForward) {
        event.preventDefault();
        handleNavigateForward();
      }
    };

    document.addEventListener('keydown', handleHistoryNavigation);
    return () => document.removeEventListener('keydown', handleHistoryNavigation);
  }, [isOpen, canNavigateBack, canNavigateForward, handleNavigateBack, handleNavigateForward]);

  // Escape key handler for modals and search (higher priority than message navigation)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Handle modals first - stopImmediatePropagation prevents other capture-phase
        // listeners on document (e.g. useKeyboardShortcuts) from also firing
        // Priority: store-controlled modals first (FileViewer, ContextModal), then local state modals
        if (fileViewerPath) {
          e.stopImmediatePropagation();
          store.clearFileViewerPath();
        } else if (contextModalAgentId) {
          e.stopImmediatePropagation();
          store.closeContextModal();
        } else if (responseModalContent) {
          e.stopImmediatePropagation();
          setResponseModalContent(null);
        } else if (bashModal) {
          e.stopImmediatePropagation();
          setBashModal(null);
        } else if (imageModal) {
          e.stopImmediatePropagation();
          setImageModal(null);
        } else if (paneRef.current?.search.searchMode) {
          e.stopImmediatePropagation();
          paneRef.current.search.closeSearch();
        }
      }
    };
    // Use capture phase to handle before message navigation
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [imageModal, bashModal, responseModalContent, fileViewerPath, contextModalAgentId]);

  // Refs to track state in event handlers
  const isOpenRef = useRef(isOpen);
  const isMouseDownOutsideRef = useRef(false);

  // Keep isOpenRef in sync with isOpen
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Close terminal when clicking outside
  // Use refs to avoid closure issues with event listeners
  useEffect(() => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) return;

    const isWithinGuakeSurface = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;

      const isInTerminal = terminalRef.current?.contains(target);
      const isAgentBar = target.closest('.agent-bar');
      // Sidebar and its edge toggle are persistent UI; clicks there shouldn't close the terminal.
      const isSidebar = target.closest('.sidebar, .sidebar-collapse-edge-btn');
      // Modals are rendered through portals under document.body.
      // Any modal interaction should never count as an outside click for Guake.
      const isInModal = !!target.closest(
        '.modal-overlay, .modal, .image-modal-overlay, .image-modal, .bash-modal-overlay, .bash-modal, .agent-info-modal-overlay, .agent-info-modal, .agent-response-modal, .pasted-text-modal-overlay, .pasted-text-modal, .file-viewer-overlay, .file-viewer-modal, .context-view-modal, .guake-context-confirm-overlay, .guake-context-confirm-modal, .pm2-logs-modal-overlay, .pm2-logs-modal, .database-panel-modal, .context-menu, .guake-git-diff-modal-overlay, .guake-git-delete-confirm, .theme-selector-dropdown'
      );

      return !!isInTerminal || !!isAgentBar || !!isSidebar || isInModal;
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Only track if terminal is currently open
      if (!isOpenRef.current) {
        isMouseDownOutsideRef.current = false;
        return;
      }

      // If any modal is open above the terminal on the stack, don't track outside clicks.
      // The modal handles its own closing; we shouldn't close the terminal underneath.
      if (hasModalsAbove('terminal')) {
        isMouseDownOutsideRef.current = false;
        return;
      }

      isMouseDownOutsideRef.current = !isWithinGuakeSurface(e.target);
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Only close if mousedown was outside (and terminal was open at that time)
      if (!isMouseDownOutsideRef.current) {
        return;
      }

      if (!isWithinGuakeSurface(e.target)) {
        store.setTerminalOpen(false);
      }
      isMouseDownOutsideRef.current = false;
    };

    // Attach listeners once and keep them attached throughout component lifetime
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mouseup', handleMouseUp, true);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, []);

  // Visibility change cleanup
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) keyboard.cleanup();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [keyboard]);

  // Clean up stale keyboard styles when agent changes or component unmounts.
  // This prevents --keyboard-visible getting stuck at 1 after rapid agent switches.
  useEffect(() => {
    return () => keyboard.cleanup();
  }, [activeAgentId, keyboard]);

  // Mobile placeholder rendering
  const isMobileWidth = typeof window !== 'undefined' && window.innerWidth <= 768;

  if (!activeAgent) {
    if (isMobileWidth && mobileView === 'terminal' && selectedAgentIds.size === 0) {
      return (
        <div ref={terminalRef} className={`guake-terminal open ${isFullscreen ? 'fullscreen' : ''}`} style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}>
          <div className="guake-content">
            <div className="guake-output" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6272a4' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}><Icon name="hand-point" size={48} /></div>
                <div style={{ fontSize: '16px' }}>{t('terminal:empty.tapAgent')}</div>
                <div style={{ fontSize: '14px', marginTop: '8px', opacity: 0.7 }}>{t('terminal:empty.switchTo3D')}</div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (isMobileWidth && mobileView === 'terminal' && selectedAgentIds.size > 0) {
      return (
        <div ref={terminalRef} className={`guake-terminal open ${isFullscreen ? 'fullscreen' : ''}`} style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}>
          <div className="guake-content">
            <div className="guake-output" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6272a4' }}>
              <div className="guake-empty loading">{t('terminal:empty.loadingTerminal')}<span className="loading-dots"><span></span><span></span><span></span></span></div>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  // At this point activeAgent exists, so activeAgentId must exist too
  if (!activeAgentId) return null;

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setDraggingOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDraggingOver(false);

    const files = e.dataTransfer.files;
    if (!files.length) return;

    for (const file of files) {
      const attached = await paneRef.current?.terminalInput.uploadFile(file);
      if (attached) {
        paneRef.current?.terminalInput.setAttachedFiles((prev) => [...prev, attached]);
      }
    }
  };

  return (
    <div
      ref={terminalRef}
      className={`guake-terminal ${isOpen ? 'open' : 'collapsed'} ${isFullscreen && isOpen ? 'fullscreen' : ''} ${debugPanelOpen && isOpen ? 'with-debug-panel' : ''} ${gitPanelOpen && isOpen ? 'with-git-panel' : ''} ${buildingsPanelOpen && isOpen ? 'with-buildings-panel' : ''} ${workflowPanelOpen && isOpen ? 'with-workflow-panel' : ''} ${trackingBoardVisible && isOpen ? 'with-tracking-board' : ''} ${overviewPanelOpen && isOpen ? 'with-overview-panel' : ''} ${draggingOver ? 'drag-over' : ''} ${mobileSwipeCloseOffset > 0 ? 'mobile-swipe-close-active' : ''} ${isMobileSwipeClosing ? 'mobile-swipe-close-closing' : ''}`}
      style={{ '--terminal-height': `${terminalHeight}%`, '--mobile-swipe-close-offset': `${mobileSwipeCloseOffset}px`, '--guake-side-panel-width': `${sidePanelWidth}px`, ...(mobileOverviewHeight > 0 ? { '--guake-mobile-overview-height': `${mobileOverviewHeight}px` } : {}) } as React.CSSProperties}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      <div className="guake-drop-overlay">
        <div className="drop-border" />
        <span className="drop-icon"><Icon name="paperclip" size={16} /></span>
        <span className="drop-label">{t('terminal:input.dropToAttach')}</span>
      </div>

      {/* Debug Panel */}
      {debugPanelOpen && isOpen && activeAgentId && (
        <AgentDebugPanel agentId={activeAgentId} onClose={() => setDebugPanelOpen(false)} />
      )}

      {/* Git Panel */}
      {gitPanelOpen && isOpen && activeAgentId && (
        <GuakeGitPanel agentId={activeAgentId} agents={agents} onClose={() => setGitPanelOpen(false)} branchInfoMap={areaBranches} fetchRemote={fetchGitRemote} fetchingDirs={gitFetchingDirs} />
      )}

      {/* Area Buildings Panel */}
      {buildingsPanelOpen && isOpen && activeAgentId && (
        <AreaBuildingsPanel agentId={activeAgentId} onClose={() => setBuildingsPanelOpen(false)} />
      )}

      {/* Workflow Panel */}
      {workflowPanelOpen && isOpen && activeAgentId && (
        <WorkflowPanel agentId={activeAgentId} onClose={() => setWorkflowPanelOpen(false)} />
      )}

      {trackingBoardVisible && isOpen && activeAgentId && (
        <div className="guake-tracking-board-panel">
          <div className="guake-tracking-board-header">
            <div className="guake-tracking-board-title">
              <span className="guake-tracking-board-icon"><Icon name="list" size={14} /></span>
              <span>Tracking Board</span>
            </div>
            <button
              type="button"
              className="guake-tracking-board-close"
              onClick={() => store.setTrackingBoardVisible(false)}
              title="Close tracking board"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="guake-tracking-board-body">
            <TrackingBoard
              activeAgentId={activeAgentId}
              onSelectAgent={handleTrackingBoardSelectAgent}
            />
          </div>
        </div>
      )}

      {/* Right-side panel resize handle */}
      {(debugPanelOpen || gitPanelOpen || buildingsPanelOpen || workflowPanelOpen || trackingBoardVisible) && isOpen && (
        <div className="guake-side-panel-resize right" onMouseDown={(e) => handleSidePanelResizeStart(e, 'right')} />
      )}

      {/* Agent Overview Panel */}
      {overviewPanelOpen && isOpen && activeAgentId && (
        <AgentOverviewPanel
          activeAgentId={activeAgentId}
          onClose={() => setOverviewPanelOpen(false)}
          onSelectAgent={(agentId) => {
            store.setLastSelectionViaDirectClick(true);
            store.selectAgent(agentId);
          }}
          agentListRef={agentListRef}
          twoFingerState={twoFingerSelector}
        />
      )}

      {/* Overview panel resize handle (left side) */}
      {overviewPanelOpen && isOpen && activeAgentId && (
        <div className="guake-side-panel-resize left" onMouseDown={(e) => handleSidePanelResizeStart(e, 'left')} />
      )}

      {/* Mobile resize handle between overview and terminal */}
      {overviewPanelOpen && isOpen && activeAgentId && (
        <div
          className="aop-resize-handle"
          onMouseDown={handleOverviewResizeMouseDown}
          onTouchStart={handleOverviewResizeTouchStart}
        />
      )}

      <div className="guake-content">
        <TerminalHeader
          selectedAgent={activeAgent}
          selectedAgentId={activeAgentId}
          sortedAgents={swipe.sortedAgents}
          isSwipingLeft={swipe.indicatorDirection === 'left'}
          isSwipingRight={swipe.indicatorDirection === 'right'}
          viewMode={viewMode}
          setViewMode={setViewMode}
          searchMode={paneRef.current?.search.searchMode ?? false}
          toggleSearch={paneRef.current?.search.toggleSearch ?? (() => {})}
          closeSearch={paneRef.current?.search.closeSearch ?? (() => {})}
          debugPanelOpen={debugPanelOpen}
          setDebugPanelOpen={setDebugPanelOpen}
          debuggerEnabled={debuggerEnabled}
          setDebuggerEnabled={setDebuggerEnabled}
          gitPanelOpen={gitPanelOpen}
          setGitPanelOpen={setGitPanelOpen}
          buildingsPanelOpen={buildingsPanelOpen}
          setBuildingsPanelOpen={setBuildingsPanelOpen}
          workflowPanelOpen={workflowPanelOpen}
          setWorkflowPanelOpen={setWorkflowPanelOpen}
          hasWorkflow={hasWorkflowForAgent}
          trackingBoardVisible={trackingBoardVisible}
          setTrackingBoardVisible={(open) => store.setTrackingBoardVisible(open)}
          overviewPanelOpen={overviewPanelOpen}
          setOverviewPanelOpen={setOverviewPanelOpen}
          agentInfoOpen={agentInfoOpen}
          onToggleAgentInfo={toggleAgentInfo}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleFullscreenToggle}
          onNavigateBack={handleNavigateBack}
          onNavigateForward={handleNavigateForward}
          canNavigateBack={canNavigateBack}
          canNavigateForward={canNavigateForward}
          outputsLength={paneRef.current?.outputsLength ?? 0}
          setContextConfirm={setContextConfirm}
          onClearContextDirect={() => {
            store.clearContext(activeAgentId);
            paneRef.current?.historyLoader.clearHistory();
          }}
          headerRef={swipe.headerRef}
        />

        {/* Swipe container — gesture hook applies transform directly via containerRef */}
        <div
          ref={swipe.containerRef}
          className={`guake-swipe-container ${swipe.swipeAnimationClass}`}
        >
          {/* Swipe indicators — only mounted during drag, visible class controls opacity */}
          {swipe.sortedAgents.length > 1 && swipe.isDragging && (
            <>
              <div className={`swipe-indicator left ${swipe.indicatorDirection === 'right' ? 'visible' : ''}`}>
                <span className="indicator-icon"><Icon name="arrow-left" size={14} /></span>
                <span className="indicator-name">{swipe.prevAgent?.name}</span>
              </div>
              <div className={`swipe-indicator right ${swipe.indicatorDirection === 'left' ? 'visible' : ''}`}>
                <span className="indicator-name">{swipe.nextAgent?.name}</span>
                <span className="indicator-icon"><Icon name="arrow-right" size={14} /></span>
              </div>
            </>
          )}

          {/* Swipe dots */}
          {swipe.sortedAgents.length > 1 && swipe.sortedAgents.length <= 8 && swipe.isDragging && (
            <div className="swipe-dots visible">
              {swipe.sortedAgents.map((agent, index) => (
                <div key={agent.id} className={`swipe-dot ${index === swipe.currentAgentIndex ? 'active' : ''}`} />
              ))}
            </div>
          )}

          <SplitTerminalLayout
            activeAgentId={activeAgentId}
            activeAgent={activeAgent}
            paneRef={paneRef}
            viewMode={viewMode}
            isOpen={isOpen}
            onImageClick={handleImageClick}
            onFileClick={handleFileClick}
            onBashClick={handleBashClick}
            onViewMarkdown={handleViewMarkdown}
            keyboard={keyboard}
            canSwipeClose={
              isMobileWidth
              && mobileView === 'terminal'
              && !(paneRef.current?.search.searchMode)
              && !(paneRef.current?.historyLoader.fetchingHistory)
            }
            onSwipeCloseOffsetChange={handleMobileSwipeCloseOffsetChange}
            onSwipeClose={handleMobileSwipeClose}
            hasModalOpen={!!(imageModal || bashModal || responseModalContent || fileViewerPath)}
          />
        </div>

        {/* Agent Status Bar (CWD + Context) */}
        <div className="guake-agent-status-bar">
          {activeAgent?.isDetached && (
            <Tooltip
              content={
                <>
                  <div className="tide-tooltip__title"><Icon name="refresh" size={14} /> {t('terminal:empty.reattachingSessionTitle')}</div>
                  <div className="tide-tooltip__text">
                    {t('terminal:empty.reattachingSessionDesc')}
                    <br /><br />
                    <strong>{t('common:labels.status')}:</strong> {t('terminal:empty.reattachingSessionStatus')}
                  </div>
                </>
              }
              position="top"
              className="tide-tooltip--detached"
            >
              <span className="guake-detached-badge" title={t('terminal:empty.reattachingBadge')}>
                <span className="guake-detached-spinner"><Icon name="refresh" size={12} /></span> {t('terminal:empty.reattaching')}
              </span>
            </Tooltip>
          )}
          {activeAgent?.cwd && (
            <span className="guake-agent-cwd" title={activeAgent.cwd}>
              <Icon name="folder" size={12} /> {activeAgent.cwd.split('/').filter(Boolean).slice(-2).join('/') || activeAgent.cwd}
            </span>
          )}
          {agentAreaDirectories && agentAreaDirectories.map(({ areaId, areaName, dir }) => {
            const branchInfo = areaBranches.get(dir);
            const isFetching = gitFetchingDirs.has(dir);
            return (
              <span
                key={`${areaId}:${dir}`}
                className="guake-agent-area-dir"
                title={`${areaName}: ${dir}${branchInfo ? ` (${branchInfo.branch}${branchInfo.ahead ? ` ↑${branchInfo.ahead}` : ''}${branchInfo.behind ? ` ↓${branchInfo.behind}` : ''})` : ''}`}
                onClick={() => store.openFileExplorerForAreaFolder(areaId, dir)}
              >
                <Icon name="folder-open" size={12} /> {dir.split('/').filter(Boolean).pop() || dir}
                {branchInfo && (
                  <>
                    <span className="guake-agent-area-branch"> <Icon name="git-branch" size={10} /> {branchInfo.branch}</span>
                    {branchInfo.ahead > 0 && <span className="guake-branch-ahead" title={`${branchInfo.ahead} ahead`}><Icon name="arrow-up" size={9} />{branchInfo.ahead}</span>}
                    {branchInfo.behind > 0 && <span className="guake-branch-behind" title={`${branchInfo.behind} behind`}><Icon name="arrow-down" size={9} />{branchInfo.behind}</span>}
                    <span
                      className={`guake-area-fetch-btn ${isFetching ? 'fetching' : ''}`}
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
          {activeAgent && (() => {
            // Use contextStats if available (from /context command), otherwise fallback to basic
            const stats = activeAgent.contextStats;
            const hasData = !!stats;
            const totalTokens = stats ? stats.totalTokens : (activeAgent.contextUsed || 0);
            const contextWindow = stats ? stats.contextWindow : (activeAgent.contextLimit || 200000);
            const rawUsedPercent = stats ? stats.usedPercent : Math.round((totalTokens / contextWindow) * 100);
            const usedPercent = Math.max(0, Math.min(100, rawUsedPercent));
            const freePercent = Math.max(0, 100 - usedPercent);
            const percentColor = usedPercent >= 80 ? '#ff4a4a' : usedPercent >= 60 ? '#ff9e4a' : usedPercent >= 40 ? '#ffd700' : '#4aff9e';
            const usedK = (totalTokens / 1000).toFixed(1);
            const limitK = (contextWindow / 1000).toFixed(1);
            return (
              <span
                className="guake-agent-context"
                onClick={() => store.setContextModalAgentId(activeAgentId)}
                title={hasData ? t('terminal:context.clickToViewStats') : t('terminal:context.clickToFetchStats')}
              >
                <span className="context-icon"><Icon name="dashboard" size={12} /></span>
                <span className="context-label">{t('terminal:agentInfo.context')}:</span>
                <span className="context-bar-mini">
                  <span
                    className="context-bar-mini-fill"
                    style={{
                      width: `${Math.min(100, usedPercent)}%`,
                      backgroundColor: percentColor,
                    }}
                  />
                </span>
                <span className="context-tokens" style={{ color: percentColor }}>
                  {usedK}k/{limitK}k
                </span>
                <span className="context-free">({t('terminal:context.percentFree', { percent: freePercent })})</span>
                {!hasData && (
                  <span className="context-warning" title={t('terminal:context.clickToFetchStats')}><Icon name="warn" size={12} /></span>
                )}
              </span>
            );
          })()}
          <span className="guake-status-right">
            {/* Terminal toggle buttons for area terminal buildings */}
            {areaTerminalBuildings.length > 0 && (
              <span className="guake-status-terminals">
                {areaTerminalBuildings.map((tb) => {
                  const isActive = bottomPanelBuildingIds.has(tb.id);
                  return (
                    <button
                      key={tb.id}
                      className={`guake-status-terminal-btn ${isActive ? 'active' : ''} ${!tb.hasUrl ? 'offline' : ''}`}
                      title={`${isActive ? 'Hide' : 'Show'} terminal: ${tb.name}${!tb.hasUrl ? ' (starting...)' : ''}`}
                      onClick={() => {
                        if (isActive) {
                          // Close just this panel
                          const panel = bottomPanels.find(p => p.buildingId === tb.id);
                          if (panel) closeBottomPanel(panel.id);
                        } else {
                          if (!tb.hasUrl) {
                            store.sendBuildingCommand(tb.id, 'start');
                          }
                          openBottomPanel(tb.id, 'terminal');
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!bottomPanelBuildingIds.has(tb.id)) {
                          setSplitContextMenu({ position: { x: e.clientX, y: e.clientY }, buildingId: tb.id, type: 'terminal' });
                        }
                      }}
                    >
                      <Icon name="terminal" size={14} />
                    </button>
                  );
                })}
              </span>
            )}
            {/* PM2 log toggle buttons for area server buildings */}
            {areaPm2Buildings.length > 0 && (
              <span className="guake-status-terminals">
                {areaPm2Buildings.map((sb) => {
                  const isActive = bottomPanelBuildingIds.has(sb.id);
                  return (
                    <button
                      key={sb.id}
                      className={`guake-status-terminal-btn ${isActive ? 'active' : ''}`}
                      title={`${isActive ? 'Hide' : 'Show'} logs: ${sb.name}`}
                      onClick={() => {
                        if (isActive) {
                          const panel = bottomPanels.find(p => p.buildingId === sb.id);
                          if (panel) closeBottomPanel(panel.id);
                        } else {
                          openBottomPanel(sb.id, 'pm2-logs');
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!bottomPanelBuildingIds.has(sb.id)) {
                          setSplitContextMenu({ position: { x: e.clientX, y: e.clientY }, buildingId: sb.id, type: 'pm2-logs' });
                        }
                      }}
                    >
                      <Icon name="scroll" size={14} />
                    </button>
                  );
                })}
              </span>
            )}
            {/* Database toggle buttons for area database buildings */}
            {areaDatabaseBuildings.length > 0 && (
              <span className="guake-status-terminals">
                {areaDatabaseBuildings.map((db) => {
                  const isActive = bottomPanelBuildingIds.has(db.id);
                  return (
                    <button
                      key={db.id}
                      className={`guake-status-terminal-btn ${isActive ? 'active' : ''}`}
                      title={`${isActive ? 'Hide' : 'Show'} database: ${db.name}`}
                      onClick={() => {
                        if (isActive) {
                          const panel = bottomPanels.find(p => p.buildingId === db.id);
                          if (panel) closeBottomPanel(panel.id);
                        } else {
                          openBottomPanel(db.id, 'database');
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!bottomPanelBuildingIds.has(db.id)) {
                          setSplitContextMenu({ position: { x: e.clientX, y: e.clientY }, buildingId: db.id, type: 'database' });
                        }
                      }}
                    >
                      <Icon name="hard-drives" size={14} />
                    </button>
                  );
                })}
              </span>
            )}
            <ThemeSelector />
          </span>
        </div>

        {/* Split context menu — portaled to body to escape overflow:hidden + backdrop-filter */}
        {(() => {
          const splitActions: ContextMenuAction[] = [];
          if (splitContextMenu) {
            splitActions.push({
              id: 'open',
              label: 'Open',
              icon: <Icon name="arrow-down" size={14} />,
              onClick: () => openBottomPanel(splitContextMenu.buildingId, splitContextMenu.type),
            });
            if (activeAreaPanels.length > 0) {
              splitActions.push({
                id: 'split-right',
                label: 'Split Right',
                icon: <Icon name="arrows-horizontal" size={14} />,
                onClick: () => splitBottomPanel(splitContextMenu.buildingId, splitContextMenu.type, 'horizontal'),
              });
              splitActions.push({
                id: 'split-below',
                label: 'Split Below',
                icon: <Icon name="arrows-vertical" size={14} />,
                onClick: () => splitBottomPanel(splitContextMenu.buildingId, splitContextMenu.type, 'vertical'),
              });
            }
          }
          return (
            <ModalPortal>
              <ContextMenu
                isOpen={splitContextMenu !== null}
                position={splitContextMenu?.position || { x: 0, y: 0 }}
                worldPosition={{ x: 0, z: 0 }}
                actions={splitActions}
                onClose={() => setSplitContextMenu(null)}
              />
            </ModalPortal>
          );
        })()}

        {/* Bottom panels area - active area panels visible, others hidden to keep iframes alive */}
        {activeAreaPanels.length > 0 && (
          <>
            <div
              className="guake-bottom-terminal-resize"
              onMouseDown={handleBottomTerminalResizeStart}
            />
            <div
              ref={bottomPanelsContainerRef}
              className={`guake-bottom-panels-container ${splitDirection}`}
              style={{ height: bottomTerminalHeight }}
              onWheel={(e) => e.stopPropagation()}
            >
              {activeAreaPanels.map((panel, panelIndex) => {
                const building = buildings.get(panel.buildingId);
                if (!building) return null;
                const ratio = splitRatios[panelIndex] ?? 1;

                const panelContent = (() => {
                  if (panel.type === 'terminal') {
                    if (!building.terminalStatus?.url) {
                      return (
                        <div key={panel.id} className="guake-bottom-panel" style={{ flex: ratio }}>
                          <div className="guake-bottom-terminal-header">
                            <span className="guake-bottom-terminal-title"><Icon name="terminal" size={12} /> {building.name} (starting...)</span>
                            <button className="guake-bottom-terminal-close" onClick={() => closeBottomPanel(panel.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                          <div className="guake-bottom-terminal-starting"><span>Starting terminal...</span></div>
                        </div>
                      );
                    }
                    return (
                      <div key={panel.id} className="guake-bottom-panel" style={{ flex: ratio }}>
                        <div className="guake-bottom-terminal-header">
                          <span className="guake-bottom-terminal-title"><Icon name="terminal" size={12} /> {building.name}</span>
                          <button className="guake-bottom-terminal-close" onClick={() => closeBottomPanel(panel.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                        <TerminalEmbed
                          terminalUrl={building.terminalStatus.url}
                          visible={true}
                        />
                      </div>
                    );
                  }

                  if (panel.type === 'pm2-logs') {
                    const filterValue = bottomPanelFilters[panel.id] || '';
                    return (
                      <div key={panel.id} className="guake-bottom-panel" style={{ flex: ratio }}>
                        <div className="guake-bottom-terminal-header">
                          <span className="guake-bottom-terminal-title"><Icon name="scroll" size={12} /> {building.name}</span>
                          <div className="guake-bottom-terminal-controls">
                            <input
                              type="text"
                              className="guake-bottom-terminal-filter"
                              value={filterValue}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                setBottomPanelFilters((prev) => {
                                  if (!nextValue.trim()) {
                                    if (!(panel.id in prev)) return prev;
                                    const next = { ...prev };
                                    delete next[panel.id];
                                    return next;
                                  }
                                  return { ...prev, [panel.id]: nextValue };
                                });
                              }}
                              placeholder="Filter logs"
                              aria-label={`Filter logs for ${building.name}`}
                              spellCheck={false}
                            />
                            <select
                              className="guake-bottom-terminal-retention"
                              value={bottomPm2LogRetention === null ? 'unlimited' : String(bottomPm2LogRetention)}
                              onChange={(e) => {
                                const nextValue = e.target.value === 'unlimited' ? null : Number(e.target.value);
                                setBottomPm2LogRetention(nextValue);
                                writeBottomPm2LogRetention(nextValue);
                              }}
                              aria-label={`Max log retention for ${building.name}`}
                            >
                              {BOTTOM_PM2_LOG_RETENTION_OPTIONS.map((option) => (
                                <option key={option === null ? 'unlimited' : option} value={option === null ? 'unlimited' : String(option)}>
                                  {option === null ? 'Unlimited' : `${option.toLocaleString()} lines`}
                                </option>
                              ))}
                            </select>
                            <button
                              className="guake-bottom-terminal-close"
                              onClick={() => store.clearStreamingLogs(panel.buildingId)}
                              title="Clear logs"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                              </svg>
                            </button>
                            <button
                              className="guake-bottom-terminal-close"
                              onClick={() => store.sendBuildingCommand(panel.buildingId, 'restart')}
                              title="Restart"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 105.64-11.36L3 10" />
                              </svg>
                            </button>
                            <button className="guake-bottom-terminal-close" onClick={() => closeBottomPanel(panel.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <BottomPm2LogContent
                          buildingId={panel.buildingId}
                          filterText={filterValue}
                          maxRetention={bottomPm2LogRetention}
                        />
                      </div>
                    );
                  }

                  // database panel (compact inline version)
                  return (
                    <div key={panel.id} className="guake-bottom-panel" style={{ flex: ratio }}>
                      <div className="guake-bottom-terminal-header">
                        <span className="guake-bottom-terminal-title"><Icon name="hard-drives" size={12} /> {building.name}</span>
                        <button className="guake-bottom-terminal-close" onClick={() => closeBottomPanel(panel.id)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                      <DatabasePanelInline building={building} />
                    </div>
                  );
                })();

                // Insert resize divider before each panel except the first
                if (panelIndex > 0) {
                  return (
                    <React.Fragment key={panel.id}>
                      <div
                        className={`guake-split-divider ${splitDirection}`}
                        onMouseDown={(e) => handleSplitResizeStart(e, panelIndex - 1)}
                      />
                      {panelContent}
                    </React.Fragment>
                  );
                }
                return panelContent;
              })}
            </div>
          </>
        )}
        {/* Keep inactive terminal embeds alive (hidden, not initialized until visible) */}
        {bottomPanels
          .filter(p => p.areaId !== activeBottomAreaId && p.type === 'terminal')
          .map(panel => {
            const building = buildings.get(panel.buildingId);
            if (!building?.terminalStatus?.url) return null;
            return (
              <TerminalEmbed
                key={panel.id}
                terminalUrl={building.terminalStatus.url}
                visible={false}
              />
            );
          })}
      </div>

      {/* Resize handle */}
      {isOpen && !isFullscreen && <div className="guake-resize-handle" onMouseDown={handleResizeStart} title={t('common:rightPanel.dragToResize')} />}

      {/* Terminal handle */}
      {!(isOpen && isFullscreen) && (
        <div
          className="guake-handle"
          onClick={() => { if (isOpen) store.toggleTerminal(); }}
          onDoubleClick={() => { if (!isOpen) store.toggleTerminal(); }}
          style={{ top: isOpen ? `min(${terminalHeight}%, calc(100vh - 72px))` : '0' }}
        >
          <span className="guake-handle-icon"><Icon name={isOpen ? 'caret-up' : 'caret-down'} size={12} /></span>
          <span className="guake-handle-text">{activeAgent.name}</span>
        </div>
      )}

      {/* Modals */}
      {imageModal && <ImageModal url={imageModal.url} name={imageModal.name} onClose={() => setImageModal(null)} />}
      {bashModal && <BashModal state={bashModal} onClose={() => setBashModal(null)} />}
      {contextConfirm && (
        <ContextConfirmModal
          action={contextConfirm}
          selectedAgentId={activeAgentId}
          subordinateCount={activeAgent?.subordinateIds?.length || 0}
          onClose={() => setContextConfirm(null)}
          onClearHistory={paneRef.current?.historyLoader.clearHistory ?? (() => {})}
        />
      )}
      <ContextModalFromGuake />
      <FileViewerFromGuake />
      <AgentInfoModal agent={activeAgent} isOpen={agentInfoOpen} onClose={() => setAgentInfoOpen(false)} />
      {(
        <AgentResponseModalWrapper agent={activeAgent} content={responseModalContent} onClose={() => setResponseModalContent(null)} />
      )}
    </div>
  );
});

// Re-export types for convenience
export type { HistoryMessage, AttachedFile, ViewMode, EditData } from './types';
