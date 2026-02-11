/**
 * useScene2DSetup - Hook for initializing and managing the 2D scene
 *
 * Similar to useSceneSetup but for the lightweight 2D view.
 */

import { useEffect, useRef, useCallback } from 'react';
import { Scene2D } from '../scene2d';
import { store } from '../store';
import type { Agent } from '../../shared/types';

interface UseScene2DSetupOptions {
  onAgentClick?: (agentId: string, shiftKey: boolean) => void;
  onAgentDoubleClick?: (agentId: string) => void;
  onAgentHover?: (agentId: string | null, screenPos: { x: number; y: number } | null) => void;
  onBuildingClick?: (buildingId: string, screenPos: { x: number; y: number }) => void;
  onBuildingDoubleClick?: (buildingId: string) => void;
  onBuildingDragStart?: (buildingId: string, startPos: { x: number; z: number }) => void;
  onBuildingDragMove?: (buildingId: string, currentPos: { x: number; z: number }) => void;
  onBuildingDragEnd?: (buildingId: string, endPos: { x: number; z: number }) => void;
  onBuildingDragCancel?: (buildingId: string) => void;
  onContextMenu?: (screenPos: { x: number; y: number }, worldPos: { x: number; z: number }, target: { type: string; id?: string } | null) => void;
  onGroundClick?: (worldPos: { x: number; z: number }) => void;
  onMoveCommand?: (agentIds: string[], targetPos: { x: number; z: number }) => void;
  onAreaDoubleClick?: (areaId: string) => void;
}

