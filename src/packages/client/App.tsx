import React, { useEffect, useRef, useState, useCallback, useMemo, Profiler } from 'react';
import { useTranslation } from 'react-i18next';
import {
  store,
  useAgentCount,
  useAreas,
  useBuildings,
  useSelectedAgentIds,
  useSelectedBuildingIds,
  useSelectedAreaId,
  useActiveTool,
  useSettings,
  useMobileView,
  useViewMode,
  useExplorerFolderPath,
  useFileViewerPath,
  useContextModalAgentId,
  useTerminalOpen,
  useAgentBarHidden,
} from './store';
import { ToastProvider, useToast } from './components/Toast';
import { Icon } from './components/Icon';
import { AgentNotificationProvider, useAgentNotification } from './components/AgentNotificationToast';
import { UnitPanel } from './components/UnitPanel';
import { TrackingBoard } from './components/ClaudeOutputPanel/TrackingBoard';
import { type SceneConfig } from './components/toolbox';
import { GuakeOutputPanel } from './components/ClaudeOutputPanel';
import { AgentBar } from './components/AgentBar';
import { DrawingModeIndicator } from './components/DrawingModeIndicator';
import { AgentHoverPopup } from './components/AgentHoverPopup';
import { BuildingActionPopup } from './components/BuildingActionPopup';
import { BossBuildingActionPopup } from './components/BossBuildingActionPopup';
import { DatabaseBuildingActionPopup } from './components/DatabaseBuildingActionPopup';
import { FPSMeter } from './components/FPSMeter';
import { WorkspaceSwitcher, useWorkspaceSwitching } from './components/WorkspaceSwitcher';

// Lazy-load heavy components that are conditionally rendered
const DatabasePanel = React.lazy(() => import('./components/database').then(m => ({ default: m.DatabasePanel })));
const PM2LogsModal = React.lazy(() => import('./components/PM2LogsModal').then(m => ({ default: m.PM2LogsModal })));
const DockerLogsModal = React.lazy(() => import('./components/DockerLogsModal').then(m => ({ default: m.DockerLogsModal })));
const BossLogsModal = React.lazy(() => import('./components/BossLogsModal').then(m => ({ default: m.BossLogsModal })));
const Scene2DCanvas = React.lazy(() => import('./components/Scene2DCanvas').then(m => ({ default: m.Scene2DCanvas })));
const FlatView = React.lazy(() => import('./components/FlatView').then(m => ({ default: m.FlatView })));
const DashboardView = React.lazy(() => import('./components/DashboardView').then(m => ({ default: m.DashboardView })));
import { MobileFabMenu } from './components/MobileFabMenu';
import { MobileBottomMenu } from './components/MobileBottomMenu';
import { FloatingActionButtons } from './components/FloatingActionButtons';
import { AppModals } from './components/AppModals';
const IframeModal = React.lazy(() => import('./components/IframeModal').then(m => ({ default: m.IframeModal })));
import { NotConnectedOverlay } from './components/NotConnectedOverlay';
import { OnboardingModal } from './components/OnboardingModal';
import { profileRender, useRenderCounter } from './utils/profiling';
import {
  useModalState,
  useModalStateWithId,
  useContextMenu,
  useModalStackRegistration,
  useSceneSetup,
  useWebSocketConnection,
  useSelectionSync,
  useAreaSync,
  useBuildingSync,
  useAreaHighlight,
  usePowerSaving,
  useKeyboardShortcuts,
  useBackNavigation,
  useBuildingGitStatus,
  useModalClose,
  subscribeToSceneRefresh,
} from './hooks';
import { loadConfig, saveConfig } from './app/sceneConfig';
import { buildContextMenuActions, applyOrganizeResult } from './app/contextMenuActions';
import { organizeAllAreas } from './api/area-layout';
import TerminalEmbed from './components/TerminalEmbed';

// Import scene lifecycle to ensure it initializes
import './app/sceneLifecycle';

