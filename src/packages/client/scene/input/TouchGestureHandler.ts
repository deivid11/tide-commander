import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DRAG_THRESHOLD } from '../config';
import type { ScreenPosition } from './types';

/**
 * Callbacks for touch gesture events.
 */
export interface TouchGestureCallbacks {
  onTap: (clientX: number, clientY: number) => void;
  onLongPress: (clientX: number, clientY: number) => void;
  onPan: (dx: number, dy: number) => void;
  onPinchZoom: (scale: number, center: ScreenPosition) => void;
  onOrbit: (dx: number, dy: number) => void;
  onRotation: (angleDelta: number) => void;
}

/**
 * Handles all touch gesture recognition and processing.
 * Supports: tap, long-press, pan, pinch-zoom, two-finger orbit, three-finger orbit.
 */
export class TouchGestureHandler {
  private canvas: HTMLCanvasElement;
  private controls: OrbitControls;
  private callbacks: TouchGestureCallbacks;

  // Touch tracking
  private activePointers: Map<number, ScreenPosition> = new Map();
  private touchStartTime = 0;
  private touchStartPos: ScreenPosition = { x: 0, y: 0 };
  private isTouchDragging = false;

  // Single finger pan
  private isTouchPanning = false;
  private touchPanStart: ScreenPosition = { x: 0, y: 0 };

  // Long press
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTriggered = false;
  private static readonly LONG_PRESS_DURATION = 500;

  // Pinch zoom
  private isPinching = false;
  private lastPinchDistance = 0;

  // Two-finger pan/rotation
  private twoFingerPanStart: ScreenPosition = { x: 0, y: 0 };
  private lastTwoFingerAngle = 0;

  // Three-finger orbit
  private isThreeFingerDrag = false;
  private threeFingerStart: ScreenPosition = { x: 0, y: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    controls: OrbitControls,
    callbacks: TouchGestureCallbacks
  ) {
    this.canvas = canvas;
    this.controls = controls;
    this.callbacks = callbacks;
  }

  /**
   * Handle touch start event.
   */
  onTouchStart(event: TouchEvent): void {
    // Track all touch points
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.activePointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    // Clear any pending long press
    this.clearLongPressTimer();
    this.longPressTriggered = false;

    if (event.touches.length === 1) {
      this.handleSingleTouchStart(event.touches[0]);
    } else if (event.touches.length === 2) {
      this.handleTwoTouchStart(event);
    } else if (event.touches.length >= 3) {
      this.handleThreeTouchStart(event);
    }
  }

  /**
   * Handle touch move event.
   */
  onTouchMove(event: TouchEvent): void {
    // Update tracked positions
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.activePointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    if (event.touches.length >= 3 && this.isThreeFingerDrag) {
      this.handleThreeTouchMove(event);
    } else if (event.touches.length === 2 && this.isPinching) {
      this.handleTwoTouchMove(event);
    } else if (event.touches.length === 1 && !this.isPinching) {
      this.handleSingleTouchMove(event.touches[0]);
    }
  }

  /**
   * Handle touch end event.
   * Returns true if a tap was detected.
   */
  onTouchEnd(event: TouchEvent): boolean {
    // Clear long press timer
    this.clearLongPressTimer();

    // Remove ended touches
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.activePointers.delete(touch.identifier);
    }

    if (event.touches.length === 0) {
      return this.handleAllTouchesEnd(event);
    } else if (event.touches.length === 2) {
      this.transitionToTwoTouches(event);
    } else if (event.touches.length === 1) {
      this.transitionToOneTouch(event.touches[0]);
    }

