import * as THREE from 'three';
import type { DrawingArea, DrawingTool } from '../../../shared/types';
import { store } from '../../store';

/**
 * Handle types for different positions.
 * - nw, ne, sw, se: corner resize handles for rectangles
 * - n, s, e, w: edge resize handles for rectangles (single-axis)
 * - radius: edge resize handle for circles
 * - move: center handle for moving the entire area
 */
type HandleType = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'radius' | 'move';

/**
 * Manages drawing areas on the battlefield.
 */
export class DrawingManager {
  private scene: THREE.Scene;
  private areaMeshes = new Map<string, THREE.Group>();
  private previewMesh: THREE.Group | null = null;

  // Drawing state
  private isDrawing = false;
  private drawStartPos: { x: number; z: number } | null = null;
  private currentTool: DrawingTool = null;

  // Resize state
  private resizeHandles: THREE.Mesh[] = [];
  private selectedAreaId: string | null = null;
  private isResizing = false;
  private resizeHandleType: HandleType | null = null;
  private resizeStartPos: { x: number; z: number } | null = null;
  private resizeOriginalArea: DrawingArea | null = null;
  private areaDragAgentStartPositions = new Map<string, { x: number; y: number; z: number }>();
  private areaDragBuildingStartPositions = new Map<string, { x: number; z: number }>();

  // Callback for when area is created
  private onAreaCreated: ((area: DrawingArea) => void) | null = null;

  // Callback for when folder icon is clicked
  private onFolderIconClick: ((areaId: string, folderPath?: string) => void) | null = null;

  // Folder icon meshes for raycasting
  private folderIconMeshes: THREE.Mesh[] = [];

  // Brightness multiplier for area materials (affects opacity/intensity)
  private brightness = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set callback for area creation.
   */
  setOnAreaCreated(callback: (area: DrawingArea) => void): void {
    this.onAreaCreated = callback;
  }

  /**
   * Set callback for folder icon clicks.
   */
  setOnFolderIconClick(callback: (areaId: string, folderPath?: string) => void): void {
    this.onFolderIconClick = callback;
  }

  /**
   * Get folder icon meshes for raycasting.
   */
  getFolderIconMeshes(): THREE.Mesh[] {
    return this.folderIconMeshes;
  }

  /**
   * Handle a raycast hit on a folder icon.
   */
  handleFolderIconClick(mesh: THREE.Mesh): void {
    const areaId = mesh.userData.areaId;
    const folderPath = mesh.userData.folderPath as string | undefined;
    if (areaId && this.onFolderIconClick) {
      this.onFolderIconClick(areaId, folderPath);
    }
  }

