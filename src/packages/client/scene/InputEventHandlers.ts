import * as THREE from 'three';
import { store } from '../store';
import type { AgentMeshData } from './characters';
import type { MovementAnimator } from './animation';
import type { EffectsManager } from './animation';
import type { DrawingManager } from './drawing';
import type { BuildingManager } from './buildings';
import type { CallbackManager } from './CallbackManager';
import type { RenderLoop } from './RenderLoop';
import type { InputHandler } from './input';

export interface InputEventDependencies {
  getAgentMeshes: () => Map<string, AgentMeshData>;
  movementAnimator: MovementAnimator;
  effectsManager: EffectsManager;
  drawingManager: DrawingManager;
  buildingManager: BuildingManager;
  callbackManager: CallbackManager;
  renderLoop: RenderLoop;
  inputHandler: InputHandler;
  refreshSelectionVisuals: () => void;
}

/**
 * Handles input events from the InputHandler and orchestrates actions.
 * Extracted from SceneManager for separation of concerns.
 */
export class InputEventHandlers {
  private deps: InputEventDependencies;

  constructor(deps: InputEventDependencies) {
    this.deps = deps;
  }

  handleAgentClick(agentId: string, shiftKey: boolean): void {
    if (shiftKey) {
      store.addToSelection(agentId);
    } else {
      store.selectAgent(agentId);
    }
    this.deps.refreshSelectionVisuals();
  }

  handleGroundClick(): void {
    store.selectAgent(null);
    store.selectBuilding(null);
    this.deps.buildingManager.highlightBuilding(null);
    this.deps.refreshSelectionVisuals();
    this.deps.callbackManager.triggerGroundClick();
  }

  handleMoveCommand(position: THREE.Vector3, agentIds: string[]): void {
    this.deps.renderLoop.markActivity();
    this.deps.effectsManager.createMoveOrderEffect(position.clone());

    const positions = this.deps.inputHandler.calculateFormationPositions(position, agentIds.length);

    agentIds.forEach((agentId, index) => {
      const pos = positions[index];
      const meshData = this.deps.getAgentMeshes().get(agentId);
      store.moveAgent(agentId, pos);
      if (meshData) {
        this.deps.movementAnimator.startMovement(agentId, meshData, pos);
      }
    });
  }

  handleSelectionBox(agentIds: string[], buildingIds: string[]): void {
    if (agentIds.length > 0) {
      store.selectMultiple(agentIds);
    } else {
      store.selectAgent(null);
    }

    if (buildingIds.length > 0) {
      store.selectMultipleBuildings(buildingIds);
      this.deps.buildingManager.highlightBuildings(buildingIds);
    } else {
      store.selectBuilding(null);
      this.deps.buildingManager.highlightBuilding(null);
    }

    this.deps.refreshSelectionVisuals();
  }

  handleAgentDoubleClick(agentId: string): void {
    if (window.innerWidth <= 768) {
      store.openTerminalOnMobile(agentId);
      this.deps.refreshSelectionVisuals();
      return;
    }
    store.selectAgent(agentId);
    this.deps.refreshSelectionVisuals();
    store.setTerminalOpen(true);
  }

  handleAreaRightClick(pos: { x: number; z: number }): void {
    const area = this.deps.drawingManager.getAreaAtPosition(pos);
    if (area) {
      const state = store.getState();
      for (const agentId of state.selectedAgentIds) {
        store.assignAgentToArea(agentId, area.id);
        const agent = state.agents.get(agentId);
        if (agent) {
          const meshData = this.deps.getAgentMeshes().get(agentId);
          const targetPos = { x: area.center.x, y: 0, z: area.center.z };
          store.moveAgent(agentId, targetPos);
          if (meshData) {
            this.deps.movementAnimator.startMovement(agentId, meshData, targetPos);
          }
        }
      }
    }
  }

  handleGroundClickOutsideArea(): void {
    store.selectArea(null);
    this.deps.drawingManager.highlightArea(null);
  }

  handleAreaClick(areaId: string): void {
    store.selectArea(areaId);
  }

  handleAreaDoubleClick(areaId: string): void {
    store.selectArea(areaId);
    this.deps.callbackManager.triggerAreaDoubleClick(areaId);
  }

  handleBuildingClick(buildingId: string, screenPos: { x: number; y: number } = { x: 0, y: 0 }): void {
    store.selectBuilding(buildingId);
    this.deps.buildingManager.highlightBuilding(buildingId);
    this.deps.callbackManager.triggerBuildingClick(buildingId, screenPos);
  }

  handleBuildingDoubleClick(buildingId: string): void {
    store.selectBuilding(buildingId);
    this.deps.buildingManager.highlightBuilding(buildingId);
    this.deps.callbackManager.triggerBuildingDoubleClick(buildingId);
  }

  handleAgentHover(
    agentId: string | null,
    screenPos: { x: number; y: number } | null
  ): void {
    this.deps.callbackManager.triggerAgentHover(agentId, screenPos);
  }

  handleBuildingHover(
    buildingId: string | null,
    screenPos: { x: number; y: number } | null
  ): void {
    this.deps.callbackManager.triggerBuildingHover(buildingId, screenPos);
  }
}
