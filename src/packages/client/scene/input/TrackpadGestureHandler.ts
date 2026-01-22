/**
 * TrackpadGestureHandler - Mac trackpad gesture recognition
 *
 * Handles trackpad-specific gestures that differ from mouse events:
 * - Two-finger pinch-to-zoom (via wheel events with ctrlKey)
 * - Two-finger scroll for panning
 * - Inertial scrolling
 * - Gesture events (Safari's GestureEvent API)
 *
 * Mac trackpads generate different events than mice:
 * - Wheel events with deltaMode=0 (pixels) and smooth deltas
 * - ctrlKey+wheel for pinch gestures
 * - GestureEvent for rotation (Safari only)
 */

import { store } from '../../store';
import type { CameraController } from './CameraController';

// ============================================================================
// TYPES
// ============================================================================

export interface TrackpadConfig {
  enabled: boolean;
  pinchToZoom: boolean;
  twoFingerScroll: boolean;
  twoFingerScrollAction: 'pan' | 'orbit';
  rotationGesture: boolean;
  inertialScrolling: boolean;
  naturalScrolling: boolean; // Inverts scroll direction like macOS default
  sensitivity: {
    zoom: number; // 0.1-3.0
    scroll: number; // 0.1-3.0
    rotation: number; // 0.1-3.0
  };
}

export const DEFAULT_TRACKPAD_CONFIG: TrackpadConfig = {
  enabled: true,
  pinchToZoom: true,
  twoFingerScroll: true,
  twoFingerScrollAction: 'pan',
  rotationGesture: true,
  inertialScrolling: true,
  naturalScrolling: true,
  sensitivity: {
    zoom: 1.0,
    scroll: 1.0,
    rotation: 1.0,
  },
};

export interface TrackpadCallbacks {
  onPan: (dx: number, dy: number) => void;
  onZoom: (delta: number, centerX: number, centerY: number) => void;
  onOrbit: (dx: number, dy: number) => void;
  onRotate: (angleDelta: number) => void;
}

// Safari's GestureEvent interface (not standard)
interface GestureEvent extends UIEvent {
  scale: number;
  rotation: number;
  clientX: number;
  clientY: number;
}

// ============================================================================
// TRACKPAD DETECTION
// ============================================================================

/**
 * Heuristics to detect trackpad vs mouse wheel:
 * - Trackpads generate many small delta events (typically < 50 pixels)
 * - Mice generate larger discrete delta events (typically 100-120+ per notch)
 * - Pinch gestures set ctrlKey=true on wheel events
 * - Horizontal scrolling is more common with trackpads
 *
 * NOTE: We can't rely on integer vs non-integer deltas - Linux mice with
 * smooth scrolling report non-integer values too. Instead we use delta magnitude.
 */
function isLikelyTrackpad(event: WheelEvent): boolean {
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);

  // Pinch gesture (ctrlKey + wheel) with small delta is trackpad
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (absY < 50) {
      return true;
    }
  }

  // Large deltaY (> 50) without deltaX is typically a mouse wheel
  // Mouse wheels report ~100-200+ per notch, trackpads report smaller values
  if (absY > 50 && absX === 0) {
    return false; // This is a mouse wheel
  }

  // Horizontal-only scrolling is typically trackpad (mice rarely do this)
  if (absX > 0 && absY === 0) {
    return true;
  }

  // Simultaneous X and Y scrolling suggests trackpad
  if (absX > 5 && absY > 5) {
    return true;
  }

  // Small deltas (< 50) without horizontal component could be trackpad scroll
  // but we'll be conservative and let mouse handler deal with it
  return false;
}

// ============================================================================
// HANDLER CLASS
// ============================================================================

export class TrackpadGestureHandler {
  private cameraController: CameraController;
  private callbacks: TrackpadCallbacks;
  private canvas: HTMLCanvasElement;

  // Gesture state
  private isGestureActive = false;
  private gestureScale = 1;
  private gestureRotation = 0;

  // Scroll accumulator for smooth panning
  private scrollAccumulatorX = 0;
  private scrollAccumulatorY = 0;
  private lastScrollTime = 0;
  private scrollDecayTimer: ReturnType<typeof setTimeout> | null = null;

  // Track recent wheel events to detect trackpad
  private recentWheelEvents: { timestamp: number; isTrackpad: boolean }[] = [];
  private isTrackpadMode = false;

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
   * Set up Safari GestureEvent listeners
   */
  private setupGestureEvents(): void {
    // Safari-specific gesture events
    if ('GestureEvent' in window) {
      this.canvas.addEventListener('gesturestart', this.onGestureStart as EventListener);
      this.canvas.addEventListener('gesturechange', this.onGestureChange as EventListener);
      this.canvas.addEventListener('gestureend', this.onGestureEnd as EventListener);
    }
  }

