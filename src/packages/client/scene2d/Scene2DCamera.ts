/**
 * Scene2DCamera - Handles viewport transformation for 2D view
 *
 * Manages pan, zoom, and coordinate conversion between screen and world space.
 * World coordinates: X = left/right, Z = up/down (matching 3D view's ground plane)
 *
 * Features:
 * - Smooth eased panning and zooming
 * - Pan/zoom limits to prevent going too far
 * - Focus on point with smooth animation
 * - Edge panning support
 * - Persistent state (saves/loads from localStorage)
 */

import { saveCameraState2D, loadCameraState2D } from '../utils/camera';

export class Scene2DCamera {
  // Viewport size (screen pixels)
  private viewportWidth: number;
  private viewportHeight: number;

  // Camera position in world space (center of viewport)
  private posX = 0;
  private posZ = 0;

  // Zoom level (pixels per world unit)
  private zoom = 30;
  private minZoom = 5;
  private maxZoom = 150;

  // Target values for smooth animation
  private targetPosX = 0;
  private targetPosZ = 0;
  private targetZoom = 30;

  // Easing configuration
  private panSmoothing = 0.12; // Lower = smoother but slower
  private zoomSmoothing = 0.15;
  private focusSmoothing = 0.08; // Slower for focus animations

  // Current smoothing (can be temporarily changed for focus)
  private currentPanSmoothing = 0.12;

  // Pan limits (world units from origin)
  private panLimitEnabled = true;
  private panLimitRadius = 50; // Max distance from origin

  // Edge panning
  private edgePanEnabled = false;
  private edgePanMargin = 40; // Pixels from edge
  private edgePanSpeed = 8; // World units per second
  private mouseScreenX = 0;
  private mouseScreenY = 0;

  // Animation state
  private isAnimating = false;
  private animationCallback: (() => void) | null = null;

  // Save throttle
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private needsSave = false;

  constructor(viewportWidth: number, viewportHeight: number) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;

