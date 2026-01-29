/**
 * Building Manager
 *
 * Manages buildings on the battlefield - rendering, selection, and animations.
 */

import * as THREE from 'three';
import type { Building, BuildingStyle } from '../../../shared/types';
import { store } from '../../store';

// Import from decomposed modules
import type { BuildingMeshData } from './types';
import { STATUS_COLORS } from './types';
import { updateLabel } from './labelUtils';
import {
  createBuildingMesh,
  updateIdleAnimations,
  updateRunningAnimations,
  updateTransitionAnimations,
  updateErrorAnimations,
} from './styles';

// Re-export types for backwards compatibility
export type { BuildingMeshData } from './types';

/**
 * Manages buildings on the battlefield.
 */
export class BuildingManager {
  private scene: THREE.Scene;
  private buildingMeshes = new Map<string, BuildingMeshData>();
  private selectedBuildingIds = new Set<string>();

  // Animation state
  private animationTime = 0;

  // Brightness multiplier for building materials (affects emissive/glow intensity)
  private brightness = 1;

  // Boss-subordinate connection lines - batched into single LineSegments for performance
  private bossSubordinateLines: THREE.LineSegments | null = null;
  private bossSubordinateMaterial: THREE.LineBasicMaterial | null = null;
  private cachedBossConnections: Array<{ bossId: string; subId: string }> = [];
  private maxLineSegments = 50; // Pre-allocate for up to 50 connections