  /**
   * Handle wheel events - detect trackpad vs mouse and route accordingly
   * Returns true if this handler consumed the event
   */
  handleWheel(event: WheelEvent): boolean {
    const config = store.getTrackpadConfig();
    if (!config.enabled) return false;

    // Check if this specific event looks like a trackpad event
    const isTrackpad = isLikelyTrackpad(event);

    // Track recent events for mode detection
    this.updateTrackpadDetection(isTrackpad);

    // IMPORTANT: Only handle events that ARE detected as trackpad
    // Mouse wheel events should always pass through to the mouse handler
    if (!isTrackpad) {
      return false;
    }

    // Pinch-to-zoom (ctrlKey + wheel on Mac)
    if (event.ctrlKey && config.pinchToZoom) {
      event.preventDefault();
      this.handlePinchZoom(event, config);
      return true;
    }

    // Two-finger scroll (only for actual trackpad events, not mouse wheel)
    if (config.twoFingerScroll) {
      event.preventDefault();
      this.handleTwoFingerScroll(event, config);
      return true;
    }

    return false;
  }

  /**
   * Handle pinch-to-zoom gesture
   */
  private handlePinchZoom(event: WheelEvent, config: TrackpadConfig): void {
    // deltaY is negative when zooming in (fingers spreading)
    const zoomDelta = -event.deltaY * 0.01 * config.sensitivity.zoom;

    this.callbacks.onZoom(zoomDelta, event.clientX, event.clientY);
  }

  /**
   * Handle two-finger scroll for pan or orbit
   */
  private handleTwoFingerScroll(event: WheelEvent, config: TrackpadConfig): void {
    let dx = event.deltaX;
    let dy = event.deltaY;

    // Apply natural scrolling (macOS default inverts direction)
    if (config.naturalScrolling) {
      dx = -dx;
      dy = -dy;
    }

    // Apply sensitivity
    dx *= config.sensitivity.scroll;
    dy *= config.sensitivity.scroll;

    // Accumulate scroll for smoother experience with inertial scrolling
    if (config.inertialScrolling) {
      this.scrollAccumulatorX += dx;
      this.scrollAccumulatorY += dy;

      // Apply accumulated scroll
      const applyDx = this.scrollAccumulatorX;
      const applyDy = this.scrollAccumulatorY;

      // Reset accumulator
      this.scrollAccumulatorX = 0;
      this.scrollAccumulatorY = 0;

      if (config.twoFingerScrollAction === 'pan') {
        this.callbacks.onPan(applyDx, applyDy);
      } else {
        this.callbacks.onOrbit(applyDx * 0.5, applyDy * 0.5);
      }
    } else {
      if (config.twoFingerScrollAction === 'pan') {
        this.callbacks.onPan(dx, dy);
      } else {
        this.callbacks.onOrbit(dx * 0.5, dy * 0.5);
      }
    }

    this.lastScrollTime = performance.now();
  }

  /**
   * Track recent wheel events to detect if user is using trackpad
   */
  private updateTrackpadDetection(isTrackpad: boolean): void {
    const now = performance.now();

    // Add this event
    this.recentWheelEvents.push({ timestamp: now, isTrackpad });

    // Remove events older than 1 second
    this.recentWheelEvents = this.recentWheelEvents.filter((e) => now - e.timestamp < 1000);

    // If majority of recent events are trackpad-like, enter trackpad mode
    const trackpadCount = this.recentWheelEvents.filter((e) => e.isTrackpad).length;
    const total = this.recentWheelEvents.length;

    this.isTrackpadMode = total >= 3 && trackpadCount / total > 0.5;
  }

  /**
   * Safari GestureEvent handlers
   */
  private onGestureStart = (event: GestureEvent): void => {
    event.preventDefault();
    const config = store.getTrackpadConfig();
    if (!config.enabled) return;

    this.isGestureActive = true;
    this.gestureScale = event.scale;
    this.gestureRotation = event.rotation;
  };

  private onGestureChange = (event: GestureEvent): void => {
    event.preventDefault();
    const config = store.getTrackpadConfig();
    if (!config.enabled || !this.isGestureActive) return;

    // Handle scale change (pinch)
    if (config.pinchToZoom && event.scale !== this.gestureScale) {
      const scaleDelta = event.scale - this.gestureScale;
      this.callbacks.onZoom(scaleDelta * config.sensitivity.zoom, event.clientX, event.clientY);
      this.gestureScale = event.scale;
    }

    // Handle rotation
    if (config.rotationGesture && event.rotation !== this.gestureRotation) {
      const rotationDelta = (event.rotation - this.gestureRotation) * (Math.PI / 180);
      this.callbacks.onRotate(rotationDelta * config.sensitivity.rotation);
      this.gestureRotation = event.rotation;
    }
  };

  private onGestureEnd = (event: GestureEvent): void => {
    event.preventDefault();
    this.isGestureActive = false;
    this.gestureScale = 1;
    this.gestureRotation = 0;
  };

  /**
   * Update references
   */
  setCameraController(cameraController: CameraController): void {
    this.cameraController = cameraController;
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    // Remove old listeners
    if ('GestureEvent' in window) {
      this.canvas.removeEventListener('gesturestart', this.onGestureStart as EventListener);
      this.canvas.removeEventListener('gesturechange', this.onGestureChange as EventListener);
      this.canvas.removeEventListener('gestureend', this.onGestureEnd as EventListener);
    }

    this.canvas = canvas;
    this.setupGestureEvents();
  }

  /**
   * Check if handler is in trackpad mode
   */
  get inTrackpadMode(): boolean {
    return this.isTrackpadMode;
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

    if (this.scrollDecayTimer) {
      clearTimeout(this.scrollDecayTimer);
    }
  }
}
