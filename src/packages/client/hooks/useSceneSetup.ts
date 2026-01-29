import { useEffect, useRef } from 'react';
import { store } from '../store';
import { setCallbacks } from '../websocket';
import { SceneManager } from '../scene/SceneManager';
import {
  getPersistedScene,
  getPersistedCanvas,
  getIsPageUnloading,
  setPersistedScene,
  setPersistedCanvas,
  markWebGLActive,
} from '../app/sceneLifecycle';
import { loadConfig } from '../app/sceneConfig';
import type { ToastType } from '../components/Toast';
import type { UseModalState } from './index';

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

  useEffect(() => {
    if (!canvasRef.current || !selectionBoxRef.current) return;

    // Get current persisted state from window (survives HMR)
    const currentPersistedScene = getPersistedScene();
    const currentPersistedCanvas = getPersistedCanvas();

    // Check if this is the same canvas as before (StrictMode remount or HMR)
    const isSameCanvas = currentPersistedCanvas === canvasRef.current;

    // Reuse or create scene manager (persists across HMR and StrictMode remounts)
    if (currentPersistedScene && isSameCanvas) {
      sceneRef.current = currentPersistedScene;
      console.log('[Tide] Reusing existing scene (StrictMode remount)');
      // Re-sync agents from store after HMR (models are already loaded)
      const state = store.getState();
      if (state.agents.size > 0) {
        console.log('[Tide] Re-syncing agents from store after remount:', state.agents.size);
        currentPersistedScene.syncAgents(Array.from(state.agents.values()));
      }
    } else if (currentPersistedScene && !isSameCanvas) {
      console.log('[Tide] HMR detected - canvas changed, reattaching scene', {
        canvasConnected: canvasRef.current.isConnected,
        canvasParent: !!canvasRef.current.parentElement,
        timestamp: Date.now(), // HMR test v6 - clouds added
      });
      currentPersistedScene.reattach(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = currentPersistedScene;
      setPersistedCanvas(canvasRef.current);
      console.log('[Tide] Reattached existing scene (HMR)');
      const state = store.getState();
      if (state.customAgentClasses.size > 0) {
        currentPersistedScene.setCustomAgentClasses(state.customAgentClasses);
      }
      // Re-sync agents from store after HMR reattach
      if (state.agents.size > 0) {
        console.log('[Tide] Re-syncing agents from store after HMR:', state.agents.size);
        currentPersistedScene.syncAgents(Array.from(state.agents.values()));
      }
    } else {
      markWebGLActive();

      const scene = new SceneManager(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = scene;
      setPersistedScene(scene);
      setPersistedCanvas(canvasRef.current);

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
    }

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
    });

    // Don't dispose on HMR or StrictMode unmount
    return () => {
      if (getIsPageUnloading()) {
        sceneRef.current?.dispose();
        setPersistedScene(null);
        setPersistedCanvas(null);
      }
    };
    // Re-run when canvas becomes available (e.g., switching from 2D to 3D mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef.current, selectionBoxRef.current]);

  return sceneRef;
}
