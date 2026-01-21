import React, { useEffect, useRef, useState, useCallback, Profiler } from 'react';
import { store, useStore, useMobileView } from './store';
import { connect, setCallbacks, getSocket } from './websocket';
import { SceneManager } from './scene/SceneManager';
import { ToastProvider, useToast } from './components/Toast';
import { UnitPanel } from './components/UnitPanel';
import { ToolHistory } from './components/ToolHistory';
import { SpawnModal } from './components/SpawnModal';
import { BossSpawnModal } from './components/BossSpawnModal';
import { SubordinateAssignmentModal } from './components/SubordinateAssignmentModal';
import { Toolbox, type SceneConfig, type TimeMode } from './components/Toolbox';
import { ClaudeOutputPanel } from './components/ClaudeOutputPanel';
import { CommanderView } from './components/CommanderView';
import { FileExplorerPanel } from './components/FileExplorerPanel';
import { AgentBar } from './components/AgentBar';
import { SupervisorPanel } from './components/SupervisorPanel';
import { Spotlight } from './components/Spotlight';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { BuildingConfigModal } from './components/BuildingConfigModal';
import { SkillsPanel } from './components/SkillsPanel';
import { WebSocketDebuggerPanel } from './components/WebSocketDebuggerPanel';
import { matchesShortcut } from './store/shortcuts';
import { FPSMeter } from './components/FPSMeter';
import { profileRender } from './utils/profiling';
import { STORAGE_KEYS, getStorage, setStorage, getStorageString } from './utils/storage';
import { useModalState, useModalStateWithId } from './hooks';

// Persist scene manager across HMR
let persistedScene: SceneManager | null = null;
let wsConnected = false;

// Default terrain config
const DEFAULT_TERRAIN = {
  showTrees: true,
  showBushes: true,
  showHouse: true,
  showLamps: true,
  showGrass: true,
  fogDensity: 1,
  floorStyle: 'concrete' as const,
};

// Default animation config
const DEFAULT_ANIMATIONS = {
  idleAnimation: 'sit' as const,
  workingAnimation: 'sprint' as const,
};

// Default FPS limit (0 = unlimited)
const DEFAULT_FPS_LIMIT = 0;

// Load config from storage
function loadConfig(): SceneConfig {
  const defaultConfig: SceneConfig = {
    characterScale: 0.5,
    indicatorScale: 1.0,
    gridVisible: true,
    timeMode: 'auto',
    terrain: DEFAULT_TERRAIN,
    animations: DEFAULT_ANIMATIONS,
    fpsLimit: DEFAULT_FPS_LIMIT,
  };

  const stored = getStorage<Partial<SceneConfig> | null>(STORAGE_KEYS.CONFIG, null);
  if (stored) {
    return {
      characterScale: stored.characterScale ?? defaultConfig.characterScale,
      indicatorScale: stored.indicatorScale ?? defaultConfig.indicatorScale,
      gridVisible: stored.gridVisible ?? defaultConfig.gridVisible,
      timeMode: stored.timeMode ?? defaultConfig.timeMode,
      terrain: { ...DEFAULT_TERRAIN, ...stored.terrain },
      animations: { ...DEFAULT_ANIMATIONS, ...stored.animations },
      fpsLimit: stored.fpsLimit ?? defaultConfig.fpsLimit,
    };
  }
  return defaultConfig;
}

// Save config to storage
function saveConfig(config: SceneConfig): void {
  setStorage(STORAGE_KEYS.CONFIG, config);
}

