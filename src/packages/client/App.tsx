import React, { useEffect, useRef, useState, useCallback, useMemo, Profiler } from 'react';
import { store, useStore, useMobileView, useExplorerFolderPath, useFileViewerPath, useContextModalAgentId, useTerminalOpen } from './store';
import { ToastProvider, useToast } from './components/Toast';
import { AgentNotificationProvider, useAgentNotification } from './components/AgentNotificationToast';
import { UnitPanel } from './components/UnitPanel';
import { ToolHistory } from './components/ToolHistory';
import { type SceneConfig } from './components/Toolbox';
import { ClaudeOutputPanel } from './components/ClaudeOutputPanel';
import { AgentBar } from './components/AgentBar';
import { DrawingModeIndicator } from './components/DrawingModeIndicator';
import { AgentHoverPopup } from './components/AgentHoverPopup';
import { FPSMeter } from './components/FPSMeter';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { MobileFabMenu } from './components/MobileFabMenu';
import { FloatingActionButtons } from './components/FloatingActionButtons';
import { AppModals } from './components/AppModals';
import { PiPWindow, AgentsPiPView } from './components/PiPWindow';
import { profileRender } from './utils/profiling';
import {
  useModalState,
  useModalStateWithId,
  useContextMenu,
  useModalStackRegistration,
  useSceneSetup,
  useSelectionSync,
  useAreaSync,
  useBuildingSync,
  useAreaHighlight,
  usePowerSaving,
  useKeyboardShortcuts,
  useBackNavigation,
  useDocumentPiP,
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

  const [spawnPosition, setSpawnPosition] = useState<{ x: number; z: number } | null>(null);
  const [hoveredAgentPopup, setHoveredAgentPopup] = useState<{
    agentId: string;
    screenPos: { x: number; y: number };
  } | null>(null);

  const [sceneConfig, setSceneConfig] = useState(loadConfig);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileView = useMobileView();
  const fileViewerPath = useFileViewerPath();
  const contextModalAgentId = useContextModalAgentId();
  const terminalOpen = useTerminalOpen();
  const { showToast } = useToast();
  const { showAgentNotification } = useAgentNotification();

  // Back navigation handling
  const { showBackNavModal, setShowBackNavModal, handleLeave } = useBackNavigation();

  // Scene setup
  const sceneRef = useSceneSetup({
    canvasRef,
    selectionBoxRef,
    showToast,
    showAgentNotification,
    toolboxModal,
    contextMenu,
    setHoveredAgentPopup,
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
    sceneRef.current?.setIdleAnimation(config.animations.idleAnimation);
    sceneRef.current?.setWorkingAnimation(config.animations.workingAnimation);
    sceneRef.current?.setFpsLimit(config.fpsLimit);
  }, [sceneRef]);

  // Handle tool changes
  const handleToolChange = useCallback((tool: 'rectangle' | 'circle' | 'select' | null) => {
    sceneRef.current?.setDrawingTool(tool);
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
    sceneRef.current?.setDrawingTool('rectangle');
    showToast('info', 'Rectangle Tool', 'Click and drag on the battlefield to draw an area', 3000);
  }, [sceneRef, showToast]);

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
    sceneRef.current?.setDrawingTool(null);
  }, [sceneRef]);

  return (
    <div className={`app ${state.terminalOpen ? 'terminal-open' : ''} ${isDrawingMode ? 'drawing-mode' : ''} mobile-view-${mobileView}`}>
      {/* FPS Meter */}
      <FPSMeter visible={state.settings.showFPS} position="bottom-right" />

      <main className="main-content">
        <div className="battlefield-container">
          <canvas ref={canvasRef} id="battlefield"></canvas>
          <div ref={selectionBoxRef} id="selection-box"></div>
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

        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
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
        showBackNavModal={showBackNavModal}
        onCloseBackNavModal={() => setShowBackNavModal(false)}
        onLeave={handleLeave}
      />

      {/* PWA Install Banner */}
      <PWAInstallBanner />
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
