import React, { useEffect, useRef, useState, useCallback, Profiler } from 'react';
import { store, useStore } from './store';
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
import { matchesShortcut } from './store/shortcuts';
import { FPSMeter } from './components/FPSMeter';
import { profileRender } from './utils/profiling';

// Persist scene manager across HMR
let persistedScene: SceneManager | null = null;
let wsConnected = false;

// Config storage key
const CONFIG_STORAGE_KEY = 'tide-commander-config';

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

// Load config from localStorage
function loadConfig(): SceneConfig {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        characterScale: parsed.characterScale ?? 0.5,
        indicatorScale: parsed.indicatorScale ?? 1.0,
        gridVisible: parsed.gridVisible ?? true,
        timeMode: parsed.timeMode ?? 'auto',
        terrain: { ...DEFAULT_TERRAIN, ...parsed.terrain },
        animations: { ...DEFAULT_ANIMATIONS, ...parsed.animations },
        fpsLimit: parsed.fpsLimit ?? DEFAULT_FPS_LIMIT,
      };
    }
  } catch (err) {
    console.warn('[Tide] Failed to load config:', err);
  }
  return { characterScale: 0.5, indicatorScale: 1.0, gridVisible: true, timeMode: 'auto', terrain: DEFAULT_TERRAIN, animations: DEFAULT_ANIMATIONS, fpsLimit: DEFAULT_FPS_LIMIT };
}

// Save config to localStorage
function saveConfig(config: SceneConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('[Tide] Failed to save config:', err);
  }
}

