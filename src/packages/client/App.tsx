import React, { useEffect, useRef, useState, useCallback, useMemo, Profiler } from 'react';
import { store, useStore, useMobileView, useExplorerFolderPath } from './store';
import { connect, setCallbacks, clearCallbacks, disconnect, getSocket } from './websocket';
import { SceneManager } from './scene/SceneManager';
import { ToastProvider, useToast } from './components/Toast';
import { AgentNotificationProvider, useAgentNotification } from './components/AgentNotificationToast';
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
import { ControlsModal } from './components/ControlsModal';
import { BuildingConfigModal } from './components/BuildingConfigModal';
import { SkillsPanel } from './components/SkillsPanel';
import { DrawingModeIndicator } from './components/DrawingModeIndicator';
import { AgentHoverPopup } from './components/AgentHoverPopup';
import { matchesShortcut } from './store/shortcuts';
import { FPSMeter } from './components/FPSMeter';
import { profileRender } from './utils/profiling';
import { STORAGE_KEYS, getStorage, setStorage, getStorageString } from './utils/storage';
import { useModalState, useModalStateWithId, useContextMenu } from './hooks';
import { ContextMenu, type ContextMenuAction } from './components/ContextMenu';

// Persist scene manager across HMR and StrictMode remounts
let persistedScene: SceneManager | null = null;
let persistedCanvas: HTMLCanvasElement | null = null;
let wsConnected = false;

// Track if page is actually unloading (not HMR)
let isPageUnloading = false;

// Cleanup function to dispose scene - called from multiple unload events
function cleanupScene(source: string): void {
  console.log(`%c[App] ${source} - disposing scene`, 'color: #ff00ff; font-weight: bold');
  isPageUnloading = true;

  // Clear the session flag to indicate clean shutdown
  sessionStorage.removeItem('tide_webgl_active');

  // Disconnect WebSocket and clear all callbacks FIRST to prevent them from holding references
  disconnect();
  clearCallbacks();

  // Clear debug reference BEFORE dispose to break reference chains
  if ((window as any).__tideScene) {
    (window as any).__tideScene = null;
  }

  if (persistedScene) {
    console.log('[App] Calling persistedScene.dispose()');
    persistedScene.dispose();
    persistedScene = null;
  } else {
    console.log('[App] No persistedScene to dispose');
  }

  persistedCanvas = null;
  wsConnected = false;

  // Remove canvas from DOM to help browser release WebGL context
  const canvas = document.getElementById('battlefield');
  if (canvas) {
    canvas.remove();
  }

  // Clear the app container to remove all React nodes
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '';
  }
}

// Session storage key to track if we had an active WebGL context
const WEBGL_SESSION_KEY = 'tide_webgl_active';

