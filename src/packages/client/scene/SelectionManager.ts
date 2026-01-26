import * as THREE from 'three';
import type { Agent } from '../../shared/types';
import { store } from '../store';
import { CharacterFactory, type AgentMeshData } from './characters';
import { ProceduralAnimator, type ProceduralAnimationState } from './animation/ProceduralAnimator';

/**
 * Manages selection visuals and boss-subordinate line connections.
 * Extracted from SceneManager for separation of concerns.
 */
export class SelectionManager {
  private scene: THREE.Scene;
  private characterFactory: CharacterFactory;
  private proceduralAnimator: ProceduralAnimator;

  // Boss-subordinate connection lines
  private linePool: THREE.Line[] = [];
  private bossSubordinateLines: THREE.Line[] = [];
  private cachedLineConnections: Array<{ bossId: string; subId: string }> = [];

  // Configuration
  private characterScale = 0.5;

  // Callbacks
  private onProceduralCacheInvalidated: (() => void) | null = null;
  private getAgentMeshes: () => Map<string, AgentMeshData>;
  private updateStatusAnimation: (agent: Agent, meshData: AgentMeshData) => void;
  private getProceduralStateForStatus: (status: string) => ProceduralAnimationState;

  constructor(
    scene: THREE.Scene,
    characterFactory: CharacterFactory,
    proceduralAnimator: ProceduralAnimator,
    getAgentMeshes: () => Map<string, AgentMeshData>,
    updateStatusAnimation: (agent: Agent, meshData: AgentMeshData) => void,
    getProceduralStateForStatus: (status: string) => ProceduralAnimationState
  ) {
    this.scene = scene;
    this.characterFactory = characterFactory;
    this.proceduralAnimator = proceduralAnimator;
    this.getAgentMeshes = getAgentMeshes;
    this.updateStatusAnimation = updateStatusAnimation;
    this.getProceduralStateForStatus = getProceduralStateForStatus;
  }

  // ============================================
  // Configuration
  // ============================================

  setCharacterScale(scale: number): void {
    this.characterScale = scale;
  }

  setOnProceduralCacheInvalidated(callback: () => void): void {
    this.onProceduralCacheInvalidated = callback;
  }

  // ============================================
  // Selection Visuals
  // ============================================

