import React, { useEffect, useRef, useState, useCallback, useMemo, Profiler } from 'react';
import { store, useStore, useMobileView, useExplorerFolderPath, useFileViewerPath, useContextModalAgentId, useTerminalOpen } from './store';
import { ToastProvider, useToast } from './components/Toast';
import { AgentNotificationProvider, useAgentNotification } from './components/AgentNotificationToast';
import { UnitPanel } from './components/UnitPanel';
import { ToolHistory } from './components/ToolHistory';
import { type SceneConfig } from './components/toolbox';
import { ClaudeOutputPanel } from './components/ClaudeOutputPanel';
import { AgentBar } from './components/AgentBar';
import { DrawingModeIndicator } from './components/DrawingModeIndicator';
import { AgentHoverPopup } from './components/AgentHoverPopup';
import { BuildingActionPopup } from './components/BuildingActionPopup';
import { BossBuildingActionPopup } from './components/BossBuildingActionPopup';
import { DatabaseBuildingActionPopup } from './components/DatabaseBuildingActionPopup';
import { DatabasePanel } from './components/database';
import { PM2LogsModal } from './components/PM2LogsModal';
import { DockerLogsModal } from './components/DockerLogsModal';
import { BossLogsModal } from './components/BossLogsModal';
import { FPSMeter } from './components/FPSMeter';
import { Scene2DCanvas } from './components/Scene2DCanvas';
import { MobileFabMenu } from './components/MobileFabMenu';
import { FloatingActionButtons } from './components/FloatingActionButtons';
import { AppModals } from './components/AppModals';
import { PiPWindow, AgentsPiPView } from './components/PiPWindow';
import { IframeModal } from './components/IframeModal';
import { profileRender } from './utils/profiling';
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
  useDocumentPiP,
  useModalClose,
  subscribeToSceneRefresh,
} from './hooks';
import { loadConfig, saveConfig } from './app/sceneConfig';
import { buildContextMenuActions } from './app/contextMenuActions';

// Import scene lifecycle to ensure it initializes
import './app/sceneLifecycle';

