import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { store } from '../../store';
import { matchesShortcut } from '../../store/shortcuts';
import { DRAG_THRESHOLD, FORMATION_SPACING } from '../config';
import type { AgentMeshData } from '../characters/CharacterFactory';
import { getStorage, STORAGE_KEYS } from '../../utils/storage';
import type { Agent } from '../../../shared/types';

// Import extracted modules
import { DoubleClickDetector } from './DoubleClickDetector';
import { TouchGestureHandler } from './TouchGestureHandler';
import { TrackpadGestureHandler } from './TrackpadGestureHandler';
import { SceneRaycaster } from './SceneRaycaster';
import { CameraController } from './CameraController';
import { MouseControlHandler } from './MouseControlHandler';
import type {
  InputCallbacks,
  DrawingModeChecker,
  ResizeHandlesGetter,
  ResizeModeChecker,
  AreaAtPositionGetter,
  BuildingAtPositionGetter,
  BuildingPositionsGetter,
  FolderIconMeshesGetter,
  GroundPosition,
} from './types';

// Re-export types for backwards compatibility
export type {
  InputCallbacks,
  DrawingModeChecker,
  ResizeHandlesGetter,
  ResizeModeChecker,
  AreaAtPositionGetter,
  BuildingAtPositionGetter,
  BuildingPositionsGetter,
};

/**
 * Handles all mouse, keyboard, and touch input for the scene.
 * Orchestrates specialized handlers for different interaction types.
 */
export class InputHandler {
  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private selectionBox: HTMLDivElement;
  private callbacks: InputCallbacks;

  // Extracted handlers
  private raycaster: SceneRaycaster;
  private cameraController: CameraController;
  private mouseControlHandler: MouseControlHandler;
  private trackpadHandler: TrackpadGestureHandler;
  private touchHandler: TouchGestureHandler;
  private agentClickDetector: DoubleClickDetector<string>;
  private agentTapDetector: DoubleClickDetector<string>;
  private buildingClickDetector: DoubleClickDetector<string>;
  private areaClickDetector: DoubleClickDetector<string>;

  // Drag selection state
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private dragCurrent = { x: 0, y: 0 };
  private pointerDownOnCanvas = false; // Track if pointer down originated on our canvas

  // Right-click drag state
  private isRightDragging = false;
  private rightDragStart = { x: 0, y: 0 };

  // Drawing state
  private isDrawing = false;
  private drawingModeChecker: DrawingModeChecker = () => false;

  // Resize state
  private isResizing = false;
  private resizeModeChecker: ResizeModeChecker = () => false;

  // Area/Building detection
  private areaAtPositionGetter: AreaAtPositionGetter = () => null;
  private buildingAtPositionGetter: BuildingAtPositionGetter = () => null;
  private buildingPositionsGetter: BuildingPositionsGetter = () => new Map();

  // Building drag state
  private isDraggingBuilding = false;
  private draggingBuildingId: string | null = null;
  private buildingDragStartPos: GroundPosition | null = null;


  // Hover state for agent tooltip
  private hoveredAgentId: string | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMousePos: { x: number; y: number } = { x: 0, y: 0 };
  private static readonly HOVER_DELAY = 400; // 400ms
  private lastHoverCheckTime = 0;
  private static readonly HOVER_CHECK_INTERVAL = 50; // Throttle to 20Hz instead of 60Hz

  // Hover state for building tooltip
  private hoveredBuildingId: string | null = null;
  private buildingHoverTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly BUILDING_HOVER_DELAY = 5000; // 5 seconds


  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    selectionBox: HTMLDivElement,
    callbacks: InputCallbacks
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.selectionBox = selectionBox;
    this.callbacks = callbacks;

    // Initialize extracted handlers
    this.raycaster = new SceneRaycaster(camera, canvas);
    this.cameraController = new CameraController(camera, controls, canvas);
    this.cameraController.setRaycastProvider(this.raycaster);

    // Mouse control handler for configurable bindings
    this.mouseControlHandler = new MouseControlHandler(this.cameraController, {
      onSelectionBoxStart: (x, y) => {
        this.dragStart = { x, y };
        this.dragCurrent = { x, y };
        this.isDragging = true;
        this.selectionBox.classList.add('active');
      },
      onSelectionBoxMove: (x, y) => {
        this.dragCurrent = { x, y };
        this.updateSelectionBox();
      },
      onSelectionBoxEnd: (x, y) => {
        this.isDragging = false;
        this.selectionBox.classList.remove('active');
        this.selectAgentsInBox(this.dragStart, { x, y });
      },
    });