    // Load saved state
    this.loadState();
  }

  /**
   * Load camera state from localStorage
   */
  private loadState(): void {
    const saved = loadCameraState2D();
    if (saved) {
      this.posX = saved.posX;
      this.posZ = saved.posZ;
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, saved.zoom));
      this.targetPosX = this.posX;
      this.targetPosZ = this.posZ;
      this.targetZoom = this.zoom;
    }
  }

  /**
   * Save camera state to localStorage (throttled)
   */
  private scheduleSave(): void {
    this.needsSave = true;
    if (this.saveTimeout) return;

    this.saveTimeout = setTimeout(() => {
      if (this.needsSave) {
        saveCameraState2D(this.posX, this.posZ, this.zoom);
        this.needsSave = false;
      }
      this.saveTimeout = null;
    }, 500); // Save at most every 500ms
  }

  /**
   * Force save camera state immediately
   */
  saveState(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    saveCameraState2D(this.posX, this.posZ, this.zoom);
    this.needsSave = false;
  }

  // ============================================
  // Viewport
  // ============================================

  setViewportSize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  getViewportSize(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight };
  }

  // ============================================
  // Position
  // ============================================

  getPosition(): { x: number; z: number } {
    return { x: this.posX, z: this.posZ };
  }

  setPosition(x: number, z: number): void {
    const clamped = this.clampPosition(x, z);
    this.posX = clamped.x;
    this.posZ = clamped.z;
    this.targetPosX = clamped.x;
    this.targetPosZ = clamped.z;
  }

  /**
   * Smoothly pan to a world position
   */
  panTo(x: number, z: number, animate = true): void {
    const clamped = this.clampPosition(x, z);
    if (animate) {
      this.targetPosX = clamped.x;
      this.targetPosZ = clamped.z;
      this.currentPanSmoothing = this.panSmoothing;
    } else {
      this.posX = clamped.x;
      this.posZ = clamped.z;
      this.targetPosX = clamped.x;
      this.targetPosZ = clamped.z;
    }
  }

  /**
   * Pan by screen delta (for drag panning)
   * Uses direct movement for responsive feel during drag
   */
  panBy(deltaX: number, deltaY: number): void {
    // Convert screen delta to world delta
    const worldDeltaX = deltaX / this.zoom;
    const worldDeltaZ = deltaY / this.zoom;

    // Direct update for responsive dragging
    const newX = this.posX - worldDeltaX;
    const newZ = this.posZ - worldDeltaZ;

    const clamped = this.clampPosition(newX, newZ);
    this.posX = clamped.x;
    this.posZ = clamped.z;
    this.targetPosX = clamped.x;
    this.targetPosZ = clamped.z;
  }

  /**
   * Focus on a world point with smooth animation
   * Optionally zoom to a specific level
   */
  focusOn(x: number, z: number, targetZoom?: number, callback?: () => void): void {
    this.isAnimating = true;
    this.animationCallback = callback || null;
    this.currentPanSmoothing = this.focusSmoothing;

    const clamped = this.clampPosition(x, z);
    this.targetPosX = clamped.x;
    this.targetPosZ = clamped.z;

    if (targetZoom !== undefined) {
      this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
    }
  }

  /**
   * Focus on a bounding box (fits the box in view with padding)
   */
  focusOnBounds(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    padding = 2
  ): void {
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    const boundsWidth = maxX - minX + padding * 2;
    const boundsHeight = maxZ - minZ + padding * 2;

    // Calculate zoom to fit bounds
    const zoomX = this.viewportWidth / boundsWidth;
    const zoomZ = this.viewportHeight / boundsHeight;
    const newZoom = Math.min(zoomX, zoomZ) * 0.9; // 90% to leave some margin

    this.focusOn(centerX, centerZ, Math.max(this.minZoom, Math.min(this.maxZoom, newZoom)));
  }

  // ============================================
  // Zoom
  // ============================================

  getZoom(): number {
    return this.zoom;
  }

  getZoomLimits(): { min: number; max: number } {
    return { min: this.minZoom, max: this.maxZoom };
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this.targetZoom = this.zoom;
  }

  setZoomLimits(min: number, max: number): void {
    this.minZoom = min;
    this.maxZoom = max;
    // Re-clamp current zoom
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom));
  }

  zoomTo(zoom: number, animate = true): void {
    const clampedZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    if (animate) {
      this.targetZoom = clampedZoom;
    } else {
      this.zoom = clampedZoom;
      this.targetZoom = clampedZoom;
    }
  }

  /**
   * Zoom towards a specific screen point (for mouse wheel zoom)
   * Smoothly animates to the new zoom level
   */
  zoomAtPoint(screenX: number, screenY: number, zoomDelta: number, animate = true): void {
    // Calculate new zoom level
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * (1 + zoomDelta)));

    if (animate) {
      // Get world position under cursor at current zoom
      const worldPos = this.screenToWorld(screenX, screenY);

      // Set target zoom
      this.targetZoom = newZoom;

      // Calculate where the cursor would be at new zoom with current position
      // We need to adjust target position so the same world point stays under cursor
      const centerX = this.viewportWidth / 2;
      const centerY = this.viewportHeight / 2;

      // World position under cursor after zoom (if camera doesn't move)
      const newWorldX = this.targetPosX + (screenX - centerX) / newZoom;
      const newWorldZ = this.targetPosZ + (screenY - centerY) / newZoom;

      // Adjust camera target to keep same world point under cursor
      const offsetX = worldPos.x - newWorldX;
      const offsetZ = worldPos.z - newWorldZ;

      const clamped = this.clampPosition(this.targetPosX + offsetX, this.targetPosZ + offsetZ);
      this.targetPosX = clamped.x;
      this.targetPosZ = clamped.z;
    } else {
      // Instant zoom (used during continuous wheel scrolling for responsiveness)
      const worldBefore = this.screenToWorld(screenX, screenY);
      this.zoom = newZoom;
      this.targetZoom = newZoom;
      const worldAfter = this.screenToWorld(screenX, screenY);

      const clamped = this.clampPosition(
        this.posX + worldBefore.x - worldAfter.x,
        this.posZ + worldBefore.z - worldAfter.z
      );
      this.posX = clamped.x;
      this.posZ = clamped.z;
      this.targetPosX = clamped.x;
      this.targetPosZ = clamped.z;
    }
  }

  // ============================================
  // Pan Limits
  // ============================================

  setPanLimits(enabled: boolean, radius?: number): void {
    this.panLimitEnabled = enabled;
    if (radius !== undefined) {
      this.panLimitRadius = radius;
    }
  }

  getPanLimits(): { enabled: boolean; radius: number } {
    return { enabled: this.panLimitEnabled, radius: this.panLimitRadius };
  }

  /**
   * Clamp position within pan limits
   */
  private clampPosition(x: number, z: number): { x: number; z: number } {
    if (!this.panLimitEnabled) {
      return { x, z };
    }

    // Clamp to a square area (simpler and faster than circular)
    const clampedX = Math.max(-this.panLimitRadius, Math.min(this.panLimitRadius, x));
    const clampedZ = Math.max(-this.panLimitRadius, Math.min(this.panLimitRadius, z));

    return { x: clampedX, z: clampedZ };
  }

  // ============================================
  // Edge Panning
  // ============================================

  setEdgePanning(enabled: boolean, margin?: number, speed?: number): void {
    this.edgePanEnabled = enabled;
    if (margin !== undefined) this.edgePanMargin = margin;
    if (speed !== undefined) this.edgePanSpeed = speed;
  }

  getEdgePanSettings(): { enabled: boolean; margin: number; speed: number } {
    return {
      enabled: this.edgePanEnabled,
      margin: this.edgePanMargin,
      speed: this.edgePanSpeed,
    };
  }

  /**
   * Update mouse position for edge panning
   */
  setMousePosition(screenX: number, screenY: number): void {
    this.mouseScreenX = screenX;
    this.mouseScreenY = screenY;
  }

  /**
   * Process edge panning (call each frame)
   */
  private processEdgePanning(deltaTime: number): void {
    if (!this.edgePanEnabled) return;

    let panX = 0;
    let panZ = 0;

    // Check edges
    if (this.mouseScreenX < this.edgePanMargin) {
      panX = -1 * (1 - this.mouseScreenX / this.edgePanMargin);
    } else if (this.mouseScreenX > this.viewportWidth - this.edgePanMargin) {
      panX = 1 * (1 - (this.viewportWidth - this.mouseScreenX) / this.edgePanMargin);
    }

    if (this.mouseScreenY < this.edgePanMargin) {
      panZ = -1 * (1 - this.mouseScreenY / this.edgePanMargin);
    } else if (this.mouseScreenY > this.viewportHeight - this.edgePanMargin) {
      panZ = 1 * (1 - (this.viewportHeight - this.mouseScreenY) / this.edgePanMargin);
    }

    if (panX !== 0 || panZ !== 0) {
      const speed = this.edgePanSpeed * deltaTime;
      const newX = this.targetPosX + panX * speed;
      const newZ = this.targetPosZ + panZ * speed;
      const clamped = this.clampPosition(newX, newZ);
      this.targetPosX = clamped.x;
      this.targetPosZ = clamped.z;
    }
  }

  // ============================================
  // Coordinate Conversion
  // ============================================

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): { x: number; z: number } {
    const centerX = this.viewportWidth / 2;
    const centerY = this.viewportHeight / 2;

    const worldX = this.posX + (screenX - centerX) / this.zoom;
    const worldZ = this.posZ + (screenY - centerY) / this.zoom;

    return { x: worldX, z: worldZ };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(worldX: number, worldZ: number): { x: number; y: number } {
    const centerX = this.viewportWidth / 2;
    const centerY = this.viewportHeight / 2;

    const screenX = centerX + (worldX - this.posX) * this.zoom;
    const screenY = centerY + (worldZ - this.posZ) * this.zoom;

    return { x: screenX, y: screenY };
  }

  /**
   * Get the visible world bounds
   */
  getVisibleBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const halfWidth = this.viewportWidth / 2 / this.zoom;
    const halfHeight = this.viewportHeight / 2 / this.zoom;

    return {
      minX: this.posX - halfWidth,
      maxX: this.posX + halfWidth,
      minZ: this.posZ - halfHeight,
      maxZ: this.posZ + halfHeight,
    };
  }

  /**
   * Check if a world point is visible
   */
  isVisible(worldX: number, worldZ: number, margin = 0): boolean {
    const bounds = this.getVisibleBounds();
    return (
      worldX >= bounds.minX - margin &&
      worldX <= bounds.maxX + margin &&
      worldZ >= bounds.minZ - margin &&
      worldZ <= bounds.maxZ + margin
    );
  }

  // ============================================
  // Animation Update
  // ============================================

  /**
   * Update camera state (call each frame)
   * Uses exponential easing for smooth movement
   * Returns true if camera moved (for render optimization)
   */
  update(deltaTime = 1 / 60): boolean {
    // Process edge panning
    this.processEdgePanning(deltaTime);

    // Calculate easing factor based on delta time for frame-rate independence
    // Using exponential decay: factor = 1 - e^(-speed * dt)
    const panFactor = 1 - Math.exp(-this.currentPanSmoothing * 60 * deltaTime);
    const zoomFactor = 1 - Math.exp(-this.zoomSmoothing * 60 * deltaTime);

    // Smooth interpolation towards target
    const prevPosX = this.posX;
    const prevPosZ = this.posZ;
    const prevZoom = this.zoom;

    this.posX += (this.targetPosX - this.posX) * panFactor;
    this.posZ += (this.targetPosZ - this.posZ) * panFactor;
    this.zoom += (this.targetZoom - this.zoom) * zoomFactor;

    // Check if animation is complete (close enough to target)
    const posThreshold = 0.001;
    const zoomThreshold = 0.01;

    const isPosComplete =
      Math.abs(this.posX - this.targetPosX) < posThreshold &&
      Math.abs(this.posZ - this.targetPosZ) < posThreshold;
    const isZoomComplete = Math.abs(this.zoom - this.targetZoom) < zoomThreshold;

    if (this.isAnimating && isPosComplete && isZoomComplete) {
      // Snap to target
      this.posX = this.targetPosX;
      this.posZ = this.targetPosZ;
      this.zoom = this.targetZoom;

      this.isAnimating = false;
      this.currentPanSmoothing = this.panSmoothing;

      if (this.animationCallback) {
        this.animationCallback();
        this.animationCallback = null;
      }
    }

    // Check if camera moved
    const moved =
      Math.abs(this.posX - prevPosX) > 0.0001 ||
      Math.abs(this.posZ - prevPosZ) > 0.0001 ||
      Math.abs(this.zoom - prevZoom) > 0.0001;

    // Schedule save if position changed
    if (moved) {
      this.scheduleSave();
    }

    return moved;
  }

  /**
   * Check if camera is currently animating
   */
  isCurrentlyAnimating(): boolean {
    const posThreshold = 0.01;
    const zoomThreshold = 0.1;

    return (
      Math.abs(this.posX - this.targetPosX) > posThreshold ||
      Math.abs(this.posZ - this.targetPosZ) > posThreshold ||
      Math.abs(this.zoom - this.targetZoom) > zoomThreshold
    );
  }

  // ============================================
  // Canvas Transform
  // ============================================

  /**
   * Apply camera transform to canvas context
   * Call this before drawing world-space elements
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    // Translate to center of viewport
    ctx.translate(this.viewportWidth / 2, this.viewportHeight / 2);
    // Apply zoom
    ctx.scale(this.zoom, this.zoom);
    // Translate by camera position (inverted)
    ctx.translate(-this.posX, -this.posZ);
  }

  /**
   * Restore canvas context after drawing
   */
  restoreTransform(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }
}
