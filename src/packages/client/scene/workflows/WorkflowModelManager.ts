/**
 * Workflow Model Manager
 *
 * Manages workflow 3D models in the scene — analogous to BuildingManager.
 * Handles add/remove/update/animate for workflow definition meshes.
 */

import * as THREE from 'three';
import type { WorkflowDefinition, WorkflowModelStatus } from '../../../shared/workflow-types';
import type { WorkflowMeshData } from './types';
import { WORKFLOW_STATUS_COLORS } from './types';
import { updateLabel } from '../buildings/labelUtils';
import {
  createWorkflowMesh,
  updateWorkflowIdleAnimations,
  updateWorkflowRunningAnimations,
  updateWorkflowErrorAnimations,
} from './WorkflowMeshFactory';

/**
 * Manages workflow 3D models in the Three.js scene.
 */
export class WorkflowModelManager {
  private scene: THREE.Scene;
  private workflowMeshes = new Map<string, WorkflowMeshData>();

  // Animation state
  private animationTime = 0;

  // Brightness multiplier (matches BuildingManager pattern)
  private brightness = 1;

  // External status provider — maps workflow ID → computed status
  private statusProvider: ((workflowId: string) => WorkflowModelStatus) | null = null;

  // Callbacks
  private onWorkflowClick: ((workflowId: string) => void) | null = null;
  private onWorkflowDoubleClick: ((workflowId: string) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set click callback.
   */
  setOnWorkflowClick(callback: (workflowId: string) => void): void {
    this.onWorkflowClick = callback;
  }

  /**
   * Set double-click callback.
   */
  setOnWorkflowDoubleClick(callback: (workflowId: string) => void): void {
    this.onWorkflowDoubleClick = callback;
  }

  /**
   * Set the status provider function.
   * Called during update() to get the current status for each workflow.
   */
  setStatusProvider(provider: (workflowId: string) => WorkflowModelStatus): void {
    this.statusProvider = provider;
  }

  /**
   * Set brightness multiplier.
   */
  setBrightness(brightness: number): void {
    this.brightness = brightness;
    for (const meshData of this.workflowMeshes.values()) {
      const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
      if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
        statusGlow.material.opacity = 0.3 * brightness;
      }
      meshData.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          const mat = child.material;
          if (mat.userData.baseEmissiveIntensity === undefined) {
            mat.userData.baseEmissiveIntensity = mat.emissiveIntensity || 1;
          }
          mat.emissiveIntensity = mat.userData.baseEmissiveIntensity * brightness;
        }
      });
    }
  }

  /**
   * Add a workflow model to the scene.
   */
  addWorkflow(def: WorkflowDefinition): void {
    this.removeWorkflow(def.id);

    const status = this.statusProvider?.(def.id) || 'idle';
    const meshData = createWorkflowMesh(def, status);

    meshData.group.userData.style = def.style || 'flowchart';
    meshData.group.userData.color = def.color || '';

    const scale = def.scale || 1.0;
    meshData.group.scale.setScalar(scale);

    this.scene.add(meshData.group);
    this.workflowMeshes.set(def.id, meshData);
  }

  /**
   * Remove a workflow model from the scene.
   */
  removeWorkflow(workflowId: string): void {
    const meshData = this.workflowMeshes.get(workflowId);
    if (meshData) {
      this.scene.remove(meshData.group);
      this.disposeGroup(meshData.group);
      this.workflowMeshes.delete(workflowId);
    }
  }

  /**
   * Update a workflow model's visuals.
   */
  updateWorkflow(def: WorkflowDefinition): void {
    const meshData = this.workflowMeshes.get(def.id);
    if (!meshData) {
      this.addWorkflow(def);
      return;
    }

    // Check if style/color changed — requires full rebuild
    const currentStyle = meshData.group.userData.style;
    const currentColor = meshData.group.userData.color;
    if (currentStyle !== (def.style || 'flowchart') || currentColor !== (def.color || '')) {
      this.removeWorkflow(def.id);
      this.addWorkflow(def);
      return;
    }

    // Update position
    meshData.group.position.set(def.position?.x || 0, 0, def.position?.z || 0);

    // Update scale
    const scale = def.scale || 1.0;
    meshData.group.scale.setScalar(scale);

    // Update status light color
    const status = this.statusProvider?.(def.id) || 'idle';
    const statusColor = WORKFLOW_STATUS_COLORS[status];

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
      updateLabel(meshData, def.name);
    }
  }

  /**
   * Set workflow position directly (for dragging).
   */
  setWorkflowPosition(workflowId: string, pos: { x: number; z: number }): void {
    const meshData = this.workflowMeshes.get(workflowId);
    if (meshData) {
      meshData.group.position.set(pos.x, 0, pos.z);
    }
  }

  /**
   * Get workflow at a world position (for click detection).
   */
  getWorkflowAtPosition(pos: { x: number; z: number }, definitions: Map<string, WorkflowDefinition>): WorkflowDefinition | null {
    for (const [id, meshData] of this.workflowMeshes) {
      const def = definitions.get(id);
      if (!def) continue;

      const scale = def.scale || 1.0;
      const halfWidth = 1.5 * scale;
      const halfDepth = 1.5 * scale;

      const dx = Math.abs(pos.x - meshData.group.position.x);
      const dz = Math.abs(pos.z - meshData.group.position.z);

      if (dx <= halfWidth && dz <= halfDepth) {
        return def;
      }
    }
    return null;
  }

  /**
   * Get all workflow meshes for raycasting.
   */
  getWorkflowMeshes(): THREE.Group[] {
    return Array.from(this.workflowMeshes.values()).map(m => m.group);
  }

  /**
   * Get workflow mesh data map.
   */
  getWorkflowMeshData(): Map<string, WorkflowMeshData> {
    return this.workflowMeshes;
  }

  /**
   * Highlight a workflow (when selected).
   */
  highlightWorkflow(workflowId: string | null): void {
    // Remove previous highlights
    for (const meshData of this.workflowMeshes.values()) {
      const body = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
      if (body && body.material instanceof THREE.MeshStandardMaterial) {
        body.material.emissive.setHex(0x000000);
      }
    }

    // Apply highlight
    if (workflowId) {
      const meshData = this.workflowMeshes.get(workflowId);
      if (meshData) {
        const body = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.emissive.setHex(0x222244);
        }
      }
    }
  }

  /**
   * Sync workflows from provided definitions map.
   */
  syncFromDefinitions(definitions: Map<string, WorkflowDefinition>): void {
    // Remove meshes for deleted workflows
    for (const workflowId of this.workflowMeshes.keys()) {
      if (!definitions.has(workflowId)) {
        this.removeWorkflow(workflowId);
      }
    }

    // Add/update meshes
    for (const def of definitions.values()) {
      if (this.workflowMeshes.has(def.id)) {
        this.updateWorkflow(def);
      } else {
        this.addWorkflow(def);
      }
    }
  }

  /**
   * Update animations (call in render loop).
   */
  update(deltaTime: number, definitions: Map<string, WorkflowDefinition>): void {
    this.animationTime += deltaTime;

    for (const [workflowId, meshData] of this.workflowMeshes) {
      const def = definitions.get(workflowId);
      if (!def) continue;

      const status = this.statusProvider?.(workflowId) || 'idle';

      // Always run idle animations
      updateWorkflowIdleAnimations(meshData, def, this.animationTime, deltaTime);

      // Status-specific animations
      if (status === 'running') {
        updateWorkflowRunningAnimations(meshData, def, this.animationTime, deltaTime);
      } else if (status === 'error') {
        updateWorkflowErrorAnimations(meshData, this.animationTime);
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
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }

  /**
   * Cleanup all workflow meshes.
   */
  dispose(): void {
    for (const workflowId of this.workflowMeshes.keys()) {
      this.removeWorkflow(workflowId);
    }
  }
}
