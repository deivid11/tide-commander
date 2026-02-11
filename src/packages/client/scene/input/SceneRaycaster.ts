import * as THREE from 'three';
import type { AgentMeshData } from '../characters/CharacterFactory';
import type { GroundPosition, ResizeHandlesGetter, FolderIconMeshesGetter } from './types';

/**
 * Handles all raycasting operations for scene interaction.
 */
export class SceneRaycaster {
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // Scene references
  private ground: THREE.Object3D | null = null;
  private agentMeshes: Map<string, AgentMeshData> = new Map();
  private resizeHandlesGetter: ResizeHandlesGetter = () => [];
  private folderIconMeshesGetter: FolderIconMeshesGetter = () => [];

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.canvas = canvas;
  }

  /**
   * Update scene references.
   */
  setReferences(ground: THREE.Object3D | null, agentMeshes: Map<string, AgentMeshData>): void {
    this.ground = ground;
    this.agentMeshes = agentMeshes;
  }

  /**
   * Set the resize handles getter.
   */
  setResizeHandlesGetter(getter: ResizeHandlesGetter): void {
    this.resizeHandlesGetter = getter;
  }

  /**
   * Set the folder icon meshes getter.
   */
  setFolderIconMeshesGetter(getter: FolderIconMeshesGetter): void {
    this.folderIconMeshesGetter = getter;
  }

  /**
   * Update canvas reference.
   */
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }

  /**
   * Raycast to ground from mouse event and return world position.
   */
  raycastGroundFromEvent(event: MouseEvent): GroundPosition | null {
    if (!this.ground) return null;

    this.updateMouseFromEvent(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(this.ground);
    if (intersects.length > 0) {
      const point = intersects[0].point;
      return { x: point.x, z: point.z };
    }
    return null;
  }

  /**
   * Raycast to ground from screen coordinates.
   */
  raycastGroundFromPoint(clientX: number, clientY: number): GroundPosition | null {
    if (!this.ground) return null;

    this.updateMouseFromPoint(clientX, clientY);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(this.ground);
    if (intersects.length > 0) {
      const point = intersects[0].point;
      return { x: point.x, z: point.z };
    }
    return null;
  }

  /**
   * Check if clicking on a resize handle.
   */
  checkResizeHandleClick(event: PointerEvent): THREE.Mesh | null {
    const handles = this.resizeHandlesGetter();
    if (handles.length === 0) return null;

    this.updateMouseFromEvent(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(handles);
    if (intersects.length > 0) {
      return intersects[0].object as THREE.Mesh;
    }
    return null;
  }

  /**
   * Check if clicking on a folder icon.
   */
  checkFolderIconClick(event: PointerEvent): THREE.Mesh | null {
    const meshes = this.folderIconMeshesGetter();
    if (meshes.length === 0) return null;

    this.updateMouseFromEvent(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(meshes);
    if (intersects.length > 0) {
      return intersects[0].object as THREE.Mesh;
    }
    return null;
  }

  /**
   * Find agent at click position.
   * Returns the agent ID if found, null otherwise.
   */
  findAgentAtPosition(event: MouseEvent | PointerEvent): string | null {
    this.updateMouseFromEvent(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshArray = Array.from(this.agentMeshes.values()).map((d) => d.group);
    const intersects = this.raycaster.intersectObjects(meshArray, true);

    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData.agentId) {
        obj = obj.parent;
      }
      if (obj && obj.userData.agentId) {
        return obj.userData.agentId;
      }
    }
    return null;
  }

  /**
   * Find agent at screen coordinates.
   */
  findAgentAtPoint(clientX: number, clientY: number): string | null {
    this.updateMouseFromPoint(clientX, clientY);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshArray = Array.from(this.agentMeshes.values()).map((d) => d.group);
    const intersects = this.raycaster.intersectObjects(meshArray, true);

    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData.agentId) {
        obj = obj.parent;
      }
      if (obj && obj.userData.agentId) {
        return obj.userData.agentId;
      }
    }
    return null;
  }

  /**
   * Raycast from normalized screen coordinates to find intersection with ground or y=0 plane.
   * Used for zoom targeting.
   */
  raycastToPlane(normalizedX: number, normalizedY: number): THREE.Vector3 | null {
    this.mouse.set(normalizedX, normalizedY);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Try ground first
    if (this.ground) {
      const groundIntersects = this.raycaster.intersectObject(this.ground);
      if (groundIntersects.length > 0) {
        return groundIntersects[0].point;
      }
    }

    // Fallback to y=0 plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const targetPoint = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, targetPoint)) {
      return targetPoint;
    }

    return null;
  }

  /**
   * Project world position to screen coordinates.
   */
  projectToScreen(position: THREE.Vector3): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const screenPos = position.clone().project(this.camera);
    return {
      x: ((screenPos.x + 1) / 2) * rect.width + rect.left,
      y: ((-screenPos.y + 1) / 2) * rect.height + rect.top,
    };
  }

  /**
   * Get normalized mouse coordinates from event.
   */
  getNormalizedMouseFromEvent(event: MouseEvent): THREE.Vector2 {
    this.updateMouseFromEvent(event);
    return this.mouse.clone();
  }

  /**
   * Get normalized mouse coordinates from screen point.
   */
  getNormalizedMouseFromPoint(clientX: number, clientY: number): THREE.Vector2 {
    this.updateMouseFromPoint(clientX, clientY);
    return this.mouse.clone();
  }

  /**
   * Get the agent meshes map.
   */
  getAgentMeshes(): Map<string, AgentMeshData> {
    return this.agentMeshes;
  }

  // --- Private methods ---

  private updateMouseFromEvent(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private updateMouseFromPoint(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }
}