function AppContent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);

  // Modal states using centralized hooks
  const spawnModal = useModalState();
  const bossSpawnModal = useModalState();
  const subordinateModal = useModalState<string>(); // data = bossId
  const toolboxModal = useModalState();
  const commanderModal = useModalState();
  const deleteConfirmModal = useModalState();
  const supervisorModal = useModalState();
  const spotlightModal = useModalState();
  const shortcutsModal = useModalState();
  const skillsModal = useModalState();
  const debuggerModal = useModalState();
  const buildingModal = useModalState<string | null>(); // data = editingBuildingId (null for new)
  const explorerModal = useModalStateWithId(); // has .id for areaId

  const [sceneConfig, setSceneConfig] = useState(loadConfig);
  const [showFPS, setShowFPS] = useState(() => {
    // Only show FPS meter in development by default, can be toggled
    return import.meta.env.DEV && getStorageString(STORAGE_KEYS.SHOW_FPS) !== 'false';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile sidebar state
  const mobileView = useMobileView(); // Mobile view toggle - from store
  const { showToast } = useToast();

  // Trigger resize when switching to 3D view on mobile (canvas needs to recalculate size)
  useEffect(() => {
    if (mobileView === '3d') {
      // Multiple resize events to ensure canvas recalculates after CSS transitions complete
      const timeouts = [
        setTimeout(() => window.dispatchEvent(new Event('resize')), 0),
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100),
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300),
      ];
      return () => timeouts.forEach(clearTimeout);
    }
  }, [mobileView]);
  const state = useStore();

  // Initialize scene and websocket
  useEffect(() => {
    if (!canvasRef.current || !selectionBoxRef.current) return;

    // Reuse or create scene manager (persists across HMR)
    if (persistedScene) {
      // Reattach to new canvas/selection elements
      persistedScene.reattach(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = persistedScene;
      console.log('[Tide] Reattached existing scene (HMR)');
      // Re-apply custom classes from store on reattach (in case they were updated)
      const customClasses = store.getState().customAgentClasses;
      if (customClasses.size > 0) {
        persistedScene.setCustomAgentClasses(customClasses);
      }
    } else {
      const scene = new SceneManager(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = scene;
      persistedScene = scene;

      // Apply saved config
      const savedConfig = loadConfig();
      scene.setCharacterScale(savedConfig.characterScale);
      scene.setIndicatorScale(savedConfig.indicatorScale);
      scene.setGridVisible(savedConfig.gridVisible);
      scene.setTimeMode(savedConfig.timeMode);
      scene.setTerrainConfig(savedConfig.terrain);
      scene.setFloorStyle(savedConfig.terrain.floorStyle, true); // force=true on initial load
      scene.setIdleAnimation(savedConfig.animations.idleAnimation);
      scene.setWorkingAnimation(savedConfig.animations.workingAnimation);
      scene.setFpsLimit(savedConfig.fpsLimit);

      // Load character models then upgrade any existing agents
      scene.loadCharacterModels().then(() => {
        console.log('[Tide] Character models ready');
        // Apply custom classes from store (they may have arrived via WebSocket before models loaded)
        const customClasses = store.getState().customAgentClasses;
        if (customClasses.size > 0) {
          console.log('[Tide] Applying custom classes from store:', customClasses.size);
          scene.setCustomAgentClasses(customClasses);
        }
        scene.upgradeAgentModels();
      }).catch((err) => {
        console.warn('[Tide] Some models failed to load, using fallback:', err);
      });
    }

    // Set up area double-click callback (always update)
    sceneRef.current?.setOnAreaDoubleClick((areaId) => {
      store.selectArea(areaId);
      toolboxModal.open();
    });

    // Set up building click callback - open toolbox when building is clicked
    sceneRef.current?.setOnBuildingClick((buildingId) => {
      store.selectBuilding(buildingId);
      toolboxModal.open();
    });

    // Set up websocket callbacks (always update refs)
    setCallbacks({
      onToast: showToast,
      onAgentCreated: (agent) => {
        sceneRef.current?.addAgent(agent);
        (window as any).__spawnModalSuccess?.();
      },
      onAgentUpdated: (agent, positionChanged) => {
        sceneRef.current?.updateAgent(agent, positionChanged);
      },
      onAgentDeleted: (agentId) => {
        sceneRef.current?.removeAgent(agentId);
      },
      onAgentsSync: (agents) => {
        sceneRef.current?.syncAgents(agents);
      },
      onSpawnError: () => {
        (window as any).__spawnModalError?.();
      },
      onSpawnSuccess: () => {
        (window as any).__spawnModalSuccess?.();
      },
      onDirectoryNotFound: (path) => {
        (window as any).__spawnModalDirNotFound?.(path);
      },
      onToolUse: (agentId, toolName, toolInput) => {
        sceneRef.current?.showToolBubble(agentId, toolName, toolInput);
      },
      onDelegation: (bossId, subordinateId) => {
        sceneRef.current?.showDelegationEffect(bossId, subordinateId);
      },
      onCustomClassesSync: (classes) => {
        sceneRef.current?.setCustomAgentClasses(classes);
        // Upgrade agent models now that custom classes are available
        // This fixes the race condition where agents arrive before custom classes
        sceneRef.current?.upgradeAgentModels();
      },
      onReconnect: () => {
        // Trigger store reconnect which increments reconnectCount
        // Components watching reconnectCount will refresh their data
        store.triggerReconnect();
      },
    });

    // Always call connect() - it has internal guards against duplicate connections
    // and will properly set up the WebSocket if needed (especially after HMR reloads
    // where the websocket module may have been reset)
    connect();
    wsConnected = true;

    // Don't dispose on HMR unmount - only on full page unload
    return () => {
      // Only cleanup if page is actually unloading
      if (!import.meta.hot) {
        sceneRef.current?.dispose();
        persistedScene = null;
        wsConnected = false;
      }
    };
  }, [showToast]);

  // Subscribe to selection changes to update scene visuals
  useEffect(() => {
    return store.subscribe(() => {
      sceneRef.current?.refreshSelectionVisuals();
    });
  }, []);

  // Sync areas when they change (subscribe to store for real-time updates)
  useEffect(() => {
    // Initial sync
    sceneRef.current?.syncAreas();

    // Subscribe to store changes - sync areas on any change
    let lastAreasJson = '';
    return store.subscribe(() => {
      const state = store.getState();
      const areasJson = JSON.stringify(Array.from(state.areas.values()));
      if (areasJson !== lastAreasJson) {
        lastAreasJson = areasJson;
        sceneRef.current?.syncAreas();
      }
    });
  }, []);

  // Sync buildings when they change
  useEffect(() => {
    // Initial sync
    sceneRef.current?.syncBuildings();

    // Subscribe to store changes - sync buildings on any change
    let lastBuildingsJson = '';
    return store.subscribe(() => {
      const state = store.getState();
      const buildingsJson = JSON.stringify(Array.from(state.buildings.values()));
      if (buildingsJson !== lastBuildingsJson) {
        lastBuildingsJson = buildingsJson;
        sceneRef.current?.syncBuildings();
      }
    });
  }, []);

  // Update area highlight when selection changes
  useEffect(() => {
    sceneRef.current?.highlightArea(state.selectedAreaId);
  }, [state.selectedAreaId]);

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
  }, []);

  // Handle tool changes
  const handleToolChange = useCallback((tool: 'rectangle' | 'circle' | 'select' | null) => {
    sceneRef.current?.setDrawingTool(tool);
  }, []);

  // Handle focus agent
  const handleFocusAgent = useCallback((agentId: string) => {
    sceneRef.current?.focusAgent(agentId);
  }, []);

  // Handle kill agent (terminates Claude session)
  const handleKillAgent = useCallback((agentId: string) => {
    store.killAgent(agentId);
  }, []);

  // Handle calling subordinates to boss location
  const handleCallSubordinates = useCallback((bossId: string) => {
    sceneRef.current?.callSubordinates(bossId);
  }, []);

  // Handle opening file explorer for an area
  const handleOpenAreaExplorer = useCallback((areaId: string) => {
    explorerModal.open(areaId);
  }, [explorerModal]);

  // Handle opening new building modal
  const handleNewBuilding = useCallback(() => {
    buildingModal.open(null); // null = creating new building
  }, [buildingModal]);

  // Handle starting new area drawing
  const handleNewArea = useCallback(() => {
    sceneRef.current?.setDrawingTool('rectangle');
  }, []);

  // Handle editing a building
  const handleEditBuilding = useCallback((buildingId: string) => {
    buildingModal.open(buildingId);
  }, [buildingModal]);

  // Handle delete selected agents (removes from UI and server, keeps Claude sessions running)
  const handleDeleteSelectedAgents = useCallback(() => {
    const selectedIds = Array.from(state.selectedAgentIds);
    selectedIds.forEach(id => {
      // Remove from server persistence (triggers agent_deleted broadcast)
      store.removeAgentFromServer(id);
      // Clean up 3D scene (zzz bubble, etc.)
      sceneRef.current?.removeAgent(id);
    });
    deleteConfirmModal.close();
    showToast('info', 'Agents Removed', `${selectedIds.length} agent(s) removed from view`);
  }, [state.selectedAgentIds, showToast, deleteConfirmModal]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = store.getShortcuts();
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Escape to deselect or close modal/terminal
      const deselectShortcut = shortcuts.find(s => s.id === 'deselect-all');
      if (matchesShortcut(e, deselectShortcut)) {
        if (spawnModal.isOpen) {
          spawnModal.close();
        } else if (store.getState().terminalOpen) {
          // Close terminal first if open (prevents selection corruption on double-ESC)
          store.setTerminalOpen(false);
        } else {
          store.deselectAll();
          sceneRef.current?.refreshSelectionVisuals();
        }
      }

      // Ctrl+Number keys to select agents
      for (let i = 1; i <= 9; i++) {
        const selectShortcut = shortcuts.find(s => s.id === `select-agent-${i}`);
        if (matchesShortcut(e, selectShortcut)) {
          e.preventDefault();
          const currentState = store.getState();
          const index = i - 1;
          const agentIds = Array.from(currentState.agents.keys());
          if (index < agentIds.length) {
            store.selectAgent(agentIds[index]);
            sceneRef.current?.refreshSelectionVisuals();
          }
          return;
        }
      }

      // Spawn new agent
      const spawnShortcut = shortcuts.find(s => s.id === 'spawn-agent');
      if (matchesShortcut(e, spawnShortcut)) {
        e.preventDefault();
        spawnModal.open();
        return;
      }

      // Toggle Commander View (Tab)
      const commanderTabShortcut = shortcuts.find(s => s.id === 'toggle-commander-tab');
      if (matchesShortcut(e, commanderTabShortcut) && !isInputFocused) {
        e.preventDefault();
        commanderModal.toggle();
        return;
      }

      // Toggle Commander View (Ctrl+K)
      const commanderShortcut = shortcuts.find(s => s.id === 'toggle-commander');
      if (matchesShortcut(e, commanderShortcut)) {
        e.preventDefault();
        commanderModal.toggle();
        return;
      }

      // Toggle File Explorer
      const explorerShortcut = shortcuts.find(s => s.id === 'toggle-file-explorer');
      if (matchesShortcut(e, explorerShortcut)) {
        e.preventDefault();
        // Toggle - if open, close; if closed, open with first area that has directories
        if (explorerModal.isOpen) {
          explorerModal.close();
        } else {
          const areasWithDirs = Array.from(store.getState().areas.values())
            .filter(a => a.directories && a.directories.length > 0);
          if (areasWithDirs.length > 0) {
            explorerModal.open(areasWithDirs[0].id);
            // Close terminal when opening file explorer
            store.setTerminalOpen(false);
          }
        }
        return;
      }

      // Toggle Spotlight (Alt+P) - direct check as fallback for shortcut system
      const spotlightShortcut = shortcuts.find(s => s.id === 'toggle-spotlight');
      if (matchesShortcut(e, spotlightShortcut) || (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP')) {
        e.preventDefault();
        spotlightModal.toggle();
        return;
      }

      // Delete selected agents or buildings
      const deleteShortcut = shortcuts.find(s => s.id === 'delete-selected');
      const deleteBackspaceShortcut = shortcuts.find(s => s.id === 'delete-selected-backspace');
      if ((matchesShortcut(e, deleteShortcut) || matchesShortcut(e, deleteBackspaceShortcut)) && !isInputFocused) {
        const currentState = store.getState();
        // Check for selected agents first
        if (currentState.selectedAgentIds.size > 0) {
          e.preventDefault();
          deleteConfirmModal.open();
          return;
        }
        // Check for selected buildings
        if (currentState.selectedBuildingIds.size > 0) {
          e.preventDefault();
          store.deleteSelectedBuildings();
          sceneRef.current?.syncBuildings();
          return;
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [spawnModal, commanderModal, explorerModal, spotlightModal, deleteConfirmModal]);

  return (
    <div className={`app ${state.terminalOpen ? 'terminal-open' : ''} mobile-view-${mobileView}`}>
      {/* FPS Meter - development only */}
      <FPSMeter visible={showFPS} position="bottom-left" />

      <main className="main-content">
        <div className="battlefield-container">
          <canvas ref={canvasRef} id="battlefield"></canvas>
          <div ref={selectionBoxRef} id="selection-box"></div>
        </div>

        {/* Mobile view toggle button (3D / Terminal) */}
        <button
          className="mobile-view-toggle-btn"
          onClick={() => store.setMobileView(mobileView === 'terminal' ? '3d' : 'terminal')}
          title={mobileView === 'terminal' ? 'Show 3D View' : 'Show Terminal'}
        >
          {mobileView === 'terminal' ? '🎮' : '💬'}
        </button>

        {/* Mobile sidebar toggle button */}
        <button
          className="sidebar-toggle-btn"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          {sidebarOpen ? '✕' : '☰'}
        </button>

        {/* Sidebar overlay for mobile */}
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
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

      {/* Floating settings button */}
      <button
        className="floating-settings-btn"
        onClick={() => toolboxModal.open()}
        title="Settings & Tools"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>

      {/* Toolbox sidebar overlay */}
      <Toolbox
        config={sceneConfig}
        onConfigChange={handleConfigChange}
        onToolChange={handleToolChange}
        isOpen={toolboxModal.isOpen}
        onClose={toolboxModal.close}
        onOpenBuildingModal={(buildingId) => buildingModal.open(buildingId || null)}
      />

      {/* Building Config Modal */}
      <BuildingConfigModal
        isOpen={buildingModal.isOpen}
        onClose={buildingModal.close}
        buildingId={buildingModal.data}
      />

      <SpawnModal
        isOpen={spawnModal.isOpen}
        onClose={spawnModal.close}
        onSpawnStart={() => {}}
        onSpawnEnd={() => {}}
      />

      <BossSpawnModal
        isOpen={bossSpawnModal.isOpen}
        onClose={bossSpawnModal.close}
        onSpawnStart={() => {}}
        onSpawnEnd={() => {}}
      />

      <SubordinateAssignmentModal
        isOpen={subordinateModal.isOpen}
        bossId={subordinateModal.data || ''}
        onClose={subordinateModal.close}
      />

      {/* Delete Confirmation Modal */}
      {deleteConfirmModal.isOpen && (
        <div
          className="modal-overlay visible"
          onClick={deleteConfirmModal.close}
          onKeyDown={(e) => {
            if (e.key === 'Escape') deleteConfirmModal.close();
            if (e.key === 'Enter') handleDeleteSelectedAgents();
          }}
        >
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Remove Agents</div>
            <div className="modal-body confirm-modal-body">
              <p>Remove {state.selectedAgentIds.size} selected agent{state.selectedAgentIds.size > 1 ? 's' : ''} from the battlefield?</p>
              <p className="confirm-modal-note">Claude Code sessions will continue running in the background.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={deleteConfirmModal.close}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDeleteSelectedAgents} autoFocus>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Commander View button */}
      <button
        className="commander-toggle-btn"
        onClick={() => commanderModal.open()}
        title="Commander View (⌘K)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>

      {/* Supervisor Overview button */}
      <button
        className={`supervisor-toggle-btn ${state.supervisor.generatingReport ? 'generating' : ''}`}
        onClick={() => supervisorModal.open()}
        title={state.supervisor.generatingReport ? 'Generating report...' : 'Supervisor Overview'}
      >
        🎖️
        {state.supervisor.generatingReport && <span className="supervisor-generating-indicator" />}
      </button>

      {/* Keyboard Shortcuts button */}
      <button
        className="shortcuts-toggle-btn"
        onClick={() => shortcutsModal.open()}
        title="Keyboard Shortcuts"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M18 12h.01M8 16h8" />
        </svg>
      </button>

      {/* Skills Panel button */}
      <button
        className="skills-toggle-btn"
        onClick={() => skillsModal.open()}
        title="Manage Skills"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </button>

      {/* WebSocket Debugger button */}
      <button
        className="debugger-toggle-btn"
        onClick={() => debuggerModal.open()}
        title="WebSocket Debugger"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </button>

      <Profiler id="CommanderView" onRender={profileRender}>
        <CommanderView
          isOpen={commanderModal.isOpen}
          onClose={commanderModal.close}
        />
      </Profiler>

      {/* Supervisor Panel */}
      <SupervisorPanel
        isOpen={supervisorModal.isOpen}
        onClose={supervisorModal.close}
      />

      {/* File Explorer Panel (right side) */}
      <FileExplorerPanel
        isOpen={explorerModal.isOpen}
        areaId={explorerModal.id}
        onClose={explorerModal.close}
      />

      {/* Bottom Agent Bar */}
      <AgentBar
        onFocusAgent={handleFocusAgent}
        onSpawnClick={() => spawnModal.open()}
        onSpawnBossClick={() => bossSpawnModal.open()}
        onNewBuildingClick={handleNewBuilding}
        onNewAreaClick={handleNewArea}
      />

      {/* Spotlight / Global Search */}
      <Spotlight
        isOpen={spotlightModal.isOpen}
        onClose={spotlightModal.close}
        onOpenSpawnModal={() => spawnModal.open()}
        onOpenCommanderView={() => commanderModal.open()}
        onOpenToolbox={() => toolboxModal.open()}
        onOpenSupervisor={() => supervisorModal.open()}
        onOpenFileExplorer={(areaId) => explorerModal.open(areaId)}
      />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={shortcutsModal.isOpen}
        onClose={shortcutsModal.close}
      />

      {/* Skills Panel */}
      <SkillsPanel
        isOpen={skillsModal.isOpen}
        onClose={skillsModal.close}
      />

      {/* WebSocket Debugger Panel */}
      <WebSocketDebuggerPanel
        isOpen={debuggerModal.isOpen}
        onClose={debuggerModal.close}
      />
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
