import { useEffect, useRef } from 'react';
import { store } from '../store';
import { setCallbacks, clearSceneCallbacks } from '../websocket';
import { SceneManager } from '../scene/SceneManager';
import {
  getPersistedScene,
  getPersistedCanvas,
  setPersistedScene,
  setPersistedCanvas,
  markWebGLActive,
} from '../app/sceneLifecycle';
import { loadConfig } from '../app/sceneConfig';
import type { ToastType } from '../components/Toast';
import type { UseModalState } from './index';

// =============================================================================
// MEMORY OPTIMIZATION: Dispose 3D scene when switching to 2D mode
// =============================================================================
// When enabled (DISPOSE_3D_ON_MODE_SWITCH = true):
//   - Switching to 2D mode fully disposes the 3D scene and frees GPU memory
//   - Switching back to 3D mode requires reloading all models (slower transition)
//   - Better for memory-constrained environments
//
// When disabled (DISPOSE_3D_ON_MODE_SWITCH = false):
//   - 3D scene stays in memory when in 2D mode
//   - Switching between modes is instant (smoother UX)
//   - Uses more memory when in 2D mode
// =============================================================================
const DISPOSE_3D_ON_MODE_SWITCH = true;

// HMR tracking for 3D scene changes - track pending changes for manual refresh
declare global {
  interface Window {
    __tideHmrPendingSceneChanges?: boolean;
    __tideHmrSceneRefresh?: () => void;
    __tideHmrRefreshListeners?: Set<() => void>;
  }
}

// Initialize refresh listeners set
if (typeof window !== 'undefined' && !window.__tideHmrRefreshListeners) {
  window.__tideHmrRefreshListeners = new Set();
}

if (import.meta.hot) {
  // Accept HMR updates for this module to prevent full page reload
  // We'll track the change as pending and let user manually refresh
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] useSceneSetup updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });

  // Listen for updates to scene-related modules
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    const sceneRelatedModules = ['/scene/', '/hooks/useSceneSetup'];
    const isSceneRelated = payload.updates?.some((u: { path: string }) =>
      sceneRelatedModules.some((m) => u.path.includes(m))
    );
    if (isSceneRelated) {
      console.log('[Tide HMR] Scene-related change detected - pending refresh available');
      window.__tideHmrPendingSceneChanges = true;
    }
  });
}

/**
 * Check if there are pending HMR scene changes
 */
export function hasPendingSceneChanges(): boolean {
  return window.__tideHmrPendingSceneChanges === true;
}

/**
 * Refresh the 3D scene - disposes current scene and reloads page to get new code
 */
export function refreshScene(): void {
  console.log('[Tide HMR] Manual scene refresh triggered');

  // Dispose the scene to free WebGL resources before reload
  const scene = getPersistedScene();
  if (scene) {
    try {
      scene.dispose();
    } catch (e) {
      console.warn('[Tide HMR] Error disposing scene:', e);
    }
    setPersistedScene(null);
  }
  setPersistedCanvas(null);

  // Clear debug reference
  if ((window as any).__tideScene) {
    (window as any).__tideScene = null;
  }

  // Force WebGL context loss to free GPU memory
  const canvas = document.getElementById('battlefield') as HTMLCanvasElement | null;
  if (canvas) {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }

  // Clear pending flag and reload to get new module code
  window.__tideHmrPendingSceneChanges = false;
  window.location.reload();
}

/**
 * Subscribe to scene refresh events
 */
export function subscribeToSceneRefresh(callback: () => void): () => void {
  window.__tideHmrRefreshListeners?.add(callback);
  return () => {
    window.__tideHmrRefreshListeners?.delete(callback);
  };
}

// Expose refresh function globally for easy access
if (typeof window !== 'undefined') {
  window.__tideHmrSceneRefresh = refreshScene;
}

