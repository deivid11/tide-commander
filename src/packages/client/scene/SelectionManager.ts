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

  // Boss-subordinate connection lines - batched into single LineSegments for performance
  private bossSubordinateLines: THREE.LineSegments | null = null;
  private bossSubordinateMaterial: THREE.LineBasicMaterial | null = null;
  private cachedLineConnections: Array<{ bossId: string; subId: string }> = [];
  private maxLineSegments = 100; // Pre-allocate for up to 100 connections

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

    // Collect all connections
    for (const [, boss] of bossesToShow) {
      const bossMesh = agentMeshes.get(boss.id);
      if (!bossMesh || !boss.subordinateIds) continue;

      for (const subId of boss.subordinateIds) {
        const subMesh = agentMeshes.get(subId);
        if (!subMesh) continue;
        this.cachedLineConnections.push({ bossId: boss.id, subId });
      }
    }

    // Create or update batched LineSegments
    if (this.cachedLineConnections.length > 0) {
      if (!this.bossSubordinateLines) {
        // Create batched LineSegments with pre-allocated buffer
        const positions = new Float32Array(this.maxLineSegments * 6); // 2 points × 3 coords per segment
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, 0); // Start with nothing drawn

        this.bossSubordinateMaterial = new THREE.LineBasicMaterial({
          color: 0xffd700, // Gold color
          transparent: true,
          opacity: 0.3,
        });

        this.bossSubordinateLines = new THREE.LineSegments(geometry, this.bossSubordinateMaterial);
        this.bossSubordinateLines.frustumCulled = false; // Always render
        this.scene.add(this.bossSubordinateLines);
      }

      // Update positions in the batched buffer
      const positions = this.bossSubordinateLines.geometry.attributes.position as THREE.BufferAttribute;
      const posArray = positions.array as Float32Array;

      for (let i = 0; i < this.cachedLineConnections.length && i < this.maxLineSegments; i++) {
        const { bossId, subId } = this.cachedLineConnections[i];
        const bossMesh = agentMeshes.get(bossId);
        const subMesh = agentMeshes.get(subId);

        if (bossMesh && subMesh) {
          const baseIdx = i * 6;
          // Start point (boss)
          posArray[baseIdx] = bossMesh.group.position.x;
          posArray[baseIdx + 1] = 0.05;
          posArray[baseIdx + 2] = bossMesh.group.position.z;
          // End point (subordinate)
          posArray[baseIdx + 3] = subMesh.group.position.x;
          posArray[baseIdx + 4] = 0.05;
          posArray[baseIdx + 5] = subMesh.group.position.z;
        }
      }

      positions.needsUpdate = true;
      this.bossSubordinateLines.geometry.setDrawRange(0, this.cachedLineConnections.length * 2);
      this.bossSubordinateLines.visible = true;
    } else if (this.bossSubordinateLines) {
      this.bossSubordinateLines.visible = false;
    }

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
    if (!this.bossSubordinateLines || this.cachedLineConnections.length === 0) return;
    if (!hasActiveMovements) return;

    const agentMeshes = this.getAgentMeshes();
    const positions = this.bossSubordinateLines.geometry.attributes.position as THREE.BufferAttribute;
    const posArray = positions.array as Float32Array;

    for (let i = 0; i < this.cachedLineConnections.length && i < this.maxLineSegments; i++) {
      const { bossId, subId } = this.cachedLineConnections[i];
      const bossMesh = agentMeshes.get(bossId);
      const subMesh = agentMeshes.get(subId);

      if (!bossMesh || !subMesh) continue;

      const baseIdx = i * 6;
      // Start point (boss)
      posArray[baseIdx] = bossMesh.group.position.x;
      posArray[baseIdx + 1] = 0.05;
      posArray[baseIdx + 2] = bossMesh.group.position.z;
      // End point (subordinate)
      posArray[baseIdx + 3] = subMesh.group.position.x;
      posArray[baseIdx + 4] = 0.05;
      posArray[baseIdx + 5] = subMesh.group.position.z;
    }

    positions.needsUpdate = true;
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    if (this.bossSubordinateLines) {
      this.scene.remove(this.bossSubordinateLines);
      this.bossSubordinateLines.geometry.dispose();
      this.bossSubordinateMaterial?.dispose();
      this.bossSubordinateLines = null;
      this.bossSubordinateMaterial = null;
    }
    this.cachedLineConnections = [];
  }
}