    return false;
  }

  /**
   * Handle pointer cancel.
   */
  onPointerCancel(pointerId: number): void {
    this.activePointers.delete(pointerId);
    this.reset();
  }

  /**
   * Reset all touch state.
   */
  reset(): void {
    this.isTouchPanning = false;
    this.isPinching = false;
    this.isThreeFingerDrag = false;
    this.lastPinchDistance = 0;
    this.isTouchDragging = false;
    this.longPressTriggered = false;
    this.clearLongPressTimer();
  }

  /**
   * Check if currently in a drag gesture.
   */
  get isDragging(): boolean {
    return this.isTouchDragging;
  }

  /**
   * Check if long press was triggered.
   */
  get wasLongPress(): boolean {
    return this.longPressTriggered;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.clearLongPressTimer();
    this.activePointers.clear();
  }

  /**
   * Reattach to new canvas and controls.
   */
  reattach(canvas: HTMLCanvasElement, controls: OrbitControls): void {
    this.canvas = canvas;
    this.controls = controls;
  }

  // --- Private handlers ---

  private handleSingleTouchStart(touch: Touch): void {
    this.touchStartTime = performance.now();
    this.touchStartPos = { x: touch.clientX, y: touch.clientY };
    this.isTouchDragging = false;
    this.isTouchPanning = false;

    // Start long-press timer
    const touchX = touch.clientX;
    const touchY = touch.clientY;
    this.longPressTimer = setTimeout(() => {
      this.longPressTriggered = true;
      this.longPressTimer = null;
      this.callbacks.onLongPress(touchX, touchY);

      // Haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, TouchGestureHandler.LONG_PRESS_DURATION);
  }

  private handleTwoTouchStart(event: TouchEvent): void {
    event.preventDefault();
    this.isPinching = true;
    this.isTouchPanning = false;
    this.isThreeFingerDrag = false;
    this.lastPinchDistance = this.getTouchDistance(event.touches[0], event.touches[1]);

    const center = this.getTouchCenter(event.touches[0], event.touches[1]);
    this.twoFingerPanStart = { x: center.x, y: center.y };
    this.lastTwoFingerAngle = this.getTwoFingerAngle(event.touches[0], event.touches[1]);
  }

  private handleThreeTouchStart(event: TouchEvent): void {
    event.preventDefault();
    this.isPinching = false;
    this.isThreeFingerDrag = true;
    this.controls.enableRotate = true;

    const center = this.getMultiTouchCenter(event.touches);
    this.threeFingerStart = { x: center.x, y: center.y };
  }

  private handleSingleTouchMove(touch: Touch): void {
    const dx = touch.clientX - this.touchStartPos.x;
    const dy = touch.clientY - this.touchStartPos.y;

    // Start panning if moved past threshold
    if (!this.isTouchPanning && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      this.clearLongPressTimer();
      this.isTouchPanning = true;
      this.isTouchDragging = true;
      this.touchPanStart = { x: touch.clientX, y: touch.clientY };
    }

    if (this.isTouchPanning) {
      const panDx = touch.clientX - this.touchPanStart.x;
      const panDy = touch.clientY - this.touchPanStart.y;
      this.callbacks.onPan(panDx, panDy);
      this.touchPanStart = { x: touch.clientX, y: touch.clientY };
    }
  }

  private handleTwoTouchMove(event: TouchEvent): void {
    this.clearLongPressTimer();
    event.preventDefault();

    const newDistance = this.getTouchDistance(event.touches[0], event.touches[1]);
    const newCenter = this.getTouchCenter(event.touches[0], event.touches[1]);
    const newAngle = this.getTwoFingerAngle(event.touches[0], event.touches[1]);

    // Pinch-to-zoom
    if (this.lastPinchDistance > 0) {
      const scale = this.lastPinchDistance / newDistance;
      this.callbacks.onPinchZoom(scale, newCenter);
    }
    this.lastPinchDistance = newDistance;

    // Two-finger drag for orbit
    const orbitDx = newCenter.x - this.twoFingerPanStart.x;
    const orbitDy = newCenter.y - this.twoFingerPanStart.y;
    if (Math.abs(orbitDx) > 1 || Math.abs(orbitDy) > 1) {
      this.callbacks.onOrbit(orbitDx, orbitDy);
      this.twoFingerPanStart = { x: newCenter.x, y: newCenter.y };
    }

    // Two-finger twist rotation
    let angleDelta = newAngle - this.lastTwoFingerAngle;
    if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
    if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;
    if (Math.abs(angleDelta) > 0.01) {
      this.callbacks.onRotation(angleDelta);
      this.lastTwoFingerAngle = newAngle;
    }
  }

  private handleThreeTouchMove(event: TouchEvent): void {
    this.clearLongPressTimer();
    event.preventDefault();

    const newCenter = this.getMultiTouchCenter(event.touches);
    const dx = newCenter.x - this.threeFingerStart.x;
    const dy = newCenter.y - this.threeFingerStart.y;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      this.callbacks.onOrbit(dx, dy);
      this.threeFingerStart = { x: newCenter.x, y: newCenter.y };
    }
  }

  private handleAllTouchesEnd(event: TouchEvent): boolean {
    const touchDuration = performance.now() - this.touchStartTime;
    const wasTap = !this.isTouchDragging && !this.longPressTriggered && touchDuration < 400;

    if (wasTap && event.changedTouches.length > 0) {
      const touch = event.changedTouches[0];
      this.callbacks.onTap(touch.clientX, touch.clientY);
    }

    this.reset();
    return wasTap;
  }

  private transitionToTwoTouches(event: TouchEvent): void {
    this.isThreeFingerDrag = false;
    this.isPinching = true;
    this.lastPinchDistance = this.getTouchDistance(event.touches[0], event.touches[1]);
    const center = this.getTouchCenter(event.touches[0], event.touches[1]);
    this.twoFingerPanStart = { x: center.x, y: center.y };
  }

  private transitionToOneTouch(touch: Touch): void {
    this.isPinching = false;
    this.isThreeFingerDrag = false;
    this.lastPinchDistance = 0;
    this.touchPanStart = { x: touch.clientX, y: touch.clientY };
    this.touchStartPos = { x: touch.clientX, y: touch.clientY };
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  // --- Utility methods ---

  private getTouchDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getTouchCenter(touch1: Touch, touch2: Touch): ScreenPosition {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  }

  private getTwoFingerAngle(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.atan2(dy, dx);
  }

  private getMultiTouchCenter(touches: TouchList): ScreenPosition {
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < touches.length; i++) {
      sumX += touches[i].clientX;
      sumY += touches[i].clientY;
    }
    return {
      x: sumX / touches.length,
      y: sumY / touches.length,
    };
  }
}