  /**
   * Set brightness multiplier for area materials.
   * Affects opacity/intensity of area fills.
   */
  setBrightness(brightness: number): void {
    this.brightness = brightness;
    // Update existing area materials
    for (const [id, group] of this.areaMeshes) {
      const isSelected = id === this.selectedAreaId;
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name !== 'resizeHandle') {
          const mat = child.material as THREE.MeshBasicMaterial;
          // Base opacity: 0.15 idle, 0.3 selected. Apply brightness multiplier.
          const baseOpacity = isSelected ? 0.3 : 0.15;
          mat.opacity = baseOpacity * this.brightness;
        }
      });
    }
  }

  /**
   * Set the active drawing tool.
   */
  setTool(tool: DrawingTool): void {
    this.currentTool = tool;
    if (!tool || tool === 'select') {
      this.cancelDrawing();
    }
  }

  /**
   * Get current tool.
   */
  getTool(): DrawingTool {
    return this.currentTool;
  }

  /**
   * Check if in drawing mode.
   */
  isInDrawingMode(): boolean {
    return this.currentTool === 'rectangle' || this.currentTool === 'circle';
  }

  /**
   * Start drawing at a position.
   */
  startDrawing(pos: { x: number; z: number }): void {
    if (!this.isInDrawingMode()) return;

    this.isDrawing = true;
    this.drawStartPos = pos;
    this.createPreview(pos);
  }

  /**
   * Update drawing preview.
   */
  updateDrawing(pos: { x: number; z: number }): void {
    if (!this.isDrawing || !this.drawStartPos || !this.previewMesh) return;

    this.updatePreview(pos);
  }

  /**
   * Finish drawing and create area.
   */
  finishDrawing(pos: { x: number; z: number }): DrawingArea | null {
    if (!this.isDrawing || !this.drawStartPos) {
      this.cancelDrawing();
      return null;
    }

    // Calculate area dimensions
    const area = this.createAreaFromDraw(this.drawStartPos, pos);

    // Clean up preview
    this.cancelDrawing();

    if (area) {
      // Add to store and render
      store.addArea(area);
      this.renderArea(area);
      this.onAreaCreated?.(area);
    }

    return area;
  }

  /**
   * Cancel drawing.
   */
  cancelDrawing(): void {
    this.isDrawing = false;
    this.drawStartPos = null;

    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.disposeGroup(this.previewMesh);
      this.previewMesh = null;
    }
  }

  /**
   * Check if currently drawing.
   */
  isCurrentlyDrawing(): boolean {
    return this.isDrawing;
  }

  /**
   * Render all areas from store.
   * Skips archived areas.
   */
  renderAllAreas(): void {
    const state = store.getState();
    for (const area of state.areas.values()) {
      // Skip archived areas
      if (area.archived) {
        // Remove mesh if it exists (area was just archived)
        if (this.areaMeshes.has(area.id)) {
          this.removeAreaMesh(area.id);
        }
        continue;
      }
      if (!this.areaMeshes.has(area.id)) {
        this.renderArea(area);
      }
    }
  }

  /**
   * Render a single area.
   */
  renderArea(area: DrawingArea): void {
    // Remove existing if any
    this.removeAreaMesh(area.id);

    const group = new THREE.Group();
    group.userData.areaId = area.id;
    group.userData.zIndex = area.zIndex ?? 0;

    const color = new THREE.Color(area.color);

    // Calculate Y offset based on zIndex to prevent z-fighting
    // Use small offset (0.001) per zIndex level
    const zOffset = (area.zIndex ?? 0) * 0.001;

    if (area.type === 'rectangle' && area.width && area.height) {
      // Fill (apply brightness multiplier to opacity)
      const fillGeom = new THREE.PlaneGeometry(area.width, area.height);
      const fillMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.15 * this.brightness,
        side: THREE.DoubleSide,
      });
      const fill = new THREE.Mesh(fillGeom, fillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.02 + zOffset;
      group.add(fill);

      // Border
      const borderPoints = [
        new THREE.Vector3(-area.width / 2, 0, -area.height / 2),
        new THREE.Vector3(area.width / 2, 0, -area.height / 2),
        new THREE.Vector3(area.width / 2, 0, area.height / 2),
        new THREE.Vector3(-area.width / 2, 0, area.height / 2),
        new THREE.Vector3(-area.width / 2, 0, -area.height / 2),
      ];
      const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
      const borderMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      const border = new THREE.Line(borderGeom, borderMat);
      border.position.y = 0.03 + zOffset;
      group.add(border);

    } else if (area.type === 'circle' && area.radius) {
      // Fill (apply brightness multiplier to opacity)
      const fillGeom = new THREE.CircleGeometry(area.radius, 32);
      const fillMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.15 * this.brightness,
        side: THREE.DoubleSide,
      });
      const fill = new THREE.Mesh(fillGeom, fillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.02 + zOffset;
      group.add(fill);

      // Border
      const borderPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        borderPoints.push(new THREE.Vector3(
          Math.cos(angle) * area.radius,
          0,
          Math.sin(angle) * area.radius
        ));
      }
      const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
      const borderMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      const border = new THREE.Line(borderGeom, borderMat);
      border.position.y = 0.03 + zOffset;
      group.add(border);
    }

    // Add name label
    const label = this.createTextLabel(area.name, area.color);
    label.position.y = 0.05 + zOffset;
    label.name = 'areaLabel';
    group.add(label);

    // Add folder icon if area has directories
    if (area.directories && area.directories.length > 0) {
      const iconSize = 0.6;
      const spacing = iconSize * 1.35;
      let baseX = 0;
      let baseZ = 0;
      let maxCols = 3;

      if (area.type === 'rectangle' && area.width && area.height) {
        baseX = -area.width / 2 + 0.4;
        baseZ = -area.height / 2 + 0.4;
        maxCols = Math.max(1, Math.floor((area.width - 0.6) / spacing));
      } else if (area.type === 'circle' && area.radius) {
        const offset = area.radius * 0.707;
        baseX = -offset + 0.3;
        baseZ = -offset + 0.3;
        maxCols = Math.max(1, Math.floor((area.radius * 1.414 - 0.5) / spacing));
      }

      area.directories.forEach((folderPath, idx) => {
        const row = Math.floor(idx / maxCols);
        const col = idx % maxCols;
        const gitCount = area.directoryGitCounts?.[idx] ?? 0;

        const folderIcon = this.createFolderIconSprite(area.color, gitCount);
        folderIcon.name = 'folderIcon';
        folderIcon.userData.areaId = area.id;
        folderIcon.userData.folderPath = folderPath;
        folderIcon.userData.isFolderIcon = true;
        folderIcon.position.set(
          baseX + col * spacing,
          0.3 + zOffset,
          baseZ + row * spacing
        );
        group.add(folderIcon);

        // Create a clickable mesh (invisible sphere for raycasting)
        const hitGeom = new THREE.SphereGeometry(0.3, 8, 8);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeom, hitMat);
        hitMesh.position.copy(folderIcon.position);
        // Offset to world position
        hitMesh.position.x += area.center.x;
        hitMesh.position.z += area.center.z;
        hitMesh.name = 'folderIconHit';
        hitMesh.userData.areaId = area.id;
        hitMesh.userData.folderPath = folderPath;
        hitMesh.userData.isFolderIcon = true;
        this.scene.add(hitMesh);
        this.folderIconMeshes.push(hitMesh);
      });
    }

    group.position.set(area.center.x, 0, area.center.z);
    this.scene.add(group);
    this.areaMeshes.set(area.id, group);
  }

  /**
   * Create a text label sprite.
   */
  private createTextLabel(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;

    const fontSize = 32;
    const padding = 20;
    const canvasHeight = 64;

    // Set initial canvas size for accurate text measurement
    canvas.width = 1024;
    canvas.height = canvasHeight;
    context.font = `bold ${fontSize}px Arial`;
    const measuredWidth = context.measureText(text).width;

    // Resize canvas to fit text (with minimum width)
    const minCanvasWidth = 256;
    canvas.width = Math.max(minCanvasWidth, measuredWidth + padding * 2);

    // Clear canvas and reset context after resize
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `bold ${fontSize}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Draw text shadow/outline for visibility
    context.strokeStyle = '#000000';
    context.lineWidth = 4;
    context.strokeText(text, canvas.width / 2, canvas.height / 2);

    // Draw text fill with area color
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    // Create texture and sprite
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    // Scale must match canvas aspect ratio to avoid distortion
    // Original: 256x64 canvas = 2x0.5 sprite (both 4:1 ratio)
    const sprite = new THREE.Sprite(spriteMaterial);
    const baseHeight = 0.5;
    const widthScale = 2 * (canvas.width / 256);
    sprite.scale.set(widthScale, baseHeight, 1);

    return sprite;
  }

  /**
   * Create a folder icon sprite using canvas.
   */
  private createFolderIconSprite(color: string, gitCount: number = 0): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Background circle
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
    ctx.fill();

    // Border circle
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
    ctx.stroke();

    // Folder shape
    const fw = size * 0.5;
    const fh = size * 0.35;
    const fx = (size - fw) / 2;
    const fy = (size - fh) / 2 + 2;
    const tabW = fw * 0.35;
    const tabH = fh * 0.22;

    ctx.fillStyle = color;
    ctx.beginPath();
    // Tab
    ctx.moveTo(fx + 4, fy + tabH);
    ctx.lineTo(fx + tabW, fy + tabH);
    ctx.lineTo(fx + tabW + tabH, fy);
    ctx.lineTo(fx + 4, fy);
    // Body
    ctx.moveTo(fx, fy + tabH);
    ctx.lineTo(fx, fy + fh);
    ctx.lineTo(fx + fw, fy + fh);
    ctx.lineTo(fx + fw, fy + tabH);
    ctx.closePath();
    ctx.fill();

    // Highlight line
    ctx.strokeStyle = `rgba(255, 255, 255, 0.3)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx + 4, fy + tabH + 3);
    ctx.lineTo(fx + fw - 4, fy + tabH + 3);
    ctx.stroke();

    // Git changes indicator badge (bottom-right of the circle)
    if (gitCount > 0) {
      const badgeRadius = size * 0.16;
      const badgeX = size * 0.78;
      const badgeY = size * 0.78;

      // Orange badge circle
      ctx.fillStyle = '#e8943a';
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.fill();

      // Dark border
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Count text
      const countText = gitCount > 99 ? '99+' : String(gitCount);
      const fontSize = badgeRadius * 1.3;
      ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(countText, badgeX, badgeY);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(0.6, 0.6, 1);
    return sprite;
  }

  /**
   * Update area mesh (after editing).
   */
  updateAreaMesh(area: DrawingArea): void {
    this.renderArea(area); // Just re-render
  }

  /**
   * Remove area mesh.
   */
  removeAreaMesh(areaId: string): void {
    const mesh = this.areaMeshes.get(areaId);
    if (mesh) {
      this.scene.remove(mesh);
      this.disposeGroup(mesh);
      this.areaMeshes.delete(areaId);
    }

    // Remove associated folder icon hit meshes
    this.folderIconMeshes = this.folderIconMeshes.filter((m) => {
      if (m.userData.areaId === areaId) {
        this.scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }

  /**
   * Highlight an area (when selected).
   */
  highlightArea(areaId: string | null): void {
    this.selectedAreaId = areaId;

    // Remove old resize handles
    this.removeResizeHandles();

    for (const [id, group] of this.areaMeshes) {
      const isSelected = id === areaId;
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name !== 'resizeHandle') {
          const mat = child.material as THREE.MeshBasicMaterial;
          // Apply brightness multiplier to opacity
          const baseOpacity = isSelected ? 0.3 : 0.15;
          mat.opacity = baseOpacity * this.brightness;
        }
        if (child instanceof THREE.Line) {
          const mat = child.material as THREE.LineBasicMaterial;
          mat.opacity = isSelected ? 1 : 0.8;
        }
      });
    }

    // Add resize handles for selected area
    if (areaId) {
      const area = store.getState().areas.get(areaId);
      if (area) {
        this.createResizeHandles(area);
      }
    }
  }

  /**
   * Create resize and move handles for an area.
   */
  private createResizeHandles(area: DrawingArea): void {
    const handleGeom = new THREE.SphereGeometry(0.15, 16, 16);
    const resizeHandleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const moveHandleMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00, // Yellow/gold for move handle
      transparent: true,
      opacity: 0.9,
    });

    // Calculate Y offset based on zIndex
    const zOffset = (area.zIndex ?? 0) * 0.001;

    // Create center move handle (for both rectangle and circle)
    const moveHandle = new THREE.Mesh(handleGeom.clone(), moveHandleMat.clone());
    moveHandle.position.set(area.center.x, 0.25 + zOffset, area.center.z);
    moveHandle.name = 'resizeHandle';
    moveHandle.userData.handleType = 'move';
    moveHandle.userData.areaId = area.id;
    this.scene.add(moveHandle);
    this.resizeHandles.push(moveHandle);

    if (area.type === 'rectangle' && area.width && area.height) {
      // Corner handles for rectangle
      const corners: { type: HandleType; x: number; z: number }[] = [
        { type: 'nw', x: -area.width / 2, z: -area.height / 2 },
        { type: 'ne', x: area.width / 2, z: -area.height / 2 },
        { type: 'sw', x: -area.width / 2, z: area.height / 2 },
        { type: 'se', x: area.width / 2, z: area.height / 2 },
      ];

      for (const corner of corners) {
        const handle = new THREE.Mesh(handleGeom.clone(), resizeHandleMat.clone());
        handle.position.set(
          area.center.x + corner.x,
          0.2 + zOffset,
          area.center.z + corner.z
        );
        handle.name = 'resizeHandle';
        handle.userData.handleType = corner.type;
        handle.userData.areaId = area.id;
        this.scene.add(handle);
        this.resizeHandles.push(handle);
      }

      // Edge handles for rectangle (midpoints of each side)
      const edgeHandleMat = new THREE.MeshBasicMaterial({
        color: 0xaaddff, // Light blue for edge handles
        transparent: true,
        opacity: 0.9,
      });
      const edgeHandleGeom = new THREE.SphereGeometry(0.12, 16, 16);
      const edges: { type: HandleType; x: number; z: number }[] = [
        { type: 'n', x: 0, z: -area.height / 2 },
        { type: 's', x: 0, z: area.height / 2 },
        { type: 'e', x: area.width / 2, z: 0 },
        { type: 'w', x: -area.width / 2, z: 0 },
      ];

      for (const edge of edges) {
        const handle = new THREE.Mesh(edgeHandleGeom.clone(), edgeHandleMat.clone());
        handle.position.set(
          area.center.x + edge.x,
          0.2 + zOffset,
          area.center.z + edge.z
        );
        handle.name = 'resizeHandle';
        handle.userData.handleType = edge.type;
        handle.userData.areaId = area.id;
        this.scene.add(handle);
        this.resizeHandles.push(handle);
      }
      edgeHandleMat.dispose();
      edgeHandleGeom.dispose();
    } else if (area.type === 'circle' && area.radius) {
      // Single handle on edge for circle
      const handle = new THREE.Mesh(handleGeom.clone(), resizeHandleMat.clone());
      handle.position.set(
        area.center.x + area.radius,
        0.2 + zOffset,
        area.center.z
      );
      handle.name = 'resizeHandle';
      handle.userData.handleType = 'radius';
      handle.userData.areaId = area.id;
      this.scene.add(handle);
      this.resizeHandles.push(handle);
    }

    handleGeom.dispose();
    resizeHandleMat.dispose();
    moveHandleMat.dispose();
  }

  /**
   * Remove all resize handles.
   */
  private removeResizeHandles(): void {
    for (const handle of this.resizeHandles) {
      this.scene.remove(handle);
      handle.geometry.dispose();
      (handle.material as THREE.Material).dispose();
    }
    this.resizeHandles = [];
  }

  /**
   * Get resize handles for raycasting.
   */
  getResizeHandles(): THREE.Mesh[] {
    return this.resizeHandles;
  }

  /**
   * Check if currently resizing.
   */
  isCurrentlyResizing(): boolean {
    return this.isResizing;
  }

  /**
   * Start resizing an area.
   */
  startResize(handle: THREE.Mesh, pos: { x: number; z: number }): void {
    const areaId = handle.userData.areaId;
    const handleType = handle.userData.handleType as HandleType;
    const area = store.getState().areas.get(areaId);

    if (!area) return;

    this.isResizing = true;
    this.resizeHandleType = handleType;
    this.resizeStartPos = pos;
    this.resizeOriginalArea = { ...area };

    this.areaDragAgentStartPositions.clear();
    this.areaDragBuildingStartPositions.clear();

    if (handleType === 'move') {
      const state = store.getState();

      for (const agent of state.agents.values()) {
        if (this.isPointInsideArea(agent.position.x, agent.position.z, area)) {
          this.areaDragAgentStartPositions.set(agent.id, { ...agent.position });
        }
      }

      for (const building of state.buildings.values()) {
        if (this.isPointInsideArea(building.position.x, building.position.z, area)) {
          this.areaDragBuildingStartPositions.set(building.id, { ...building.position });
        }
      }
    }
  }

  /**
   * Update resize or move during drag.
   */
  updateResize(pos: { x: number; z: number }): void {
    if (!this.isResizing || !this.resizeOriginalArea || !this.resizeHandleType || !this.resizeStartPos) return;

    const area = this.resizeOriginalArea;
    let updates: Partial<DrawingArea> = {};

    // Handle move operation (works for both rectangle and circle)
    if (this.resizeHandleType === 'move') {
      const deltaX = pos.x - this.resizeStartPos.x;
      const deltaZ = pos.z - this.resizeStartPos.z;
      updates = {
        center: {
          x: area.center.x + deltaX,
          z: area.center.z + deltaZ,
        },
      };

      for (const [agentId, startPos] of this.areaDragAgentStartPositions) {
        store.moveAgentLocal(agentId, {
          x: startPos.x + deltaX,
          y: startPos.y,
          z: startPos.z + deltaZ,
        });
      }

      for (const [buildingId, startPos] of this.areaDragBuildingStartPositions) {
        store.updateBuildingLocal(buildingId, {
          position: {
            x: startPos.x + deltaX,
            z: startPos.z + deltaZ,
          },
        });
      }
    } else if (area.type === 'rectangle' && area.width && area.height) {
      // Asymmetric resize: anchor the opposite side, only move the dragged side
      const deltaX = pos.x - this.resizeStartPos.x;
      const deltaZ = pos.z - this.resizeStartPos.z;
      const origW = area.width;
      const origH = area.height;
      const origCX = area.center.x;
      const origCZ = area.center.z;

      // Helper: compute new width/center when moving one side
      const moveRight = (dx: number) => {
        const newW = Math.max(0.5, origW + dx);
        return { width: newW, cx: origCX + (newW - origW) / 2 };
      };
      const moveLeft = (dx: number) => {
        const newW = Math.max(0.5, origW - dx);
        return { width: newW, cx: origCX + (origW - newW) / 2 };
      };
      const moveBottom = (dz: number) => {
        const newH = Math.max(0.5, origH + dz);
        return { height: newH, cz: origCZ + (newH - origH) / 2 };
      };
      const moveTop = (dz: number) => {
        const newH = Math.max(0.5, origH - dz);
        return { height: newH, cz: origCZ + (origH - newH) / 2 };
      };

      switch (this.resizeHandleType) {
        case 'se': {
          const r = moveRight(deltaX);
          const b = moveBottom(deltaZ);
          updates = { width: r.width, height: b.height, center: { x: r.cx, z: b.cz } };
          break;
        }
        case 'sw': {
          const l = moveLeft(deltaX);
          const b = moveBottom(deltaZ);
          updates = { width: l.width, height: b.height, center: { x: l.cx, z: b.cz } };
          break;
        }
        case 'ne': {
          const r = moveRight(deltaX);
          const t = moveTop(deltaZ);
          updates = { width: r.width, height: t.height, center: { x: r.cx, z: t.cz } };
          break;
        }
        case 'nw': {
          const l = moveLeft(deltaX);
          const t = moveTop(deltaZ);
          updates = { width: l.width, height: t.height, center: { x: l.cx, z: t.cz } };
          break;
        }
        case 'e': {
          const r = moveRight(deltaX);
          updates = { width: r.width, center: { x: r.cx, z: origCZ } };
          break;
        }
        case 'w': {
          const l = moveLeft(deltaX);
          updates = { width: l.width, center: { x: l.cx, z: origCZ } };
          break;
        }
        case 's': {
          const b = moveBottom(deltaZ);
          updates = { height: b.height, center: { x: origCX, z: b.cz } };
          break;
        }
        case 'n': {
          const t = moveTop(deltaZ);
          updates = { height: t.height, center: { x: origCX, z: t.cz } };
          break;
        }
      }
    } else if (area.type === 'circle' && this.resizeHandleType === 'radius') {
      // Calculate new radius based on distance from center
      const dx = pos.x - area.center.x;
      const dz = pos.z - area.center.z;
      const newRadius = Math.max(0.5, Math.sqrt(dx * dx + dz * dz));
      updates = { radius: newRadius };
    }

    if (Object.keys(updates).length > 0) {
      store.updateArea(area.id, updates);
    }
  }

  /**
   * Finish resizing.
   */
  finishResize(): void {
    if (this.resizeHandleType === 'move' && this.resizeOriginalArea && this.resizeStartPos) {
      const state = store.getState();
      const currentArea = state.areas.get(this.resizeOriginalArea.id);
      if (currentArea) {
        const deltaX = currentArea.center.x - this.resizeOriginalArea.center.x;
        const deltaZ = currentArea.center.z - this.resizeOriginalArea.center.z;

        if (deltaX !== 0 || deltaZ !== 0) {
          for (const [agentId, startPos] of this.areaDragAgentStartPositions) {
            store.moveAgent(agentId, {
              x: startPos.x + deltaX,
              y: startPos.y,
              z: startPos.z + deltaZ,
            });
          }

          for (const [buildingId, startPos] of this.areaDragBuildingStartPositions) {
            store.moveBuilding(buildingId, {
              x: startPos.x + deltaX,
              z: startPos.z + deltaZ,
            });
          }
        }
      }
    }

    this.isResizing = false;
    this.resizeHandleType = null;
    this.resizeStartPos = null;
    this.resizeOriginalArea = null;
    this.areaDragAgentStartPositions.clear();
    this.areaDragBuildingStartPositions.clear();

    // Refresh handles for the selected area
    if (this.selectedAreaId) {
      this.removeResizeHandles();
      const area = store.getState().areas.get(this.selectedAreaId);
      if (area) {
        this.createResizeHandles(area);
      }
    }
  }

  private isPointInsideArea(x: number, z: number, area: DrawingArea): boolean {
    if (area.type === 'rectangle' && area.width && area.height) {
      const halfW = area.width / 2;
      const halfH = area.height / 2;
      return (
        x >= area.center.x - halfW &&
        x <= area.center.x + halfW &&
        z >= area.center.z - halfH &&
        z <= area.center.z + halfH
      );
    }

    if (area.type === 'circle' && area.radius) {
      const dx = x - area.center.x;
      const dz = z - area.center.z;
      return dx * dx + dz * dz <= area.radius * area.radius;
    }

    return false;
  }

  /**
   * Get area at a world position.
   * Areas are checked in reverse z-order (highest zIndex first) so topmost area is selected.
   * Archived areas are excluded.
   */
  getAreaAtPosition(pos: { x: number; z: number }): DrawingArea | null {
    const state = store.getState();

    // Sort areas by zIndex descending (highest first) so we check topmost areas first
    // Filter out archived areas
    const sortedAreas = Array.from(state.areas.values())
      .filter((a) => !a.archived)
      .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));

    for (const area of sortedAreas) {
      if (area.type === 'rectangle' && area.width && area.height) {
        const halfW = area.width / 2;
        const halfH = area.height / 2;
        if (
          pos.x >= area.center.x - halfW &&
          pos.x <= area.center.x + halfW &&
          pos.z >= area.center.z - halfH &&
          pos.z <= area.center.z + halfH
        ) {
          return area;
        }
      } else if (area.type === 'circle' && area.radius) {
        const dx = pos.x - area.center.x;
        const dz = pos.z - area.center.z;
        if (Math.sqrt(dx * dx + dz * dz) <= area.radius) {
          return area;
        }
      }
    }

    return null;
  }

  /**
   * Sync areas from store (e.g., after loading from localStorage).
   * Removes meshes for deleted or archived areas.
   */
  syncFromStore(): void {
    const state = store.getState();

    // Remove meshes for deleted OR archived areas
    for (const areaId of this.areaMeshes.keys()) {
      const area = state.areas.get(areaId);
      if (!area || area.archived) {
        this.removeAreaMesh(areaId);
      }
    }

    // Add/update meshes for visible (non-archived) areas only
    for (const area of state.areas.values()) {
      if (!area.archived) {
        this.renderArea(area);
      }
    }
  }

  // ============================================
  // Private Methods
  // ============================================

  private createPreview(_pos: { x: number; z: number }): void {
    this.previewMesh = new THREE.Group();
    this.scene.add(this.previewMesh);
  }

  private updatePreview(pos: { x: number; z: number }): void {
    if (!this.previewMesh || !this.drawStartPos) return;

    // Clear previous preview content
    while (this.previewMesh.children.length > 0) {
      const child = this.previewMesh.children[0];
      this.previewMesh.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const color = new THREE.Color('#4a9eff');

    if (this.currentTool === 'rectangle') {
      const width = Math.abs(pos.x - this.drawStartPos.x);
      const height = Math.abs(pos.z - this.drawStartPos.z);
      const centerX = (pos.x + this.drawStartPos.x) / 2;
      const centerZ = (pos.z + this.drawStartPos.z) / 2;

      if (width > 0.1 && height > 0.1) {
        // Fill
        const fillGeom = new THREE.PlaneGeometry(width, height);
        const fillMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        });
        const fill = new THREE.Mesh(fillGeom, fillMat);
        fill.rotation.x = -Math.PI / 2;
        fill.position.set(centerX, 0.02, centerZ);
        this.previewMesh.add(fill);

        // Border
        const borderPoints = [
          new THREE.Vector3(this.drawStartPos.x, 0.03, this.drawStartPos.z),
          new THREE.Vector3(pos.x, 0.03, this.drawStartPos.z),
          new THREE.Vector3(pos.x, 0.03, pos.z),
          new THREE.Vector3(this.drawStartPos.x, 0.03, pos.z),
          new THREE.Vector3(this.drawStartPos.x, 0.03, this.drawStartPos.z),
        ];
        const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
        const borderMat = new THREE.LineBasicMaterial({ color });
        const border = new THREE.Line(borderGeom, borderMat);
        this.previewMesh.add(border);
      }

    } else if (this.currentTool === 'circle') {
      const dx = pos.x - this.drawStartPos.x;
      const dz = pos.z - this.drawStartPos.z;
      const radius = Math.sqrt(dx * dx + dz * dz);

      if (radius > 0.1) {
        // Fill
        const fillGeom = new THREE.CircleGeometry(radius, 32);
        const fillMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        });
        const fill = new THREE.Mesh(fillGeom, fillMat);
        fill.rotation.x = -Math.PI / 2;
        fill.position.set(this.drawStartPos.x, 0.02, this.drawStartPos.z);
        this.previewMesh.add(fill);

        // Border
        const borderPoints: THREE.Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
          const angle = (i / 32) * Math.PI * 2;
          borderPoints.push(new THREE.Vector3(
            this.drawStartPos.x + Math.cos(angle) * radius,
            0.03,
            this.drawStartPos.z + Math.sin(angle) * radius
          ));
        }
        const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
        const borderMat = new THREE.LineBasicMaterial({ color });
        const border = new THREE.Line(borderGeom, borderMat);
        this.previewMesh.add(border);
      }
    }
  }

  private createAreaFromDraw(
    start: { x: number; z: number },
    end: { x: number; z: number }
  ): DrawingArea | null {
    const id = `area_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const areasCount = store.getState().areas.size;
    // New areas get the next zIndex (will be on top of existing areas)
    const nextZIndex = store.getNextZIndex();

    if (this.currentTool === 'rectangle') {
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.z - start.z);

      if (width < 0.5 || height < 0.5) return null;

      return {
        id,
        name: `Area ${areasCount + 1}`,
        type: 'rectangle',
        center: {
          x: (start.x + end.x) / 2,
          z: (start.z + end.z) / 2,
        },
        width,
        height,
        color: '#4a9eff',
        zIndex: nextZIndex,
        assignedAgentIds: [],
        directories: [],
      };

    } else if (this.currentTool === 'circle') {
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const radius = Math.sqrt(dx * dx + dz * dz);

      if (radius < 0.5) return null;

      return {
        id,
        name: `Area ${areasCount + 1}`,
        type: 'circle',
        center: { x: start.x, z: start.z },
        radius,
        color: '#4a9eff',
        zIndex: nextZIndex,
        assignedAgentIds: [],
        directories: [],
      };
    }

    return null;
  }

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
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
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
    this.cancelDrawing();
    this.removeResizeHandles();
    for (const areaId of this.areaMeshes.keys()) {
      this.removeAreaMesh(areaId);
    }
    // Clean up any remaining folder icon meshes
    for (const m of this.folderIconMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.folderIconMeshes = [];
  }
}
