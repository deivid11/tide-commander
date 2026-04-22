/**
 * Hook for detecting horizontal swipe gestures on mobile.
 * Used for navigating between agents in the guake terminal.
 *
 * Applies transform directly to dragTarget during drag to avoid React re-renders.
 * Only callbacks that need state changes (onDragStart, onDragThreshold, onSwipeLeft,
 * onSwipeRight, onSwipeCancel) fire at most 2-4 times per gesture.
 */

import { useRef, useEffect, useCallback } from 'react';
import { triggerHaptic, type VibrationIntensity } from '../utils/haptics';

export interface SwipeGestureOptions {
  /** Minimum distance in pixels to trigger a swipe */
  threshold?: number;
  /** Maximum vertical movement allowed (to distinguish from scroll) */
  maxVerticalMovement?: number;
  /** Whether the gesture is enabled */
  enabled?: boolean;
  /** Callback when swiping left (right-to-left) */
  onSwipeLeft?: () => void;
  /** Callback when swiping right (left-to-right) */
  onSwipeRight?: () => void;
  /** Fires once when visual drag starts (> movementThreshold). Use to show dots. */
  onDragStart?: () => void;
  /**
   * Fires when drag crosses the indicator threshold (~30% of screen width).
   * 'right' = finger moving right, 'left' = finger moving left, null = retreated.
   */
  onDragThreshold?: (direction: 'left' | 'right' | null) => void;
  /** Callback when swipe ends without triggering navigation */
  onSwipeCancel?: () => void;
  /** Vibration intensity for haptic feedback (0=off, 1=ultra light ... 5=heavy). Default: 1 */
  vibrationIntensity?: VibrationIntensity;
  /** Element to apply live transform to during drag (avoids React re-renders) */
  dragTarget?: React.RefObject<HTMLElement | null>;
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  isTracking: boolean;
  isDragging: boolean;
  lastThresholdDir: 'left' | 'right' | null;
}