function AppContent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false);
  const [isBossSpawnModalOpen, setIsBossSpawnModalOpen] = useState(false);
  const [isSubordinateModalOpen, setIsSubordinateModalOpen] = useState(false);
  const [editingBossId, setEditingBossId] = useState<string | null>(null);
  const [isToolboxOpen, setIsToolboxOpen] = useState(false);
  const [isCommanderViewOpen, setIsCommanderViewOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSupervisorOpen, setIsSupervisorOpen] = useState(false);
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isBuildingModalOpen, setIsBuildingModalOpen] = useState(false);
  const [isSkillsPanelOpen, setIsSkillsPanelOpen] = useState(false);
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null);
  const [sceneConfig, setSceneConfig] = useState(loadConfig);
  const [explorerAreaId, setExplorerAreaId] = useState<string | null>(null);
  const [showFPS, setShowFPS] = useState(() => {
    // Only show FPS meter in development by default, can be toggled
    return import.meta.env.DEV && localStorage.getItem('tide-show-fps') !== 'false';
  });
  const { showToast } = useToast();
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
        scene.upgradeAgentModels();
      }).catch((err) => {
        console.warn('[Tide] Some models failed to load, using fallback:', err);
      });
    }

    // Set up area double-click callback (always update)
    sceneRef.current?.setOnAreaDoubleClick((areaId) => {
      store.selectArea(areaId);
      setIsToolboxOpen(true);
    });

    // Set up building click callback - open toolbox when building is clicked
    sceneRef.current?.setOnBuildingClick((buildingId) => {
      store.selectBuilding(buildingId);
      setIsToolboxOpen(true);
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
      },
    });

    // Connect to server only if not already connected
    if (!wsConnected || !getSocket() || getSocket()?.readyState !== WebSocket.OPEN) {
      connect();
      wsConnected = true;
    }

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
    setExplorerAreaId(areaId);
  }, []);

  // Handle opening new building modal
  const handleNewBuilding = useCallback(() => {
    setEditingBuildingId(null);
    setIsBuildingModalOpen(true);
  }, []);

  // Handle starting new area drawing
  const handleNewArea = useCallback(() => {
    sceneRef.current?.setDrawingTool('rectangle');
  }, []);

  // Handle editing a building
  const handleEditBuilding = useCallback((buildingId: string) => {
    setEditingBuildingId(buildingId);
    setIsBuildingModalOpen(true);
  }, []);

  // Handle delete selected agents (removes from UI and server, keeps Claude sessions running)
  const handleDeleteSelectedAgents = useCallback(() => {
    const selectedIds = Array.from(state.selectedAgentIds);
    selectedIds.forEach(id => {
      // Remove from server persistence (triggers agent_deleted broadcast)
      store.removeAgentFromServer(id);
      // Clean up 3D scene (zzz bubble, etc.)
      sceneRef.current?.removeAgent(id);
    });
    setIsDeleteConfirmOpen(false);
    showToast('info', 'Agents Removed', `${selectedIds.length} agent(s) removed from view`);
  }, [state.selectedAgentIds, showToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = store.getShortcuts();
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Escape to deselect or close modal
      const deselectShortcut = shortcuts.find(s => s.id === 'deselect-all');
      if (matchesShortcut(e, deselectShortcut)) {
        if (isSpawnModalOpen) {
          setIsSpawnModalOpen(false);
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
        setIsSpawnModalOpen(true);
        return;
      }

      // Toggle Commander View (Tab)
      const commanderTabShortcut = shortcuts.find(s => s.id === 'toggle-commander-tab');
      if (matchesShortcut(e, commanderTabShortcut) && !isInputFocused) {
        e.preventDefault();
        setIsCommanderViewOpen(prev => !prev);
        return;
      }

      // Toggle Commander View (Ctrl+K)
      const commanderShortcut = shortcuts.find(s => s.id === 'toggle-commander');
      if (matchesShortcut(e, commanderShortcut)) {
        e.preventDefault();
        setIsCommanderViewOpen(prev => !prev);
        return;
      }

      // Toggle File Explorer
      const explorerShortcut = shortcuts.find(s => s.id === 'toggle-file-explorer');
      if (matchesShortcut(e, explorerShortcut)) {
        e.preventDefault();
        // Toggle - if open, close; if closed, open with first area that has directories
        if (explorerAreaId !== null) {
          setExplorerAreaId(null);
        } else {
          const areasWithDirs = Array.from(store.getState().areas.values())
            .filter(a => a.directories && a.directories.length > 0);
          if (areasWithDirs.length > 0) {
            setExplorerAreaId(areasWithDirs[0].id);
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
        setIsSpotlightOpen(prev => !prev);
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
          setIsDeleteConfirmOpen(true);
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
  }, [isSpawnModalOpen, explorerAreaId]);

  return (
    <div className="app">
      {/* FPS Meter - development only */}
      <FPSMeter visible={showFPS} position="bottom-left" />

      <main className="main-content">
        <div className="battlefield-container">
          <canvas ref={canvasRef} id="battlefield"></canvas>
          <div ref={selectionBoxRef} id="selection-box"></div>
        </div>

        <aside className="sidebar">
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
        onClick={() => setIsToolboxOpen(true)}
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
        isOpen={isToolboxOpen}
        onClose={() => setIsToolboxOpen(false)}
        onOpenBuildingModal={(buildingId) => {
          setEditingBuildingId(buildingId || null);
          setIsBuildingModalOpen(true);
        }}
      />

      {/* Building Config Modal */}
      <BuildingConfigModal
        isOpen={isBuildingModalOpen}
        onClose={() => {
          setIsBuildingModalOpen(false);
          setEditingBuildingId(null);
        }}
        buildingId={editingBuildingId}
      />

      <SpawnModal
        isOpen={isSpawnModalOpen}
        onClose={() => setIsSpawnModalOpen(false)}
        onSpawnStart={() => {}}
        onSpawnEnd={() => {}}
      />

      <BossSpawnModal
        isOpen={isBossSpawnModalOpen}
        onClose={() => setIsBossSpawnModalOpen(false)}
        onSpawnStart={() => {}}
        onSpawnEnd={() => {}}
      />

      <SubordinateAssignmentModal
        isOpen={isSubordinateModalOpen}
        bossId={editingBossId || ''}
        onClose={() => {
          setIsSubordinateModalOpen(false);
          setEditingBossId(null);
        }}
      />

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div
          className="modal-overlay visible"
          onClick={() => setIsDeleteConfirmOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsDeleteConfirmOpen(false);
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
              <button className="btn btn-secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
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
        onClick={() => setIsCommanderViewOpen(true)}
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
        className="supervisor-toggle-btn"
        onClick={() => setIsSupervisorOpen(true)}
        title="Supervisor Overview"
      >
        🎖️
      </button>

      {/* Keyboard Shortcuts button */}
      <button
        className="shortcuts-toggle-btn"
        onClick={() => setIsShortcutsModalOpen(true)}
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
        onClick={() => setIsSkillsPanelOpen(true)}
        title="Manage Skills"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </button>

      <Profiler id="CommanderView" onRender={profileRender}>
        <CommanderView
          isOpen={isCommanderViewOpen}
          onClose={() => setIsCommanderViewOpen(false)}
        />
      </Profiler>

      {/* Supervisor Panel */}
      <SupervisorPanel
        isOpen={isSupervisorOpen}
        onClose={() => setIsSupervisorOpen(false)}
      />

      {/* File Explorer Panel (right side) */}
      <FileExplorerPanel
        isOpen={explorerAreaId !== null}
        areaId={explorerAreaId}
        onClose={() => setExplorerAreaId(null)}
      />

      {/* Bottom Agent Bar */}
      <AgentBar
        onFocusAgent={handleFocusAgent}
        onSpawnClick={() => setIsSpawnModalOpen(true)}
        onSpawnBossClick={() => setIsBossSpawnModalOpen(true)}
        onNewBuildingClick={handleNewBuilding}
        onNewAreaClick={handleNewArea}
      />

      {/* Spotlight / Global Search */}
      <Spotlight
        isOpen={isSpotlightOpen}
        onClose={() => setIsSpotlightOpen(false)}
        onOpenSpawnModal={() => setIsSpawnModalOpen(true)}
        onOpenCommanderView={() => setIsCommanderViewOpen(true)}
        onOpenToolbox={() => setIsToolboxOpen(true)}
        onOpenSupervisor={() => setIsSupervisorOpen(true)}
        onOpenFileExplorer={(areaId) => setExplorerAreaId(areaId)}
      />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* Skills Panel */}
      <SkillsPanel
        isOpen={isSkillsPanelOpen}
        onClose={() => setIsSkillsPanelOpen(false)}
      />

      {/* Building Config Modal */}
      <BuildingConfigModal
        isOpen={isBuildingModalOpen}
        onClose={() => {
          setIsBuildingModalOpen(false);
          setEditingBuildingId(null);
        }}
        buildingId={editingBuildingId}
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