if (typeof window !== 'undefined') {
  // ON PAGE LOAD: Clean up any stale scene references from previous sessions
  // This handles the case where bfcache or reload preserved old memory
  (function cleanupStaleContexts() {
    // Check if previous session didn't clean up properly (refresh without beforeunload)
    const hadActiveContext = sessionStorage.getItem(WEBGL_SESSION_KEY) === 'true';
    if (hadActiveContext) {
      console.log('[App] Detected unclean shutdown from previous session - forcing cleanup');
    }

    // Clear any stale global references - only if there's actually a stale scene
    if ((window as any).__tideScene) {
      console.log('[App] Cleaning up stale __tideScene reference');
      try {
        (window as any).__tideScene.dispose?.();
      } catch {
        // May already be disposed
      }
      (window as any).__tideScene = null;
    }

    // Clear persistedScene if it exists from a previous load
    // Note: Cast needed because TS control flow doesn't account for bfcache/HMR edge cases
    const staleScene = persistedScene as unknown as SceneManager | null;
    if (staleScene) {
      console.log('[App] Cleaning up stale persistedScene');
      try {
        staleScene.dispose();
      } catch {
        // May already be disposed
      }
      persistedScene = null;
    }

    // ALWAYS try to kill any existing WebGL context on the battlefield canvas
    // This is critical because on refresh, the browser may keep the old context alive
    const existingCanvas = document.getElementById('battlefield') as HTMLCanvasElement | null;
    if (existingCanvas) {
      console.log('[App] Found existing canvas, forcing WebGL context loss and removal');
      try {
        // Try to get and lose any existing context
        const gl = existingCanvas.getContext('webgl2') || existingCanvas.getContext('webgl');
        if (gl) {
          const loseContext = gl.getExtension('WEBGL_lose_context');
          if (loseContext) {
            loseContext.loseContext();
          }
        }
      } catch {
        // Context may already be lost
      }
      // Always remove the canvas so a fresh one is created
      existingCanvas.remove();
    }

    // Clear the session flag since we've done cleanup
    sessionStorage.removeItem(WEBGL_SESSION_KEY);
  })();

  // Detect bfcache restore and force cleanup
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      console.log('[App] Page restored from bfcache - cleaning up');
      cleanupScene('bfcache-restore');
      // Force reload to get fresh state
      window.location.reload();
    }
  });

  // Cleanup handlers for page unload
  window.onunload = () => cleanupScene('onunload');
  window.onbeforeunload = () => {
    cleanupScene('onbeforeunload');
    return undefined;
  };
  window.addEventListener('pagehide', (event) => {
    cleanupScene(`pagehide (persisted=${event.persisted})`);
  });
}

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
    characterScale: 2.0,
    indicatorScale: 2.0,
    gridVisible: true,
    timeMode: 'day',
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
  const controlsModal = useModalState();
  const skillsModal = useModalState();
  const buildingModal = useModalState<string | null>(); // data = editingBuildingId (null for new)
  const explorerModal = useModalStateWithId(); // has .id for areaId
  const explorerFolderPath = useExplorerFolderPath(); // Direct folder path for file explorer (from store)
  const contextMenu = useContextMenu(); // Right-click context menu
  const [spawnPosition, setSpawnPosition] = useState<{ x: number; z: number } | null>(null);
  const [hoveredAgentPopup, setHoveredAgentPopup] = useState<{
    agentId: string;
    screenPos: { x: number; y: number };
  } | null>(null);

  const [sceneConfig, setSceneConfig] = useState(loadConfig);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile sidebar state
  const mobileView = useMobileView(); // Mobile view toggle - from store
  const { showToast } = useToast();
  const { showAgentNotification } = useAgentNotification();

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

    // Check if this is the same canvas as before (StrictMode remount or HMR)
    const isSameCanvas = persistedCanvas === canvasRef.current;

    // Reuse or create scene manager (persists across HMR and StrictMode remounts)
    if (persistedScene && isSameCanvas) {
      // Same canvas, just reuse existing scene (StrictMode remount)
      sceneRef.current = persistedScene;
      console.log('[Tide] Reusing existing scene (StrictMode remount)');
    } else if (persistedScene && !isSameCanvas) {
      // Different canvas (HMR), need to reattach
      persistedScene.reattach(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = persistedScene;
      persistedCanvas = canvasRef.current;
      console.log('[Tide] Reattached existing scene (HMR)');
      // Re-apply custom classes from store on reattach (in case they were updated)
      const customClasses = store.getState().customAgentClasses;
      if (customClasses.size > 0) {
        persistedScene.setCustomAgentClasses(customClasses);
      }
    } else {
      // Mark that we're creating a WebGL context - used for detecting unclean shutdowns
      sessionStorage.setItem(WEBGL_SESSION_KEY, 'true');

      const scene = new SceneManager(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = scene;
      persistedScene = scene;
      persistedCanvas = canvasRef.current;

      // Expose scene manager for debugging in dev mode
      if (import.meta.env.DEV && typeof window !== 'undefined') {
        (window as any).__tideScene = scene;
        console.log('[Tide] SceneManager available at window.__tideScene (use .logMemoryDiagnostics() for memory info)');
      }

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

      // Load character models then sync agents from store
      scene.loadCharacterModels().then(() => {
        console.log('[Tide] Character models ready');
        // Apply custom classes from store (they may have arrived via WebSocket before models loaded)
        const state = store.getState();
        if (state.customAgentClasses.size > 0) {
          console.log('[Tide] Applying custom classes from store:', state.customAgentClasses.size);
          scene.setCustomAgentClasses(state.customAgentClasses);
        }
        // Sync agents from store (in case WS sync happened before scene was ready)
        if (state.agents.size > 0) {
          console.log('[Tide] Syncing agents from store:', state.agents.size);
          scene.syncAgents(Array.from(state.agents.values()));
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
    // For folder buildings, open file explorer instead
    sceneRef.current?.setOnBuildingClick((buildingId) => {
      store.selectBuilding(buildingId);
      const building = store.getState().buildings.get(buildingId);
      if (building?.type === 'folder' && building.folderPath) {
        // Open file explorer with the folder path
        store.openFileExplorer(building.folderPath);
      } else {
        toolboxModal.open();
      }
    });

    // Set up context menu callback (right-click on ground, agent, area, or building)
    sceneRef.current?.setOnContextMenu((screenPos, worldPos, target) => {
      contextMenu.open(screenPos, worldPos, target);
    });

    // Set up agent hover callback (for battlefield tooltip)
    sceneRef.current?.setOnAgentHover((agentId, screenPos) => {
      if (agentId && screenPos) {
        setHoveredAgentPopup({ agentId, screenPos });
      } else {
        setHoveredAgentPopup(null);
      }
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
      onAgentNotification: (notification) => {
        showAgentNotification(notification);
      },
    });

    // Always call connect() - it has internal guards against duplicate connections
    // and will properly set up the WebSocket if needed (especially after HMR reloads
    // where the websocket module may have been reset)
    connect();
    wsConnected = true;

    // Don't dispose on HMR or StrictMode unmount - only on full page unload
    return () => {
      // Only cleanup if page is actually unloading (not HMR or StrictMode)
      // isPageUnloading is set by beforeunload event
      // In production, StrictMode causes mount/unmount/remount, so we keep the scene alive
      if (isPageUnloading) {
        sceneRef.current?.dispose();
        persistedScene = null;
        persistedCanvas = null;
        wsConnected = false;
      }
    };
  }, [showToast, showAgentNotification]);

  // Subscribe to selection changes to update scene visuals
  // CRITICAL: Only refresh when selection actually changes, not on every store update
  // This prevents massive geometry churn from boss-subordinate line recreation
  useEffect(() => {
    let lastSelectedIds = '';
    let lastAgentVersion = new Map<string, number>();

    // Efficient shallow comparison without JSON serialization
    const getAgentVersion = (agents: Map<string, any>) => {
      let changed = false;
      const newVersion = new Map<string, number>();

      for (const [id, agent] of agents) {
        // Create a simple hash from relevant properties
        const hash = `${agent.position.x.toFixed(2)},${agent.position.z.toFixed(2)},${agent.status},${agent.class},${agent.isBoss},${agent.subordinateIds?.length ?? 0}`;
        const hashCode = hash.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
        newVersion.set(id, hashCode);

        if (lastAgentVersion.get(id) !== hashCode) {
          changed = true;
        }
      }

      // Check for removed agents
      if (newVersion.size !== lastAgentVersion.size) {
        changed = true;
      }

      return { newVersion, changed };
    };

    return store.subscribe(() => {
      const state = store.getState();
      // Check if selection changed
      const selectedIds = Array.from(state.selectedAgentIds).sort().join(',');
      const selectionChanged = selectedIds !== lastSelectedIds;

      // Efficient agent comparison without JSON.stringify
      const { newVersion, changed: agentsChanged } = getAgentVersion(state.agents);

      if (selectionChanged || agentsChanged) {
        lastSelectedIds = selectedIds;
        lastAgentVersion = newVersion;
        sceneRef.current?.refreshSelectionVisuals();
      }
    });
  }, []);

  // Sync areas when they change (subscribe to store for real-time updates)
  useEffect(() => {
    // Initial sync
    sceneRef.current?.syncAreas();

    // Subscribe to store changes - use size + shallow check instead of JSON
    let lastAreasSize = 0;
    let lastAreasHash = 0;
    return store.subscribe(() => {
      const state = store.getState();
      const areas = state.areas;
      // Quick size check first
      if (areas.size !== lastAreasSize) {
        lastAreasSize = areas.size;
        lastAreasHash = Date.now(); // Force update
        sceneRef.current?.syncAreas();
        return;
      }
      // Simple hash of area ids and dimensions
      let hash = 0;
      for (const [id, area] of areas) {
        hash ^= id.charCodeAt(0) + ((area.width ?? 0) + (area.height ?? 0) + (area.radius ?? 0)) | 0;
      }
      if (hash !== lastAreasHash) {
        lastAreasHash = hash;
        sceneRef.current?.syncAreas();
      }
    });
  }, []);

  // Sync buildings when they change
  useEffect(() => {
    // Initial sync
    sceneRef.current?.syncBuildings();

    // Subscribe to store changes - use size + shallow check instead of JSON
    let lastBuildingsSize = 0;
    let lastBuildingsHash = 0;
    return store.subscribe(() => {
      const state = store.getState();
      const buildings = state.buildings;
      // Quick size check first
      if (buildings.size !== lastBuildingsSize) {
        lastBuildingsSize = buildings.size;
        lastBuildingsHash = Date.now();
        sceneRef.current?.syncBuildings();
        return;
      }
      // Simple hash of building positions
      let hash = 0;
      for (const [id, building] of buildings) {
        hash ^= (building.position.x * 1000 + building.position.z) | 0;
      }
      if (hash !== lastBuildingsHash) {
        lastBuildingsHash = hash;
        sceneRef.current?.syncBuildings();
      }
    });
  }, []);

  // Update area highlight when selection changes
  useEffect(() => {
    sceneRef.current?.highlightArea(state.selectedAreaId);
  }, [state.selectedAreaId]);

  // Apply power saving setting to scene
  useEffect(() => {
    sceneRef.current?.setPowerSaving(state.settings.powerSaving);
  }, [state.settings.powerSaving]);

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
    // Show toast when entering drawing mode
    if (tool === 'rectangle' || tool === 'circle') {
      const toolName = tool === 'rectangle' ? 'Rectangle' : 'Circle';
      showToast('info', `${toolName} Tool`, 'Click and drag on the battlefield to draw an area', 3000);
    }
  }, [showToast]);

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
    showToast('info', 'Rectangle Tool', 'Click and drag on the battlefield to draw an area', 3000);
  }, [showToast]);

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

  // Context menu actions - build dynamically based on what was clicked
  const contextMenuActions: ContextMenuAction[] = useMemo(() => {
    const worldPos = contextMenu.worldPosition;
    const target = contextMenu.target;
    const actions: ContextMenuAction[] = [];

    // Agent-specific actions
    if (target.type === 'agent' && target.id) {
      const agent = state.agents.get(target.id);
      if (agent) {
        actions.push({
          id: 'select-agent',
          label: `Select ${agent.name}`,
          icon: '👆',
          onClick: () => {
            store.selectAgent(target.id!);
            sceneRef.current?.refreshSelectionVisuals();
          },
        });
        actions.push({
          id: 'focus-agent',
          label: 'Focus Camera',
          icon: '🎯',
          onClick: () => {
            sceneRef.current?.focusAgent(target.id!);
          },
        });
        actions.push({
          id: 'open-terminal',
          label: 'Open Terminal',
          icon: '💬',
          onClick: () => {
            store.selectAgent(target.id!);
            store.setTerminalOpen(true);
          },
        });
        actions.push({ id: 'divider-agent', label: '', divider: true, onClick: () => {} });
        actions.push({
          id: 'delete-agent',
          label: `Remove ${agent.name}`,
          icon: '🗑️',
          danger: true,
          onClick: () => {
            store.removeAgentFromServer(target.id!);
            sceneRef.current?.removeAgent(target.id!);
            showToast('info', 'Agent Removed', `${agent.name} removed from view`);
          },
        });
        return actions;
      }
    }

    // Area-specific actions
    if (target.type === 'area' && target.id) {
      const area = state.areas.get(target.id);
      if (area) {
        actions.push({
          id: 'select-area',
          label: `Select "${area.name}"`,
          icon: '📐',
          onClick: () => {
            store.selectArea(target.id!);
            toolboxModal.open();
          },
        });
        if (area.directories && area.directories.length > 0) {
          actions.push({
            id: 'open-explorer',
            label: 'Open File Explorer',
            icon: '📁',
            onClick: () => {
              explorerModal.open(target.id!);
            },
          });
        }
        actions.push({ id: 'divider-area', label: '', divider: true, onClick: () => {} });
        actions.push({
          id: 'delete-area',
          label: `Delete "${area.name}"`,
          icon: '🗑️',
          danger: true,
          onClick: () => {
            store.deleteArea(target.id!);
            sceneRef.current?.syncAreas();
            showToast('info', 'Area Deleted', `"${area.name}" has been deleted`);
          },
        });
        return actions;
      }
    }

    // Building-specific actions
    if (target.type === 'building' && target.id) {
      const building = state.buildings.get(target.id);
      if (building) {
        actions.push({
          id: 'select-building',
          label: `Select "${building.name}"`,
          icon: '🏢',
          onClick: () => {
            store.selectBuilding(target.id!);
            toolboxModal.open();
          },
        });
        actions.push({
          id: 'edit-building',
          label: 'Edit Building',
          icon: '✏️',
          onClick: () => {
            buildingModal.open(target.id!);
          },
        });
        if (building.type === 'folder' && building.folderPath) {
          actions.push({
            id: 'open-folder',
            label: 'Open Folder',
            icon: '📁',
            onClick: () => {
              store.openFileExplorer(building.folderPath!);
            },
          });
        }
        actions.push({ id: 'divider-building', label: '', divider: true, onClick: () => {} });
        actions.push({
          id: 'delete-building',
          label: `Delete "${building.name}"`,
          icon: '🗑️',
          danger: true,
          onClick: () => {
            store.deleteBuilding(target.id!);
            sceneRef.current?.syncBuildings();
            showToast('info', 'Building Deleted', `"${building.name}" has been deleted`);
          },
        });
        return actions;
      }
    }

    // Ground actions (default) - spawn, draw, etc.
    actions.push({
      id: 'spawn-agent',
      label: 'Spawn Agent Here',
      icon: '🤖',
      shortcut: 'N',
      onClick: () => {
        setSpawnPosition(worldPos);
        spawnModal.open();
      },
    });
    actions.push({
      id: 'spawn-boss',
      label: 'Spawn Boss Here',
      icon: '👑',
      onClick: () => {
        setSpawnPosition(worldPos);
        bossSpawnModal.open();
      },
    });
    actions.push({ id: 'divider-1', label: '', divider: true, onClick: () => {} });
    actions.push({
      id: 'draw-area',
      label: 'Draw Area',
      icon: '📐',
      onClick: () => {
        sceneRef.current?.setDrawingTool('rectangle');
      },
    });
    actions.push({
      id: 'new-building',
      label: 'Place Building',
      icon: '🏢',
      onClick: () => {
        buildingModal.open(null);
      },
    });
    actions.push({ id: 'divider-2', label: '', divider: true, onClick: () => {} });
    actions.push({
      id: 'open-settings',
      label: 'Settings',
      icon: '⚙️',
      onClick: () => {
        toolboxModal.open();
      },
    });
    actions.push({
      id: 'open-commander',
      label: 'Commander View',
      icon: '📊',
      shortcut: '⌘K',
      onClick: () => {
        commanderModal.open();
      },
    });

    return actions;
  }, [contextMenu.worldPosition, contextMenu.target, state.agents, state.areas, state.buildings, spawnModal, bossSpawnModal, buildingModal, toolboxModal, commanderModal, explorerModal, showToast]);

  // Clear spawn position when spawn modals close
  useEffect(() => {
    if (!spawnModal.isOpen && !bossSpawnModal.isOpen) {
      setSpawnPosition(null);
    }
  }, [spawnModal.isOpen, bossSpawnModal.isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = store.getShortcuts();
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Escape to deselect or close modal/terminal/drawing mode
      const deselectShortcut = shortcuts.find(s => s.id === 'deselect-all');
      if (matchesShortcut(e, deselectShortcut)) {
        const currentState = store.getState();
        // Exit drawing mode first if active
        if (currentState.activeTool === 'rectangle' || currentState.activeTool === 'circle') {
          sceneRef.current?.setDrawingTool(null);
          return;
        }
        if (spawnModal.isOpen) {
          spawnModal.close();
        } else if (currentState.terminalOpen) {
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
  }, [spawnModal, commanderModal, explorerModal, spotlightModal, deleteConfirmModal, controlsModal]);

  // Check if in drawing mode
  const isDrawingMode = state.activeTool === 'rectangle' || state.activeTool === 'circle';

  // Handle exit drawing mode
  const handleExitDrawingMode = useCallback(() => {
    sceneRef.current?.setDrawingTool(null);
  }, []);

  return (
    <div className={`app ${state.terminalOpen ? 'terminal-open' : ''} ${isDrawingMode ? 'drawing-mode' : ''} mobile-view-${mobileView}`}>
      {/* FPS Meter */}
      <FPSMeter visible={state.settings.showFPS} position="top-left" />

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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

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

      {/* Toolbox sidebar overlay */}
      <Toolbox
        config={sceneConfig}
        onConfigChange={handleConfigChange}
        onToolChange={handleToolChange}
        isOpen={toolboxModal.isOpen}
        onClose={toolboxModal.close}
        onOpenBuildingModal={(buildingId) => buildingModal.open(buildingId || null)}
        onOpenAreaExplorer={handleOpenAreaExplorer}
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
        spawnPosition={spawnPosition}
      />

      <BossSpawnModal
        isOpen={bossSpawnModal.isOpen}
        onClose={bossSpawnModal.close}
        onSpawnStart={() => {}}
        onSpawnEnd={() => {}}
        spawnPosition={spawnPosition}
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

      {/* Controls button (Keyboard & Mouse) */}
      <button
        className="shortcuts-toggle-btn"
        onClick={() => controlsModal.open()}
        title="Controls (Keyboard & Mouse)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
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
        isOpen={explorerModal.isOpen || explorerFolderPath !== null}
        areaId={explorerModal.id}
        folderPath={explorerFolderPath}
        onClose={() => {
          explorerModal.close();
          store.closeFileExplorer();
        }}
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

      {/* Controls Modal (Keyboard & Mouse) */}
      <ControlsModal
        isOpen={controlsModal.isOpen}
        onClose={controlsModal.close}
      />

      {/* Skills Panel */}
      <SkillsPanel
        isOpen={skillsModal.isOpen}
        onClose={skillsModal.close}
      />

      {/* Right-click Context Menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.screenPosition}
        worldPosition={contextMenu.worldPosition}
        actions={contextMenuActions}
        onClose={contextMenu.close}
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