function AppContent() {
  const { t } = useTranslation(['common', 'notifications']);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);

  // Modal states using centralized hooks
  const spawnModal = useModalState();
  const bossSpawnModal = useModalState();
  const subordinateModal = useModalState<string>();
  const toolboxModal = useModalState();
  const commanderModal = useModalState();
  const deleteConfirmModal = useModalState();
  const spotlightModal = useModalState();
  const controlsModal = useModalState();
  const skillsModal = useModalState();
  const integrationsModal = useModalState<string | undefined>();
  const monitoringModal = useModalState();
  const workflowEditorModal = useModalState();
  const triggerManagerModal = useModalState();
  const buildingModal = useModalState<string | null>();
  const agentEditModal = useModalState<string>();
  const restoreArchivedModal = useModalState<{ x: number; z: number } | null>();
  const explorerModal = useModalStateWithId();
  const explorerFolderPath = useExplorerFolderPath();
  const contextMenu = useContextMenu();
  const [iframeModalUrl, setIframeModalUrl] = useState<string | null>(null);
  const isWorkspaceSwitching = useWorkspaceSwitching();
  const [isOrganizing, setIsOrganizing] = useState(false);

  const [spawnPosition, setSpawnPosition] = useState<{ x: number; z: number } | null>(null);
  const [buildingInitialPosition, setBuildingInitialPosition] = useState<{ x: number; z: number } | null>(null);
  const [spawnAreaId, setSpawnAreaId] = useState<string | null>(null);
  // 'selected' means delete all selected buildings, otherwise a specific building ID
  const [pendingBuildingDelete, setPendingBuildingDelete] = useState<string | 'selected' | null>(null);
  const [hoveredAgentPopup, setHoveredAgentPopup] = useState<{
    agentId: string;
    screenPos: { x: number; y: number };
  } | null>(null);
  const [buildingPopup, setBuildingPopupState] = useState<{
    buildingId: string;
    screenPos: { x: number; y: number };
    fromClick?: boolean; // true if opened by click (should stay open), false/undefined if from hover
  } | null>(null);
  const [pm2LogsModalBuildingId, setPm2LogsModalBuildingId] = useState<string | null>(null);
  const [bossLogsModalBuildingId, setBossLogsModalBuildingId] = useState<string | null>(null);
  const [terminalModalBuildingId, setTerminalModalBuildingId] = useState<string | null>(null);
  const [databasePanelBuildingId, _setDatabasePanelBuildingId] = useState<string | null>(null);
  const setDatabasePanelBuildingId = useCallback((id: string | null) => {
    _setDatabasePanelBuildingId(id);
    if (id) {
      localStorage.setItem('tide-commander-last-database-building', id);
    }
  }, []);
  const closeDatabasePanel = useCallback(() => setDatabasePanelBuildingId(null), [setDatabasePanelBuildingId]);
  const { handleMouseDown: handleDatabasePanelBackdropMouseDown, handleClick: handleDatabasePanelBackdropClick } = useModalClose(closeDatabasePanel);
  const closeTerminalModal = useCallback(() => setTerminalModalBuildingId(null), []);
  const { handleMouseDown: handleTerminalBackdropMouseDown, handleClick: handleTerminalBackdropClick } = useModalClose(closeTerminalModal);
  // Ref to access current popup state in callbacks
  const buildingPopupRef = useRef(buildingPopup);
  buildingPopupRef.current = buildingPopup;
  const setBuildingPopup = useCallback((popup: typeof buildingPopup) => {
    setBuildingPopupState(popup);
  }, []);
  const getBuildingPopup = useCallback(() => buildingPopupRef.current, []);
  // Ref for pending popup timeout (used by 2D mode building click)
  const pendingPopupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sceneConfig, setSceneConfig] = useState(loadConfig);
  const [sceneKey, setSceneKey] = useState(0); // Key to force canvas remount on HMR refresh
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('tide-commander-sidebar-collapsed');
    return saved === 'true';
  });
  const [sidebarView, setSidebarView] = useState<'agents' | 'tracking'>(() => {
    const saved = localStorage.getItem('tide-commander-sidebar-view');
    return saved === 'tracking' ? 'tracking' : 'agents';
  });
  // Track if sidebar was revealed by hover (should auto-hide on mouse leave)
  const [sidebarRevealedByHover, setSidebarRevealedByHover] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileView = useMobileView();
  const viewMode = useViewMode();
  const agentBarHidden = useAgentBarHidden();
  const fileViewerPath = useFileViewerPath();
  const contextModalAgentId = useContextModalAgentId();
  const terminalOpen = useTerminalOpen();
  const { showToast } = useToast();
  const { showAgentNotification } = useAgentNotification();

  // Back navigation handling
  const { showBackNavModal, setShowBackNavModal, handleLeave } = useBackNavigation();

  // Bottom stack ref — measured so the terminal input can sit exactly above it
  const bottomStackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bottomStackRef.current;
    if (!el) return;
    const appEl = el.closest('.app') as HTMLElement | null;
    if (!appEl) return;
    const obs = new ResizeObserver(() => {
      appEl.style.setProperty('--mobile-bottom-stack-height', `${el.offsetHeight}px`);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // WebSocket connection - runs regardless of 2D/3D view mode
  // This ensures agents are synced on page load even when 2D mode is active
  useWebSocketConnection({
    showToast,
    showAgentNotification,
  });

  // Scene loading state
  const [sceneLoading, setSceneLoading] = useState(false);

  // Show loader immediately when user presses the 3D mode button.
  useEffect(() => {
    const handleViewModeSwitchPressed = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
      if (mode === '3d') {
        setSceneLoading(true);
      }
    };

    window.addEventListener('tide:viewmode-switch-pressed', handleViewModeSwitchPressed as EventListener);
    return () => {
      window.removeEventListener('tide:viewmode-switch-pressed', handleViewModeSwitchPressed as EventListener);
    };
  }, []);

  // Fallback: also show loader for any programmatic switch to 3D.
  useEffect(() => {
    if (viewMode === '3d') {
      setSceneLoading(true);
    }
  }, [viewMode]);

  // Scene setup
  const sceneRef = useSceneSetup({
    canvasRef,
    selectionBoxRef,
    viewMode,
    sceneMountKey: sceneKey,
    showToast,
    showAgentNotification,
    toolboxModal,
    contextMenu,
    setHoveredAgentPopup,
    setBuildingPopup,
    getBuildingPopup,
    openBuildingModal: (buildingId) => buildingModal.open(buildingId),
    openPM2LogsModal: (buildingId) => setPm2LogsModalBuildingId(buildingId),
    openBossLogsModal: (buildingId) => setBossLogsModalBuildingId(buildingId),
    openDatabasePanel: (buildingId) => setDatabasePanelBuildingId(buildingId),
    onSceneLoadingChange: setSceneLoading,
  });

  // Use agentCount instead of useAgents() to avoid re-renders on every agent property change.
  // For on-demand agent data, read store.getState().agents directly.
  const agentCount = useAgentCount();
  const areas = useAreas();
  const buildings = useBuildings();
  const selectedAgentIds = useSelectedAgentIds();
  const selectedBuildingIds = useSelectedBuildingIds();
  const selectedAreaId = useSelectedAreaId();
  const activeTool = useActiveTool();
  const settings = useSettings();
  const selectedAgentIdsArray = useMemo(() => Array.from(selectedAgentIds), [selectedAgentIds]);
  const deepLinkHandledRef = useRef(false);

  useRenderCounter('AppContent');

  // Scene synchronization hooks
  useSelectionSync(sceneRef);
  useAreaSync(sceneRef);
  useBuildingSync(sceneRef);
  useBuildingGitStatus();
  useAreaHighlight(sceneRef, selectedAreaId);
  usePowerSaving(sceneRef, settings.powerSaving);

  // Configurable browser tab title
  useEffect(() => {
    document.title = settings.tabTitle?.trim() || 'Tide Commander';
  }, [settings.tabTitle]);

  // POC: allow external launchers (e.g. KRunner) to deep-link into an agent terminal.
  // Supported query params:
  // - agentId=<id>
  // - agentName=<name>
  // - openTerminal=1|true|yes (defaults to true when agentId/agentName is present)
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const rawAgentId = params.get('agentId')?.trim();
    const rawAgentName = params.get('agentName')?.trim();
    if (!rawAgentId && !rawAgentName) return;

    // Wait until agents are available from initial websocket sync.
    if (agentCount === 0) return;

    const agents = store.getState().agents;
    const openTerminalParam = params.get('openTerminal');
    const shouldOpenTerminal = openTerminalParam
      ? ['1', 'true', 'yes'].includes(openTerminalParam.toLowerCase())
      : true;

    let targetAgent = rawAgentId ? agents.get(rawAgentId) : undefined;
    if (!targetAgent && rawAgentName) {
      const lowerName = rawAgentName.toLowerCase();
      targetAgent = Array.from(agents.values()).find((agent) => agent.name.toLowerCase() === lowerName);
    }

    if (!targetAgent) {
      console.warn('[DeepLink] No matching agent found for query params', { rawAgentId, rawAgentName });
      deepLinkHandledRef.current = true;
      return;
    }

    store.selectAgent(targetAgent.id);
    if (shouldOpenTerminal) {
      store.setTerminalOpen(true);
    }

    // Remove one-shot deep-link params from URL without reloading.
    params.delete('agentId');
    params.delete('agentName');
    params.delete('openTerminal');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, nextUrl);

    deepLinkHandledRef.current = true;
  }, [agentCount]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    sceneRef,
    spawnModal,
    commanderModal,
    explorerModal,
    spotlightModal,
    deleteConfirmModal,
    onRequestBuildingDelete: () => setPendingBuildingDelete('selected'),
    onOpenDatabasePanel: setDatabasePanelBuildingId,
    onCloseDatabasePanel: closeDatabasePanel,
    databasePanelOpen: databasePanelBuildingId !== null,
  });

  // Register modals on the stack for mobile back gesture handling
  useModalStackRegistration('spawn-modal', spawnModal.isOpen, spawnModal.close);
  useModalStackRegistration('boss-spawn-modal', bossSpawnModal.isOpen, bossSpawnModal.close);
  useModalStackRegistration('subordinate-modal', subordinateModal.isOpen, subordinateModal.close);
  useModalStackRegistration('toolbox-modal', toolboxModal.isOpen, toolboxModal.close);
  useModalStackRegistration('commander-modal', commanderModal.isOpen, commanderModal.close);
  useModalStackRegistration('delete-confirm-modal', deleteConfirmModal.isOpen, deleteConfirmModal.close);
  useModalStackRegistration('spotlight-modal', spotlightModal.isOpen, spotlightModal.close);
  useModalStackRegistration('controls-modal', controlsModal.isOpen, controlsModal.close);
  useModalStackRegistration('skills-modal', skillsModal.isOpen, skillsModal.close);
  useModalStackRegistration('integrations-modal', integrationsModal.isOpen, integrationsModal.close);
  useModalStackRegistration('monitoring-modal', monitoringModal.isOpen, monitoringModal.close);
  useModalStackRegistration('workflow-editor-modal', workflowEditorModal.isOpen, workflowEditorModal.close);
  useModalStackRegistration('trigger-manager-modal', triggerManagerModal.isOpen, triggerManagerModal.close);
  useModalStackRegistration('building-modal', buildingModal.isOpen, buildingModal.close);
  useModalStackRegistration('agent-edit-modal', agentEditModal.isOpen, agentEditModal.close);
  useModalStackRegistration('explorer-modal', explorerModal.isOpen || explorerFolderPath !== null, () => {
    explorerModal.close();
    store.closeFileExplorer();
  });
  useModalStackRegistration('context-menu', contextMenu.isOpen, contextMenu.close);
  useModalStackRegistration('mobile-sidebar', sidebarOpen, () => setSidebarOpen(false));
  useModalStackRegistration('mobile-fab-menu', mobileMenuOpen, () => setMobileMenuOpen(false));
  useModalStackRegistration('file-viewer', fileViewerPath !== null, () => store.clearFileViewerPath());
  useModalStackRegistration('context-modal', contextModalAgentId !== null, () => store.closeContextModal());
  useModalStackRegistration('terminal', terminalOpen, () => store.setTerminalOpen(false));
  useModalStackRegistration('pm2-logs-modal', pm2LogsModalBuildingId !== null, () => setPm2LogsModalBuildingId(null));
  useModalStackRegistration('boss-logs-modal', bossLogsModalBuildingId !== null, () => setBossLogsModalBuildingId(null));
  useModalStackRegistration('database-panel', databasePanelBuildingId !== null, closeDatabasePanel);
  useModalStackRegistration('terminal-modal', terminalModalBuildingId !== null, closeTerminalModal);

  // Close tools modals when guake terminal transitions from open to closed
  const prevTerminalOpen = useRef(terminalOpen);
  const skillsModalRef = useRef(skillsModal);
  const controlsModalRef = useRef(controlsModal);
  skillsModalRef.current = skillsModal;
  controlsModalRef.current = controlsModal;
  useEffect(() => {
    if (prevTerminalOpen.current && !terminalOpen) {
      skillsModalRef.current.close();
      controlsModalRef.current.close();
    }
    prevTerminalOpen.current = terminalOpen;
  }, [terminalOpen]);

  // Subscribe to HMR scene refresh (dev mode only)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    return subscribeToSceneRefresh(() => {
      console.log('[App] Scene refresh triggered - incrementing sceneKey');
      setSceneKey((k) => k + 1);
    });
  }, []);

  // Trigger one post-transition resize when switching to mobile 3D view in 3D mode.
  // In 2D mode we keep the scene mounted behind terminal, so no forced resize is needed.
  useEffect(() => {
    if (mobileView !== '3d' || viewMode !== '3d') return;
    const timeout = setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    return () => clearTimeout(timeout);
  }, [mobileView, viewMode]);

  // Handle config changes
  const handleConfigChange = useCallback((config: SceneConfig) => {
    setSceneConfig(config);
    saveConfig(config);
    sceneRef.current?.setCharacterScale(config.characterScale);
    sceneRef.current?.setScale3D(config.scale3d);
    sceneRef.current?.setTimeMode(config.timeMode);
    sceneRef.current?.setTerrainConfig(config.terrain);
    sceneRef.current?.setFloorStyle(config.terrain.floorStyle);
    sceneRef.current?.setGridVisible(config.gridVisible);
    sceneRef.current?.setAgentModelStyle(config.modelStyle);
    sceneRef.current?.setIdleAnimation(config.animations.idleAnimation);
    sceneRef.current?.setWorkingAnimation(config.animations.workingAnimation);
    sceneRef.current?.setFpsLimit(config.fpsLimit);
  }, [sceneRef]);

  // Handle tool changes
  const handleToolChange = useCallback((tool: 'rectangle' | 'circle' | 'select' | null) => {
    // Try 3D scene first
    sceneRef.current?.setDrawingTool(tool);
    // Also try 2D scene if available
    if (typeof window !== 'undefined' && (window as any).__tideScene2D_setDrawingTool) {
      (window as any).__tideScene2D_setDrawingTool(tool);
    }
    if (tool === 'rectangle' || tool === 'circle') {
      const toolName = tool === 'rectangle' ? t('notifications:drawing.rectangleTool') : t('notifications:drawing.circleTool');
      showToast('info', toolName, t('notifications:drawing.clickAndDrag'), 3000);
    }
  }, [sceneRef, showToast]);

  // Handle focus agent
  const handleFocusAgent = useCallback((agentId: string) => {
    sceneRef.current?.focusAgent(agentId);
  }, [sceneRef]);

  // Handle kill agent
  const handleKillAgent = useCallback((agentId: string) => {
    store.killAgent(agentId);
  }, []);

  // Handle calling subordinates to boss location
  const handleCallSubordinates = useCallback((bossId: string) => {
    sceneRef.current?.callSubordinates(bossId);
  }, [sceneRef]);

  const handleTrackingBoardSelectAgent = useCallback((agentId: string) => {
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(agentId);
    store.setTerminalOpen(true);
    setSidebarOpen(false);
  }, []);

  // Handle opening file explorer for an area
  const handleOpenAreaExplorer = useCallback((areaId: string) => {
    explorerModal.open(areaId);
  }, [explorerModal]);

  // Handle opening new building modal
  const handleNewBuilding = useCallback(() => {
    buildingModal.open(null);
  }, [buildingModal]);

  // Handle starting new area drawing
  const handleNewArea = useCallback(() => {
    // Try 3D scene first
    sceneRef.current?.setDrawingTool('rectangle');
    // Also try 2D scene if available
    if (typeof window !== 'undefined' && (window as any).__tideScene2D_setDrawingTool) {
      (window as any).__tideScene2D_setDrawingTool('rectangle');
    }
    showToast('info', t('notifications:drawing.rectangleTool'), t('notifications:drawing.clickAndDrag'), 3000);
  }, [sceneRef, showToast]);

  // Handle opening URL in iframe modal
  const handleOpenUrlInModal = useCallback((url: string) => {
    setIframeModalUrl(url);
  }, []);

  // Handle closing iframe modal
  const handleCloseIframeModal = useCallback(() => {
    setIframeModalUrl(null);
  }, []);

  // Handle delete selected agents
  // Read selection from store at execution time (not from closure) to avoid
  // stale-closure bugs where React re-renders clear the captured array.
  const handleDeleteSelectedAgents = useCallback(() => {
    const selectedIds = Array.from(store.getState().selectedAgentIds);
    selectedIds.forEach(id => {
      store.removeAgentFromServer(id);
      sceneRef.current?.removeAgent(id);
    });
    deleteConfirmModal.close();
    showToast('info', t('notifications:toast.agentsRemoved'), t('notifications:toast.agentsRemovedMsg', { count: selectedIds.length }));
  }, [showToast, deleteConfirmModal, sceneRef, t]);

  // Building delete confirmation handler
  const handleConfirmBuildingDelete = useCallback(() => {
    if (pendingBuildingDelete === 'selected') {
      // Delete all selected buildings
      const count = selectedBuildingIds.size;
      store.deleteSelectedBuildings();
      sceneRef.current?.syncBuildings();
      showToast('info', t('notifications:toast.buildingsDeleted'), t('notifications:toast.buildingsDeletedMsg', { count }));
    } else if (pendingBuildingDelete) {
      // Delete single building
      const building = buildings.get(pendingBuildingDelete);
      store.deleteBuilding(pendingBuildingDelete);
      sceneRef.current?.syncBuildings();
      showToast('info', t('notifications:toast.buildingDeleted'), t('notifications:toast.buildingDeletedMsg', { name: building?.name || 'Building' }));
    }
    setPendingBuildingDelete(null);
  }, [pendingBuildingDelete, buildings, selectedBuildingIds.size, showToast, sceneRef, t]);

  // Context menu actions - read agents from store on demand (not reactive) since
  // contextMenu.worldPosition/target already trigger recalculation when the menu opens.
  const contextMenuActions = useMemo(() => {
    return buildContextMenuActions(
      contextMenu.worldPosition,
      contextMenu.target,
      store.getState().agents,
      areas,
      buildings,
      {
        showToast,
        openSpawnModal: () => spawnModal.open(),
        openBossSpawnModal: () => bossSpawnModal.open(),
        openToolboxModal: () => toolboxModal.open(),
        openCommanderModal: () => commanderModal.open(),
        openExplorerModal: (areaId) => explorerModal.open(areaId),
        openBuildingModal: (buildingId) => buildingModal.open(buildingId),
        openAgentEditModal: (agentId) => agentEditModal.open(agentId),
        requestBuildingDelete: (buildingId) => setPendingBuildingDelete(buildingId),
        setSpawnPosition,
        openRestoreArchivedModal: (worldPos) => restoreArchivedModal.open(worldPos),
        sceneRef,
      }
    );
  }, [
    contextMenu.worldPosition,
    contextMenu.target,
    areas,
    buildings,
    spawnModal,
    bossSpawnModal,
    buildingModal,
    toolboxModal,
    commanderModal,
    explorerModal,
    agentEditModal,
    restoreArchivedModal,
    showToast,
    sceneRef,
  ]);

  // Clear spawn position when spawn modals close
  useEffect(() => {
    if (!spawnModal.isOpen && !bossSpawnModal.isOpen) {
      setSpawnPosition(null);
      setSpawnAreaId(null);
    }
  }, [spawnModal.isOpen, bossSpawnModal.isOpen]);

  useEffect(() => {
    const handleOpenSpawnModal = (event: Event) => {
      const detail = (event as CustomEvent<{ areaId?: string; position?: { x: number; z: number } }>).detail;
      setSpawnAreaId(detail?.areaId || null);
      setSpawnPosition(detail?.position || null);
      spawnModal.open();
    };

    const handleBuildingAction = (event: Event) => {
      const detail = (event as CustomEvent<{ buildingId: string }>).detail;
      if (!detail?.buildingId) return;
      const building = store.getState().buildings.get(detail.buildingId);
      if (!building) return;

      if (building.type === 'server' && building.pm2?.enabled) {
        setPm2LogsModalBuildingId(detail.buildingId);
      } else if (building.type === 'boss') {
        setBossLogsModalBuildingId(detail.buildingId);
      } else if (building.type === 'database') {
        setDatabasePanelBuildingId(detail.buildingId);
      } else if (building.type === 'folder' && building.folderPath) {
        store.openFileExplorer(building.folderPath);
      } else if (building.type === 'terminal' && building.terminalStatus?.url) {
        setTerminalModalBuildingId(detail.buildingId);
      } else {
        buildingModal.open(detail.buildingId);
      }
    };

    // Edit building - opens config modal for existing building
    const handleBuildingEdit = (event: Event) => {
      const detail = (event as CustomEvent<{ buildingId: string }>).detail;
      if (detail?.buildingId) {
        buildingModal.open(detail.buildingId);
      }
    };

    // Create building - opens config modal in create mode with position
    const handleBuildingCreate = (event: Event) => {
      const detail = (event as CustomEvent<{ position: { x: number; z: number } }>).detail;
      setBuildingInitialPosition(detail?.position || null);
      buildingModal.open(null);
    };

    const handleOpenIframeModal = (event: Event) => {
      const detail = (event as CustomEvent<{ url: string; title?: string; buildingId?: string }>).detail;
      if (detail?.buildingId) {
        setTerminalModalBuildingId(detail.buildingId);
      } else if (detail?.url) {
        setIframeModalUrl(detail.url);
      }
    };

    window.addEventListener('tide:open-spawn-modal', handleOpenSpawnModal as EventListener);
    window.addEventListener('tide:building-action', handleBuildingAction as EventListener);
    window.addEventListener('tide:building-edit', handleBuildingEdit as EventListener);
    window.addEventListener('tide:building-create', handleBuildingCreate as EventListener);
    window.addEventListener('tide:open-iframe-modal', handleOpenIframeModal as EventListener);
    return () => {
      window.removeEventListener('tide:open-spawn-modal', handleOpenSpawnModal as EventListener);
      window.removeEventListener('tide:building-action', handleBuildingAction as EventListener);
      window.removeEventListener('tide:building-edit', handleBuildingEdit as EventListener);
      window.removeEventListener('tide:building-create', handleBuildingCreate as EventListener);
      window.removeEventListener('tide:open-iframe-modal', handleOpenIframeModal as EventListener);
    };
  }, [spawnModal, buildingModal]);

  // Check if in drawing mode
  const isDrawingMode = activeTool === 'rectangle' || activeTool === 'circle';

  // Handle exit drawing mode
  const handleExitDrawingMode = useCallback(() => {
    // Try 3D scene first
    sceneRef.current?.setDrawingTool(null);
    // Also try 2D scene if available
    if (typeof window !== 'undefined' && (window as any).__tideScene2D_setDrawingTool) {
      (window as any).__tideScene2D_setDrawingTool(null);
    }
  }, [sceneRef]);

  // Stable callbacks for MobileFabMenu
  const handleMobileMenuToggle = useCallback(() => setMobileMenuOpen(prev => !prev), []);
  const handleShowTerminal = useCallback(() => store.setMobileView('terminal'), []);
  const handleOpenSidebar = useCallback(() => setSidebarOpen(true), []);
  const handleOpenTrackingBoard = useCallback(() => {
    setSidebarView('tracking');
    localStorage.setItem('tide-commander-sidebar-view', 'tracking');
    setSidebarOpen(true);
  }, []);

  return (
    <div className={`app ${terminalOpen ? 'terminal-open' : ''} ${isDrawingMode ? 'drawing-mode' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} mobile-view-${mobileView} view-mode-${viewMode}`}>
      {/* Not Connected Overlay */}
      <NotConnectedOverlay />
      <OnboardingModal onCreateAgent={spawnModal.open} />

      {/* FPS Meter */}
      <FPSMeter visible={settings.showFPS} position="bottom-right" />

      {/* Workspace switcher as floating FAB (left rail) */}
      <div className="fab-workspace-wrapper">
        <WorkspaceSwitcher />
      </div>

      {/* Organize button — only relevant in 2D/3D scenes */}
      {(viewMode === '2d' || viewMode === '3d') && (
        <button
          className="fab-spawn-btn fab-spawn-organize-btn"
          disabled={isOrganizing}
          aria-label="Auto-organize all agents in their areas"
          title="Auto-organize all agents in their areas"
          onClick={() => {
            setIsOrganizing(true);
            organizeAllAreas()
              .then((result) => {
                applyOrganizeResult(result, sceneRef);
                showToast('success', 'Organized', `Arranged ${result.organized.length} agent${result.organized.length !== 1 ? 's' : ''}`);
              })
              .catch((err) => {
                console.error('organize all error:', err);
                showToast('error', 'Organize Failed', err.message || 'Failed to organize');
              })
              .finally(() => setIsOrganizing(false));
          }}
        >
          <span className="fab-spawn-icon"><Icon name={isOrganizing ? 'hourglass' : 'sparkle'} size={18} /></span>
        </button>
      )}

      <main className="main-content">
        <div className="battlefield-container">
          {isWorkspaceSwitching && (
            <div className="workspace-switch-overlay">
              <div className="workspace-switch-spinner" />
              <span className="workspace-switch-text">Switching workspace...</span>
            </div>
          )}
          <React.Suspense fallback={null}>
          {viewMode === 'flat' ? (
            <FlatView
              onAgentClick={(agentId) => store.selectAgent(agentId)}
              onAgentDoubleClick={(agentId) => {
                if (window.innerWidth <= 768) {
                  store.openTerminalOnMobile(agentId);
                  return;
                }
                store.selectAgent(agentId);
                store.setTerminalOpen(true);
              }}
              onBuildingClick={(buildingId) => store.selectBuilding(buildingId)}
              onBuildingDoubleClick={(buildingId) => {
                const building = store.getState().buildings.get(buildingId);
                if (building?.type === 'server' && building.pm2?.enabled) {
                  setPm2LogsModalBuildingId(buildingId);
                } else if (building?.type === 'boss') {
                  setBossLogsModalBuildingId(buildingId);
                } else if (building?.type === 'database') {
                  setDatabasePanelBuildingId(buildingId);
                } else if (building?.type === 'folder' && building.folderPath) {
                  store.openFileExplorer(building.folderPath);
                } else {
                  buildingModal.open(buildingId);
                }
              }}
              onAreaClick={(areaId) => {
                store.selectArea(areaId);
                toolboxModal.open();
              }}
              // Creation modal callbacks
              onOpenSpawnModal={() => {
                setSpawnPosition(null);
                setSpawnAreaId(null);
                spawnModal.open();
              }}
              onOpenBossSpawnModal={() => {
                setSpawnPosition(null);
                bossSpawnModal.open();
              }}
              onOpenBuildingModal={() => {
                setBuildingInitialPosition(null);
                buildingModal.open(null);
              }}
              onOpenAreaModal={() => {
                // Switch to 2D view with rectangle tool active for area drawing
                store.setViewMode('2d');
                handleToolChange('rectangle');
              }}
            />
          ) : viewMode === 'dashboard' ? (
            <DashboardView
              onSelectAgent={(agentId) => store.selectAgent(agentId)}
              onFocusAgent={(agentId) => {
                store.setViewMode('3d');
                handleFocusAgent(agentId);
              }}
              onKillAgent={handleKillAgent}
              onSelectBuilding={(buildingId) => store.selectBuilding(buildingId)}
              onOpenTerminal={(agentId) => {
                store.selectAgent(agentId);
                store.setTerminalOpen(true);
              }}
              onFocusZone={(areaId) => {
                store.setViewMode('3d');
                const area = store.getState().areas.get(areaId);
                if (area && area.assignedAgentIds.length > 0) {
                  // Focus camera on the first agent in this zone
                  handleFocusAgent(area.assignedAgentIds[0]);
                }
              }}
            />
          ) : viewMode === '2d' ? (
            <Scene2DCanvas
              onAgentClick={(agentId, shiftKey) => {
                if (shiftKey) {
                  store.addToSelection(agentId);
                } else {
                  store.selectAgent(agentId);
                }
              }}
              onAgentDoubleClick={(agentId) => {
                if (window.innerWidth <= 768) {
                  store.openTerminalOnMobile(agentId);
                  return;
                }
                store.selectAgent(agentId);
                store.setTerminalOpen(true);
              }}
              onBuildingClick={(buildingId: string, screenPos: { x: number; y: number }) => {
                store.selectBuilding(buildingId);
                const building = store.getState().buildings.get(buildingId);
                if (building?.type === 'folder' && building.folderPath) {
                  store.openFileExplorer(building.folderPath);
                } else if (building?.type === 'server' || building?.type === 'boss' || building?.type === 'database') {
                  // Clear any pending popup timeout
                  if (pendingPopupTimeoutRef.current) {
                    clearTimeout(pendingPopupTimeoutRef.current);
                  }
                  // Delay popup to allow double-click detection (150ms for faster response)
                  pendingPopupTimeoutRef.current = setTimeout(() => {
                    setBuildingPopup({ buildingId, screenPos, fromClick: true });
                    pendingPopupTimeoutRef.current = null;
                  }, 150);
                }
              }}
              onBuildingDoubleClick={(buildingId: string) => {
                // Clear pending popup timeout on double-click
                if (pendingPopupTimeoutRef.current) {
                  clearTimeout(pendingPopupTimeoutRef.current);
                  pendingPopupTimeoutRef.current = null;
                }
                // Close popup if open
                setBuildingPopup(null);

                const building = store.getState().buildings.get(buildingId);
                if (building?.type === 'server' && building.pm2?.enabled) {
                  setPm2LogsModalBuildingId(buildingId);
                } else if (building?.type === 'boss') {
                  setBossLogsModalBuildingId(buildingId);
                } else if (building?.type === 'database') {
                  setDatabasePanelBuildingId(buildingId);
                } else if (building?.type === 'folder' && building.folderPath) {
                  store.openFileExplorer(building.folderPath);
                } else {
                  buildingModal.open(buildingId);
                }
              }}
              onGroundClick={() => {
                store.selectAgent(null);
                store.selectBuilding(null);
              }}
              onAreaDoubleClick={(areaId) => {
                store.selectArea(areaId);
                toolboxModal.open();
              }}
              onContextMenu={(screenPos, worldPos, target) => {
                const menuTarget = target
                  ? { type: target.type as 'ground' | 'agent' | 'area' | 'building', id: target.id }
                  : { type: 'ground' as const };
                contextMenu.open(screenPos, worldPos, menuTarget);
              }}
              onMoveCommand={(agentIds, targetPos) => {
                // Calculate formation positions (same logic as 3D scene)
                const FORMATION_SPACING = 1.2;
                const count = agentIds.length;
                const positions: { x: number; y: number; z: number }[] = [];

                if (count === 1) {
                  positions.push({ x: targetPos.x, y: 0, z: targetPos.z });
                } else if (count <= 6) {
                  // Circle formation
                  const radius = FORMATION_SPACING * Math.max(1, count / 3);
                  for (let i = 0; i < count; i++) {
                    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
                    positions.push({
                      x: targetPos.x + Math.cos(angle) * radius,
                      y: 0,
                      z: targetPos.z + Math.sin(angle) * radius,
                    });
                  }
                } else {
                  // Grid formation
                  const cols = Math.ceil(Math.sqrt(count));
                  const rows = Math.ceil(count / cols);
                  const offsetX = ((cols - 1) * FORMATION_SPACING) / 2;
                  const offsetZ = ((rows - 1) * FORMATION_SPACING) / 2;

                  for (let i = 0; i < count; i++) {
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    positions.push({
                      x: targetPos.x + col * FORMATION_SPACING - offsetX,
                      y: 0,
                      z: targetPos.z + row * FORMATION_SPACING - offsetZ,
                    });
                  }
                }

                // Move each agent to their formation position
                agentIds.forEach((agentId, index) => {
                  store.moveAgent(agentId, positions[index]);
                });
              }}
              onBuildingDragMove={(buildingId, currentPos) => {
                // Update building position visually during drag (real-time)
                const building = store.getState().buildings.get(buildingId);
                if (building) {
                  store.getState().buildings.set(buildingId, {
                    ...building,
                    position: { x: currentPos.x, z: currentPos.z },
                  });
                  // Trigger re-render of 2D scene
                  (window as any).__tideScene2D?.syncBuildings();
                }
              }}
              onBuildingDragEnd={(buildingId, endPos) => {
                // Persist the final position to store and server
                store.updateBuildingPosition(buildingId, endPos);
              }}
              scale2d={sceneConfig.scale2d}
              showTaskLabels={sceneConfig.show2DTaskLabels}
              showGrid={sceneConfig.gridVisible}
              fpsLimit={sceneConfig.fpsLimit}
            />
          ) : (
            <React.Fragment key={sceneKey}>
              <canvas ref={canvasRef} id="battlefield" tabIndex={0}></canvas>
              <div ref={selectionBoxRef} id="selection-box"></div>
            </React.Fragment>
          )}
          </React.Suspense>
          {sceneLoading && (
            <div className="scene-loading-overlay">
              <div className="scene-loading-overlay__spinner" />
              <span className="scene-loading-overlay__label">Loading 3D scene…</span>
            </div>
          )}
        </div>

        {/* Mobile FAB Menu */}
        <MobileFabMenu
          isOpen={mobileMenuOpen}
          onToggle={handleMobileMenuToggle}
          onShowTerminal={handleShowTerminal}
          onOpenSidebar={handleOpenSidebar}
          onOpenToolbox={toolboxModal.open}
          onOpenSpotlight={spotlightModal.open}
          onOpenCommander={commanderModal.open}
          onOpenControls={controlsModal.open}
          onOpenSkills={skillsModal.open}
          mobileView={mobileView}
        />

        {/* Sidebar overlay for mobile */}
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar hover zone - DISABLED (use button to open instead) */}
        {false && (
          <div
            className="sidebar-hover-zone hide-on-mobile"
            onMouseEnter={() => {
              setSidebarCollapsed(false);
              setSidebarRevealedByHover(true);
            }}
          />
        )}

        {/* Sidebar toggle button - always visible, positioned fixed */}
        <button
          className={`sidebar-collapse-edge-btn ${sidebarCollapsed ? 'is-collapsed' : ''} ${sidebarRevealedByHover ? 'can-pin' : ''}`}
          onClick={() => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
              // On mobile, toggle slide-in sidebar
              setSidebarOpen(!sidebarOpen);
            } else {
              // On desktop, toggle sidebar collapsed state
              const newCollapsedState = !sidebarCollapsed;
              setSidebarCollapsed(newCollapsedState);
              localStorage.setItem('tide-commander-sidebar-collapsed', String(newCollapsedState));
            }
          }}
          title={sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {sidebarRevealedByHover ? (
              // Pin icon
              <><circle cx="12" cy="10" r="3" /><line x1="12" y1="13" x2="12" y2="21" /><line x1="8" y1="21" x2="16" y2="21" /></>
            ) : (
              // Chevron points toward the action direction
              <polyline points={sidebarCollapsed ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
            )}
          </svg>
        </button>

        <aside
          className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
          // Disabled: auto-hide on mouse leave removed - use button to close instead
        >
          <button
            className="sidebar-close-btn show-on-mobile"
            onClick={() => setSidebarOpen(false)}
            title="Close sidebar"
          >
            <Icon name="close" size={14} />
          </button>
          <div className="sidebar-view-toggle" role="tablist" aria-label="Sidebar view">
            <button
              type="button"
              role="tab"
              aria-selected={sidebarView === 'agents'}
              className={`sidebar-view-toggle-btn${sidebarView === 'agents' ? ' active' : ''}`}
              onClick={() => {
                setSidebarView('agents');
                localStorage.setItem('tide-commander-sidebar-view', 'agents');
              }}
              title={t('common:sidebar.agentsView', { defaultValue: 'Agents' })}
            >
              {t('common:sidebar.agentsView', { defaultValue: 'Agents' })}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarView === 'tracking'}
              className={`sidebar-view-toggle-btn${sidebarView === 'tracking' ? ' active' : ''}`}
              onClick={() => {
                setSidebarView('tracking');
                localStorage.setItem('tide-commander-sidebar-view', 'tracking');
              }}
              title={t('common:sidebar.trackingBoard', { defaultValue: 'Tracking Board' })}
            >
              <span className="sidebar-view-toggle-icon"><Icon name="list" size={14} /></span>
              {t('common:sidebar.trackingBoard', { defaultValue: 'Tracking Board' })}
            </button>
          </div>
          {sidebarView === 'tracking' ? (
            <div className="sidebar-section sidebar-tracking-section">
              <div className="sidebar-tracking-body">
                <TrackingBoard
                  activeAgentId={selectedAgentIdsArray[0] ?? ''}
                  onSelectAgent={handleTrackingBoardSelectAgent}
                />
              </div>
            </div>
          ) : (
            <div className="sidebar-section unit-section">
              <Profiler id="UnitPanel" onRender={profileRender}>
                <UnitPanel
                  onFocusAgent={handleFocusAgent}
                  onKillAgent={handleKillAgent}
                  onCallSubordinates={handleCallSubordinates}
                  onOpenAreaExplorer={handleOpenAreaExplorer}
                />
              </Profiler>
            </div>
          )}
        </aside>

        {/* Guake-style dropdown terminal */}
        <Profiler id="GuakeOutputPanel" onRender={profileRender}>
          <GuakeOutputPanel />
        </Profiler>
      </main>

      {/* Floating Action Buttons */}
      <FloatingActionButtons
        onOpenToolbox={toolboxModal.open}
        onOpenSpotlight={spotlightModal.open}
        onOpenCommander={commanderModal.open}
        onOpenControls={controlsModal.open}
        onOpenSkills={skillsModal.open}
        onSpawnAgent={spawnModal.open}
        onSpawnBoss={bossSpawnModal.open}
        onNewBuilding={handleNewBuilding}
        onNewArea={handleNewArea}
      />

      {/* Drawing Mode Indicator */}
      <DrawingModeIndicator
        activeTool={activeTool}
        onExit={handleExitDrawingMode}
      />

      {/* Agent Hover Popup (battlefield tooltip) */}
      {hoveredAgentPopup && (() => {
        const agent = store.getState().agents.get(hoveredAgentPopup.agentId);
        if (!agent) return null;
        return (
          <AgentHoverPopup
            agent={agent}
            screenPos={hoveredAgentPopup.screenPos}
            onClose={() => setHoveredAgentPopup(null)}
          />
        );
      })()}

      {/* Building Action Popup (battlefield click) */}
      {buildingPopup && (() => {
        const building = buildings.get(buildingPopup.buildingId);
        if (!building) return null;

        const closePopup = () => setBuildingPopup(null);

        // Use BossBuildingActionPopup for boss buildings
        if (building.type === 'boss') {
          return (
            <>
              <div className="building-popup-backdrop" onClick={closePopup} />
              <BossBuildingActionPopup
                building={building}
                screenPos={buildingPopup.screenPos}
                onClose={closePopup}
                onOpenSettings={() => {
                  closePopup();
                  buildingModal.open(buildingPopup.buildingId);
                }}
                onOpenLogsModal={() => {
                  closePopup();
                  setBossLogsModalBuildingId(buildingPopup.buildingId);
                }}
                onOpenUrlInModal={handleOpenUrlInModal}
              />
            </>
          );
        }

        // Use DatabaseBuildingActionPopup for database buildings
        if (building.type === 'database') {
          return (
            <>
              <div className="building-popup-backdrop" onClick={closePopup} />
              <DatabaseBuildingActionPopup
                building={building}
                screenPos={buildingPopup.screenPos}
                onClose={closePopup}
                onOpenSettings={() => {
                  closePopup();
                  buildingModal.open(buildingPopup.buildingId);
                }}
                onOpenDatabasePanel={() => {
                  closePopup();
                  setDatabasePanelBuildingId(buildingPopup.buildingId);
                }}
              />
            </>
          );
        }

        return (
          <>
            <div className="building-popup-backdrop" onClick={closePopup} />
            <BuildingActionPopup
              building={building}
              screenPos={buildingPopup.screenPos}
              onClose={closePopup}
              onOpenSettings={() => {
                closePopup();
                buildingModal.open(buildingPopup.buildingId);
              }}
              onOpenLogsModal={() => {
                setPm2LogsModalBuildingId(buildingPopup.buildingId);
              }}
              onOpenUrlInModal={handleOpenUrlInModal}
            />
          </>
        );
      })()}

      {/* PM2/Docker Logs Modal */}
      {pm2LogsModalBuildingId && (() => {
        const building = buildings.get(pm2LogsModalBuildingId);
        if (!building) return null;
        // Use DockerLogsModal for Docker buildings, PM2LogsModal for PM2 buildings
        if (building.docker?.enabled) {
          return (
            <DockerLogsModal
              building={building}
              isOpen={true}
              onClose={() => setPm2LogsModalBuildingId(null)}
            />
          );
        }
        return (
          <PM2LogsModal
            building={building}
            isOpen={true}
            onClose={() => setPm2LogsModalBuildingId(null)}
          />
        );
      })()}

      {/* Boss Logs Modal */}
      {bossLogsModalBuildingId && (() => {
        const building = buildings.get(bossLogsModalBuildingId);
        if (!building) return null;
        return (
          <BossLogsModal
            building={building}
            isOpen={true}
            onClose={() => setBossLogsModalBuildingId(null)}
          />
        );
      })()}

      {/* Database Panel Modal */}
      {databasePanelBuildingId && (() => {
        const building = buildings.get(databasePanelBuildingId);
        if (!building) return null;
        return (
          <div
            className="modal-overlay visible"
            onMouseDown={handleDatabasePanelBackdropMouseDown}
            onClick={handleDatabasePanelBackdropClick}
          >
            <div className="database-panel-modal">
              <DatabasePanel
                building={building}
                onClose={closeDatabasePanel}
              />
            </div>
          </div>
        );
      })()}

      {/* Terminal Modal */}
      {terminalModalBuildingId && (() => {
        const building = buildings.get(terminalModalBuildingId);
        if (!building || !building.terminalStatus?.url) return null;
        return (
          <div
            className="modal-overlay visible"
            onMouseDown={handleTerminalBackdropMouseDown}
            onClick={handleTerminalBackdropClick}
          >
            <div className="terminal-modal-container">
              <div className="terminal-modal-header">
                <span className="terminal-modal-title">Terminal - {building.name}</span>
                <button className="terminal-modal-close" onClick={closeTerminalModal}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <TerminalEmbed
                terminalUrl={building.terminalStatus.url}
                visible={true}
              />
            </div>
          </div>
        );
      })()}

      {/* Iframe Modal for port URLs */}
      <IframeModal
        url={iframeModalUrl || ''}
        title={iframeModalUrl ? `Preview - ${iframeModalUrl}` : ''}
        isOpen={!!iframeModalUrl}
        onClose={handleCloseIframeModal}
      />

      {/* Bottom stack: agent bar + mobile nav, measured so input can sit above it */}
      <div className="mobile-bottom-stack" ref={bottomStackRef}>
        {viewMode !== 'flat' && !agentBarHidden && (
          <AgentBar
            onFocusAgent={handleFocusAgent}
            onSpawnClick={spawnModal.open}
            onSpawnBossClick={bossSpawnModal.open}
            onNewBuildingClick={handleNewBuilding}
            onNewAreaClick={handleNewArea}
          />
        )}
        {viewMode !== 'flat' && agentBarHidden && (
          <button
            className="agent-bar-show-btn"
            onClick={() => store.setAgentBarHidden(false)}
            aria-label="Show agent bar"
            title="Show agent bar"
          >
            ▲
          </button>
        )}
        <MobileBottomMenu
          onOpenSpotlight={spotlightModal.open}
          onOpenTrackingBoard={handleOpenTrackingBoard}
          onOpenCommander={commanderModal.open}
          onOpenToolbox={toolboxModal.open}
          onSpawnAgent={spawnModal.open}
          sidebarOpen={sidebarOpen}
        />
      </div>

      {/* All Modals */}
      <AppModals
        spawnModal={spawnModal}
        bossSpawnModal={bossSpawnModal}
        subordinateModal={subordinateModal}
        toolboxModal={toolboxModal}
        commanderModal={commanderModal}
        deleteConfirmModal={deleteConfirmModal}
        spotlightModal={spotlightModal}
        controlsModal={controlsModal}
        skillsModal={skillsModal}
        integrationsModal={integrationsModal}
        monitoringModal={monitoringModal}
        workflowEditorModal={workflowEditorModal}
        triggerManagerModal={triggerManagerModal}
        buildingModal={buildingModal}
        buildingInitialPosition={buildingInitialPosition}
        agentEditModal={agentEditModal}
        restoreArchivedModal={restoreArchivedModal}
        explorerModal={explorerModal}
        contextMenu={contextMenu}
        spawnPosition={spawnPosition}
        spawnAreaId={spawnAreaId}
        explorerFolderPath={explorerFolderPath}
        contextMenuActions={contextMenuActions}
        sceneConfig={sceneConfig}
        onConfigChange={handleConfigChange}
        onToolChange={handleToolChange}
        onOpenAreaExplorer={handleOpenAreaExplorer}
        onDeleteSelectedAgents={handleDeleteSelectedAgents}
        pendingBuildingDelete={pendingBuildingDelete}
        onCancelBuildingDelete={() => setPendingBuildingDelete(null)}
        onConfirmBuildingDelete={handleConfirmBuildingDelete}
        showBackNavModal={showBackNavModal}
        onCloseBackNavModal={() => setShowBackNavModal(false)}
        onLeave={handleLeave}
        onOpenPM2LogsModal={(buildingId) => setPm2LogsModalBuildingId(buildingId)}
        onOpenBossLogsModal={(buildingId) => setBossLogsModalBuildingId(buildingId)}
        onOpenDatabasePanel={(buildingId) => setDatabasePanelBuildingId(buildingId)}
        onSyncScene={() => {
          sceneRef.current?.syncAreas();
          sceneRef.current?.syncAgents(Array.from(store.getState().agents.values()));
        }}
      />
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AgentNotificationProvider>
        <AppContent />
      </AgentNotificationProvider>
    </ToastProvider>
  );
}
