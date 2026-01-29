/**
 * Scene2DInput - Handles mouse/touch input for 2D view
 *
 * Supports: click, double-click, right-click, pan, zoom, selection box
 */

import type { Scene2D } from './Scene2D';
import type { Scene2DCamera } from './Scene2DCamera';
import { store } from '../store';

interface SelectionBox {
  start: { x: number; z: number };
  end: { x: number; z: number };
}

export class Scene2DInput {
  private canvas: HTMLCanvasElement;
  private camera: Scene2DCamera;
  private scene: Scene2D;

  // Mouse state
  private isMouseDown = false;
  private isPanning = false;
  private isSelecting = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private mouseDownX = 0;
  private mouseDownY = 0;
  private mouseDownTime = 0;

  // Double click detection
  private lastClickTime = 0;
  private lastClickTarget: string | null = null;
  private doubleClickDelay = 400; // Increased from 300 for better detection

  // Selection box
  private selectionBox: SelectionBox | null = null;

  // Hover state
  private hoveredAgentId: string | null = null;
  private hoveredBuildingId: string | null = null;

  // Edge panning state
  private isMouseInCanvas = false;

  constructor(canvas: HTMLCanvasElement, camera: Scene2DCamera, scene: Scene2D) {
    this.canvas = canvas;
    this.camera = camera;
    this.scene = scene;

    this.setupEventListeners();
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);