interface UseSceneSetupOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  selectionBoxRef: React.RefObject<HTMLDivElement | null>;
  showToast: (type: ToastType, title: string, message: string, duration?: number) => void;
  showAgentNotification: (notification: any) => void;
  toolboxModal: UseModalState;
  contextMenu: {
    open: (
      screenPos: { x: number; y: number },
      worldPos: { x: number; z: number },
      target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }
    ) => void;
  };
  setHoveredAgentPopup: (popup: { agentId: string; screenPos: { x: number; y: number } } | null) => void;
  setBuildingPopup: (popup: { buildingId: string; screenPos: { x: number; y: number }; fromClick?: boolean } | null) => void;
  getBuildingPopup: () => { buildingId: string; screenPos: { x: number; y: number }; fromClick?: boolean } | null;
  openBuildingModal: (buildingId: string) => void;
  openPM2LogsModal?: (buildingId: string) => void;
  openBossLogsModal?: (buildingId: string) => void;
  openDatabasePanel?: (buildingId: string) => void;
}

/**
 * Hook for initializing the 3D scene.
 * Handles scene creation, model loading, callback registration, and cleanup.
 * Note: WebSocket connection is handled separately by useWebSocketConnection.
 */
export function useSceneSetup({
  canvasRef,
  selectionBoxRef,
  showToast: _showToast,
  showAgentNotification: _showAgentNotification,
  toolboxModal: _toolboxModal,
  contextMenu,
  setHoveredAgentPopup: _setHoveredAgentPopup,
  setBuildingPopup,
  getBuildingPopup,
  openBuildingModal,
  openPM2LogsModal,
  openBossLogsModal,
  openDatabasePanel,
}: UseSceneSetupOptions): React.RefObject<SceneManager | null> {
  const sceneRef = useRef<SceneManager | null>(null);
  // Track pending popup timeout to cancel on double-click
  const pendingPopupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track RAF ID for cleanup
  const initRafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !selectionBoxRef.current) return;

    // Flag to track if this effect has been cleaned up
    let isCleanedUp = false;

    // Get current persisted state from window (survives StrictMode remounts)
    const currentPersistedScene = getPersistedScene();
    const currentPersistedCanvas = getPersistedCanvas();

    // Check if this is the same canvas as before (StrictMode remount)
    const isSameCanvas = currentPersistedCanvas === canvasRef.current;

    // Helper function to set up scene callbacks - defined here so it's available to both branches
    function setupSceneCallbacks() {
      // Set up toast callback for agent manager notifications
      sceneRef.current?.setOnToast(_showToast);

      // Set up building click callback
      sceneRef.current?.setOnBuildingClick((buildingId, screenPos) => {
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
        } else {
          // Open modal for other types
          openBuildingModal(buildingId);
        }
      });

      // Set up context menu callback
      sceneRef.current?.setOnContextMenu((screenPos, worldPos, target) => {
        contextMenu.open(screenPos, worldPos, target);
      });

      // Agent hover popup disabled - no longer showing popup on agent hover
      sceneRef.current?.setOnAgentHover(() => {
        // Intentionally empty - popup removed
      });

      // Set up building hover callback (5 second delay for server buildings)
      sceneRef.current?.setOnBuildingHover((buildingId, screenPos) => {
        const currentPopup = getBuildingPopup();
        if (buildingId && screenPos) {
          const building = store.getState().buildings.get(buildingId);
          // Only show hover popup for server, boss, and database buildings (and only if not already opened by click)
          if ((building?.type === 'server' || building?.type === 'boss' || building?.type === 'database') && !currentPopup?.fromClick) {
            setBuildingPopup({ buildingId, screenPos, fromClick: false });
          }
        } else {
          // Only close popup if it wasn't opened by a click
          if (!currentPopup?.fromClick) {
            setBuildingPopup(null);
          }
        }
      });

      // Set up ground click callback (close building popup when clicking on ground)
      sceneRef.current?.setOnGroundClick(() => {
        setBuildingPopup(null);
      });

      // Set up area double-click callback (open toolbox focused on area config)
      sceneRef.current?.setOnAreaDoubleClick((areaId) => {
        store.selectArea(areaId);
        _toolboxModal.open();
      });

      // Set up building double-click callback (open logs for server/boss buildings)
      sceneRef.current?.setOnBuildingDoubleClick((buildingId) => {
        // Cancel any pending popup from single click
        if (pendingPopupTimeoutRef.current) {
          clearTimeout(pendingPopupTimeoutRef.current);
          pendingPopupTimeoutRef.current = null;
        }
        // Close any existing popup
        setBuildingPopup(null);

        const building = store.getState().buildings.get(buildingId);
        if (building?.type === 'server' && building.pm2?.enabled) {
          // Open PM2 logs modal for server buildings with PM2 enabled
          openPM2LogsModal?.(buildingId);
        } else if (building?.type === 'boss') {
          // Open unified logs modal for boss buildings
          openBossLogsModal?.(buildingId);
        } else if (building?.type === 'database') {
          // Open database panel for database buildings
          openDatabasePanel?.(buildingId);
        } else if (building?.type === 'folder' && building.folderPath) {
          // Open file explorer for folder buildings
          store.openFileExplorer(building.folderPath);
        } else {
          // Open building config modal for other types
          openBuildingModal(buildingId);
        }
      });
    }

    // Reuse existing scene for StrictMode remounts, otherwise create new
    if (currentPersistedScene && isSameCanvas) {
      sceneRef.current = currentPersistedScene;
      console.log('[Tide] Reusing existing scene (StrictMode remount)');
      // IMPORTANT: Sync areas BEFORE agents so isAgentInArchivedArea works correctly
      const state = store.getState();
      currentPersistedScene.syncAreas();
      currentPersistedScene.syncBuildings();
      if (state.agents.size > 0) {
        console.log('[Tide] Re-syncing agents from store after remount:', state.agents.size);
        currentPersistedScene.syncAgents(Array.from(state.agents.values()));
      }
      // Set up callbacks for reused scene
      setupSceneCallbacks();
    } else {
      // Defer scene initialization to next frame to ensure CSS is applied
      // This is critical for production builds where CSS may load async
      const canvas = canvasRef.current;
      const selectionBox = selectionBoxRef.current;

      const initScene = () => {
        // Check if effect was cleaned up before RAF executed
        if (isCleanedUp) {
          console.log('[Tide] Effect cleaned up before scene init, skipping');
          return;
        }

        // Verify canvas still exists and is connected
        if (!canvas.isConnected || !selectionBox.isConnected) {
          console.warn('[Tide] Canvas disconnected before initialization');
          return;
        }

        // Ensure canvas has dimensions - fallback to window size if CSS not applied
        if (!canvas.clientWidth || !canvas.clientHeight) {
          console.log('[Tide] Canvas has no CSS dimensions, using window fallback');
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          // Force reflow
          void canvas.offsetHeight;
        }

        // If still no dimensions, set explicit size
        if (!canvas.clientWidth || !canvas.clientHeight) {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        }

        markWebGLActive();

        try {
          const scene = new SceneManager(canvas, selectionBox);
          sceneRef.current = scene;
          setPersistedScene(scene);
          setPersistedCanvas(canvas);

          // Expose scene manager for debugging in dev mode
          if (import.meta.env.DEV && typeof window !== 'undefined') {
            (window as any).__tideScene = scene;
            console.log('[Tide] SceneManager available at window.__tideScene');
          }

          // Apply saved config
          const savedConfig = loadConfig();
          scene.setCharacterScale(savedConfig.characterScale);
          scene.setIndicatorScale(savedConfig.indicatorScale);
          scene.setGridVisible(savedConfig.gridVisible);
          scene.setTimeMode(savedConfig.timeMode);
          scene.setTerrainConfig(savedConfig.terrain);
          scene.setFloorStyle(savedConfig.terrain.floorStyle, true);
          scene.setAgentModelStyle(savedConfig.modelStyle);
          scene.setIdleAnimation(savedConfig.animations.idleAnimation);
          scene.setWorkingAnimation(savedConfig.animations.workingAnimation);
          scene.setFpsLimit(savedConfig.fpsLimit);

          // Sync areas and buildings immediately (don't need to wait for models)
          scene.syncAreas();
          scene.syncBuildings();

          // Load character models then sync agents from store
          scene.loadCharacterModels().then(() => {
            console.log('[Tide] Character models ready');
            const state = store.getState();
            if (state.customAgentClasses.size > 0) {
              console.log('[Tide] Applying custom classes from store:', state.customAgentClasses.size);
              scene.setCustomAgentClasses(state.customAgentClasses);
            }
            if (state.agents.size > 0) {
              console.log('[Tide] Syncing agents from store:', state.agents.size);
              scene.syncAgents(Array.from(state.agents.values()));
            }
            scene.upgradeAgentModels();
          }).catch((err) => {
            console.warn('[Tide] Some models failed to load, using fallback:', err);
          });

          // Set up callbacks after scene is created
          setupSceneCallbacks();
        } catch (error) {
          console.error('[Tide] Failed to initialize 3D scene:', error);
          // Could trigger fallback to 2D mode here if needed
        }
      };

      // Use requestAnimationFrame to ensure DOM layout is complete
      // This prevents WebGL context creation failures in production builds
      initRafIdRef.current = requestAnimationFrame(initScene);
    }

    // Set up scene-specific websocket callbacks for visual effects
    // Note: Connection and basic callbacks are handled by useWebSocketConnection
    setCallbacks({
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
      onAreasSync: () => {
        // Re-sync agents after areas are loaded to filter out those in archived areas
        sceneRef.current?.syncAreas();
        const agents = Array.from(store.getState().agents.values());
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
        sceneRef.current?.upgradeAgentModels();
      },
      onBuildingUpdated: (building) => {
        sceneRef.current?.updateBuilding(building);
      },
      onSubagentStarted: (subagent) => {
        sceneRef.current?.addSubagentEffect(subagent.id, subagent.parentAgentId, subagent.name, subagent.subagentType);
      },
      onSubagentCompleted: (subagentId) => {
        // subagentId from server is toolUseId, but scene effects use the sub_xxx ID.
        // Resolve the actual subagent ID from the store.
        const sub = store.getSubagent(subagentId) || store.getSubagentByToolUseId(subagentId);
        const effectId = sub?.id || subagentId;
        sceneRef.current?.completeSubagentEffect(effectId);
        // Auto-remove effect from scene after fade-out (matches store's 30s auto-remove)
        setTimeout(() => {
          sceneRef.current?.removeSubagentEffect(effectId);
        }, 30000);
      },
    });

    // Cleanup when canvas unmounts (mode switch to 2D or page unload)
    return () => {
      // Mark as cleaned up to prevent pending RAF from running
      isCleanedUp = true;

      // Cancel any pending initialization RAF
      if (initRafIdRef.current !== null) {
        cancelAnimationFrame(initRafIdRef.current);
        initRafIdRef.current = null;
      }

      // React may re-run effects when dependencies change, but the canvas stays connected.
      // Only dispose if the canvas is actually disconnected from DOM (real unmount).
      // This prevents losing WebGL context when canvas is being reused.
      if (canvasRef.current?.isConnected) {
        return;
      }

      // Memory optimization: dispose 3D scene when switching to 2D mode
      // Set DISPOSE_3D_ON_MODE_SWITCH = false at top of file for instant mode switching
      if (DISPOSE_3D_ON_MODE_SWITCH && sceneRef.current) {
        console.log('[Tide] 3D canvas unmounted - disposing scene to free memory');
        // Clear scene-specific websocket callbacks
        clearSceneCallbacks();
        // Clear debug reference
        if (import.meta.env.DEV && typeof window !== 'undefined') {
          (window as any).__tideScene = null;
        }
        sceneRef.current.dispose();
        sceneRef.current = null;
        setPersistedScene(null);
        setPersistedCanvas(null);
      }
    };
    // Re-run when canvas becomes available (e.g., switching from 2D to 3D mode)
  }, [canvasRef.current, selectionBoxRef.current]);

  return sceneRef;
}
