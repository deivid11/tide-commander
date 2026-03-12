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
import { useTranslation } from 'react-i18next';
import {
  useAgents,
  useAgent,
  useSelectedAgentIds,
  useTerminalOpen,
  useLastPrompts,
  useAgentOutputs,
  useMobileView,
  store,
  useReconnectCount,
  useHistoryRefreshTrigger,
  useAgentTaskProgress,
  useExecTasks,
  useSubagentsMapForAgent,
  useFileViewerPath,
  useContextModalAgentId,
  useCurrentSnapshot,
  useOverviewPanelOpen,
  usePermissionRequests,
  useAreas,
  useBuildings,
} from '../../store';
import {
  STORAGE_KEYS,
  getStorageBoolean,
  getStorageNumber,
  getStorageString,
  setStorageBoolean,
  setStorageNumber,
  authUrl,
} from '../../utils/storage';
import { resolveAgentFileReference } from '../../utils/filePaths';

// Import types
import type { ViewMode, EnrichedHistoryMessage } from './types';

// Import extracted hooks
import { useKeyboardHeight } from './useKeyboardHeight';
import { useTerminalResize } from './useTerminalResize';
import { useMobileOverviewResize } from './useMobileOverviewResize';
import { useSwipeNavigation } from './useSwipeNavigation';
import { useHistoryLoader } from './useHistoryLoader';
import { useSearchHistory } from './useSearchHistory';
import { useTerminalInput } from './useTerminalInput';
import { useMessageNavigation } from './useMessageNavigation';
import { useGitBranches } from './useGitBranch';
import { useFilteredOutputsWithLogging } from '../shared/useFilteredOutputs';
import { parseBossContext, parseInjectedInstructions } from './BossContext';
import { useModalStackRegistration, hasModalsAbove } from '../../hooks/useModalStack';

// Import extracted components
import { TerminalHeader, SearchBar } from './TerminalHeader';
import { TerminalInputArea } from './TerminalInputArea';
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
import { VirtualizedOutputList } from './VirtualizedOutputList';
import { AgentDebugPanel } from './AgentDebugPanel';
import { GuakeGitPanel } from './GuakeGitPanel';
import { AgentOverviewPanel } from './AgentOverviewPanel';
import { AreaBuildingsPanel } from './AreaBuildingsPanel';
import { useTwoFingerSelector } from '../../hooks/useTwoFingerSelector';
import { agentDebugger } from '../../services/agentDebugger';
import { AgentProgressIndicator } from './AgentProgressIndicator';
import { ThemeSelector } from './ThemeSelector';
import { Tooltip } from '../shared/Tooltip';
import type { Agent } from '../../../shared/types';

const LIVE_DUPLICATE_WINDOW_MS = 10_000;
const HISTORY_OUTPUT_DUPLICATE_WINDOW_MS = 30_000;
const HISTORY_ASSISTANT_OUTPUT_DUPLICATE_WINDOW_MS = 120_000;
const MOBILE_CLOSE_SWIPE_MAX_OFFSET_PX = 128;
const MOBILE_CLOSE_SWIPE_RELEASE_MS = 95;

function normalizeUserMessage(text: string): string {
  const parsedBoss = parseBossContext(text);
  const parsedInjected = parseInjectedInstructions(parsedBoss.userMessage);
  return parsedInjected.userMessage.trim().replace(/\r\n/g, '\n');
}

function normalizeAssistantMessage(text: string): string {
  return text.trim().replace(/\r\n/g, '\n');
}

function isToolOrSystemOutput(text: string): boolean {
  return text.startsWith('Using tool:')
    || text.startsWith('Tool input:')
    || text.startsWith('Tool result:')
    || text.startsWith('Bash output:')
    || text.startsWith('Session started:')
    || text.startsWith('[thinking]')
    || text.startsWith('Tokens:')
    || text.startsWith('Cost:')
    || text.startsWith('Context (estimated from Codex turn usage):')
    || text.startsWith('🔄 [System]')
    || text.startsWith('📋 [System]')
    || text.startsWith('[System]');
}

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

export interface GuakeOutputPanelProps {
  /** Callback when user clicks star button to save snapshot */
  onSaveSnapshot?: () => void;
}

