/**
 * TrackpadGestureHandler - Simple trackpad gesture support
 *
 * Two gestures only:
 * - Pinch to zoom (ctrlKey + wheel on trackpads)
 * - Two-finger drag to pan (follows hand movement)
 */

import { store } from '../../store';
import type { CameraController } from './CameraController';

// ============================================================================
// TYPES
// ============================================================================

export interface TrackpadConfig {
  enabled: boolean;
  pinchToZoom: boolean;
  twoFingerPan: boolean;
  shiftTwoFingerOrbit: boolean; // Shift + two-finger drag to orbit
  sensitivity: {
    zoom: number; // 0.1-3.0
    pan: number; // 0.1-3.0
    orbit: number; // 0.1-3.0
  };
}

export const DEFAULT_TRACKPAD_CONFIG: TrackpadConfig = {
  enabled: true,
  pinchToZoom: true,
  twoFingerPan: true,
  shiftTwoFingerOrbit: true,
  sensitivity: {
    zoom: 1.0,
    pan: 1.0,
    orbit: 1.0,
  },
};

export interface TrackpadCallbacks {
  onPan: (dx: number, dy: number) => void;
  onZoom: (delta: number, centerX: number, centerY: number) => void;
  onOrbit: (dx: number, dy: number) => void;
}

// ============================================================================
// TRACKPAD DETECTION
// ============================================================================

/**
 * Detect trackpad vs mouse wheel:
 * - Trackpads have horizontal component (deltaX)
 * - Mice generate large deltaY values (100-200+) with no deltaX
 * - Pinch gestures have ctrlKey
 */
function isLikelyTrackpad(event: WheelEvent): boolean {
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);

  // Pinch gesture (ctrlKey + wheel) is always trackpad
  if (event.ctrlKey) {
    return true;
  }

  // Any horizontal component strongly suggests trackpad
  if (absX > 1) {
    return true;
  }

  // Large deltaY (> 80) without deltaX is a mouse wheel
  if (absY > 80 && absX < 1) {
    return false;
  }

  // Small vertical deltas could be trackpad
  if (absY > 0 && absY <= 80) {
    return true;
  }

  return false;
}

// ============================================================================
// HANDLER CLASS
// ============================================================================

export class TrackpadGestureHandler {
  private cameraController: CameraController;
  private callbacks: TrackpadCallbacks;
  private canvas: HTMLCanvasElement;

  // Safari GestureEvent state
  private isGestureActive = false;
  private gestureScale = 1;

  constructor(
    cameraController: CameraController,
    canvas: HTMLCanvasElement,
    callbacks: TrackpadCallbacks
  ) {
    this.cameraController = cameraController;
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.setupGestureEvents();
  }

  /**
   * Set up Safari GestureEvent listeners for pinch zoom
   */
  private setupGestureEvents(): void {
    if ('GestureEvent' in window) {
      this.canvas.addEventListener('gesturestart', this.onGestureStart as EventListener);
      this.canvas.addEventListener('gesturechange', this.onGestureChange as EventListener);
      this.canvas.addEventListener('gestureend', this.onGestureEnd as EventListener);
    }
  }

  /**
   * Handle wheel events
   * Returns true if this handler consumed the event
   */
  handleWheel(event: WheelEvent): boolean {
    const config = store.getTrackpadConfig();
    if (!config.enabled) return false;

    // Only handle trackpad events
    if (!isLikelyTrackpad(event)) {
      return false;
    }

    // Pinch-to-zoom (ctrlKey + wheel)
    if (event.ctrlKey && config.pinchToZoom) {
      event.preventDefault();
      const zoomDelta = -event.deltaY * 0.01 * config.sensitivity.zoom;
      this.callbacks.onZoom(zoomDelta, event.clientX, event.clientY);
      return true;
    }

    // Shift + two-finger = Orbit camera
    if (event.shiftKey && config.shiftTwoFingerOrbit) {
      event.preventDefault();
      const dx = -event.deltaX * config.sensitivity.orbit;
      const dy = -event.deltaY * config.sensitivity.orbit;
      this.callbacks.onOrbit(dx, dy);
      return true;
    }

    // Two-finger pan (follows hand movement - invert deltas)
    if (config.twoFingerPan) {
      event.preventDefault();
      // Invert so movement follows the hand (drag right = pan right)
      const dx = -event.deltaX * config.sensitivity.pan;
      const dy = -event.deltaY * config.sensitivity.pan;
      this.callbacks.onPan(dx, dy);
      return true;
    }

    return false;
  }

  /**
   * Safari GestureEvent handlers for pinch zoom
   */
  private onGestureStart = (event: Event): void => {
    const gestureEvent = event as unknown as { scale: number; preventDefault: () => void };
    gestureEvent.preventDefault();

    const config = store.getTrackpadConfig();
    if (!config.enabled) return;

    this.isGestureActive = true;
    this.gestureScale = gestureEvent.scale;
  };

  private onGestureChange = (event: Event): void => {
    const gestureEvent = event as unknown as {
      scale: number;
      clientX: number;
      clientY: number;
      preventDefault: () => void
    };
    gestureEvent.preventDefault();

    const config = store.getTrackpadConfig();
    if (!config.enabled || !this.isGestureActive) return;

    // Handle pinch zoom
    if (config.pinchToZoom && gestureEvent.scale !== this.gestureScale) {
      const scaleDelta = gestureEvent.scale - this.gestureScale;
      this.callbacks.onZoom(
        scaleDelta * config.sensitivity.zoom,
        gestureEvent.clientX,
        gestureEvent.clientY
      );
      this.gestureScale = gestureEvent.scale;
    }
  };

  private onGestureEnd = (event: Event): void => {
    (event as unknown as { preventDefault: () => void }).preventDefault();
    this.isGestureActive = false;
    this.gestureScale = 1;
  };

  /**
   * Update references
   */
  setCameraController(cameraController: CameraController): void {
    this.cameraController = cameraController;
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    if ('GestureEvent' in window) {
      this.canvas.removeEventListener('gesturestart', this.onGestureStart as EventListener);
      this.canvas.removeEventListener('gesturechange', this.onGestureChange as EventListener);
      this.canvas.removeEventListener('gestureend', this.onGestureEnd as EventListener);
    }

    this.canvas = canvas;
    this.setupGestureEvents();
  }

  /**
   * Clean up
   */
  dispose(): void {
    if ('GestureEvent' in window) {
      this.canvas.removeEventListener('gesturestart', this.onGestureStart as EventListener);
      this.canvas.removeEventListener('gesturechange', this.onGestureChange as EventListener);
      this.canvas.removeEventListener('gestureend', this.onGestureEnd as EventListener);
    }
  }
}