    // Trackpad gesture handler: pinch zoom, two-finger pan, shift+two-finger orbit
    this.trackpadHandler = new TrackpadGestureHandler(this.cameraController, canvas, {
      onPan: (dx, dy) => {
        this.cameraController.handlePan(dx, dy);
      },
      onZoom: (delta, centerX, centerY) => {
        // Convert delta to scale for pinch zoom
        const scale = 1 - delta;
        this.cameraController.handlePinchZoom(scale, { x: centerX, y: centerY });
      },
      onOrbit: (dx, dy) => {
        this.cameraController.handleOrbit(dx, dy);
      },
    });

    // Double-click detectors
    this.agentClickDetector = new DoubleClickDetector(300);
    this.agentTapDetector = new DoubleClickDetector(450); // Touch needs longer threshold
    this.buildingClickDetector = new DoubleClickDetector(300);
    this.areaClickDetector = new DoubleClickDetector(300);

    // Touch gesture handler
    this.touchHandler = new TouchGestureHandler(canvas, controls, {
      onTap: this.handleTouchTap,
      onLongPress: this.handleLongPress,
      onPan: (dx, dy) => this.cameraController.handlePan(dx, dy),
      onPinchZoom: (scale, center) => this.cameraController.handlePinchZoom(scale, center),
      onOrbit: (dx, dy) => this.cameraController.handleOrbit(dx, dy),
      onRotation: (angleDelta) => this.cameraController.handleTwistRotation(angleDelta),
    });

