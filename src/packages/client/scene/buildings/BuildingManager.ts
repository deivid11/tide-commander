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

    // Update position
    meshData.group.position.set(building.position.x, 0, building.position.z);

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

    // Update label if name changed
    const currentLabel = meshData.label;
    const canvas = (currentLabel.material as THREE.SpriteMaterial).map?.image as HTMLCanvasElement;
    if (canvas) {
      // Simple check - just update if needed
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
  }

  /**
   * Get building mesh data for screen position calculation.
   */
  getBuildingMeshData(): Map<string, BuildingMeshData> {
    return this.buildingMeshes;
  }

  /**
   * Get hitbox dimensions for a building style.
   */
  private getHitboxForStyle(style: BuildingStyle): { halfWidth: number; halfDepth: number } {
    switch (style) {
      case 'desktop':
        return { halfWidth: 1.4, halfDepth: 1.4 }; // 2.8 x 2.8 base
      case 'filing-cabinet':
        return { halfWidth: 1.3, halfDepth: 0.7 }; // 2.6 x 1.4 base
      case 'factory':
        return { halfWidth: 1.0, halfDepth: 0.7 }; // 2.0 x 1.4 roof
      case 'satellite':
        return { halfWidth: 0.65, halfDepth: 0.55 }; // 1.3 x 1.1 base
      case 'crystal':
        return { halfWidth: 0.8, halfDepth: 0.8 }; // Crystal floats, generous hitbox
      case 'tower':
        return { halfWidth: 0.6, halfDepth: 0.4 }; // 1.2 x 0.8 tower
      case 'dome':
        return { halfWidth: 0.8, halfDepth: 0.8 }; // Dome shape
      case 'pyramid':
        return { halfWidth: 0.75, halfDepth: 0.75 }; // Pyramid shape
      case 'server-rack':
      default:
        return { halfWidth: 0.75, halfDepth: 0.55 }; // 1.5 x 1.1 base
    }
  }

  /**
   * Get building at a world position (for click detection).
   */
  getBuildingAtPosition(pos: { x: number; z: number }): Building | null {
    const state = store.getState();

    for (const building of state.buildings.values()) {
      const hitbox = this.getHitboxForStyle(building.style);
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
  }
}