export const GuakeOutputPanel = memo(function GuakeOutputPanel({ onSaveSnapshot }: GuakeOutputPanelProps = {}) {
  const { t } = useTranslation(['terminal', 'common']);
  // Store selectors
  const agents = useAgents();
  const selectedAgentIds = useSelectedAgentIds();
  const terminalOpen = useTerminalOpen();
  const lastPrompts = useLastPrompts();
  const reconnectCount = useReconnectCount();
  const historyRefreshTrigger = useHistoryRefreshTrigger();
  const mobileView = useMobileView();
  const fileViewerPath = useFileViewerPath();
  const contextModalAgentId = useContextModalAgentId();

  // Get current snapshot from store
  const currentSnapshot = useCurrentSnapshot();
  const isSnapshotView = !!currentSnapshot;

  // Snapshots should be viewable even when no agent is selected/running.
  const snapshotAgent = useMemo<Agent | null>(() => {
    if (!currentSnapshot) return null;
      return {
        id: currentSnapshot.agentId,
        name: currentSnapshot.agentName,
        class: currentSnapshot.agentClass as Agent['class'],
        status: 'idle',
        provider: 'claude',
      position: { x: 0, y: 0, z: 0 },
      cwd: currentSnapshot.cwd,
      permissionMode: 'interactive',
      tokensUsed: 0,
      contextUsed: 0,
      contextLimit: 200000,
      taskCount: 0,
      createdAt: currentSnapshot.createdAt,
      lastActivity: currentSnapshot.createdAt,
    };
  }, [currentSnapshot]);

  // Get selected agent
  const selectedAgentIdsArray = Array.from(selectedAgentIds);
  const isSingleSelection = selectedAgentIdsArray.length === 1;
  const selectedAgentId = isSingleSelection ? selectedAgentIdsArray[0] : null;
  const selectedAgent = useAgent(selectedAgentId) || null;

  const activeAgent = selectedAgent ?? (isSnapshotView ? snapshotAgent : null);
  const activeAgentId = selectedAgentId ?? (isSnapshotView ? currentSnapshot?.agentId ?? null : null);
  const hasSessionId = !!activeAgent?.sessionId && !isSnapshotView;

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
  const outputs = useAgentOutputs(activeAgentId);

  // Use snapshot outputs if viewing a snapshot, otherwise use agent outputs
  const displayOutputs = useMemo(() => {
    if (!(isSnapshotView && currentSnapshot)) return outputs;
    return currentSnapshot.outputs.map((output: any) => ({
      text: output.text || '',
      timestamp: output.timestamp,
      isStreaming: false,
      isUserPrompt: false,
    }));
  }, [isSnapshotView, currentSnapshot, outputs]);

  // Shared ref for output scroll container (used by history loader and swipe)
  const outputScrollRef = useRef<HTMLDivElement>(null);

  // Ref for the agent overview list (shared with two-finger selector)
  const agentListRef = useRef<HTMLDivElement>(null);

  // Refs for terminal input elements (shared with message navigation for focus-on-type)
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const terminalTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Agent overview panel state (persisted in store across agent switches)
  const overviewPanelOpen = useOverviewPanelOpen();
  const setOverviewPanelOpen = useCallback((open: boolean) => store.setOverviewPanelOpen(open), []);

  // Bottom embedded terminal panel - persisted per area in localStorage
  const [bottomTerminalBuildingId, setBottomTerminalBuildingId] = useState<string | null>(null);
  const [bottomTerminalHeight, setBottomTerminalHeight] = useState(() => {
    try {
      const h = localStorage.getItem('tide:bottom-terminal-height');
      return h ? Math.max(120, Math.min(600, Number(h))) : 250;
    } catch { return 250; }
  });
  const bottomTerminalResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const bottomTerminalMapRef = useRef<Map<string, string>>(new Map());

  // Load per-area bottom terminal map from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tide:bottom-terminals');
      if (saved) {
        const entries = JSON.parse(saved) as [string, string][];
        bottomTerminalMapRef.current = new Map(entries);
      }
    } catch { /* ignore */ }
  }, []);

  // Helper to persist the map
  const persistBottomTerminals = useCallback(() => {
    try {
      const entries = Array.from(bottomTerminalMapRef.current.entries());
      localStorage.setItem('tide:bottom-terminals', JSON.stringify(entries));
    } catch { /* ignore */ }
  }, []);

  // When active agent changes, restore or hide bottom terminal based on area
  useEffect(() => {
    if (!activeAgentId) {
      setBottomTerminalBuildingId(null);
      return;
    }
    const area = store.getAreaForAgent(activeAgentId);
    if (!area) {
      setBottomTerminalBuildingId(null);
      return;
    }
    const saved = bottomTerminalMapRef.current.get(area.id);
    setBottomTerminalBuildingId(saved || null);
  }, [activeAgentId]);

  // Wrap setBottomTerminalBuildingId to also save per area
  const setBottomTerminal = useCallback((buildingId: string | null) => {
    setBottomTerminalBuildingId(buildingId);
    if (!activeAgentId) return;
    const area = store.getAreaForAgent(activeAgentId);
    if (!area) return;
    if (buildingId) {
      bottomTerminalMapRef.current.set(area.id, buildingId);
    } else {
      bottomTerminalMapRef.current.delete(area.id);
    }
    persistBottomTerminals();
  }, [activeAgentId, persistBottomTerminals]);

  // Listen for open-bottom-terminal events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ buildingId: string }>).detail;
      if (detail?.buildingId) {
        setBottomTerminal(detail.buildingId);
      }
    };
    window.addEventListener('tide:open-bottom-terminal', handler as EventListener);
    return () => window.removeEventListener('tide:open-bottom-terminal', handler as EventListener);
  }, [setBottomTerminal]);

  // Track whether the bottom terminal previously had a URL.
  // When a running terminal stops (URL disappears), auto-close the panel
  // so the user doesn't get stuck on a "Starting terminal..." placeholder.
  const bottomTerminalHadUrlRef = useRef(false);
  useEffect(() => {
    if (!bottomTerminalBuildingId) {
      bottomTerminalHadUrlRef.current = false;
      return;
    }
    const building = buildings.get(bottomTerminalBuildingId);
    const hasUrl = !!building?.terminalStatus?.url;
    if (hasUrl) {
      bottomTerminalHadUrlRef.current = true;
    } else if (bottomTerminalHadUrlRef.current) {
      // Terminal was running but lost its URL — it stopped
      setBottomTerminal(null);
      bottomTerminalHadUrlRef.current = false;
    }
  }, [bottomTerminalBuildingId, buildings, setBottomTerminal]);

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

  // Completion indicator state
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionElapsed, setCompletionElapsed] = useState<number | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History fade-in state
  const [historyFadeIn, setHistoryFadeIn] = useState(false);
  const [pinToBottom, setPinToBottom] = useState(false);
  const [isAgentSwitching, setIsAgentSwitching] = useState(false);

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

  // History loader hook
  const historyLoader = useHistoryLoader({
    selectedAgentId: activeAgentId,
    hasSessionId,
    reconnectCount,
    historyRefreshTrigger,
    lastPrompts,
    outputScrollRef,
  });

  // Search hook initialized below after dedupedHistory/dedupedOutputs are computed

  // Swipe navigation hook (horizontal agent switching)
  const swipe = useSwipeNavigation({
    agents,
    selectedAgentId: activeAgentId,
    isOpen,
    overviewPanelOpen,
    // Use in-flight flag so swipe-in animation waits even when the UI loading flag is delayed
    loadingHistory: historyLoader.fetchingHistory,
    hasModalOpen: !!(imageModal || bashModal || responseModalContent || fileViewerPath || contextModalAgentId),
    outputRef: outputScrollRef,
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
    gestureRef: outputScrollRef,
    agentListRef,
    enabled: twoFingerEnabled,
    onSelect: handleTwoFingerSelect,
  });

  // Terminal input hook
  const terminalInput = useTerminalInput({ selectedAgentId });

  // Get pending permission requests - subscribe to store changes so we see new permissions
  const permissionRequests = usePermissionRequests();
  const pendingPermissions = useMemo(() => {
    if (isSnapshotView || !activeAgentId) return [];
    return Array.from(permissionRequests.values()).filter(
      (r) => r.agentId === activeAgentId && r.status === 'pending'
    );
  }, [isSnapshotView, activeAgentId, permissionRequests]);

  // Check if selected agent is a boss
  const isBoss = activeAgent?.class === 'boss' || activeAgent?.isBoss;
  const agentTaskProgress = useAgentTaskProgress(!isSnapshotView && isBoss ? activeAgentId : null);
  const activeTaskProgress = useMemo(
    () => Array.from(agentTaskProgress.values()).filter((progress) => progress.status === 'working'),
    [agentTaskProgress]
  );
  const completedTaskProgressIds = useMemo(
    () => Array.from(agentTaskProgress.values())
      .filter((progress) => progress.status === 'completed' || progress.status === 'failed')
      .map((progress) => progress.agentId),
    [agentTaskProgress]
  );
  const [agentProgressCollapsed, setAgentProgressCollapsed] = useState(true);

  // Get exec tasks for the selected agent
  const execTasks = useExecTasks(!isSnapshotView ? activeAgentId : null);

  // Get subagents for inline activity display (scoped to active agent to avoid re-renders from other agents)
  const subagents = useSubagentsMapForAgent(!isSnapshotView ? activeAgentId : null);

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

  useEffect(() => {
    if (!activeAgentId || !isBoss || isSnapshotView || completedTaskProgressIds.length === 0) {
      return;
    }

    const dismissTimer = window.setTimeout(() => {
      completedTaskProgressIds.forEach((subordinateId) => {
        store.clearAgentTaskProgress(activeAgentId, subordinateId);
      });
    }, 300);

    return () => window.clearTimeout(dismissTimer);
  }, [activeAgentId, isBoss, isSnapshotView, completedTaskProgressIds]);

  // Detect completion state
  useEffect(() => {
    const currentStatus = activeAgent?.status;
    const prevStatus = prevStatusRef.current;

    if (prevStatus === 'working' && currentStatus === 'idle') {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
      // Capture elapsed time from last prompt
      const prompt = activeAgentId ? lastPrompts.get(activeAgentId) : undefined;
      setCompletionElapsed(prompt?.timestamp ? Date.now() - prompt.timestamp : null);
      setShowCompletion(true);
      completionTimerRef.current = setTimeout(() => {
        setShowCompletion(false);
        setCompletionElapsed(null);
        completionTimerRef.current = null;
      }, 4000);
    } else if (currentStatus === 'working') {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      setShowCompletion(false);
      setCompletionElapsed(null);
    }

    prevStatusRef.current = currentStatus || null;

    return () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, [activeAgent?.status]);

  // Memoized filtered history
  const filteredHistory = useMemo((): EnrichedHistoryMessage[] => {
    const { history } = historyLoader;
    const toolResultMap = new Map<string, string>();
    for (const msg of history) {
      if (msg.type === 'tool_result' && msg.toolUseId) {
        toolResultMap.set(msg.toolUseId, msg.content);
      }
    }

    const enrichHistory = (messages: typeof history): EnrichedHistoryMessage[] => {
      return messages.map((msg) => {
        if (msg.type === 'tool_use' && msg.toolName === 'Bash' && msg.toolUseId) {
          const bashOutput = toolResultMap.get(msg.toolUseId);
          let bashCommand: string | undefined;
          try {
            const input = msg.toolInput || (msg.content ? JSON.parse(msg.content) : {});
            bashCommand = input.command;
          } catch { /* ignore */ }
          return { ...msg, _bashOutput: bashOutput, _bashCommand: bashCommand };
        }
        return msg as EnrichedHistoryMessage;
      });
    };

    return enrichHistory(history);
  }, [historyLoader.history, viewMode]);

  // Filtered outputs
  const filteredOutputs = useFilteredOutputsWithLogging({ outputs: displayOutputs, viewMode });

  // Remove accidental duplicate user prompts from history (same normalized text, emitted within a short window)
  const dedupedHistory = useMemo((): EnrichedHistoryMessage[] => {
    const result: EnrichedHistoryMessage[] = [];
    const seenAssistantKeys = new Set<string>();
    const seenUserUuidKeys = new Set<string>();
    let lastUserKey: string | null = null;
    let lastUserTs = 0;

    for (const msg of filteredHistory) {
      if (msg.type === 'assistant') {
        const assistantKey = msg.uuid
          ? `uuid:${msg.uuid}:${normalizeAssistantMessage(msg.content)}`
          : `sig:${msg.timestamp}:${normalizeAssistantMessage(msg.content)}`;
        if (seenAssistantKeys.has(assistantKey)) {
          continue;
        }
        seenAssistantKeys.add(assistantKey);
        result.push(msg);
        continue;
      }

      if (msg.type !== 'user') {
        result.push(msg);
        continue;
      }

      const key = normalizeUserMessage(msg.content);
      const userUuidKey = msg.uuid ? `uuid:${msg.uuid}:${key}` : null;
      if (userUuidKey && seenUserUuidKeys.has(userUuidKey)) {
        continue;
      }
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (lastUserKey === key && Math.abs(ts - lastUserTs) <= LIVE_DUPLICATE_WINDOW_MS) {
        continue;
      }

      result.push(msg);
      if (userUuidKey) {
        seenUserUuidKeys.add(userUuidKey);
      }
      lastUserKey = key;
      lastUserTs = ts;
    }

    return result;
  }, [filteredHistory]);

  // Remove live user prompts that are duplicates of very recent history/live prompts
  const dedupedOutputs = useMemo(() => {
    const latestHistoryUserTsByKey = new Map<string, number>();
    const historyAssistantUuidSet = new Set<string>();
    const latestHistoryAssistantTsByKey = new Map<string, number>();
    for (const msg of dedupedHistory) {
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (msg.type === 'user') {
        const key = normalizeUserMessage(msg.content);
        const prev = latestHistoryUserTsByKey.get(key) ?? 0;
        if (ts > prev) latestHistoryUserTsByKey.set(key, ts);
        continue;
      }
      if (msg.type !== 'assistant') continue;
      if (msg.uuid) {
        historyAssistantUuidSet.add(msg.uuid);
      }
      const key = normalizeAssistantMessage(msg.content);
      const prev = latestHistoryAssistantTsByKey.get(key) ?? 0;
      if (ts > prev) latestHistoryAssistantTsByKey.set(key, ts);
    }

    const result: typeof filteredOutputs = [];
    let lastLiveUserKey: string | null = null;
    let lastLiveUserTs = 0;

    for (const output of filteredOutputs) {
      if (!output.isUserPrompt) {
        if (!output.isStreaming && !isToolOrSystemOutput(output.text)) {
          if (output.uuid && historyAssistantUuidSet.has(output.uuid)) {
            continue;
          }
          const key = normalizeAssistantMessage(output.text);
          const ts = output.timestamp || 0;
          const historyTs = latestHistoryAssistantTsByKey.get(key);
          if (historyTs && Math.abs(ts - historyTs) <= HISTORY_ASSISTANT_OUTPUT_DUPLICATE_WINDOW_MS) {
            continue;
          }
        }
        result.push(output);
        continue;
      }

      const key = normalizeUserMessage(output.text);
      const ts = output.timestamp || 0;
      const latestHistoryTs = latestHistoryUserTsByKey.get(key);

      // Duplicate of freshly-loaded history copy of the same user prompt
      if (latestHistoryTs && ts >= latestHistoryTs && ts - latestHistoryTs <= HISTORY_OUTPUT_DUPLICATE_WINDOW_MS) {
        continue;
      }

      // Duplicate command_started events that occasionally arrive twice
      if (lastLiveUserKey === key && Math.abs(ts - lastLiveUserTs) <= LIVE_DUPLICATE_WINDOW_MS) {
        continue;
      }

      result.push(output);
      lastLiveUserKey = key;
      lastLiveUserTs = ts;
    }

    return result;
  }, [filteredOutputs, dedupedHistory]);

  // Combined items for client-side search
  const allSearchItems = useMemo(
    () => [...dedupedHistory, ...dedupedOutputs],
    [dedupedHistory, dedupedOutputs]
  );

  // Search hook (client-side, WhatsApp-style navigation)
  // Loads all remaining history pages when search activates for full-conversation coverage
  const search = useSearchHistory({
    selectedAgentId: activeAgentId,
    isOpen,
    allItems: allSearchItems,
    viewMode,
    hasMoreHistory: historyLoader.hasMore,
    loadAllHistory: historyLoader.loadAllHistory,
    loadingMore: historyLoader.loadingMore,
  });

  // Total navigable messages count (history + live outputs)
  const totalNavigableMessages = dedupedHistory.length + dedupedOutputs.length;

  // Message navigation hook (Alt+J/K)
  const messageNav = useMessageNavigation({
    totalMessages: totalNavigableMessages,
    isOpen,
    hasModalOpen: !!(imageModal || bashModal || responseModalContent || fileViewerPath),
    scrollContainerRef: outputScrollRef,
    selectedAgentId: activeAgentId,
    inputRef: terminalInputRef,
    textareaRef: terminalTextareaRef,
    useTextarea: terminalInput.useTextarea,
  });

  // Auto-update bash modal when output arrives
  useEffect(() => {
    if (!bashModal?.isLive || !bashModal.command) return;
    for (const output of dedupedOutputs) {
      if (output._bashCommand === bashModal.command && output._bashOutput) {
        setBashModal({ command: bashModal.command, output: output._bashOutput, isLive: false });
        return;
      }
    }
  }, [bashModal, dedupedOutputs]);

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

  // Scroll handling - track if user scrolled up to disable auto-scroll
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [mobileSwipeCloseOffset, setMobileSwipeCloseOffset] = useState(0);
  const [isMobileSwipeClosing, setIsMobileSwipeClosing] = useState(false);
  const isUserScrolledUpRef = useRef(false);
  const pendingSelectionScrollRef = useRef(false);
  // Grace period after agent switch - don't detect user scroll during this time
  const agentSwitchGraceRef = useRef(false);

  const handleUserScrollUp = useCallback(() => {
    // Don't disable auto-scroll during grace period after agent switch
    if (agentSwitchGraceRef.current) return;
    isUserScrolledUpRef.current = true;
    setShouldAutoScroll(false);
  }, []);

  const handlePinCancel = useCallback(() => setPinToBottom(false), []);

  // Reset auto-scroll when user sends a message so terminal scrolls to bottom
  const handleSendCommand = useCallback(() => {
    isUserScrolledUpRef.current = false;
    setShouldAutoScroll(true);
  }, []);

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

  // Reset auto-scroll when agent changes (NOT on new outputs - that would override user scroll-up)
  useEffect(() => {
    setShouldAutoScroll(true);
    setMobileSwipeCloseOffset(0);
    setIsMobileSwipeClosing(false);
    isUserScrolledUpRef.current = false;
    pendingSelectionScrollRef.current = true;
    // Start grace period - for 3 seconds after agent change, don't detect user scroll
    agentSwitchGraceRef.current = true;
    const timeout = setTimeout(() => {
      agentSwitchGraceRef.current = false;
    }, 3000);
    return () => clearTimeout(timeout);
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

  useEffect(() => {
    if (!pendingSelectionScrollRef.current) return;
    if (!activeAgentId) return;
    if (isAgentSwitching) return;
    if (historyLoader.fetchingHistory) return;

    let rafId = 0;
    let rafId2 = 0;
    rafId = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        if (outputScrollRef.current) {
          outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
        }
        pendingSelectionScrollRef.current = false;
      });
    });

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(rafId2);
    };
  }, [activeAgentId, isAgentSwitching, historyLoader.fetchingHistory, historyLoader.historyLoadVersion]);

  // Keep historyLoader.handleScroll in a ref so handleScroll callback stays stable
  const historyLoaderHandleScrollRef = useRef(historyLoader.handleScroll);
  historyLoaderHandleScrollRef.current = historyLoader.handleScroll;

  const handleScroll = useCallback(() => {
    if (!outputScrollRef.current) return;
    if (keyboard.keyboardScrollLockRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = outputScrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;

    // Only track user scroll state outside of grace period
    if (!agentSwitchGraceRef.current) {
      isUserScrolledUpRef.current = !isAtBottom;

      if (isAtBottom) {
        setShouldAutoScroll(true);
      }
    }

    historyLoaderHandleScrollRef.current(keyboard.keyboardScrollLockRef);
  }, [outputScrollRef, keyboard.keyboardScrollLockRef]);

  // Auto-scroll on new output (only if user hasn't scrolled up)
  const lastOutputLength = outputs.length > 0 ? outputs[outputs.length - 1]?.text?.length || 0 : 0;
  useEffect(() => {
    if (keyboard.keyboardScrollLockRef.current) return;
    if (isUserScrolledUpRef.current) return;
    requestAnimationFrame(() => {
      if (outputScrollRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = outputScrollRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
        if (isAtBottom) {
          outputScrollRef.current.scrollTop = scrollHeight;
        }
      }
    });
  }, [outputs.length, lastOutputLength, keyboard.keyboardScrollLockRef, outputScrollRef]);

  // Hide content immediately when agent changes (useLayoutEffect to avoid flicker).
  // For cached agents: skip isAgentSwitching entirely — content stays visible and
  // VirtualizedOutputList remounts via key={activeAgentId} with cached data.
  // For non-cached agents: hide content while history fetches.
  const prevSelectedAgentIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const prev = prevSelectedAgentIdRef.current;
    const changed = prev !== null && prev !== selectedAgentId;

    if (changed) {
      // Always hide content during switch — the VirtualizedOutputList remounts via
      // key={activeAgentId} and needs a few frames to rebuild + scroll to bottom.
      // Content is revealed by the fade-in after scroll stabilises.
      setHistoryFadeIn(false);

      const hasCached = selectedAgentId ? historyLoader.hasCachedHistory(selectedAgentId) : false;
      if (!hasCached) {
        // No cache: also show loading indicator while history fetches
        setIsAgentSwitching(true);
      }

      if (store.getState().currentSnapshot) {
        store.setCurrentSnapshot(null);
      }
    } else if (!selectedAgentId) {
      setHistoryFadeIn(false);
    }

    prevSelectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  // Keep Guake output empty while agent switch is still settling (history fetch/cache rebind).
  useEffect(() => {
    if (!isAgentSwitching) return;
    if (historyLoader.fetchingHistory) return;
    const raf = requestAnimationFrame(() => {
      // Reset scroll position before VirtualizedOutputList remounts so the
      // virtualizer doesn't initialise at a stale offset (which can cause it
      // to calculate zero visible items until the user scrolls).
      if (outputScrollRef.current) {
        outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
      }
      setIsAgentSwitching(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [isAgentSwitching, historyLoader.fetchingHistory, historyLoader.historyLoadVersion]);

  // Track when we need to scroll and fade in (to avoid stale closure issues)
  const pendingFadeInRef = useRef(false);

  // Clear unseen badge when terminal is open and agent is visible
  useEffect(() => {
    if (isOpen && selectedAgentId) {
      store.clearUnseenForAgent(selectedAgentId);
    }
  }, [isOpen, selectedAgentId]);

  // Mark pending fade-in when agent changes
  useEffect(() => {
    pendingFadeInRef.current = true;
    setPinToBottom(true);
  }, [activeAgentId, reconnectCount]);

  // If history fetching starts after agent selection (e.g., session establishment),
  // ensure we still perform the post-load scroll.
  useEffect(() => {
    if (historyLoader.fetchingHistory) {
      pendingFadeInRef.current = true;
      setPinToBottom(true);
    }
  }, [historyLoader.fetchingHistory]);

  // Release pinning once the scroll container stabilizes at the bottom after a load.
  useEffect(() => {
    if (!pinToBottom) return;
    if (!isOpen) return;
    if (historyLoader.fetchingHistory) return;

    const container = outputScrollRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const start = performance.now();
    let stableFrames = 0;
    let lastScrollHeight = -1;

    const isAtBottom = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight <= 2;
    };

    const tick = () => {
      const now = performance.now();
      const currentScrollHeight = container.scrollHeight;
      const heightStable = Math.abs(currentScrollHeight - lastScrollHeight) <= 1;
      const atBottom = isAtBottom();

      if (heightStable && atBottom) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      lastScrollHeight = currentScrollHeight;

      // If we've been stable at the bottom for a few frames, stop pinning.
      // VirtualizedOutputList's RAF loop handles the active scrolling;
      // this loop only observes when it's safe to release.
      if (stableFrames >= 3) {
        setPinToBottom(false);
        rafId = null;
        return;
      }

      // Hard cap so we don't pin forever on pathological content.
      if (now - start > 8000) {
        setPinToBottom(false);
        rafId = null;
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [pinToBottom, isOpen, historyLoader.fetchingHistory, historyLoader.historyLoadVersion]);

  // After content loads: fade in once scroll has stabilized.
  // Primary path: pinToBottom transitions true→false when stabilization loop completes.
  const prevPinToBottomRef = useRef(false);
  useEffect(() => {
    if (prevPinToBottomRef.current && !pinToBottom && pendingFadeInRef.current) {
      // Scroll stabilization just completed — safe to show content
      pendingFadeInRef.current = false;
      setHistoryFadeIn(true);
    }
    prevPinToBottomRef.current = pinToBottom;
  }, [pinToBottom]);

  // Fallback: if pinToBottom was never activated or was already false when
  // history finished loading, trigger fade-in once fetch completes.
  useEffect(() => {
    if (!isOpen) return;
    if (!pendingFadeInRef.current) return;
    if (pinToBottom) return; // Wait for stabilization loop instead
    if (historyLoader.fetchingHistory) return; // Wait for fetch to complete

    // Pin was never active or already released — content is ready
    const rafId = requestAnimationFrame(() => {
      if (pendingFadeInRef.current) {
        pendingFadeInRef.current = false;
        setHistoryFadeIn(true);
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [historyLoader.historyLoadVersion, isOpen, pinToBottom, historyLoader.fetchingHistory]);

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
        } else if (search.searchMode) {
          e.stopImmediatePropagation();
          search.closeSearch();
        }
      }
    };
    // Use capture phase to handle before message navigation
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [imageModal, bashModal, responseModalContent, search, fileViewerPath, contextModalAgentId]);

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
      // Modals are rendered through portals under document.body.
      // Any modal interaction should never count as an outside click for Guake.
      const isInModal = !!target.closest(
        '.modal-overlay, .modal, .image-modal-overlay, .image-modal, .bash-modal-overlay, .bash-modal, .agent-info-modal-overlay, .agent-info-modal, .agent-response-modal, .pasted-text-modal-overlay, .pasted-text-modal, .file-viewer-overlay, .file-viewer-modal, .context-view-modal, .guake-context-confirm-overlay, .guake-context-confirm-modal, .pm2-logs-modal-overlay, .pm2-logs-modal, .database-panel-modal'
      );

      return !!isInTerminal || !!isAgentBar || isInModal;
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
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>👆</div>
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
      const attached = await terminalInput.uploadFile(file);
      if (attached) {
        terminalInput.setAttachedFiles((prev) => [...prev, attached]);
      }
    }
  };

  return (
    <div
      ref={terminalRef}
      className={`guake-terminal ${isOpen ? 'open' : 'collapsed'} ${isFullscreen && isOpen ? 'fullscreen' : ''} ${debugPanelOpen && isOpen ? 'with-debug-panel' : ''} ${gitPanelOpen && isOpen ? 'with-git-panel' : ''} ${buildingsPanelOpen && isOpen ? 'with-buildings-panel' : ''} ${overviewPanelOpen && isOpen ? 'with-overview-panel' : ''} ${draggingOver ? 'drag-over' : ''} ${mobileSwipeCloseOffset > 0 ? 'mobile-swipe-close-active' : ''} ${isMobileSwipeClosing ? 'mobile-swipe-close-closing' : ''}`}
      style={{ '--terminal-height': `${terminalHeight}%`, '--mobile-swipe-close-offset': `${mobileSwipeCloseOffset}px`, '--guake-side-panel-width': `${sidePanelWidth}px`, ...(mobileOverviewHeight > 0 ? { '--guake-mobile-overview-height': `${mobileOverviewHeight}px` } : {}) } as React.CSSProperties}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      <div className="guake-drop-overlay">
        <div className="drop-border" />
        <span className="drop-icon">📎</span>
        <span className="drop-label">{t('terminal:input.dropToAttach')}</span>
      </div>

      {/* Debug Panel */}
      {!isSnapshotView && debugPanelOpen && isOpen && activeAgentId && (
        <AgentDebugPanel agentId={activeAgentId} onClose={() => setDebugPanelOpen(false)} />
      )}

      {/* Git Panel */}
      {!isSnapshotView && gitPanelOpen && isOpen && activeAgentId && (
        <GuakeGitPanel agentId={activeAgentId} agents={agents} onClose={() => setGitPanelOpen(false)} branchInfoMap={areaBranches} fetchRemote={fetchGitRemote} fetchingDirs={gitFetchingDirs} />
      )}

      {/* Area Buildings Panel */}
      {!isSnapshotView && buildingsPanelOpen && isOpen && activeAgentId && (
        <AreaBuildingsPanel agentId={activeAgentId} onClose={() => setBuildingsPanelOpen(false)} />
      )}

      {/* Right-side panel resize handle */}
      {!isSnapshotView && (debugPanelOpen || gitPanelOpen || buildingsPanelOpen) && isOpen && (
        <div className="guake-side-panel-resize right" onMouseDown={(e) => handleSidePanelResizeStart(e, 'right')} />
      )}

      {/* Agent Overview Panel */}
      {!isSnapshotView && overviewPanelOpen && isOpen && activeAgentId && (
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
      {!isSnapshotView && overviewPanelOpen && isOpen && activeAgentId && (
        <div className="guake-side-panel-resize left" onMouseDown={(e) => handleSidePanelResizeStart(e, 'left')} />
      )}

      {/* Mobile resize handle between overview and terminal */}
      {!isSnapshotView && overviewPanelOpen && isOpen && activeAgentId && (
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
          swipeOffset={swipe.swipeOffset}
          viewMode={viewMode}
          setViewMode={setViewMode}
          searchMode={search.searchMode}
          toggleSearch={search.toggleSearch}
          closeSearch={search.closeSearch}
          debugPanelOpen={debugPanelOpen}
          setDebugPanelOpen={setDebugPanelOpen}
          debuggerEnabled={debuggerEnabled}
          setDebuggerEnabled={setDebuggerEnabled}
          gitPanelOpen={gitPanelOpen}
          setGitPanelOpen={setGitPanelOpen}
          buildingsPanelOpen={buildingsPanelOpen}
          setBuildingsPanelOpen={setBuildingsPanelOpen}
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
          outputsLength={dedupedHistory.length + dedupedOutputs.length}
          setContextConfirm={setContextConfirm}
          headerRef={swipe.headerRef}
          onSaveSnapshot={isSnapshotView ? undefined : onSaveSnapshot}
          isSnapshotView={isSnapshotView}
        />

        {/* Search bar */}
        {search.searchMode && (
          <SearchBar
            searchInputRef={search.searchInputRef}
            searchQuery={search.searchQuery}
            setSearchQuery={search.setSearchQuery}
            closeSearch={search.closeSearch}
            matchCount={search.matchIndices.length}
            currentMatch={search.currentMatch}
            navigateNext={search.navigateNext}
            navigatePrev={search.navigatePrev}
            loadingFullHistory={search.loadingFullHistory}
          />
        )}

        {/* Swipe container */}
        <div
          className={`guake-swipe-container ${swipe.swipeAnimationClass}`}
          style={swipe.swipeOffset !== 0 ? { transform: `translateX(${swipe.swipeOffset * 40}%)` } : undefined}
        >
          {/* Swipe indicators */}
          {swipe.sortedAgents.length > 1 && swipe.swipeOffset !== 0 && (
            <>
              <div className={`swipe-indicator left ${swipe.swipeOffset > 0.3 ? 'visible' : ''}`}>
                <span className="indicator-icon">←</span>
                <span className="indicator-name">{swipe.nextAgent?.name}</span>
              </div>
              <div className={`swipe-indicator right ${swipe.swipeOffset < -0.3 ? 'visible' : ''}`}>
                <span className="indicator-name">{swipe.prevAgent?.name}</span>
                <span className="indicator-icon">→</span>
              </div>
            </>
          )}

          {/* Swipe dots */}
          {swipe.sortedAgents.length > 1 && swipe.sortedAgents.length <= 8 && swipe.swipeOffset !== 0 && (
            <div className={`swipe-dots ${Math.abs(swipe.swipeOffset) > 0.1 ? 'visible' : ''}`}>
              {swipe.sortedAgents.map((agent, index) => (
                <div key={agent.id} className={`swipe-dot ${index === swipe.currentAgentIndex ? 'active' : ''}`} />
              ))}
            </div>
          )}

          <div className="guake-output" ref={outputScrollRef} onScroll={handleScroll}>
              <div className={`guake-history-content ${historyFadeIn ? 'fade-in' : ''}`}>
                {isAgentSwitching && (
                  <div className="guake-empty loading">{t('terminal:empty.loadingConversation')}<span className="loading-dots"><span></span><span></span><span></span></span></div>
                )}
                {!isAgentSwitching && historyLoader.loadingHistory && historyLoader.history.length === 0 && outputs.length === 0 && (
                  <div className="guake-empty loading">{t('terminal:empty.loadingConversation')}<span className="loading-dots"><span></span><span></span><span></span></span></div>
                )}
                {!isAgentSwitching && !historyLoader.loadingHistory && historyLoader.history.length === 0 && displayOutputs.length === 0 && activeAgent.status !== 'working' && (
                  <div className="guake-empty">{t('terminal:empty.noOutput')}</div>
                )}
                {!isAgentSwitching && historyLoader.hasMore && !search.searchMode && (
                  <div className="guake-load-more">
                    {historyLoader.loadingMore ? (
                      <span>{t('terminal:empty.loadingOlder')}</span>
                    ) : (
                      <button onClick={historyLoader.loadMoreHistory}>
                        {t('terminal:empty.loadMore', { count: historyLoader.totalCount - historyLoader.history.length })}
                      </button>
                    )}
                  </div>
                )}
                {/* Virtualized rendering - only renders visible items + overscan buffer */}
                {!isAgentSwitching && (
                  <VirtualizedOutputList
                    key={activeAgentId}
                    historyMessages={dedupedHistory}
                    liveOutputs={dedupedOutputs}
                    agentId={activeAgentId}
                    execTasks={execTasks}
                    subagents={subagents}
                    viewMode={viewMode}
                    searchHighlight={search.highlightQuery}
                    searchActiveIndex={search.scrollToIndex}
                    selectedMessageIndex={messageNav.selectedIndex}
                    isMessageSelected={messageNav.isSelected}
                    onImageClick={handleImageClick}
                    onFileClick={handleFileClick}
                    onBashClick={handleBashClick}
                    onViewMarkdown={handleViewMarkdown}
                    scrollContainerRef={outputScrollRef}
                    onScrollTopReached={historyLoader.loadMoreHistory}
                    isLoadingMore={historyLoader.loadingMore}
                    hasMore={historyLoader.hasMore}
                    shouldAutoScroll={shouldAutoScroll}
                    onUserScroll={handleUserScrollUp}
                    pinToBottom={pinToBottom}
                    onPinCancel={handlePinCancel}
                    // Use in-flight flag so the virtualized list can reliably detect load completion
                    // (the spinner flag is intentionally delayed and may never toggle true on fast loads).
                    isLoadingHistory={historyLoader.fetchingHistory}
                  />
                )}
                {/* Boss agent progress indicators */}
                {!isAgentSwitching && isBoss && activeTaskProgress.length > 0 && (
                  <div className={`agent-progress-container ${agentProgressCollapsed ? 'collapsed' : 'expanded'}`}>
                    <div
                      className="agent-progress-container-header"
                      onClick={() => setAgentProgressCollapsed((previous) => !previous)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setAgentProgressCollapsed((previous) => !previous);
                        }
                      }}
                    >
                      <span className="progress-crown">👑</span>
                      <span>{t('terminal:empty.subordinateProgress')}</span>
                      <span className="progress-count">{t('terminal:empty.activeCount', { count: activeTaskProgress.length })}</span>
                      <span className="agent-progress-container-toggle">{agentProgressCollapsed ? '▶' : '▼'}</span>
                    </div>
                    {!agentProgressCollapsed && activeTaskProgress.map((progress) => (
                      <AgentProgressIndicator
                        key={progress.agentId}
                        progress={progress}
                        defaultExpanded={progress.status === 'working'}
                        onAgentClick={(agentId) => {
                          store.selectAgent(agentId);
                          store.setTerminalOpen(true);
                        }}
                        onDismiss={(subordinateId) => {
                          if (activeAgentId) {
                            store.clearAgentTaskProgress(activeAgentId, subordinateId);
                          }
                        }}
                        onFileClick={handleFileClick}
                        onBashClick={handleBashClick}
                      />
                    ))}
                  </div>
                )}
              </div>
          </div>
        </div>

        <TerminalInputArea
          selectedAgent={activeAgent}
          selectedAgentId={activeAgentId}
          isOpen={isOpen}
          command={terminalInput.command}
          setCommand={terminalInput.setCommand}
          forceTextarea={terminalInput.forceTextarea}
          setForceTextarea={terminalInput.setForceTextarea}
          useTextarea={terminalInput.useTextarea}
          attachedFiles={terminalInput.attachedFiles}
          setAttachedFiles={terminalInput.setAttachedFiles}
          removeAttachedFile={terminalInput.removeAttachedFile}
          uploadFile={terminalInput.uploadFile}
          pastedTexts={terminalInput.pastedTexts}
          expandPastedTexts={terminalInput.expandPastedTexts}
          incrementPastedCount={terminalInput.incrementPastedCount}
          setPastedTexts={terminalInput.setPastedTexts}
          resetPastedCount={terminalInput.resetPastedCount}
          handleInputFocus={keyboard.handleInputFocus}
          handleInputBlur={keyboard.handleInputBlur}
          pendingPermissions={pendingPermissions}
          showCompletion={showCompletion}
          completionElapsed={completionElapsed}
          onImageClick={handleImageClick}
          inputRef={terminalInputRef}
          textareaRef={terminalTextareaRef}
          isSnapshotView={isSnapshotView}
          onClearHistory={historyLoader.clearHistory}
          onSendCommand={handleSendCommand}
          canSwipeClose={
            isMobileWidth
            && mobileView === 'terminal'
            && !isAgentSwitching
            && !search.searchMode
            && !historyLoader.fetchingHistory
          }
          onSwipeCloseOffsetChange={handleMobileSwipeCloseOffsetChange}
          onSwipeClose={handleMobileSwipeClose}
        />

        {/* Agent Status Bar (CWD + Context) */}
        <div className="guake-agent-status-bar">
          {!isSnapshotView && activeAgent?.isDetached && (
            <Tooltip
              content={
                <>
                  <div className="tide-tooltip__title">🔄 {t('terminal:empty.reattachingSessionTitle')}</div>
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
                <span className="guake-detached-spinner">🔄</span> {t('terminal:empty.reattaching')}
              </span>
            </Tooltip>
          )}
          {activeAgent?.cwd && (
            <span className="guake-agent-cwd">
              📁 {activeAgent.cwd.split('/').filter(Boolean).slice(-2).join('/') || activeAgent.cwd}
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
                📂 {dir.split('/').filter(Boolean).pop() || dir}
                {branchInfo && (
                  <>
                    <span className="guake-agent-area-branch"> ⎇ {branchInfo.branch}</span>
                    {branchInfo.ahead > 0 && <span className="guake-branch-ahead" title={`${branchInfo.ahead} ahead`}>↑{branchInfo.ahead}</span>}
                    {branchInfo.behind > 0 && <span className="guake-branch-behind" title={`${branchInfo.behind} behind`}>↓{branchInfo.behind}</span>}
                    <span
                      className={`guake-area-fetch-btn ${isFetching ? 'fetching' : ''}`}
                      title="Git fetch"
                      onClick={(e) => { e.stopPropagation(); fetchGitRemote(dir); }}
                    >
                      {isFetching ? '⏳' : '⇣'}
                    </span>
                  </>
                )}
              </span>
            );
          })}
          {!isSnapshotView && activeAgent && (() => {
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
                <span className="context-icon">📊</span>
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
                  <span className="context-warning" title={t('terminal:context.clickToFetchStats')}>⚠️</span>
                )}
              </span>
            );
          })()}
          <span className="guake-status-right">
            {/* Terminal toggle buttons for area terminal buildings */}
            {areaTerminalBuildings.length > 0 && (
              <span className="guake-status-terminals">
                {areaTerminalBuildings.map((tb) => {
                  const isActive = bottomTerminalBuildingId === tb.id;
                  return (
                    <button
                      key={tb.id}
                      className={`guake-status-terminal-btn ${isActive ? 'active' : ''} ${!tb.hasUrl ? 'offline' : ''}`}
                      title={`${isActive ? 'Hide' : 'Show'} terminal: ${tb.name}${!tb.hasUrl ? ' (starting...)' : ''}`}
                      onClick={() => {
                        if (isActive && tb.hasUrl) {
                          setBottomTerminal(null);
                        } else {
                          if (!tb.hasUrl) {
                            store.sendBuildingCommand(tb.id, 'start');
                          }
                          window.dispatchEvent(new CustomEvent('tide:open-bottom-terminal', { detail: { buildingId: tb.id } }));
                        }
                      }}
                    >
                      💻
                    </button>
                  );
                })}
              </span>
            )}
            <ThemeSelector />
          </span>
        </div>

        {/* Bottom embedded terminal panel */}
        {bottomTerminalBuildingId && (() => {
          const termBuilding = buildings.get(bottomTerminalBuildingId);
          if (!termBuilding) return null;
          if (!termBuilding.terminalStatus?.url) {
            return (
              <div
                className="guake-bottom-terminal"
                style={{ height: bottomTerminalHeight }}
              >
                <div className="guake-bottom-terminal-header">
                  <span className="guake-bottom-terminal-title">Terminal - {termBuilding.name} (starting...)</span>
                  <button
                    className="guake-bottom-terminal-close"
                    onClick={() => setBottomTerminal(null)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="guake-bottom-terminal-starting">
                  <span>Starting terminal...</span>
                </div>
              </div>
            );
          }
          return (
            <>
              <div
                className="guake-bottom-terminal-resize"
                onMouseDown={handleBottomTerminalResizeStart}
              />
              <div
                className="guake-bottom-terminal"
                style={{ height: bottomTerminalHeight }}
                onWheel={(e) => e.stopPropagation()}
              >
                <div className="guake-bottom-terminal-header">
                  <span className="guake-bottom-terminal-title">Terminal - {termBuilding.name}</span>
                  <button
                    className="guake-bottom-terminal-close"
                    onClick={() => setBottomTerminal(null)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <iframe
                  src={authUrl(termBuilding.terminalStatus.url)}
                  className="guake-bottom-terminal-iframe"
                  title={`Terminal - ${termBuilding.name}`}
                  allow="clipboard-read; clipboard-write"
                />
              </div>
            </>
          );
        })()}
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
          <span className="guake-handle-icon">{isOpen ? '▲' : '▼'}</span>
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
          onClearHistory={historyLoader.clearHistory}
        />
      )}
      <ContextModalFromGuake />
      <FileViewerFromGuake />
      <AgentInfoModal agent={activeAgent} isOpen={agentInfoOpen} onClose={() => setAgentInfoOpen(false)} />
      {!isSnapshotView && (
        <AgentResponseModalWrapper agent={activeAgent} content={responseModalContent} onClose={() => setResponseModalContent(null)} />
      )}
    </div>
  );
});

// Re-export types for convenience
export type { HistoryMessage, AttachedFile, ViewMode, EditData } from './types';