export function useScene2DSetup(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: UseScene2DSetupOptions = {}
) {
  const sceneRef = useRef<Scene2D | null>(null);

  // Store callbacks in refs to avoid re-creating scene on every render
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Initialize scene - only depends on canvasRef, not options
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create scene
    const scene = new Scene2D(canvas);
    sceneRef.current = scene;

    // Store global reference for debugging
    if (typeof window !== 'undefined') {
      (window as any).__tideScene2D = scene;
    }

    // Set callbacks - use refs to get latest callbacks
    scene.setCallbacks({
      onAgentClick: (agentId, shiftKey) => callbacksRef.current.onAgentClick?.(agentId, shiftKey),
      onAgentDoubleClick: (agentId) => callbacksRef.current.onAgentDoubleClick?.(agentId),
      onAgentHover: (agentId, screenPos) => callbacksRef.current.onAgentHover?.(agentId, screenPos),
      onBuildingClick: (buildingId, screenPos) => callbacksRef.current.onBuildingClick?.(buildingId, screenPos),
      onBuildingDoubleClick: (buildingId) => callbacksRef.current.onBuildingDoubleClick?.(buildingId),
      onBuildingDragStart: (buildingId, startPos) => callbacksRef.current.onBuildingDragStart?.(buildingId, startPos),
      onBuildingDragMove: (buildingId, currentPos) => callbacksRef.current.onBuildingDragMove?.(buildingId, currentPos),
      onBuildingDragEnd: (buildingId, endPos) => callbacksRef.current.onBuildingDragEnd?.(buildingId, endPos),
      onBuildingDragCancel: (buildingId) => callbacksRef.current.onBuildingDragCancel?.(buildingId),
      onContextMenu: (screenPos, worldPos, target) => callbacksRef.current.onContextMenu?.(screenPos, worldPos, target),
      onGroundClick: (worldPos) => callbacksRef.current.onGroundClick?.(worldPos),
      onMoveCommand: (agentIds, targetPos) => callbacksRef.current.onMoveCommand?.(agentIds, targetPos),
      onAreaDoubleClick: (areaId) => callbacksRef.current.onAreaDoubleClick?.(areaId),
      onSelectionBox: (start, end) => {
        // Find agents within selection box
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minZ = Math.min(start.z, end.z);
        const maxZ = Math.max(start.z, end.z);

        const selectedIds: string[] = [];
        for (const agent of scene.getAgents().values()) {
          if (
            agent.position.x >= minX &&
            agent.position.x <= maxX &&
            agent.position.z >= minZ &&
            agent.position.z <= maxZ
          ) {
            selectedIds.push(agent.id);
          }
        }

        // Select first agent, then add others
        if (selectedIds.length > 0) {
          store.selectAgent(selectedIds[0]);
          for (let i = 1; i < selectedIds.length; i++) {
            store.addToSelection(selectedIds[i]);
          }
        } else {
          store.selectAgent(null);
        }
      },
    });

    // Sync initial state from store
    // IMPORTANT: Sync areas BEFORE agents so isAgentInArchivedArea works correctly
    const state = store.getState();
    scene.syncAreas();
    scene.syncBuildings();
    scene.syncAgents(Array.from(state.agents.values()));
    scene.setSelectedAgents(state.selectedAgentIds);
    scene.setSelectedBuildings(state.selectedBuildingIds);

    // Start rendering
    scene.start();

    // Track previous agent positions for animation
    let prevAgentPositions = new Map<string, { x: number; z: number }>();
    for (const agent of state.agents.values()) {
      prevAgentPositions.set(agent.id, { x: agent.position.x, z: agent.position.z });
    }

    // Track if we've done initial sync (agents may not be loaded yet on page refresh)
    let hasInitialAgents = state.agents.size > 0;

    // Subscribe to store updates
    const unsubscribe = store.subscribe(() => {
      const newState = store.getState();

      // On first agent sync (e.g., after WebSocket connects), do a full sync
      if (!hasInitialAgents && newState.agents.size > 0) {
        hasInitialAgents = true;
        // IMPORTANT: Sync areas BEFORE agents so isAgentInArchivedArea works correctly
        scene.syncAreas();
        scene.syncAgents(Array.from(newState.agents.values()));
        // Initialize position tracking
        for (const agent of newState.agents.values()) {
          prevAgentPositions.set(agent.id, { x: agent.position.x, z: agent.position.z });
        }
      } else {
        // Check for position changes and animate them
        for (const agent of newState.agents.values()) {
          // Skip agents in archived areas
          if (store.isAgentInArchivedArea(agent.id)) {
            // Remove from scene if it was previously visible
            if (prevAgentPositions.has(agent.id)) {
              scene.removeAgent(agent.id);
              prevAgentPositions.delete(agent.id);
            }
            continue;
          }

          const prevPos = prevAgentPositions.get(agent.id);
          const posChanged = !prevPos ||
            prevPos.x !== agent.position.x ||
            prevPos.z !== agent.position.z;

          if (posChanged) {
            // Animate position change
            scene.updateAgent(agent, true);
            // Update tracking immediately after starting animation
            prevAgentPositions.set(agent.id, { x: agent.position.x, z: agent.position.z });
          } else {
            // Just update other properties without animation
            // But skip if agent has an active movement to avoid interfering
            const hasActiveMovement = scene.hasActiveMovement?.(agent.id);
            if (!hasActiveMovement) {
              scene.updateAgent(agent, false);
            }
          }
        }

        // Remove agents that no longer exist or are in archived areas
        for (const id of prevAgentPositions.keys()) {
          if (!newState.agents.has(id) || store.isAgentInArchivedArea(id)) {
            scene.removeAgent(id);
            prevAgentPositions.delete(id);
          }
        }
      }

      scene.syncBuildings();
      scene.syncAreas();
      scene.setSelectedAgents(newState.selectedAgentIds);
      scene.setSelectedBuildings(newState.selectedBuildingIds);
    });

    return () => {
      unsubscribe();
      scene.dispose();
      sceneRef.current = null;
      // Clean up global reference
      if (typeof window !== 'undefined') {
        delete (window as any).__tideScene2D;
      }
    };
  }, [canvasRef]); // Only re-create scene when canvas changes, not on every render

  // Methods to expose
  const focusAgent = useCallback((agentId: string) => {
    sceneRef.current?.focusAgent(agentId);
  }, []);

  const updateAgent = useCallback((agent: Agent, animate = true) => {
    sceneRef.current?.updateAgent(agent, animate);
  }, []);

  const createMoveOrderEffect = useCallback((pos: { x: number; z: number }) => {
    sceneRef.current?.createMoveOrderEffect(pos);
  }, []);

  const showToolBubble = useCallback((agentId: string, toolName: string) => {
    sceneRef.current?.showToolBubble(agentId, toolName);
  }, []);

  const setIndicatorScale = useCallback((scale: number) => {
    sceneRef.current?.setIndicatorScale(scale);
  }, []);

  const setGridVisible = useCallback((visible: boolean) => {
    sceneRef.current?.setGridVisible(visible);
  }, []);

  const setDrawingTool = useCallback((tool: 'rectangle' | 'circle' | 'select' | null) => {
    sceneRef.current?.setDrawingTool(tool);
  }, []);

  const setFpsLimit = useCallback((limit: number) => {
    sceneRef.current?.setFpsLimit(limit);
  }, []);

  return {
    scene: sceneRef,
    focusAgent,
    updateAgent,
    createMoveOrderEffect,
    showToolBubble,
    setIndicatorScale,
    setGridVisible,
    setDrawingTool,
    setFpsLimit,
  };
}
