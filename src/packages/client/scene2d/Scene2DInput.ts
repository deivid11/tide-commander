/**
 * Scene2DInput - Handles mouse/touch input for 2D view
 *
 * Supports: click, double-click, right-click, pan, zoom, selection box
 */

import type { Scene2D } from './Scene2D';
import type { Scene2DCamera } from './Scene2DCamera';
import { store } from '../store';
import { matchesShortcut } from '../store/shortcuts';
import { getStorage, STORAGE_KEYS } from '../utils/storage';

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

  // Feature flags
  private static readonly ENABLE_DOUBLE_CLICK_CAMERA_FOCUS = false; // Set to true to enable camera zoom/pan on double-click

  // Selection box
  private selectionBox: SelectionBox | null = null;

  // Hover state
  private hoveredAgentId: string | null = null;
  private hoveredBuildingId: string | null = null;

  // Edge panning state
  private isMouseInCanvas = false;

  // Area resize/move state
  private isResizingArea = false;
  private resizeHandleType: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'radius' | null = null;

  // Building drag state
  private isDraggingBuilding = false;
  private draggingBuildingId: string | null = null;
  private buildingDragStartPos: { x: number; z: number } | null = null;

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
    document.removeEventListener('keydown', this.onKeyDown, true);
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

    // Keyboard events (for space key to open terminal)
    // Use capture phase so global shortcuts (like spotlight) are processed first
    document.addEventListener('keydown', this.onKeyDown, true);
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

      // Check if clicking on a resize handle (when area is selected)
      const handle = this.scene.getAreaHandleAtWorldPos(worldPos.x, worldPos.z);
      if (handle) {
        this.isResizingArea = true;
        this.resizeHandleType = handle.handleType;
        this.scene.startAreaResize(handle.handleType, worldPos);
        const ht = handle.handleType;
        this.canvas.style.cursor = ht === 'move' ? 'move'
          : (ht === 'n' || ht === 's') ? 'ns-resize'
          : (ht === 'e' || ht === 'w' || ht === 'radius') ? 'ew-resize'
          : (ht === 'ne' || ht === 'sw') ? 'nesw-resize'
          : 'nwse-resize';
        return;
      }

      const agent = this.scene.getAgentAtScreenPos(x, y);
      const building = this.scene.getBuildingAtScreenPos(x, y);

      // Start tracking building for potential drag
      if (building && !agent) {
        this.draggingBuildingId = building.id;
        this.buildingDragStartPos = { ...worldPos };
        this.isDraggingBuilding = false;
        return;
      }

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

    // Hover detection for area resize handles (update cursor)
    if (!this.isMouseDown) {
      const worldPos = this.camera.screenToWorld(x, y);
      const handle = this.scene.getAreaHandleAtWorldPos(worldPos.x, worldPos.z);
      if (handle) {
        if (handle.handleType === 'move') {
          this.canvas.style.cursor = 'move';
        } else if (handle.handleType === 'nw' || handle.handleType === 'se') {
          this.canvas.style.cursor = 'nwse-resize';
        } else if (handle.handleType === 'ne' || handle.handleType === 'sw') {
          this.canvas.style.cursor = 'nesw-resize';
        } else if (handle.handleType === 'n' || handle.handleType === 's') {
          this.canvas.style.cursor = 'ns-resize';
        } else if (handle.handleType === 'e' || handle.handleType === 'w' || handle.handleType === 'radius') {
          this.canvas.style.cursor = 'ew-resize';
        }
      } else {
        this.canvas.style.cursor = '';
      }
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

    // Handle area resizing/moving
    if (this.isResizingArea) {
      this.scene.updateAreaResize(worldPos);
      this.lastMouseX = x;
      this.lastMouseY = y;
      return;
    }

    // Handle building drag
    if (this.draggingBuildingId && this.buildingDragStartPos) {
      const dx = worldPos.x - this.buildingDragStartPos.x;
      const dz = worldPos.z - this.buildingDragStartPos.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Start dragging after moving a bit (threshold ~0.5 world units)
      if (!this.isDraggingBuilding && distance > 0.5) {
        this.isDraggingBuilding = true;
        this.scene.handleBuildingDragStart(this.draggingBuildingId, this.buildingDragStartPos);
        this.canvas.style.cursor = 'move';
      }

      if (this.isDraggingBuilding) {
        this.scene.handleBuildingDragMove(this.draggingBuildingId, worldPos);
      }

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

    // Check for area resize completion
    if (this.isResizingArea) {
      this.scene.finishAreaResize();
      this.isResizingArea = false;
      this.resizeHandleType = null;
      this.canvas.style.cursor = '';
      this.isMouseDown = false;
      return;
    }

    // Check for building drag completion
    if (this.draggingBuildingId) {
      if (this.isDraggingBuilding) {
        this.scene.handleBuildingDragEnd(this.draggingBuildingId, worldPos);
        this.draggingBuildingId = null;
        this.buildingDragStartPos = null;
        this.isDraggingBuilding = false;
        this.canvas.style.cursor = '';
        this.isMouseDown = false;
        return;
      } else {
        // Was a click, not a drag - let handleClick process it for double-click detection
        this.draggingBuildingId = null;
        this.buildingDragStartPos = null;
        this.isDraggingBuilding = false;
        this.canvas.style.cursor = '';
        // Fall through to handleClick below
      }
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
    this.canvas.style.cursor = '';

    // Finish any in-progress area resize
    if (this.isResizingArea) {
      this.scene.finishAreaResize();
      this.isResizingArea = false;
      this.resizeHandleType = null;
    }

    // Finish any in-progress building drag
    if (this.isDraggingBuilding && this.draggingBuildingId) {
      // Cancel the drag on mouse leave (don't move the building)
      this.scene.handleBuildingDragCancel?.(this.draggingBuildingId);
    }
    this.draggingBuildingId = null;
    this.buildingDragStartPos = null;
    this.isDraggingBuilding = false;

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
    const area = this.scene.getAreaAtScreenPos(x, y);

    // If agents are selected and right-clicking anywhere (not on another agent or building), move them
    // Areas don't block move commands - you should be able to move agents into/within areas
    const state = store.getState();
    if (state.selectedAgentIds.size > 0 && !agent && !building) {
      // Issue move command to selected agents
      this.scene.handleMoveCommand({ x: worldPos.x, z: worldPos.z });
      // Create visual effect at target position
      this.scene.createMoveOrderEffect({ x: worldPos.x, z: worldPos.z });
      return;
    }

    // No agents selected or clicked on an entity/area - show context menu
    let target: { type: string; id?: string } | null = null;
    if (agent) {
      target = { type: 'agent', id: agent.id };
    } else if (building) {
      target = { type: 'building', id: building.id };
    } else if (area) {
      target = { type: 'area', id: area.id };
    }

    this.scene.handleContextMenu(
      { x: e.clientX, y: e.clientY },
      { x: worldPos.x, z: worldPos.z },
      target
    );
  };

  // ============================================
  // Keyboard Events
  // ============================================

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    const state = store.getState();

    // Check if we're in an input field
    const isInInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    const guakeTerminal = target.closest('.guake-terminal');
    const isCollapsedTerminal = guakeTerminal?.classList.contains('collapsed');

    // Don't handle if typing in an input field (with exceptions)
    const shortcuts = store.getShortcuts();
    const nextAgentShortcut = shortcuts.find(s => s.id === 'next-agent');
    const prevAgentShortcut = shortcuts.find(s => s.id === 'prev-agent');
    const openTerminalShortcut = shortcuts.find(s => s.id === 'open-terminal');
    const spotlightShortcut = shortcuts.find(s => s.id === 'toggle-spotlight');

    // Allow global shortcuts to pass through (let other handlers deal with them)
    if (matchesShortcut(event, spotlightShortcut)) {
      console.log('[Scene2DInput] Spotlight shortcut detected, passing through');
      return; // Let useKeyboardShortcuts handle spotlight
    }

    if (isInInputField) {
      // Exception: agent nav shortcuts in collapsed terminal input - blur and continue for navigation
      const isAltNavKey = matchesShortcut(event, nextAgentShortcut)
        || matchesShortcut(event, prevAgentShortcut);

      if (isAltNavKey && isCollapsedTerminal) {
        (target as HTMLInputElement | HTMLTextAreaElement).blur();
      } else {
        return;
      }
    }

    // Agent navigation (works when terminal is closed)
    if ((matchesShortcut(event, nextAgentShortcut) || matchesShortcut(event, prevAgentShortcut)) && !state.terminalOpen) {
      const orderedAgents = this.getOrderedAgents(state.agents);
      if (orderedAgents.length <= 1) return;

      const selectedId = state.selectedAgentIds.size === 1
        ? Array.from(state.selectedAgentIds)[0]
        : null;
      const currentIndex = selectedId ? orderedAgents.findIndex(a => a.id === selectedId) : -1;

      let nextIndex: number;
      if (matchesShortcut(event, nextAgentShortcut)) {
        nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % orderedAgents.length;
      } else {
        nextIndex = currentIndex === -1 ? orderedAgents.length - 1 : (currentIndex - 1 + orderedAgents.length) % orderedAgents.length;
      }

      event.preventDefault();
      store.selectAgent(orderedAgents[nextIndex].id);
      return;
    }

    // Open terminal
    if (matchesShortcut(event, openTerminalShortcut)) {
      console.log('[Scene2DInput] Space pressed', {
        guakeTerminal: !!guakeTerminal,
        isCollapsedTerminal,
        targetTag: target.tagName,
        terminalOpen: state.terminalOpen,
        selectedAgents: state.selectedAgentIds.size,
        selectedBuildings: state.selectedBuildingIds.size,
        selectedArea: state.selectedAreaId,
        lastSelectedAgentId: state.lastSelectedAgentId,
      });

      // Don't trigger if inside an open terminal
      if (guakeTerminal && !isCollapsedTerminal) {
        console.log('[Scene2DInput] Space: blocked - inside open terminal');
        return;
      }

      // Don't trigger if any interactive element has focus (buttons, links, etc.)
      if (target.tagName === 'BUTTON' || target.tagName === 'A') {
        console.log('[Scene2DInput] Space: blocked - button/link focused');
        return;
      }

      // Only OPEN the terminal with Space (use backtick or Escape to close)
      if (state.terminalOpen) {
        console.log('[Scene2DInput] Space: blocked - terminal already open');
        return;
      }

      // Don't trigger if a building or area is focused (let other handlers deal with it)
      if (state.selectedBuildingIds.size > 0 || state.selectedAreaId !== null) {
        console.log('[Scene2DInput] Space: blocked - building or area focused');
        return;
      }

      // If no agent selected, select the last active agent
      if (state.selectedAgentIds.size === 0) {
        const lastAgentId = state.lastSelectedAgentId;
        console.log('[Scene2DInput] Space: no agent selected, trying lastAgentId:', lastAgentId);
        if (lastAgentId && state.agents.has(lastAgentId)) {
          event.preventDefault();
          store.selectAgent(lastAgentId);
          store.setTerminalOpen(true);
          console.log('[Scene2DInput] Space: opened terminal for last agent:', lastAgentId);
        } else {
          console.log('[Scene2DInput] Space: no valid last agent to open');
        }
        return;
      }

      // Prevent page scroll
      event.preventDefault();

      // Open terminal
      console.log('[Scene2DInput] Space: opening terminal for selected agent');
      store.setTerminalOpen(true);
    }
  };

  /**
   * Get agents ordered by creation time (for Alt+H/L navigation)
   */
  private getOrderedAgents(agentsMap: Map<string, any>): any[] {
    const agents = Array.from(agentsMap.values());
    const currentAgentIds = new Set(agents.map((a: any) => a.id));

    // Get saved order from localStorage
    const savedOrder = getStorage<string[]>(STORAGE_KEYS.AGENT_ORDER, []);
    const validSavedOrder = savedOrder.filter(id => currentAgentIds.has(id));

    // New agents not in saved order - sort by creation time
    const newAgents = agents
      .filter((a: any) => !validSavedOrder.includes(a.id))
      .sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0));
    const newAgentIds = newAgents.map((a: any) => a.id);

    const finalOrder = [...validSavedOrder, ...newAgentIds];
    const agentMap = new Map(agents.map((a: any) => [a.id, a]));
    const orderedAgents = finalOrder
      .map(id => agentMap.get(id))
      .filter((a): a is any => a !== undefined);

    // Group by area (matching useSwipeNavigation order)
    const groups = new Map<string | null, { area: { name: string } | null; agents: any[] }>();
    for (const agent of orderedAgents) {
      const area = store.getAreaForAgent(agent.id);
      const areaKey = area?.id || null;
      if (!groups.has(areaKey)) {
        groups.set(areaKey, { area: area ? { name: area.name } : null, agents: [] });
      }
      groups.get(areaKey)!.agents.push(agent);
    }

    const groupArray = Array.from(groups.values());
    groupArray.sort((a, b) => {
      if (!a.area && b.area) return 1;
      if (a.area && !b.area) return -1;
      if (!a.area && !b.area) return 0;
      return (a.area?.name || '').localeCompare(b.area?.name || '');
    });

    return groupArray.flatMap(group => group.agents);
  }

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
        // Focus camera on agent with smooth animation (if enabled)
        if (Scene2DInput.ENABLE_DOUBLE_CLICK_CAMERA_FOCUS) {
          this.focusCameraOnAgent(agent.id);
        }
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
        // Focus camera on building with smooth animation (if enabled)
        if (Scene2DInput.ENABLE_DOUBLE_CLICK_CAMERA_FOCUS) {
          this.focusCameraOnBuilding(building.id);
        }
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
      // Check if clicking on a folder icon first (takes priority over area selection)
      const folderAreaId = this.scene.getAreaFolderIconAtScreenPos(screenX, screenY);
      if (folderAreaId) {
        this.scene.handleAreaFolderClick(folderAreaId);
        this.lastClickTime = 0;
        this.lastClickTarget = null;
        return;
      }

      // Check if clicking on an area (for selection)
      const area = this.scene.getAreaAtScreenPos(screenX, screenY);
      const worldPos = this.camera.screenToWorld(screenX, screenY);

      if (area) {
        const areaClickTarget = `area:${area.id}`;
        // Check for double-click
        if (
          this.lastClickTarget === areaClickTarget &&
          now - this.lastClickTime < this.doubleClickDelay
        ) {
          this.scene.selectArea(area.id);
          this.scene.handleAreaDoubleClick(area.id);
          this.lastClickTime = 0;
          this.lastClickTarget = null;
        } else {
          // Single click selects the area
          this.scene.selectArea(area.id);
          this.lastClickTime = now;
          this.lastClickTarget = areaClickTarget;
        }
      } else {
        // Ground click - deselect any selected area
        this.scene.selectArea(null);
        this.scene.handleGroundClick({ x: worldPos.x, z: worldPos.z });
        this.lastClickTime = 0;
        this.lastClickTarget = null;
      }
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