export function useSwipeGesture(
  ref: React.RefObject<HTMLElement | null>,
  options: SwipeGestureOptions
) {
  const {
    threshold = 80,
    maxVerticalMovement = 50,
    enabled = true,
    onSwipeLeft,
    onSwipeRight,
    onDragStart,
    onDragThreshold,
    onSwipeCancel,
    vibrationIntensity = 1,
    dragTarget,
  } = options;

  const touchStateRef = useRef<TouchState>({
    startX: 0,
    startY: 0,
    startTime: 0,
    isTracking: false,
    isDragging: false,
    lastThresholdDir: null,
  });

  // Pending cleanup for snap-back animation (cancelled if new touch starts)
  const animCleanupRef = useRef<(() => void) | null>(null);

  const clearAnimCleanup = useCallback(() => {
    animCleanupRef.current?.();
    animCleanupRef.current = null;
  }, []);

  const snapBack = useCallback(() => {
    const el = dragTarget?.current;
    if (!el) return;
    clearAnimCleanup();
    el.style.transition = 'transform 220ms ease-out';
    el.style.transform = 'translateX(0)';
    const cleanup = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
      animCleanupRef.current = null;
    };
    const tid = setTimeout(cleanup, 270);
    el.addEventListener('transitionend', cleanup, { once: true });
    animCleanupRef.current = () => {
      clearTimeout(tid);
      el.removeEventListener('transitionend', cleanup);
    };
  }, [dragTarget, clearAnimCleanup]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return;

    // If touch starts inside a horizontally scrollable element, let browser handle scroll
    let el = e.target as Element | null;
    while (el && el !== ref.current) {
      if (el.scrollWidth > el.clientWidth) return;
      el = el.parentElement;
    }

    // Cancel any in-progress snap-back so the new drag starts cleanly
    if (animCleanupRef.current && dragTarget?.current) {
      clearAnimCleanup();
      dragTarget.current.style.transition = '';
      dragTarget.current.style.transform = '';
    }

    const touch = e.touches[0];
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      isTracking: true,
      isDragging: false,
      lastThresholdDir: null,
    };
  }, [ref, dragTarget, clearAnimCleanup]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStateRef.current.isTracking || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStateRef.current.startX;
    const deltaY = Math.abs(touch.clientY - touchStateRef.current.startY);
    const absDeltaX = Math.abs(deltaX);

    // Early vertical-scroll detection: if user is clearly scrolling before drag starts, bail
    if (!touchStateRef.current.isDragging && deltaY > absDeltaX * 2 && absDeltaX < 20) {
      touchStateRef.current.isTracking = false;
      return;
    }

    // Vertical movement exceeded limit → cancel
    if (deltaY > maxVerticalMovement) {
      touchStateRef.current.isTracking = false;
      if (touchStateRef.current.isDragging) {
        touchStateRef.current.isDragging = false;
        snapBack();
        onSwipeCancel?.();
      }
      return;
    }

    const movementThreshold = 12;
    if (absDeltaX < movementThreshold) return;

    // First frame past the movement threshold: enable will-change and notify drag start
    if (!touchStateRef.current.isDragging) {
      touchStateRef.current.isDragging = true;
      if (dragTarget?.current) {
        dragTarget.current.style.willChange = 'transform';
      }
      onDragStart?.();
    }

    // Prevent browser vertical scroll/bounce during committed horizontal drag
    e.preventDefault();

    // Apply live transform — directly to DOM, no React re-render
    if (dragTarget?.current) {
      const maxDelta = window.innerWidth * 0.55;
      const clamped = Math.max(-maxDelta, Math.min(maxDelta, deltaX));
      dragTarget.current.style.transform = `translateX(${clamped}px)`;
    }

    // Notify indicator threshold (fires at most ~2 times per gesture)
    if (onDragThreshold) {
      const indicatorPx = window.innerWidth * 0.12; // ~47px on 390px screen
      const newDir: 'left' | 'right' | null =
        deltaX > indicatorPx ? 'right' :
        deltaX < -indicatorPx ? 'left' :
        null;
      if (newDir !== touchStateRef.current.lastThresholdDir) {
        touchStateRef.current.lastThresholdDir = newDir;
        onDragThreshold(newDir);
      }
    }
  }, [maxVerticalMovement, onDragStart, onDragThreshold, onSwipeCancel, dragTarget, snapBack]);

  const commitRelease = useCallback((deltaX: number, deltaY: number, duration: number) => {
    const wasDragging = touchStateRef.current.isDragging;
    touchStateRef.current.isTracking = false;
    touchStateRef.current.isDragging = false;
    touchStateRef.current.lastThresholdDir = null;

    const isValidSwipe =
      Math.abs(deltaX) >= threshold &&
      deltaY <= maxVerticalMovement &&
      duration < 500;

    if (isValidSwipe) {
      // Clear inline styles so the swipe-in entrance animation isn't blocked
      if (dragTarget?.current) {
        dragTarget.current.style.transform = '';
        dragTarget.current.style.willChange = '';
      }
      triggerHaptic(vibrationIntensity as VibrationIntensity);
      if (deltaX > 0) {
        onSwipeRight?.();
      } else {
        onSwipeLeft?.();
      }
    } else if (wasDragging) {
      snapBack();
      onSwipeCancel?.();
    } else {
      if (dragTarget?.current) {
        dragTarget.current.style.willChange = '';
      }
    }
  }, [threshold, maxVerticalMovement, vibrationIntensity, onSwipeLeft, onSwipeRight, onSwipeCancel, dragTarget, snapBack]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStateRef.current.isTracking) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStateRef.current.startX;
    const deltaY = Math.abs(touch.clientY - touchStateRef.current.startY);
    const duration = Date.now() - touchStateRef.current.startTime;
    commitRelease(deltaX, deltaY, duration);
  }, [commitRelease]);

  const handleTouchCancel = useCallback(() => {
    if (!touchStateRef.current.isTracking) return;
    const wasDragging = touchStateRef.current.isDragging;
    touchStateRef.current.isTracking = false;
    touchStateRef.current.isDragging = false;
    touchStateRef.current.lastThresholdDir = null;
    if (wasDragging) {
      snapBack();
      onSwipeCancel?.();
    } else {
      if (dragTarget?.current) {
        dragTarget.current.style.willChange = '';
      }
    }
  }, [snapBack, onSwipeCancel, dragTarget]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    const isMobile = window.innerWidth <= 768 && 'ontouchstart' in window;
    if (!isMobile) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });
    element.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [ref, enabled, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]);
}