  refreshSelectionVisuals(): void {
    const state = store.getState();
    const agentMeshes = this.getAgentMeshes();

    // Collect all bosses whose hierarchy should be shown
    const bossesToShow = new Map<string, Agent>();
    const subordinateIdsOfSelectedBosses = new Set<string>();

    for (const selectedId of state.selectedAgentIds) {
      const selectedAgent = state.agents.get(selectedId);
      if (!selectedAgent) continue;

      // If selected agent is a boss, show their hierarchy
      if ((selectedAgent.isBoss || selectedAgent.class === 'boss') && selectedAgent.subordinateIds) {
        bossesToShow.set(selectedAgent.id, selectedAgent);
        for (const subId of selectedAgent.subordinateIds) {
          subordinateIdsOfSelectedBosses.add(subId);
        }
      }

      // If selected agent has a boss, show that boss's entire hierarchy
      if (selectedAgent.bossId) {
        const boss = state.agents.get(selectedAgent.bossId);
        if (boss && (boss.isBoss || boss.class === 'boss') && boss.subordinateIds) {
          bossesToShow.set(boss.id, boss);
          for (const subId of boss.subordinateIds) {
            subordinateIdsOfSelectedBosses.add(subId);
          }
        }
      }
    }

    // Clear and rebuild cached line connections
    this.cachedLineConnections = [];

    // Reuse existing lines from pool or create new ones as needed
    let lineIndex = 0;
    for (const [, boss] of bossesToShow) {
      const bossMesh = agentMeshes.get(boss.id);
      if (!bossMesh || !boss.subordinateIds) continue;

      for (const subId of boss.subordinateIds) {
        const subMesh = agentMeshes.get(subId);
        if (!subMesh) continue;

        // Cache the connection for efficient frame updates
        this.cachedLineConnections.push({ bossId: boss.id, subId });

        let line: THREE.Line;
        if (lineIndex < this.linePool.length) {
          // Reuse existing line from pool
          line = this.linePool[lineIndex];
          line.visible = true;
        } else {
          // Create new line and add to pool
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
          const material = new THREE.LineBasicMaterial({
            color: 0xffd700, // Gold color to match subordinate highlight
            transparent: true,
            opacity: 0.3,
          });
          line = new THREE.Line(geometry, material);
          this.scene.add(line);
          this.linePool.push(line);
        }

        // Update line positions
        const positions = line.geometry.attributes.position as THREE.BufferAttribute;
        positions.setXYZ(0, bossMesh.group.position.x, 0.05, bossMesh.group.position.z);
        positions.setXYZ(1, subMesh.group.position.x, 0.05, subMesh.group.position.z);
        positions.needsUpdate = true;

        lineIndex++;
      }
    }

    // Hide unused lines (don't dispose, keep in pool for reuse)
    for (let i = lineIndex; i < this.linePool.length; i++) {
      this.linePool[i].visible = false;
    }

    // Update bossSubordinateLines to reference active lines
    this.bossSubordinateLines = this.linePool.slice(0, lineIndex);

    // Also track boss IDs that should be highlighted
    const bossIdsToHighlight = new Set(bossesToShow.keys());

    for (const [agentId, meshData] of agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent) {
        // Check if class changed and update model if needed
        const updatedMeshData = this.characterFactory.updateAgentClass(meshData, agent);
        if (updatedMeshData) {
          // Model was replaced, update the stored meshData
          agentMeshes.set(agentId, updatedMeshData);

          // Apply character scale
          const newBody = updatedMeshData.group.getObjectByName('characterBody');
          if (newBody) {
            const customModelScale = newBody.userData.customModelScale ?? 1.0;
            const bossMultiplier = (agent.isBoss || agent.class === 'boss') ? 1.5 : 1.0;
            newBody.scale.setScalar(customModelScale * this.characterScale * bossMultiplier);

            // Update procedural animator registration based on new model
            this.proceduralAnimator.unregister(agentId);
            if (updatedMeshData.animations.size === 0) {
              const proceduralState = this.getProceduralStateForStatus(agent.status);
              this.proceduralAnimator.register(agentId, newBody, proceduralState);
            }
            this.onProceduralCacheInvalidated?.();
          }

          // Start animation based on agent's current status
          this.updateStatusAnimation(agent, updatedMeshData);

          // Use the new meshData for visual updates
          const isSelected = state.selectedAgentIds.has(agentId);
          const isPartOfSelectedHierarchy = subordinateIdsOfSelectedBosses.has(agentId) || bossIdsToHighlight.has(agentId);
          this.characterFactory.updateVisuals(updatedMeshData.group, agent, isSelected, isPartOfSelectedHierarchy && !isSelected);
        } else {
          const isSelected = state.selectedAgentIds.has(agentId);
          const isPartOfSelectedHierarchy = subordinateIdsOfSelectedBosses.has(agentId) || bossIdsToHighlight.has(agentId);
          this.characterFactory.updateVisuals(meshData.group, agent, isSelected, isPartOfSelectedHierarchy && !isSelected);
        }
      }
    }
  }

  // ============================================
  // Boss-Subordinate Lines
  // ============================================

  updateBossSubordinateLines(hasActiveMovements: boolean): void {
    if (this.bossSubordinateLines.length === 0) return;
    if (!hasActiveMovements) return;

    const agentMeshes = this.getAgentMeshes();

    for (let i = 0; i < this.cachedLineConnections.length && i < this.bossSubordinateLines.length; i++) {
      const { bossId, subId } = this.cachedLineConnections[i];
      const bossMesh = agentMeshes.get(bossId);
      const subMesh = agentMeshes.get(subId);

      if (!bossMesh || !subMesh) continue;

      const line = this.bossSubordinateLines[i];
      const positions = line.geometry.attributes.position as THREE.BufferAttribute;

      positions.setXYZ(0, bossMesh.group.position.x, 0.05, bossMesh.group.position.z);
      positions.setXYZ(1, subMesh.group.position.x, 0.05, subMesh.group.position.z);
      positions.needsUpdate = true;
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    for (const line of this.linePool) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.linePool = [];
    this.bossSubordinateLines = [];
    this.cachedLineConnections = [];
  }
}
