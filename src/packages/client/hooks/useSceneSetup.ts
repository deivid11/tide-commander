import { useEffect, useRef } from 'react';
import { store } from '../store';
import { connect, setCallbacks } from '../websocket';
import { SceneManager } from '../scene/SceneManager';
import {
  persistedScene,
  persistedCanvas,
  isPageUnloading,
  setPersistedScene,
  setPersistedCanvas,
  setWsConnected,
  markWebGLActive,
} from '../app/sceneLifecycle';
import { loadConfig } from '../app/sceneConfig';
import { requestNotificationPermission, initNotificationListeners } from '../utils/notifications';
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
}

/**
 * Hook for initializing the 3D scene and WebSocket connection.
 * Handles scene creation, model loading, callback registration, and cleanup.
 */
export function useSceneSetup({
  canvasRef,
  selectionBoxRef,
  showToast,
  showAgentNotification,
  toolboxModal,
  contextMenu,
  setHoveredAgentPopup,
}: UseSceneSetupOptions): React.RefObject<SceneManager | null> {
  const sceneRef = useRef<SceneManager | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !selectionBoxRef.current) return;

    // Check if this is the same canvas as before (StrictMode remount or HMR)
    const isSameCanvas = persistedCanvas === canvasRef.current;

    // Reuse or create scene manager (persists across HMR and StrictMode remounts)
    if (persistedScene && isSameCanvas) {
      sceneRef.current = persistedScene;
      console.log('[Tide] Reusing existing scene (StrictMode remount)');
      // Re-sync agents from store after HMR (models are already loaded)
      const state = store.getState();
      if (state.agents.size > 0) {
        console.log('[Tide] Re-syncing agents from store after remount:', state.agents.size);
        persistedScene.syncAgents(Array.from(state.agents.values()));
      }
    } else if (persistedScene && !isSameCanvas) {
      persistedScene.reattach(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = persistedScene;
      setPersistedCanvas(canvasRef.current);
      console.log('[Tide] Reattached existing scene (HMR)');
      const state = store.getState();
      if (state.customAgentClasses.size > 0) {
        persistedScene.setCustomAgentClasses(state.customAgentClasses);
      }
      // Re-sync agents from store after HMR reattach
      if (state.agents.size > 0) {
        console.log('[Tide] Re-syncing agents from store after HMR:', state.agents.size);
        persistedScene.syncAgents(Array.from(state.agents.values()));
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

    // Set up area double-click callback
    sceneRef.current?.setOnAreaDoubleClick((areaId) => {
      store.selectArea(areaId);
      toolboxModal.open();
    });

    // Set up building click callback
    sceneRef.current?.setOnBuildingClick((buildingId) => {
      store.selectBuilding(buildingId);
      const building = store.getState().buildings.get(buildingId);
      if (building?.type === 'folder' && building.folderPath) {
        store.openFileExplorer(building.folderPath);
      } else {
        toolboxModal.open();
      }
    });

    // Set up context menu callback
    sceneRef.current?.setOnContextMenu((screenPos, worldPos, target) => {
      contextMenu.open(screenPos, worldPos, target);
    });

    // Set up agent hover callback
    sceneRef.current?.setOnAgentHover((agentId, screenPos) => {
      if (agentId && screenPos) {
        setHoveredAgentPopup({ agentId, screenPos });
      } else {
        setHoveredAgentPopup(null);
      }
    });

    // Set up websocket callbacks
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
        sceneRef.current?.upgradeAgentModels();
      },
      onReconnect: () => {
        store.triggerReconnect();
      },
      onAgentNotification: (notification) => {
        showAgentNotification(notification);
      },
    });

    connect();
    setWsConnected(true);

    // Request notification permissions
    requestNotificationPermission();
    initNotificationListeners((data) => {
      if (data.agentId && typeof data.agentId === 'string') {
        store.selectAgent(data.agentId);
      }
    });

    // Handle app resume from background (Android)
    const handleAppResume = () => {
      console.log('[Tide] App resumed from background, reconnecting...');
      setTimeout(() => connect(), 100);
    };
    window.addEventListener('tideAppResume', handleAppResume);

    // Don't dispose on HMR or StrictMode unmount
    return () => {
      if (isPageUnloading) {
        sceneRef.current?.dispose();
        setPersistedScene(null);
        setPersistedCanvas(null);
        setWsConnected(false);
      }
    };
  }, [showToast, showAgentNotification]);

  return sceneRef;
}
