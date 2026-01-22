/**
 * MouseControlHandler - Configurable mouse control binding system
 *
 * Resolves mouse button + modifier combinations to configurable actions.
 * Integrates with the store's mouseControls state for persistence.
 */

import { store } from '../../store';
import type {
  MouseControlConfig,
  MouseAction,
  MouseButton,
} from '../../store/mouseControls';
import { BUTTON_MAP, modifiersMatch } from '../../store/mouseControls';
import type { CameraController } from './CameraController';

// ============================================================================
// TYPES
// ============================================================================

export interface MouseControlCallbacks {
  onSelectionBoxStart: (x: number, y: number) => void;
  onSelectionBoxMove: (x: number, y: number) => void;
  onSelectionBoxEnd: (x: number, y: number) => void;
}

// ============================================================================
// HANDLER CLASS
// ============================================================================

export class MouseControlHandler {
  private cameraController: CameraController;
  private callbacks: MouseControlCallbacks;

  // Active drag state
  private activeDragAction: MouseAction | null = null;
  private activeBinding: MouseControlConfig | null = null;
  private dragStartPos = { x: 0, y: 0 };
  private lastDragPos = { x: 0, y: 0 };

  constructor(cameraController: CameraController, callbacks: MouseControlCallbacks) {
    this.cameraController = cameraController;
    this.callbacks = callbacks;
  }

  /**
   * Update the camera controller reference
   */
  setCameraController(cameraController: CameraController): void {
    this.cameraController = cameraController;
  }

  /**
   * Find the matching mouse binding for a pointer/mouse event
   */
  findBinding(
    event: PointerEvent | MouseEvent,
    button: number
  ): MouseControlConfig | null {
    const controls = store.getMouseControls();
    const buttonName = BUTTON_MAP[button] as MouseButton | undefined;

    if (!buttonName) return null;

    // Find matching binding (most specific first - with modifiers before without)
    const candidates = controls.bindings
      .filter((b) => b.enabled && b.button === buttonName)
      .sort((a, b) => {
        const aModCount = Object.values(a.modifiers).filter(Boolean).length;
        const bModCount = Object.values(b.modifiers).filter(Boolean).length;
        return bModCount - aModCount; // More modifiers = higher priority
      });

    for (const binding of candidates) {
      if (modifiersMatch(event, binding.modifiers)) {
        return binding;
      }
    }

    return null;
  }

  /**
   * Check if an action is a camera action (drag-based)
   */
  private isCameraAction(action: MouseAction): boolean {
    return (
      action === 'camera-pan' ||
      action === 'camera-orbit' ||
      action === 'camera-rotate' ||
      action === 'camera-tilt'
    );
  }

  /**
   * Handle pointer down - determine action and start if drag-based
   * Returns true if this handler is consuming the event
   */
  handlePointerDown(event: PointerEvent): boolean {
    const binding = this.findBinding(event, event.button);
    if (!binding) return false;

    this.dragStartPos = { x: event.clientX, y: event.clientY };
    this.lastDragPos = { x: event.clientX, y: event.clientY };

    // Camera actions start immediately on pointer down
    if (this.isCameraAction(binding.action)) {
      this.activeDragAction = binding.action;
      this.activeBinding = binding;
      return true;
    }

    // Selection box starts on drag threshold (handled elsewhere for now)
    // Primary action, context menu, move command are handled on click/up

    return false;
  }

  /**
   * Handle pointer move - execute drag actions
   * Returns true if this handler is consuming the event
   */
  handlePointerMove(event: PointerEvent): boolean {
    if (!this.activeDragAction || !this.activeBinding) return false;

    const dx = event.clientX - this.lastDragPos.x;
    const dy = event.clientY - this.lastDragPos.y;
    const sensitivity = store.getMouseControls().sensitivity;

    switch (this.activeDragAction) {
      case 'camera-pan': {
        // Pan uses raw dx/dy - CameraController already applies distance-based scaling
        const panX = sensitivity.invertPanX ? -dx : dx;
        const panY = sensitivity.invertPanY ? -dy : dy;
        this.cameraController.handlePan(panX, panY);
        break;
      }

      case 'camera-orbit': {
        // Orbit uses raw dx/dy - CameraController already applies rotation speed
        const orbitX = sensitivity.invertOrbitX ? -dx : dx;
        const orbitY = sensitivity.invertOrbitY ? -dy : dy;
        this.cameraController.handleOrbit(orbitX, orbitY);
        break;
      }

      case 'camera-rotate':
        // Horizontal rotation only
        this.cameraController.handleOrbit(dx * sensitivity.orbitSpeed, 0);
        break;

      case 'camera-tilt':
        // Vertical rotation only
        this.cameraController.handleOrbit(0, dy * sensitivity.orbitSpeed);
        break;

      case 'selection-box':
        this.callbacks.onSelectionBoxMove(event.clientX, event.clientY);
        break;
    }

    this.lastDragPos = { x: event.clientX, y: event.clientY };
    return true;
  }

  /**
   * Handle pointer up - end drag actions
   * Returns true if this handler was consuming the event
   */
  handlePointerUp(_event: PointerEvent): boolean {
    const wasActive = this.activeDragAction !== null;

    if (this.activeDragAction === 'selection-box') {
      this.callbacks.onSelectionBoxEnd(_event.clientX, _event.clientY);
    }

    this.activeDragAction = null;
    this.activeBinding = null;
    return wasActive;
  }

  /**
   * Handle wheel events for zoom
   * Returns true if this handler consumed the event
   */
  handleWheel(event: WheelEvent): boolean {
    const controls = store.getMouseControls();
    const zoomBinding = controls.bindings.find(
      (b) => b.enabled && b.action === 'camera-zoom'
    );

    if (!zoomBinding) return false;

    // Apply sensitivity to wheel zoom via the camera controller
    // The camera controller already handles the zoom logic
    const sensitivity = controls.sensitivity;

    // Create a modified event with scaled deltaY
    // We can't actually modify the event, so we'll handle zoom directly
    const zoomIn = event.deltaY < 0;
    const zoomFactor = 0.1 * sensitivity.zoomSpeed;

    // Call the camera controller's wheel zoom with the original event
    // The sensitivity is applied via the zoomFactor
    this.cameraController.handleWheelZoom(event);

    return true;
  }

  /**
   * Check if currently in a drag action
   */
  get isDragging(): boolean {
    return this.activeDragAction !== null;
  }

  /**
   * Get the current drag action
   */
  get currentAction(): MouseAction | null {
    return this.activeDragAction;
  }

  /**
   * Cancel any active drag operation
   */
  cancelDrag(): void {
    this.activeDragAction = null;
    this.activeBinding = null;
  }
}