  // Callbacks
  private onBuildingClick: ((buildingId: string) => void) | null = null;
  private onBuildingDoubleClick: ((buildingId: string) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set click callback
   */
  setOnBuildingClick(callback: (buildingId: string) => void): void {
    this.onBuildingClick = callback;
  }

  /**
   * Set double-click callback
   */
  setOnBuildingDoubleClick(callback: (buildingId: string) => void): void {
    this.onBuildingDoubleClick = callback;
  }

  /**
   * Set brightness multiplier for building materials.
   * Affects emissive intensity and glow opacity.
   */
  setBrightness(brightness: number): void {
    this.brightness = brightness;
    // Update existing building materials
    for (const meshData of this.buildingMeshes.values()) {
      // Update status glow opacity
      const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
      if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
        // Base glow opacity is 0.3, apply brightness
        statusGlow.material.opacity = 0.3 * brightness;
      }

      // Update emissive intensity on standard materials
      meshData.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          // Boost or reduce emissive intensity based on brightness
          const mat = child.material;
          if (mat.emissiveIntensity !== undefined) {
            // Store base emissive intensity if not already stored
            if (mat.userData.baseEmissiveIntensity === undefined) {
              mat.userData.baseEmissiveIntensity = mat.emissiveIntensity || 1;
            }
            mat.emissiveIntensity = mat.userData.baseEmissiveIntensity * brightness;
          }
        }
      });
    }
  }

  /**
   * Add a building to the scene.
   */
  addBuilding(building: Building): void {
    // Remove existing if present
    this.removeBuilding(building.id);

    // Create mesh based on building style
    const meshData = createBuildingMesh(building);

    // Store style and color in userData for change detection
    meshData.group.userData.style = building.style;
    meshData.group.userData.color = building.color || '';

    // Apply scale from building config
    const scale = building.scale || 1.0;
    meshData.group.scale.setScalar(scale);

    this.scene.add(meshData.group);
    this.buildingMeshes.set(building.id, meshData);
  }

  /**
   * Remove a building from the scene.
   */
  removeBuilding(buildingId: string): void {
    const meshData = this.buildingMeshes.get(buildingId);
    if (meshData) {
      this.scene.remove(meshData.group);
      this.disposeGroup(meshData.group);
      this.buildingMeshes.delete(buildingId);
    }
  }

  /**
   * Update building position directly (for dragging).
   * Does not update the store, just the visual.
   */
  setBuildingPosition(buildingId: string, pos: { x: number; z: number }): void {
    const meshData = this.buildingMeshes.get(buildingId);
    if (meshData) {
      meshData.group.position.set(pos.x, 0, pos.z);
      // Update boss-subordinate connection lines during drag
      this.updateBossLinePositions();
    }
  }

  /**
   * Update a building's visuals.
   */
  updateBuilding(building: Building): void {
    const meshData = this.buildingMeshes.get(building.id);
    if (!meshData) {
      this.addBuilding(building);
      return;
    }

    // Check if we need to rebuild the entire mesh (style or color changed)
    const currentStyle = meshData.group.userData.style;
    const currentColor = meshData.group.userData.color;
    if (currentStyle !== building.style || currentColor !== (building.color || '')) {
      // Remove and recreate with new style/color
      this.removeBuilding(building.id);
      this.addBuilding(building);
      return;
    }

    // Update position
    meshData.group.position.set(building.position.x, 0, building.position.z);

    // Update scale
    const scale = building.scale || 1.0;
    meshData.group.scale.setScalar(scale);

    // Update status light color
    const statusColor = STATUS_COLORS[building.status];
    const statusLight = meshData.group.getObjectByName('statusLight') as THREE.Mesh;
    if (statusLight && statusLight.material instanceof THREE.MeshBasicMaterial) {
      statusLight.material.color.setHex(statusColor);
    }

    const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
    if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
      statusGlow.material.color.setHex(statusColor);
    }

    // Update label if name changed (ports are shown in popup only)
    const currentLabel = meshData.label;
    const canvas = (currentLabel.material as THREE.SpriteMaterial).map?.image as HTMLCanvasElement;
    if (canvas) {
      updateLabel(meshData, building.name);
    }
  }

  /**
   * Highlight a building (when selected).
   */
  highlightBuilding(buildingId: string | null): void {
    // Remove highlight from all previously selected buildings
    for (const prevId of this.selectedBuildingIds) {
      const prevMeshData = this.buildingMeshes.get(prevId);
      if (prevMeshData) {
        const body = prevMeshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x000000);
        }
      }
    }

    this.selectedBuildingIds.clear();

    // Add highlight to new selection
    if (buildingId) {
      this.selectedBuildingIds.add(buildingId);
      const meshData = this.buildingMeshes.get(buildingId);
      if (meshData) {
        const body = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x222244);
        }
      }
    }

    // Update boss-subordinate connection lines
    this.updateBossConnectionLines();
  }

  /**
   * Highlight multiple buildings (for drag selection).
   */
  highlightBuildings(buildingIds: string[]): void {
    // Remove highlight from all previously selected buildings
    for (const prevId of this.selectedBuildingIds) {
      const prevMeshData = this.buildingMeshes.get(prevId);
      if (prevMeshData) {
        const body = prevMeshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x000000);
        }
      }
    }

    this.selectedBuildingIds.clear();

    // Add highlight to all new selections
    for (const buildingId of buildingIds) {
      this.selectedBuildingIds.add(buildingId);
      const meshData = this.buildingMeshes.get(buildingId);
      if (meshData) {
        const body = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x222244);
        }
      }
    }

    // Update boss-subordinate connection lines
    this.updateBossConnectionLines();
  }

  /**
   * Get building mesh data for screen position calculation.
   */
  getBuildingMeshData(): Map<string, BuildingMeshData> {
    return this.buildingMeshes;
  }

  /**
   * Get hitbox dimensions for a building style.
   * These are generous hitboxes to make clicking easier.
   */
  private getHitboxForStyle(style: BuildingStyle): { halfWidth: number; halfDepth: number } {
    // Increased all hitboxes for easier clicking
    switch (style) {
      case 'desktop':
        return { halfWidth: 2.0, halfDepth: 2.0 }; // Large desktop
      case 'filing-cabinet':
        return { halfWidth: 1.8, halfDepth: 1.2 }; // Filing cabinet
      case 'factory':
        return { halfWidth: 1.5, halfDepth: 1.2 }; // Factory building
      case 'satellite':
        return { halfWidth: 1.2, halfDepth: 1.2 }; // Satellite dish
      case 'crystal':
        return { halfWidth: 1.5, halfDepth: 1.5 }; // Crystal (tall, needs wide hitbox)
      case 'tower':
        return { halfWidth: 1.2, halfDepth: 1.0 }; // Tower
      case 'dome':
        return { halfWidth: 1.5, halfDepth: 1.5 }; // Dome shape
      case 'pyramid':
        return { halfWidth: 1.5, halfDepth: 1.5 }; // Pyramid shape
      case 'command-center':
        return { halfWidth: 2.2, halfDepth: 2.2 }; // Command center (large)
      case 'server-rack':
      default:
        return { halfWidth: 1.2, halfDepth: 1.0 }; // Server rack
    }
  }

  /**
   * Get building at a world position (for click detection).
   */
  getBuildingAtPosition(pos: { x: number; z: number }): Building | null {
    const state = store.getState();

    for (const building of state.buildings.values()) {
      const baseHitbox = this.getHitboxForStyle(building.style);
      const scale = building.scale || 1.0;

      // Scale the hitbox with the building
      const hitbox = {
        halfWidth: baseHitbox.halfWidth * scale,
        halfDepth: baseHitbox.halfDepth * scale,
      };

      const dx = Math.abs(pos.x - building.position.x);
      const dz = Math.abs(pos.z - building.position.z);

      if (dx <= hitbox.halfWidth && dz <= hitbox.halfDepth) {
        return building;
      }
    }

    return null;
  }

  /**
   * Get all building meshes for raycasting.
   */
  getBuildingMeshes(): THREE.Group[] {
    return Array.from(this.buildingMeshes.values()).map(m => m.group);
  }

  /**
   * Sync buildings from store.
   */
  syncFromStore(): void {
    const state = store.getState();

    // Remove meshes for deleted buildings
    for (const buildingId of this.buildingMeshes.keys()) {
      if (!state.buildings.has(buildingId)) {
        this.removeBuilding(buildingId);
      }
    }

    // Add/update meshes for existing buildings
    for (const building of state.buildings.values()) {
      if (this.buildingMeshes.has(building.id)) {
        this.updateBuilding(building);
      } else {
        this.addBuilding(building);
      }
    }
  }

  /**
   * Update animations (call in render loop).
   */
  update(deltaTime: number): void {
    this.animationTime += deltaTime;

    const state = store.getState();

    for (const [buildingId, meshData] of this.buildingMeshes) {
      const building = state.buildings.get(buildingId);
      if (!building) continue;

      // Always run idle animations
      updateIdleAnimations(meshData, building, this.animationTime, deltaTime);

      // Status-specific animations
      if (building.status === 'running') {
        updateRunningAnimations(meshData, building, this.animationTime, deltaTime);
      } else if (building.status === 'starting' || building.status === 'stopping') {
        updateTransitionAnimations(meshData, this.animationTime);
      } else if (building.status === 'error') {
        updateErrorAnimations(meshData, this.animationTime);
      }
    }
  }

  // ============================================
  // Boss-Subordinate Connection Lines
  // ============================================

  /**
   * Update boss-subordinate connection lines.
   * Shows lines from selected boss buildings to their subordinates.
   * Uses batched LineSegments for performance (single draw call).
   */
  updateBossConnectionLines(): void {
    const state = store.getState();

    // Find all selected boss buildings
    const bossBuildings: Building[] = [];
    const subordinateIdsOfSelectedBosses = new Set<string>();

    for (const buildingId of this.selectedBuildingIds) {
      const building = state.buildings.get(buildingId);
      if (building && building.type === 'boss' && building.subordinateBuildingIds) {
        bossBuildings.push(building);
        for (const subId of building.subordinateBuildingIds) {
          subordinateIdsOfSelectedBosses.add(subId);
        }
      }

      // Also check if selected building has a boss - show boss's hierarchy
      if (building) {
        for (const [, potentialBoss] of state.buildings) {
          if (
            potentialBoss.type === 'boss' &&
            potentialBoss.subordinateBuildingIds?.includes(building.id) &&
            !bossBuildings.find(b => b.id === potentialBoss.id)
          ) {
            bossBuildings.push(potentialBoss);
            for (const subId of potentialBoss.subordinateBuildingIds || []) {
              subordinateIdsOfSelectedBosses.add(subId);
            }
          }
        }
      }
    }

    // Clear and rebuild cached connections
    this.cachedBossConnections = [];

    // Collect all connections
    for (const boss of bossBuildings) {
      const bossMesh = this.buildingMeshes.get(boss.id);
      if (!bossMesh || !boss.subordinateBuildingIds) continue;

      for (const subId of boss.subordinateBuildingIds) {
        const subMesh = this.buildingMeshes.get(subId);
        if (!subMesh) continue;
        this.cachedBossConnections.push({ bossId: boss.id, subId });
      }
    }

    // Create or update batched LineSegments
    if (this.cachedBossConnections.length > 0) {
      if (!this.bossSubordinateLines) {
        // Create batched LineSegments with pre-allocated buffer
        const positions = new Float32Array(this.maxLineSegments * 6); // 2 points × 3 coords per segment
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, 0); // Start with nothing drawn

        this.bossSubordinateMaterial = new THREE.LineBasicMaterial({
          color: 0xffd700, // Gold color for boss connections
          transparent: true,
          opacity: 0.4,
        });

        this.bossSubordinateLines = new THREE.LineSegments(geometry, this.bossSubordinateMaterial);
        this.bossSubordinateLines.frustumCulled = false; // Always render
        this.scene.add(this.bossSubordinateLines);
      }

      // Update positions in the batched buffer
      const positions = this.bossSubordinateLines.geometry.attributes.position as THREE.BufferAttribute;
      const posArray = positions.array as Float32Array;

      for (let i = 0; i < this.cachedBossConnections.length && i < this.maxLineSegments; i++) {
        const { bossId, subId } = this.cachedBossConnections[i];
        const bossMesh = this.buildingMeshes.get(bossId);
        const subMesh = this.buildingMeshes.get(subId);

        if (bossMesh && subMesh) {
          const baseIdx = i * 6;
          // Start point (boss)
          posArray[baseIdx] = bossMesh.group.position.x;
          posArray[baseIdx + 1] = 0.1;
          posArray[baseIdx + 2] = bossMesh.group.position.z;
          // End point (subordinate)
          posArray[baseIdx + 3] = subMesh.group.position.x;
          posArray[baseIdx + 4] = 0.1;
          posArray[baseIdx + 5] = subMesh.group.position.z;
        }
      }

      positions.needsUpdate = true;
      this.bossSubordinateLines.geometry.setDrawRange(0, this.cachedBossConnections.length * 2);
      this.bossSubordinateLines.visible = true;
    } else if (this.bossSubordinateLines) {
      this.bossSubordinateLines.visible = false;
    }

    // Highlight subordinate buildings
    for (const [buildingId, meshData] of this.buildingMeshes) {
      const building = state.buildings.get(buildingId);
      if (!building) continue;

      const isSubordinate = subordinateIdsOfSelectedBosses.has(buildingId);
      const body = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
      if (body && body.material instanceof THREE.MeshStandardMaterial) {
        if (isSubordinate && !this.selectedBuildingIds.has(buildingId)) {
          // Highlight subordinate with gold tint
          body.material.emissive.setHex(0x332200);
        } else if (!this.selectedBuildingIds.has(buildingId)) {
          // Remove highlight if not selected
          body.material.emissive.setHex(0x000000);
        }
      }
    }
  }

  /**
   * Update line positions during building movement.
   */
  updateBossLinePositions(): void {
    if (!this.bossSubordinateLines || this.cachedBossConnections.length === 0) return;

    const positions = this.bossSubordinateLines.geometry.attributes.position as THREE.BufferAttribute;
    const posArray = positions.array as Float32Array;

    for (let i = 0; i < this.cachedBossConnections.length && i < this.maxLineSegments; i++) {
      const { bossId, subId } = this.cachedBossConnections[i];
      const bossMesh = this.buildingMeshes.get(bossId);
      const subMesh = this.buildingMeshes.get(subId);

      if (!bossMesh || !subMesh) continue;

      const baseIdx = i * 6;
      // Start point (boss)
      posArray[baseIdx] = bossMesh.group.position.x;
      posArray[baseIdx + 1] = 0.1;
      posArray[baseIdx + 2] = bossMesh.group.position.z;
      // End point (subordinate)
      posArray[baseIdx + 3] = subMesh.group.position.x;
      posArray[baseIdx + 4] = 0.1;
      posArray[baseIdx + 5] = subMesh.group.position.z;
    }

    positions.needsUpdate = true;
  }

  /**
   * Dispose of a group and its children.
   */
  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        const mat = child.material as THREE.SpriteMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    });
  }

  /**
   * Cleanup.
   */
  dispose(): void {
    for (const buildingId of this.buildingMeshes.keys()) {
      this.removeBuilding(buildingId);
    }
    // Clean up batched boss lines
    if (this.bossSubordinateLines) {
      this.scene.remove(this.bossSubordinateLines);
      this.bossSubordinateLines.geometry.dispose();
      this.bossSubordinateMaterial?.dispose();
      this.bossSubordinateLines = null;
      this.bossSubordinateMaterial = null;
    }
    this.cachedBossConnections = [];
  }
}