    // Touch events
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd);
  }

  // ============================================
  // Mouse Events
  // ============================================

  private onMouseDown = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.isMouseDown = true;
    this.mouseDownX = x;
    this.mouseDownY = y;
    this.lastMouseX = x;
    this.lastMouseY = y;
    this.mouseDownTime = Date.now();

    // Middle mouse button = pan
    if (e.button === 1) {
      this.isPanning = true;
      this.canvas.classList.add('panning');
      e.preventDefault();
      return;
    }

    // Left click handling
    if (e.button === 0) {
      const worldPos = this.camera.screenToWorld(x, y);

      // Check if in drawing mode
      if (this.scene.isInDrawingMode()) {
        this.scene.startDrawing(worldPos);
        return;
      }

      const agent = this.scene.getAgentAtScreenPos(x, y);
      const building = this.scene.getBuildingAtScreenPos(x, y);

      if (!agent && !building) {
        // Will start selection box on drag
        this.isSelecting = false; // Start as false, becomes true on drag
        this.selectionBox = {
          start: { ...worldPos },
          end: { ...worldPos },
        };
      }
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Update camera mouse position for edge panning
    this.camera.setMousePosition(x, y);
    this.isMouseInCanvas = true;

    // Hover detection for agents
    const agent = this.scene.getAgentAtScreenPos(x, y);
    const newHoveredAgentId = agent?.id ?? null;

    if (newHoveredAgentId !== this.hoveredAgentId) {
      this.hoveredAgentId = newHoveredAgentId;
      this.scene.handleAgentHover(
        newHoveredAgentId,
        newHoveredAgentId ? { x: e.clientX, y: e.clientY } : null
      );
    }

    // Hover detection for buildings
    const building = this.scene.getBuildingAtScreenPos(x, y);
    const newHoveredBuildingId = building?.id ?? null;

    if (newHoveredBuildingId !== this.hoveredBuildingId) {
      this.hoveredBuildingId = newHoveredBuildingId;
      this.scene.handleBuildingHover?.(newHoveredBuildingId);
    }

    if (!this.isMouseDown) {
      this.lastMouseX = x;
      this.lastMouseY = y;
      return;
    }

    const deltaX = x - this.lastMouseX;
    const deltaY = y - this.lastMouseY;
    const worldPos = this.camera.screenToWorld(x, y);

    // Handle drawing mode
    if (this.scene.isCurrentlyDrawing()) {
      this.scene.updateDrawing(worldPos);
      this.lastMouseX = x;
      this.lastMouseY = y;
      return;
    }

    // Panning (middle mouse)
    if (this.isPanning) {
      this.camera.panBy(deltaX, deltaY);
    }
    // Selection box (left click drag on ground)
    else if (this.selectionBox) {
      const distFromStart = Math.sqrt(
        Math.pow(x - this.mouseDownX, 2) + Math.pow(y - this.mouseDownY, 2)
      );

      // Start selection mode after moving a bit
      if (distFromStart > 5 && !this.isSelecting) {
        this.isSelecting = true;
        this.canvas.classList.add('selecting');
      }

      if (this.isSelecting) {
        this.selectionBox.end = { ...worldPos };
      }
    }

    this.lastMouseX = x;
    this.lastMouseY = y;
  };

  private onMouseUp = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const worldPos = this.camera.screenToWorld(x, y);

    // Check for drawing completion
    if (this.scene.isCurrentlyDrawing()) {
      this.scene.finishDrawing(worldPos);
      this.isMouseDown = false;
      return;
    }

    const wasSelecting = this.isSelecting;
    const wasPanning = this.isPanning;

    // Check for selection box completion
    if (wasSelecting && this.selectionBox) {
      this.scene.handleSelectionBox(this.selectionBox.start, this.selectionBox.end);
      this.selectionBox = null;
    }

    // Check for click (not pan/select)
    if (!wasPanning && !wasSelecting && e.button === 0) {
      const clickDuration = Date.now() - this.mouseDownTime;
      const distFromStart = Math.sqrt(
        Math.pow(x - this.mouseDownX, 2) + Math.pow(y - this.mouseDownY, 2)
      );

      // Only treat as click if relatively quick and didn't move much
      // Allow up to 500ms for click (increased from 300 for better double-click detection)
      if (clickDuration < 500 && distFromStart < 10) {
        this.handleClick(x, y, e.shiftKey);
      }
    }

    this.isMouseDown = false;
    this.isPanning = false;
    this.isSelecting = false;
    this.canvas.classList.remove('panning', 'selecting');
  };

  private onMouseLeave = (): void => {
    this.isMouseDown = false;
    this.isPanning = false;
    this.isSelecting = false;
    this.selectionBox = null;
    this.isMouseInCanvas = false;
    this.canvas.classList.remove('panning', 'selecting');

    // Clear hover states
    if (this.hoveredAgentId) {
      this.hoveredAgentId = null;
      this.scene.handleAgentHover(null, null);
    }
    if (this.hoveredBuildingId) {
      this.hoveredBuildingId = null;
      this.scene.handleBuildingHover?.(null);
    }

    // Reset mouse position for edge panning (center to prevent accidental pan)
    const { width, height } = this.camera.getViewportSize();
    this.camera.setMousePosition(width / 2, height / 2);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Detect trackpad vs mouse wheel:
    // - Trackpad: ctrlKey=false, smaller deltaY, often has deltaX
    // - Mouse wheel: typically larger deltaY, no deltaX
    // - Pinch zoom on trackpad: ctrlKey=true
    const isTrackpadPan = !e.ctrlKey && (
      Math.abs(e.deltaX) > 0 || // Has horizontal scroll
      (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) // Small pixel-based vertical scroll
    );

    if (e.ctrlKey) {
      // Pinch to zoom on trackpad (ctrl+wheel)
      const zoomDelta = -e.deltaY * 0.01;
      this.camera.zoomAtPoint(x, y, zoomDelta);
    } else if (isTrackpadPan) {
      // Two-finger pan on trackpad
      this.camera.panBy(-e.deltaX, -e.deltaY);
    } else {
      // Mouse wheel zoom
      const zoomDelta = -e.deltaY * 0.001;
      this.camera.zoomAtPoint(x, y, zoomDelta);
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const worldPos = this.camera.screenToWorld(x, y);
    const agent = this.scene.getAgentAtScreenPos(x, y);
    const building = this.scene.getBuildingAtScreenPos(x, y);

    let target: { type: string; id?: string } | null = null;
    if (agent) {
      target = { type: 'agent', id: agent.id };
    } else if (building) {
      target = { type: 'building', id: building.id };
    }

    this.scene.handleContextMenu(
      { x: e.clientX, y: e.clientY },
      { x: worldPos.x, z: worldPos.z },
      target
    );
    // Context menu will handle move commands via App.tsx, don't auto-move here
  };

  // ============================================
  // Touch Events
  // ============================================

  private touchStartPositions: Array<{ x: number; y: number }> = [];
  private initialPinchDistance = 0;

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    this.touchStartPositions = Array.from(e.touches).map(t => ({
      x: t.clientX - rect.left,
      y: t.clientY - rect.top,
    }));

    if (e.touches.length === 1) {
      const x = this.touchStartPositions[0].x;
      const y = this.touchStartPositions[0].y;
      this.mouseDownX = x;
      this.mouseDownY = y;
      this.lastMouseX = x;
      this.lastMouseY = y;
      this.mouseDownTime = Date.now();
      this.isMouseDown = true;
    } else if (e.touches.length === 2) {
      // Pinch zoom
      this.initialPinchDistance = this.getPinchDistance(e.touches);
      this.isPanning = false;
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();

    if (e.touches.length === 1) {
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;

      const deltaX = x - this.lastMouseX;
      const deltaY = y - this.lastMouseY;

      // Pan
      this.camera.panBy(deltaX, deltaY);

      this.lastMouseX = x;
      this.lastMouseY = y;
    } else if (e.touches.length === 2) {
      // Pinch zoom
      const currentDistance = this.getPinchDistance(e.touches);
      const zoomDelta = (currentDistance - this.initialPinchDistance) * 0.01;

      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

      this.camera.zoomAtPoint(centerX, centerY, zoomDelta);
      this.initialPinchDistance = currentDistance;
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length === 0 && this.touchStartPositions.length === 1) {
      const clickDuration = Date.now() - this.mouseDownTime;
      const distFromStart = Math.sqrt(
        Math.pow(this.lastMouseX - this.mouseDownX, 2) +
        Math.pow(this.lastMouseY - this.mouseDownY, 2)
      );

      // Tap = click
      if (clickDuration < 300 && distFromStart < 20) {
        this.handleClick(this.lastMouseX, this.lastMouseY, false);
      }
    }

    this.isMouseDown = false;
    this.isPanning = false;
    this.touchStartPositions = [];
  };

  private getPinchDistance(touches: TouchList): number {
    return Math.sqrt(
      Math.pow(touches[0].clientX - touches[1].clientX, 2) +
      Math.pow(touches[0].clientY - touches[1].clientY, 2)
    );
  }

  // ============================================
  // Click Handling
  // ============================================

  private handleClick(screenX: number, screenY: number, shiftKey: boolean): void {
    const agent = this.scene.getAgentAtScreenPos(screenX, screenY);
    const building = this.scene.getBuildingAtScreenPos(screenX, screenY);
    const now = Date.now();

    if (agent) {
      // Check for double-click
      if (
        this.lastClickTarget === agent.id &&
        now - this.lastClickTime < this.doubleClickDelay
      ) {
        // Focus camera on agent with smooth animation
        this.focusCameraOnAgent(agent.id);
        // Open terminal directly via store (same as 3D scene)
        if (window.innerWidth <= 768) {
          store.openTerminalOnMobile(agent.id);
        } else {
          store.selectAgent(agent.id);
          store.setTerminalOpen(true);
        }
        // Also trigger the callback for any additional handling
        this.scene.handleAgentDoubleClick(agent.id);
        this.lastClickTime = 0;
        this.lastClickTarget = null;
      } else {
        this.scene.handleAgentClick(agent.id, shiftKey);
        this.lastClickTime = now;
        this.lastClickTarget = agent.id;
      }
    } else if (building) {
      // Check for double-click
      if (
        this.lastClickTarget === building.id &&
        now - this.lastClickTime < this.doubleClickDelay
      ) {
        // Focus camera on building with smooth animation
        this.focusCameraOnBuilding(building.id);
        this.scene.handleBuildingDoubleClick(building.id);
        this.lastClickTime = 0;
        this.lastClickTarget = null;
      } else {
        const rect = this.canvas.getBoundingClientRect();
        this.scene.handleBuildingClick(building.id, {
          x: screenX + rect.left,
          y: screenY + rect.top,
        });
        this.lastClickTime = now;
        this.lastClickTarget = building.id;
      }
    } else {
      // Ground click
      const worldPos = this.camera.screenToWorld(screenX, screenY);
      this.scene.handleGroundClick({ x: worldPos.x, z: worldPos.z });
      this.lastClickTime = 0;
      this.lastClickTarget = null;
    }
  }

  /**
   * Focus camera smoothly on an agent
   */
  private focusCameraOnAgent(agentId: string): void {
    const agentData = this.scene.getAgentData(agentId);
    if (agentData) {
      // Focus on agent position with a nice zoom level
      this.camera.focusOn(agentData.position.x, agentData.position.z, 50);
    }
  }

  /**
   * Focus camera smoothly on a building
   */
  private focusCameraOnBuilding(buildingId: string): void {
    const buildingData = this.scene.getBuildingData(buildingId);
    if (buildingData) {
      // Focus on building position with a nice zoom level
      this.camera.focusOn(buildingData.position.x, buildingData.position.z, 40);
    }
  }

  // ============================================
  // Public API
  // ============================================

  getSelectionBox(): SelectionBox | null {
    return this.selectionBox;
  }
}