function AppContent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);

  // Modal states using centralized hooks
  const spawnModal = useModalState();
  const bossSpawnModal = useModalState();
  const subordinateModal = useModalState<string>();
  const toolboxModal = useModalState();
  const commanderModal = useModalState();
  const deleteConfirmModal = useModalState();
  const supervisorModal = useModalState();
  const spotlightModal = useModalState();
  const controlsModal = useModalState();
  const skillsModal = useModalState();
  const buildingModal = useModalState<string | null>();
  const agentEditModal = useModalState<string>();
  const explorerModal = useModalStateWithId();
  const explorerFolderPath = useExplorerFolderPath();
  const contextMenu = useContextMenu();
  const pip = useDocumentPiP(); // Document Picture-in-Picture for agents view
  const [iframeModalUrl, setIframeModalUrl] = useState<string | null>(null);

  const [spawnPosition, setSpawnPosition] = useState<{ x: number; z: number } | null>(null);
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
  const [databasePanelBuildingId, setDatabasePanelBuildingId] = useState<string | null>(null);
  const closeDatabasePanel = useCallback(() => setDatabasePanelBuildingId(null), []);
  const { handleMouseDown: handleDatabasePanelBackdropMouseDown, handleClick: handleDatabasePanelBackdropClick } = useModalClose(closeDatabasePanel);
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
  // Track if sidebar was revealed by hover (should auto-hide on mouse leave)
  const [sidebarRevealedByHover, setSidebarRevealedByHover] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileView = useMobileView();
  const fileViewerPath = useFileViewerPath();
  const contextModalAgentId = useContextModalAgentId();
  const terminalOpen = useTerminalOpen();
  const { showToast } = useToast();
  const { showAgentNotification } = useAgentNotification();

  // Back navigation handling
  const { showBackNavModal, setShowBackNavModal, handleLeave } = useBackNavigation();

  // WebSocket connection - runs regardless of 2D/3D view mode
  // This ensures agents are synced on page load even when 2D mode is active
  useWebSocketConnection({
    showToast,
    showAgentNotification,
  });

  // Scene setup
  const sceneRef = useSceneSetup({
    canvasRef,
    selectionBoxRef,
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
  });

  const state = useStore();

  // Scene synchronization hooks
  useSelectionSync(sceneRef);
  useAreaSync(sceneRef);
  useBuildingSync(sceneRef);
  useAreaHighlight(sceneRef, state.selectedAreaId);
  usePowerSaving(sceneRef, state.settings.powerSaving);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    sceneRef,
    spawnModal,
    commanderModal,
    explorerModal,
    spotlightModal,
    deleteConfirmModal,
    onRequestBuildingDelete: () => setPendingBuildingDelete('selected'),
  });

  // Register modals on the stack for mobile back gesture handling
  useModalStackRegistration('spawn-modal', spawnModal.isOpen, spawnModal.close);
  useModalStackRegistration('boss-spawn-modal', bossSpawnModal.isOpen, bossSpawnModal.close);
  useModalStackRegistration('subordinate-modal', subordinateModal.isOpen, subordinateModal.close);
  useModalStackRegistration('toolbox-modal', toolboxModal.isOpen, toolboxModal.close);
  useModalStackRegistration('commander-modal', commanderModal.isOpen, commanderModal.close);
  useModalStackRegistration('delete-confirm-modal', deleteConfirmModal.isOpen, deleteConfirmModal.close);
  useModalStackRegistration('supervisor-modal', supervisorModal.isOpen, supervisorModal.close);
  useModalStackRegistration('spotlight-modal', spotlightModal.isOpen, spotlightModal.close);
  useModalStackRegistration('controls-modal', controlsModal.isOpen, controlsModal.close);
  useModalStackRegistration('skills-modal', skillsModal.isOpen, skillsModal.close);
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

  // Trigger resize when switching to 3D view on mobile
  useEffect(() => {
    if (mobileView === '3d') {
      const timeouts = [
        setTimeout(() => window.dispatchEvent(new Event('resize')), 0),
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100),
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300),
      ];
      return () => timeouts.forEach(clearTimeout);
    }
  }, [mobileView]);

  // Handle config changes
  const handleConfigChange = useCallback((config: SceneConfig) => {
    setSceneConfig(config);
    saveConfig(config);
    sceneRef.current?.setCharacterScale(config.characterScale);
    sceneRef.current?.setIndicatorScale(config.indicatorScale);
    sceneRef.current?.setGridVisible(config.gridVisible);
    sceneRef.current?.setTimeMode(config.timeMode);
    sceneRef.current?.setTerrainConfig(config.terrain);
    sceneRef.current?.setFloorStyle(config.terrain.floorStyle);
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
      const toolName = tool === 'rectangle' ? 'Rectangle' : 'Circle';
      showToast('info', `${toolName} Tool`, 'Click and drag on the battlefield to draw an area', 3000);
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
    showToast('info', 'Rectangle Tool', 'Click and drag on the battlefield to draw an area', 3000);
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
  const handleDeleteSelectedAgents = useCallback(() => {
    const selectedIds = Array.from(state.selectedAgentIds);
    selectedIds.forEach(id => {
      store.removeAgentFromServer(id);
      sceneRef.current?.removeAgent(id);
    });
    deleteConfirmModal.close();
    showToast('info', 'Agents Removed', `${selectedIds.length} agent(s) removed from view`);
  }, [state.selectedAgentIds, showToast, deleteConfirmModal, sceneRef]);

  // Building delete confirmation handler
  const handleConfirmBuildingDelete = useCallback(() => {
    if (pendingBuildingDelete === 'selected') {
      // Delete all selected buildings
      const count = state.selectedBuildingIds.size;
      store.deleteSelectedBuildings();
      sceneRef.current?.syncBuildings();
      showToast('info', 'Buildings Deleted', `${count} building(s) deleted`);
    } else if (pendingBuildingDelete) {
      // Delete single building
      const building = state.buildings.get(pendingBuildingDelete);
      store.deleteBuilding(pendingBuildingDelete);
      sceneRef.current?.syncBuildings();
      showToast('info', 'Building Deleted', `"${building?.name || 'Building'}" has been deleted`);
    }
    setPendingBuildingDelete(null);
  }, [pendingBuildingDelete, state.buildings, state.selectedBuildingIds.size, showToast, sceneRef]);

  // Context menu actions
  const contextMenuActions = useMemo(() => {
    return buildContextMenuActions(
      contextMenu.worldPosition,
      contextMenu.target,
      state.agents,
      state.areas,
      state.buildings,
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
        sceneRef,
      }
    );
  }, [
    contextMenu.worldPosition,
    contextMenu.target,
    state.agents,
    state.areas,
    state.buildings,
    spawnModal,
    bossSpawnModal,
    buildingModal,
    toolboxModal,
    commanderModal,
    explorerModal,
    agentEditModal,
    showToast,
    sceneRef,
  ]);

  // Clear spawn position when spawn modals close
  useEffect(() => {
    if (!spawnModal.isOpen && !bossSpawnModal.isOpen) {
      setSpawnPosition(null);
    }
  }, [spawnModal.isOpen, bossSpawnModal.isOpen]);

  // Check if in drawing mode
  const isDrawingMode = state.activeTool === 'rectangle' || state.activeTool === 'circle';

  // Handle exit drawing mode
  const handleExitDrawingMode = useCallback(() => {
    // Try 3D scene first
    sceneRef.current?.setDrawingTool(null);
    // Also try 2D scene if available
    if (typeof window !== 'undefined' && (window as any).__tideScene2D_setDrawingTool) {
      (window as any).__tideScene2D_setDrawingTool(null);
    }
  }, [sceneRef]);

  return (
    <div className={`app ${state.terminalOpen ? 'terminal-open' : ''} ${isDrawingMode ? 'drawing-mode' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} mobile-view-${mobileView}`}>
      {/* FPS Meter */}
      <FPSMeter visible={state.settings.showFPS} position="bottom-right" />

      <main className="main-content">
        <div className="battlefield-container">
          {state.settings.experimental2DView ? (
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
              indicatorScale={sceneConfig.indicatorScale}
              showGrid={sceneConfig.gridVisible}
              fpsLimit={sceneConfig.fpsLimit}
            />
          ) : (
            <React.Fragment key={sceneKey}>
              <canvas ref={canvasRef} id="battlefield" tabIndex={0}></canvas>
              <div ref={selectionBoxRef} id="selection-box"></div>
            </React.Fragment>
          )}
        </div>

        {/* Mobile FAB Menu */}
        <MobileFabMenu
          isOpen={mobileMenuOpen}
          onToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
          onShowTerminal={() => store.setMobileView('terminal')}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenToolbox={() => toolboxModal.open()}
          onOpenCommander={() => commanderModal.open()}
          onOpenSupervisor={() => supervisorModal.open()}
          onOpenControls={() => controlsModal.open()}
          onOpenSkills={() => skillsModal.open()}
          mobileView={mobileView}
        />

        {/* Sidebar overlay for mobile */}
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar hover zone - shows when collapsed, reveals sidebar on hover */}
        {sidebarCollapsed && (
          <div
            className="sidebar-hover-zone hide-on-mobile"
            onMouseEnter={() => {
              setSidebarCollapsed(false);
              setSidebarRevealedByHover(true);
            }}
          />
        )}

        <aside
          className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
          onMouseLeave={() => {
            // Auto-hide if it was revealed by hover
            if (sidebarRevealedByHover) {
              setSidebarCollapsed(true);
              setSidebarRevealedByHover(false);
            }
          }}
        >
          {/* Collapse/Pin button on left edge of sidebar (desktop only) */}
          <button
            className={`sidebar-collapse-edge-btn hide-on-mobile ${sidebarRevealedByHover ? 'can-pin' : ''}`}
            onClick={() => {
              if (sidebarRevealedByHover) {
                // Pin the sidebar (disable auto-hide)
                setSidebarRevealedByHover(false);
                localStorage.setItem('tide-commander-sidebar-collapsed', 'false');
              } else {
                // Collapse the sidebar
                setSidebarCollapsed(true);
                localStorage.setItem('tide-commander-sidebar-collapsed', 'true');
              }
            }}
            title={sidebarRevealedByHover ? 'Pin sidebar open' : 'Hide sidebar'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarRevealedByHover ? (
                // Pin icon
                <><circle cx="12" cy="10" r="3" /><line x1="12" y1="13" x2="12" y2="21" /><line x1="8" y1="21" x2="16" y2="21" /></>
              ) : (
                // Chevron right icon
                <polyline points="9 6 15 12 9 18" />
              )}
            </svg>
          </button>
          <button
            className="sidebar-close-btn show-on-mobile"
            onClick={() => setSidebarOpen(false)}
            title="Close sidebar"
          >
            ✕
          </button>
          {state.selectedAgentIds.size > 0 ? (
            <>
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
              <div className="sidebar-section tool-history-section">
                <Profiler id="ToolHistory" onRender={profileRender}>
                  <ToolHistory agentIds={Array.from(state.selectedAgentIds)} />
                </Profiler>
              </div>
            </>
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
        <Profiler id="ClaudeOutputPanel" onRender={profileRender}>
          <ClaudeOutputPanel />
        </Profiler>
      </main>

      {/* Floating Action Buttons */}
      <FloatingActionButtons
        onOpenToolbox={() => toolboxModal.open()}
        onOpenCommander={() => commanderModal.open()}
        onOpenSupervisor={() => supervisorModal.open()}
        onOpenControls={() => controlsModal.open()}
        onOpenSkills={() => skillsModal.open()}
        isGeneratingReport={state.supervisor.generatingReport}
      />

      {/* Drawing Mode Indicator */}
      <DrawingModeIndicator
        activeTool={state.activeTool}
        onExit={handleExitDrawingMode}
      />

      {/* Agent Hover Popup (battlefield tooltip) */}
      {hoveredAgentPopup && (() => {
        const agent = state.agents.get(hoveredAgentPopup.agentId);
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
        const building = state.buildings.get(buildingPopup.buildingId);
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
        const building = state.buildings.get(pm2LogsModalBuildingId);
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
        const building = state.buildings.get(bossLogsModalBuildingId);
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
        const building = state.buildings.get(databasePanelBuildingId);
        if (!building) return null;
        return (
          <div className="modal-overlay visible" onMouseDown={handleDatabasePanelBackdropMouseDown} onClick={handleDatabasePanelBackdropClick}>
            <div className="database-panel-modal">
              <DatabasePanel
                building={building}
                onClose={closeDatabasePanel}
              />
            </div>
          </div>
        );
      })()}

      {/* Picture-in-Picture button */}
      {pip.isSupported && (
        <button
          className={`pip-toggle-btn ${pip.isOpen ? 'active' : ''}`}
          onClick={() => pip.toggle({ width: 320, height: 400 })}
          title={pip.isOpen ? 'Close Agents in PiP Mode' : 'Open Agents in PiP Mode'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <rect x="12" y="9" width="8" height="6" rx="1" />
          </svg>
        </button>
      )}

      {/* PiP Window with Agents View */}
      <PiPWindow pip={pip} title="Tide Commander - Agents">
        <AgentsPiPView />
      </PiPWindow>

      {/* Iframe Modal for port URLs */}
      <IframeModal
        url={iframeModalUrl || ''}
        title={iframeModalUrl ? `Preview - ${iframeModalUrl}` : ''}
        isOpen={!!iframeModalUrl}
        onClose={handleCloseIframeModal}
      />

      {/* Bottom Agent Bar */}
      <AgentBar
        onFocusAgent={handleFocusAgent}
        onSpawnClick={() => spawnModal.open()}
        onSpawnBossClick={() => bossSpawnModal.open()}
        onNewBuildingClick={handleNewBuilding}
        onNewAreaClick={handleNewArea}
      />

      {/* All Modals */}
      <AppModals
        spawnModal={spawnModal}
        bossSpawnModal={bossSpawnModal}
        subordinateModal={subordinateModal}
        toolboxModal={toolboxModal}
        commanderModal={commanderModal}
        deleteConfirmModal={deleteConfirmModal}
        supervisorModal={supervisorModal}
        spotlightModal={spotlightModal}
        controlsModal={controlsModal}
        skillsModal={skillsModal}
        buildingModal={buildingModal}
        agentEditModal={agentEditModal}
        explorerModal={explorerModal}
        contextMenu={contextMenu}
        spawnPosition={spawnPosition}
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