    this.setupEventListeners();
  }

  /**
   * Update references for raycasting.
   */
  setReferences(ground: THREE.Object3D | null, agentMeshes: Map<string, AgentMeshData>): void {
    this.raycaster.setReferences(ground, agentMeshes);
  }

  /**
   * Set the drawing mode checker function.
   */
  setDrawingModeChecker(checker: DrawingModeChecker): void {
    this.drawingModeChecker = checker;
  }

  /**
   * Set the resize handles getter and mode checker.
   */
  setResizeHandlers(getter: ResizeHandlesGetter, checker: ResizeModeChecker): void {
    this.raycaster.setResizeHandlesGetter(getter);
    this.resizeModeChecker = checker;
  }

  /**
   * Set the folder icon meshes getter.
   */
  setFolderIconMeshesGetter(getter: FolderIconMeshesGetter): void {
    this.raycaster.setFolderIconMeshesGetter(getter);
  }

  /**
   * Set the area at position getter.
   */
  setAreaAtPositionGetter(getter: AreaAtPositionGetter): void {
    this.areaAtPositionGetter = getter;
  }

  /**
   * Set the building at position getter.
   */
  setBuildingAtPositionGetter(getter: BuildingAtPositionGetter): void {
    this.buildingAtPositionGetter = getter;
  }

  /**
   * Set the building positions getter (for drag selection).
   */
  setBuildingPositionsGetter(getter: BuildingPositionsGetter): void {
    this.buildingPositionsGetter = getter;
  }


  /**
   * Raycast to ground and return world position.
   */
  raycastGround(event: MouseEvent): GroundPosition | null {
    return this.raycaster.raycastGroundFromEvent(event);
  }

  /**
   * Remove event listeners.
   */
  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, true);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);

    this.agentClickDetector.dispose();
    this.agentTapDetector.dispose();
    this.buildingClickDetector.dispose();
    this.areaClickDetector.dispose();
    this.touchHandler.dispose();
    this.trackpadHandler.dispose();
    this.clearHoverTimer();
    this.clearBuildingHoverTimer();
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  /**
   * Reattach to new canvas element and controls.
   */
  reattach(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement, controls: OrbitControls): void {
    this.dispose();
    this.canvas = canvas;
    this.selectionBox = selectionBox;
    this.controls = controls;

    this.raycaster.setCanvas(canvas);
    this.cameraController.setCanvas(canvas);
    this.cameraController.setControls(controls);
    this.mouseControlHandler.setCameraController(this.cameraController);
    this.trackpadHandler.setCameraController(this.cameraController);
    this.trackpadHandler.setCanvas(canvas);
    this.touchHandler.reattach(canvas, controls);

    this.setupEventListeners();
  }

  /**
   * Calculate formation positions for multiple agents.
   */
  calculateFormationPositions(
    center: THREE.Vector3,
    count: number
  ): { x: number; y: number; z: number }[] {
    const positions: { x: number; y: number; z: number }[] = [];

    if (count === 1) {
      return [{ x: center.x, y: 0, z: center.z }];
    }

    if (count <= 6) {
      // Circle formation
      const radius = FORMATION_SPACING * Math.max(1, count / 3);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        positions.push({
          x: center.x + Math.cos(angle) * radius,
          y: 0,
          z: center.z + Math.sin(angle) * radius,
        });
      }
    } else {
      // Grid formation
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const offsetX = ((cols - 1) * FORMATION_SPACING) / 2;
      const offsetZ = ((rows - 1) * FORMATION_SPACING) / 2;

      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.push({
          x: center.x + col * FORMATION_SPACING - offsetX,
          y: 0,
          z: center.z + row * FORMATION_SPACING - offsetZ,
        });
      }
    }

    return positions;
  }

  // --- Event Listeners Setup ---

  private setupEventListeners(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown, true);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    // Clear hover when window loses focus (e.g., switching to Guake terminal)
    window.addEventListener('blur', this.onWindowBlur);
    // Also listen for visibility changes
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // Keyboard events for Space key to toggle terminal
    // Use capture phase so global shortcuts (like spotlight) are processed first
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  // --- Pointer Event Handlers ---

  private onPointerDown = (event: PointerEvent): void => {
    // Ignore pointer events when window doesn't have focus or isn't the active element
    // This prevents selection box when dragging overlay windows like Guake over the canvas
    if (!document.hasFocus() || document.visibilityState === 'hidden') {
      return;
    }

    // Mark activity to prevent idle throttling
    this.callbacks.onActivity?.();

    const isTouch = event.pointerType === 'touch';

    if (event.button === 0) {
      this.controls.mouseButtons.LEFT = null as unknown as THREE.MOUSE;

      // Check resize handle (mouse only)
      if (!isTouch) {
        const resizeHandle = this.raycaster.checkResizeHandleClick(event);
        if (resizeHandle) {
          const groundPos = this.raycaster.raycastGroundFromEvent(event);
          if (groundPos) {
            this.isResizing = true;
            this.callbacks.onResizeStart?.(resizeHandle, groundPos);
          }
          return;
        }
      }

      // Check drawing mode (mouse only)
      if (!isTouch && this.drawingModeChecker()) {
        const groundPos = this.raycaster.raycastGroundFromEvent(event);
        if (groundPos) {
          this.isDrawing = true;
          this.callbacks.onDrawStart?.(groundPos);
        }
        return;
      }

      // Check building click (mouse only for drag)
      const groundPos = this.raycaster.raycastGroundFromEvent(event);
      if (groundPos) {
        const building = this.buildingAtPositionGetter(groundPos);
        if (building && !isTouch) {
          this.draggingBuildingId = building.id;
          this.buildingDragStartPos = groundPos;
          this.isDraggingBuilding = false;
          return;
        }
      }

      this.isDragging = false;
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.dragCurrent = { x: event.clientX, y: event.clientY };
      this.pointerDownOnCanvas = true; // Mark that we initiated this drag
    }

    if (event.button === 2) {
      // Check if mouse control handler wants this event (e.g., Alt+Right for camera pan)
      if (this.mouseControlHandler.handlePointerDown(event)) {
        this.controls.mouseButtons.RIGHT = null as unknown as THREE.MOUSE;
        return;
      }

      this.controls.mouseButtons.RIGHT = null as unknown as THREE.MOUSE;
      this.isRightDragging = false;
      this.rightDragStart = { x: event.clientX, y: event.clientY };
    }

    // Check middle button for camera controls
    if (event.button === 1) {
      if (this.mouseControlHandler.handlePointerDown(event)) {
        this.controls.mouseButtons.MIDDLE = null as unknown as THREE.MOUSE;
        return;
      }
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    // Ignore events when window doesn't have focus or document is hidden
    // This helps prevent selection box when dragging external windows over the canvas
    if (!document.hasFocus() || document.hidden) {
      if (this.isDragging) {
        this.isDragging = false;
        this.selectionBox.classList.remove('active');
        this.pointerDownOnCanvas = false;
      }
      return;
    }

    if (event.buttons & 1) {
      // Handle resize mode
      if (this.isResizing) {
        const groundPos = this.raycaster.raycastGroundFromEvent(event);
        if (groundPos) {
          this.callbacks.onResizeMove?.(groundPos);
        }
        return;
      }

      // Handle drawing mode
      if (this.isDrawing) {
        const groundPos = this.raycaster.raycastGroundFromEvent(event);
        if (groundPos) {
          this.callbacks.onDrawMove?.(groundPos);
        }
        return;
      }

      // Handle building drag
      if (this.draggingBuildingId && this.buildingDragStartPos) {
        const groundPos = this.raycaster.raycastGroundFromEvent(event);
        if (groundPos) {
          const dx = groundPos.x - this.buildingDragStartPos.x;
          const dz = groundPos.z - this.buildingDragStartPos.z;
          const distance = Math.sqrt(dx * dx + dz * dz);

          if (!this.isDraggingBuilding && distance > 0.2) {
            this.isDraggingBuilding = true;
            this.callbacks.onBuildingDragStart?.(this.draggingBuildingId, this.buildingDragStartPos);
          }

          if (this.isDraggingBuilding) {
            this.callbacks.onBuildingDragMove?.(this.draggingBuildingId, groundPos);
          }
        }
        return;
      }

      // Skip selection box on touch
      if (event.pointerType === 'touch') {
        return;
      }

      // Only process selection box if we initiated the pointer down on our canvas
      // and terminal is not being resized
      if (!this.pointerDownOnCanvas || store.getState().terminalResizing) {
        return;
      }

      const dx = event.clientX - this.dragStart.x;
      const dy = event.clientY - this.dragStart.y;

      if (!this.isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        this.isDragging = true;
        this.selectionBox.classList.add('active');
      }

      if (this.isDragging) {
        this.dragCurrent = { x: event.clientX, y: event.clientY };
        this.updateSelectionBox();
      }
    }

    if (event.buttons & 2) {
      // Check if mouse control handler is handling camera drag
      if (this.mouseControlHandler.handlePointerMove(event)) {
        return;
      }

      const dx = event.clientX - this.rightDragStart.x;
      const dy = event.clientY - this.rightDragStart.y;

      if (!this.isRightDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        this.isRightDragging = true;
      }
    }

    // Handle middle button camera drags
    if (event.buttons & 4) {
      if (this.mouseControlHandler.handlePointerMove(event)) {
        return;
      }
    }

    // Handle hover detection when no buttons pressed (for agent tooltip)
    // Throttled to reduce raycasting frequency
    if (event.buttons === 0 && event.pointerType !== 'touch') {
      const now = performance.now();
      if (now - this.lastHoverCheckTime > InputHandler.HOVER_CHECK_INTERVAL) {
        this.handleHoverDetection(event);
        this.lastHoverCheckTime = now;
      }
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) {
      this.controls.mouseButtons.LEFT = null as unknown as THREE.MOUSE;

      // Skip click handling for touch events - they're handled by handleTouchTap
      // This prevents the synthetic pointer events from touch from double-processing
      if (event.pointerType === 'touch') {
        this.pointerDownOnCanvas = false;
        return;
      }

      if (this.isResizing) {
        this.callbacks.onResizeEnd?.();
        this.isResizing = false;
        return;
      }

      if (this.isDrawing) {
        const groundPos = this.raycaster.raycastGroundFromEvent(event);
        if (groundPos) {
          this.callbacks.onDrawEnd?.(groundPos);
        }
        this.isDrawing = false;
        return;
      }

      if (this.draggingBuildingId) {
        const buildingId = this.draggingBuildingId;
        const groundPos = this.raycaster.raycastGroundFromEvent(event);
        const screenPos = { x: event.clientX, y: event.clientY };

        if (this.isDraggingBuilding && groundPos) {
          this.callbacks.onBuildingDragEnd?.(buildingId, groundPos);
        } else {
          this.handleBuildingClick(buildingId, screenPos);
        }

        this.draggingBuildingId = null;
        this.buildingDragStartPos = null;
        this.isDraggingBuilding = false;
        return;
      }

      if (this.isDragging) {
        this.isDragging = false;
        this.selectionBox.classList.remove('active');
        this.selectAgentsInBox(this.dragStart, this.dragCurrent);
      } else if (!event.ctrlKey) {
        this.handleSingleClick(event);
      }

      // Reset the pointer down flag
      this.pointerDownOnCanvas = false;
    }

    if (event.button === 2) {
      // Let mouse control handler clean up if it was handling
      this.mouseControlHandler.handlePointerUp(event);
      this.controls.mouseButtons.RIGHT = null as unknown as THREE.MOUSE;
      this.isRightDragging = false;
    }

    // Handle middle button release
    if (event.button === 1) {
      this.mouseControlHandler.handlePointerUp(event);
      this.controls.mouseButtons.MIDDLE = null as unknown as THREE.MOUSE;
    }
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.touchHandler.onPointerCancel(event.pointerId);
  };

  private onPointerLeave = (_event: PointerEvent): void => {
    // Clear hover states when mouse leaves the canvas
    this.clearHoverState();
    this.clearBuildingHoverState();
  };

  private onWindowBlur = (): void => {
    this.cancelAllDragStates();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.cancelAllDragStates();
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    const state = store.getState();

    // Check if we're in an input field
    const isInInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    const guakeTerminal = target.closest('.guake-terminal');
    const isCollapsedTerminal = guakeTerminal?.classList.contains('collapsed');

    // Alt+H / Alt+L for agent navigation (works when terminal is closed)
    // Note: Alt+Shift+H/L for working agents is handled in useKeyboardShortcuts.ts
    const shortcuts = store.getShortcuts();
    const spotlightShortcut = shortcuts.find(s => s.id === 'toggle-spotlight');
    const nextAgentShortcut = shortcuts.find(s => s.id === 'next-agent');
    const prevAgentShortcut = shortcuts.find(s => s.id === 'prev-agent');
    const openTerminalShortcut = shortcuts.find(s => s.id === 'open-terminal');

    // Allow global shortcuts to pass through (let other handlers deal with them)
    if (matchesShortcut(event, spotlightShortcut)) {
      console.log('[InputHandler] Spotlight shortcut detected, passing through');
      return; // Let useKeyboardShortcuts handle spotlight
    }

    // Don't handle if typing in an input field (with exceptions)
    if (isInInputField) {
      // Exception: agent nav shortcuts in collapsed terminal input - blur and continue for navigation
      const navShortcuts = store.getShortcuts();
      const isAltNavKey = matchesShortcut(event, navShortcuts.find(s => s.id === 'next-agent'))
        || matchesShortcut(event, navShortcuts.find(s => s.id === 'prev-agent'))
        || matchesShortcut(event, navShortcuts.find(s => s.id === 'next-working-agent'))
        || matchesShortcut(event, navShortcuts.find(s => s.id === 'prev-working-agent'));

      if (isAltNavKey && isCollapsedTerminal) {
        (target as HTMLInputElement | HTMLTextAreaElement).blur();
      } else {
        // Space and other keys should not trigger when input is focused
        return;
      }
    }

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
      this.callbacks.onActivity?.();
      return;
    }

    // Open terminal
    if (matchesShortcut(event, openTerminalShortcut)) {
      // Get fresh state and DOM element
      const freshState = store.getState();
      const terminalDom = document.querySelector('.guake-terminal');
      const isDomCollapsed = terminalDom?.classList.contains('collapsed');

      console.log('[InputHandler] ► Space pressed', {
        state_terminalOpen: state.terminalOpen,
        freshState_terminalOpen: freshState.terminalOpen,
        dom_isCollapsed: isDomCollapsed,
        dom_hasOpen: terminalDom?.classList.contains('open'),
      });

      // Don't trigger if inside an open terminal
      if (guakeTerminal && !isCollapsedTerminal) {
        console.log('[InputHandler] Space: blocked - inside open terminal');
        return;
      }

      // Don't trigger if any interactive element has focus (buttons, links, etc.)
      if (target.tagName === 'BUTTON' || target.tagName === 'A') {
        console.log('[InputHandler] Space: blocked - button/link focused');
        return;
      }

      // Only OPEN the terminal with Space (use backtick or Escape to close)
      // Check both state AND visual state to handle stuck state bug
      if (state.terminalOpen) {
        // Safeguard: if terminal is marked open but visually collapsed, reset the state
        if (guakeTerminal && isCollapsedTerminal) {
          console.log('[InputHandler] Space: terminal state was stuck open but visually collapsed - resetting and opening');
          store.setTerminalOpen(false);
          // Don't return - let it fall through to reopen
        } else {
          console.log('[InputHandler] Space: blocked - terminal already open');
          return;
        }
      }

      // Additional safety: if terminal says it's open but isn't actually on screen, force reset
      const terminalElement = document.querySelector('.guake-terminal');
      if (terminalElement && terminalElement.classList.contains('collapsed') && state.terminalOpen) {
        console.log('[InputHandler] Space: detected stuck state (open in state, collapsed visually) - fixing');
        store.setTerminalOpen(false);
      }

      // Don't trigger if a building or area is focused (let other handlers deal with it)
      if (state.selectedBuildingIds.size > 0 || state.selectedAreaId !== null) {
        console.log('[InputHandler] Space: blocked - building or area focused');
        return;
      }

      // If no agent selected, select the last active agent
      if (state.selectedAgentIds.size === 0) {
        const lastAgentId = state.lastSelectedAgentId;
        console.log('[InputHandler] Space: no agent selected, trying lastAgentId:', lastAgentId);
        if (lastAgentId && state.agents.has(lastAgentId)) {
          event.preventDefault();
          store.selectAgent(lastAgentId);
          store.setTerminalOpen(true);
          console.log('[InputHandler] Space: opened terminal for last agent:', lastAgentId);
        } else {
          console.log('[InputHandler] Space: no valid last agent to open');
        }
        return;
      }

      // Prevent page scroll
      event.preventDefault();

      // Open terminal
      console.log('[InputHandler] Space: opening terminal for selected agent');
      store.setTerminalOpen(true);
    }
  };

  private cancelAllDragStates(): void {
    // Clear hover states
    this.clearHoverState();
    this.clearBuildingHoverState();
    // Cancel any active drag selection
    if (this.isDragging) {
      this.isDragging = false;
      this.selectionBox.classList.remove('active');
    }
    // Reset pointer tracking
    this.pointerDownOnCanvas = false;
  }

  private clearHoverState(): void {
    this.clearHoverTimer();
    if (this.hoveredAgentId !== null) {
      this.hoveredAgentId = null;
      this.callbacks.onAgentHover?.(null, null);
    }
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();

    if (event.altKey) return;

    this.controls.mouseButtons.RIGHT = null as unknown as THREE.MOUSE;

    if (this.isRightDragging) {
      this.isRightDragging = false;
      return;
    }

    const state = store.getState();
    const groundPos = this.raycaster.raycastGroundFromEvent(event);

    if (groundPos) {
      // If agents are selected, right-click moves them (no context menu)
      if (state.selectedAgentIds.size > 0) {
        if (this.callbacks.onAreaRightClick) {
          this.callbacks.onAreaRightClick(groundPos);
        }

        const agentIds = Array.from(state.selectedAgentIds);
        const point = new THREE.Vector3(groundPos.x, 0, groundPos.z);
        this.callbacks.onMoveCommand(point, agentIds);
        return;
      }

      // No agents selected - show context menu with target information
      if (this.callbacks.onContextMenu) {
        const agentAtPos = this.raycaster.findAgentAtPosition(event);
        const areaAtPos = this.areaAtPositionGetter?.(groundPos);
        const buildingAtPos = this.buildingAtPositionGetter?.(groundPos);

        let target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string };

        if (agentAtPos) {
          target = { type: 'agent', id: agentAtPos };
        } else if (buildingAtPos) {
          target = { type: 'building', id: buildingAtPos.id };
        } else if (areaAtPos) {
          target = { type: 'area', id: areaAtPos.id };
        } else {
          target = { type: 'ground' };
        }

        this.callbacks.onContextMenu(
          { x: event.clientX, y: event.clientY },
          groundPos,
          target
        );
      }
    }
  };

  private onWheel = (event: WheelEvent): void => {
    // Mark activity to prevent idle throttling
    this.callbacks.onActivity?.();

    // Try trackpad handler first (for pinch-to-zoom and two-finger scroll)
    if (this.trackpadHandler.handleWheel(event)) {
      return;
    }

    // Fall back to mouse control handler which applies sensitivity settings
    this.mouseControlHandler.handleWheel(event);
  };

  // --- Touch Event Handlers ---

  private onTouchStart = (event: TouchEvent): void => {
    this.touchHandler.onTouchStart(event);
  };

  private onTouchMove = (event: TouchEvent): void => {
    this.touchHandler.onTouchMove(event);
  };

  private onTouchEnd = (event: TouchEvent): void => {
    this.touchHandler.onTouchEnd(event);
  };

  // --- Touch Callbacks ---

  private handleTouchTap = (clientX: number, clientY: number): void => {
    console.log('[InputHandler] handleTouchTap called at:', clientX, clientY);
    // Check for agent tap
    const agentId = this.raycaster.findAgentAtPoint(clientX, clientY);
    console.log('[InputHandler] Agent at tap position:', agentId);

    if (agentId) {
      const clickType = this.agentTapDetector.handleClick(agentId);
      console.log('[InputHandler] clickType from detector:', clickType);
      if (clickType === 'double') {
        console.log('[Touch] >>> DOUBLE-TAP detected on agent:', agentId);
        this.callbacks.onAgentDoubleClick(agentId);
      } else {
        console.log('[Touch] >>> SINGLE tap on agent:', agentId);
        this.callbacks.onAgentClick(agentId, false);
      }
      return;
    }

    // Check for building tap
    const groundPos = this.raycaster.raycastGroundFromPoint(clientX, clientY);
    if (groundPos) {
      const building = this.buildingAtPositionGetter(groundPos);
      if (building) {
        const screenPos = { x: clientX, y: clientY };
        this.handleBuildingClick(building.id, screenPos);
        return;
      }

      // Check for area tap - areas are edited via right-click context menu only
      const area = this.areaAtPositionGetter(groundPos);
      if (area) {
        return;
      }
    }

    // Tapped on ground - deselect
    this.agentClickDetector.reset();
    this.callbacks.onGroundClick();
    this.callbacks.onGroundClickOutsideArea?.();
  };

  private handleLongPress = (clientX: number, clientY: number): void => {
    const state = store.getState();
    const groundPos = this.raycaster.raycastGroundFromPoint(clientX, clientY);
    if (!groundPos) return;

    // Check if long-pressing on an agent - show context menu
    const agentId = this.raycaster.findAgentAtPoint(clientX, clientY);
    if (agentId) {
      // Show context menu for the agent
      if (this.callbacks.onContextMenu) {
        this.callbacks.onContextMenu(
          { x: clientX, y: clientY },
          groundPos,
          { type: 'agent', id: agentId }
        );
      }
      return;
    }

    // Check if long-pressing on a building - show context menu
    const buildingAtPos = this.buildingAtPositionGetter?.(groundPos);
    if (buildingAtPos) {
      if (this.callbacks.onContextMenu) {
        this.callbacks.onContextMenu(
          { x: clientX, y: clientY },
          groundPos,
          { type: 'building', id: buildingAtPos.id }
        );
      }
      return;
    }

    // Check if long-pressing on an area - show context menu
    const areaAtPos = this.areaAtPositionGetter?.(groundPos);
    if (areaAtPos) {
      if (this.callbacks.onContextMenu) {
        this.callbacks.onContextMenu(
          { x: clientX, y: clientY },
          groundPos,
          { type: 'area', id: areaAtPos.id }
        );
      }
      return;
    }

    // Long-press on ground with agents selected - move command
    if (state.selectedAgentIds.size > 0) {
      const agentIds = Array.from(state.selectedAgentIds);
      const position = new THREE.Vector3(groundPos.x, 0, groundPos.z);
      this.callbacks.onMoveCommand(position, agentIds);
      return;
    }

    // Long-press on empty ground with no selection - show ground context menu
    if (this.callbacks.onContextMenu) {
      this.callbacks.onContextMenu(
        { x: clientX, y: clientY },
        groundPos,
        { type: 'ground' }
      );
    }
  };

  // --- Click Handlers ---

  private handleSingleClick(event: PointerEvent): void {
    // Check for folder icon click first (takes priority)
    const folderIconMesh = this.raycaster.checkFolderIconClick(event);
    if (folderIconMesh) {
      const areaId = folderIconMesh.userData.areaId;
      if (areaId) {
        this.callbacks.onFolderIconClick?.(areaId);
        return;
      }
    }

    const agentId = this.raycaster.findAgentAtPosition(event);

    if (agentId) {
      const clickType = this.agentClickDetector.handleClick(agentId);
      if (clickType === 'double') {
        this.callbacks.onAgentDoubleClick(agentId);
      } else {
        this.callbacks.onAgentClick(agentId, event.shiftKey);
      }
      return;
    }

    // Clicked on ground - reset state
    this.agentClickDetector.reset();

    // Check for area click - areas are edited via right-click context menu only
    const groundPos = this.raycaster.raycastGroundFromEvent(event);
    if (groundPos) {
      const area = this.areaAtPositionGetter(groundPos);
      if (area) {
        return;
      }
    }

    this.areaClickDetector.reset();

    if (!event.shiftKey) {
      this.callbacks.onGroundClick();
      this.callbacks.onGroundClickOutsideArea?.();
    }
  }

  private handleBuildingClick(buildingId: string, screenPos?: { x: number; y: number }): void {
    const clickType = this.buildingClickDetector.handleClick(buildingId);
    if (clickType === 'double') {
      this.callbacks.onBuildingDoubleClick?.(buildingId);
    } else {
      // Use provided screen position or default to center if not available
      const pos = screenPos || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      this.callbacks.onBuildingClick?.(buildingId, pos);
    }
  }

  // --- Selection Box ---

  private updateSelectionBox(): void {
    const left = Math.min(this.dragStart.x, this.dragCurrent.x);
    const top = Math.min(this.dragStart.y, this.dragCurrent.y);
    const width = Math.abs(this.dragCurrent.x - this.dragStart.x);
    const height = Math.abs(this.dragCurrent.y - this.dragStart.y);

    this.selectionBox.style.left = `${left}px`;
    this.selectionBox.style.top = `${top}px`;
    this.selectionBox.style.width = `${width}px`;
    this.selectionBox.style.height = `${height}px`;
  }

  private selectAgentsInBox(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): void {
    const _rect = this.canvas.getBoundingClientRect();
    const boxLeft = Math.min(start.x, end.x);
    const boxRight = Math.max(start.x, end.x);
    const boxTop = Math.min(start.y, end.y);
    const boxBottom = Math.max(start.y, end.y);

    const agentsInBox: string[] = [];
    const buildingsInBox: string[] = [];

    // Check agents
    for (const [agentId, meshData] of this.raycaster.getAgentMeshes()) {
      const screenPos = this.raycaster.projectToScreen(meshData.group.position);

      if (
        screenPos.x >= boxLeft &&
        screenPos.x <= boxRight &&
        screenPos.y >= boxTop &&
        screenPos.y <= boxBottom
      ) {
        agentsInBox.push(agentId);
      }
    }

    // Check buildings
    const buildingPositions = this.buildingPositionsGetter();
    for (const [buildingId, position] of buildingPositions) {
      const screenPos = this.raycaster.projectToScreen(position);

      if (
        screenPos.x >= boxLeft &&
        screenPos.x <= boxRight &&
        screenPos.y >= boxTop &&
        screenPos.y <= boxBottom
      ) {
        buildingsInBox.push(buildingId);
      }
    }

    this.callbacks.onSelectionBox(agentsInBox, buildingsInBox);
  }

  // --- Hover Detection ---

  private handleHoverDetection(event: PointerEvent): void {
    this.lastMousePos = { x: event.clientX, y: event.clientY };
    const agentId = this.raycaster.findAgentAtPosition(event);

    if (agentId !== this.hoveredAgentId) {
      // Agent changed - clear any pending timer and notify immediately with null
      this.clearHoverTimer();

      if (this.hoveredAgentId !== null) {
        // Was hovering an agent, now not - clear the popup
        this.callbacks.onAgentHover?.(null, null);
      }

      this.hoveredAgentId = agentId;

      if (agentId) {
        // Started hovering a new agent - start timer for showing popup
        this.hoverTimer = setTimeout(() => {
          this.triggerHoverCallback();
        }, InputHandler.HOVER_DELAY);
      }
    }

    // Handle building hover detection (5 second delay)
    const groundPos = this.raycaster.raycastGroundFromEvent(event);
    const building = groundPos ? this.buildingAtPositionGetter(groundPos) : null;
    const buildingId = building?.id ?? null;

    if (buildingId !== this.hoveredBuildingId) {
      // Building changed - clear any pending timer and notify immediately with null
      this.clearBuildingHoverTimer();

      if (this.hoveredBuildingId !== null) {
        // Was hovering a building, now not - clear the popup
        this.callbacks.onBuildingHover?.(null, null);
      }

      this.hoveredBuildingId = buildingId;

      if (buildingId) {
        // Started hovering a new building - start timer for showing popup (5 seconds)
        this.buildingHoverTimer = setTimeout(() => {
          this.triggerBuildingHoverCallback();
        }, InputHandler.BUILDING_HOVER_DELAY);
      }
    }
  }

  private triggerHoverCallback(): void {
    if (this.hoveredAgentId && this.callbacks.onAgentHover) {
      // Get screen position of the agent for popup placement
      const meshData = this.raycaster.getAgentMeshes().get(this.hoveredAgentId);
      if (meshData) {
        const screenPos = this.raycaster.projectToScreen(meshData.group.position);
        this.callbacks.onAgentHover(this.hoveredAgentId, screenPos);
      }
    }
  }

  private clearHoverTimer(): void {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private triggerBuildingHoverCallback(): void {
    if (this.hoveredBuildingId && this.callbacks.onBuildingHover) {
      // Get screen position of the building for popup placement
      const buildingPositions = this.buildingPositionsGetter();
      const position = buildingPositions.get(this.hoveredBuildingId);
      if (position) {
        const screenPos = this.raycaster.projectToScreen(position);
        this.callbacks.onBuildingHover(this.hoveredBuildingId, screenPos);
      }
    }
  }

  private clearBuildingHoverTimer(): void {
    if (this.buildingHoverTimer) {
      clearTimeout(this.buildingHoverTimer);
      this.buildingHoverTimer = null;
    }
  }

  private clearBuildingHoverState(): void {
    this.clearBuildingHoverTimer();
    if (this.hoveredBuildingId !== null) {
      this.hoveredBuildingId = null;
      this.callbacks.onBuildingHover?.(null, null);
    }
  }

  /**
   * Get agents ordered according to the saved toolbar order.
   * Matches the order used in AgentBar and useSwipeNavigation.
   */
  private getOrderedAgents(agentsMap: Map<string, Agent>): Agent[] {
    const agents = Array.from(agentsMap.values());
    const currentAgentIds = new Set(agents.map(a => a.id));

    // Get saved order from localStorage
    const savedOrder = getStorage<string[]>(STORAGE_KEYS.AGENT_ORDER, []);

    // Filter saved order to only include existing agents
    const validSavedOrder = savedOrder.filter(id => currentAgentIds.has(id));

    // Find agents that exist but aren't in saved order (new agents) - sort by creation time
    const newAgents = agents
      .filter(a => !validSavedOrder.includes(a.id))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const newAgentIds = newAgents.map(a => a.id);

    // Combine: saved order (valid only) + new agents at the end
    const finalOrder = [...validSavedOrder, ...newAgentIds];

    // Map IDs to actual agent objects
    const agentMap = new Map(agents.map(a => [a.id, a]));
    const orderedAgents = finalOrder
      .map(id => agentMap.get(id))
      .filter((a): a is Agent => a !== undefined);

    // Group by area (matching useSwipeNavigation order)
    const groups = new Map<string | null, { area: { name: string } | null; agents: Agent[] }>();
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
}
