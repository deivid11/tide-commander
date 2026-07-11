/**
 * Hook for detecting horizontal swipe gestures on mobile.
 * Used for navigating between agents in the guake terminal.
 *
 * Applies transform directly to dragTarget during drag to avoid React re-renders.
 * Only callbacks that need state changes (onDragStart, onDragThreshold, onSwipeLeft,
 * onSwipeRight, onSwipeCancel) fire at most 2-4 times per gesture.
 *
 * Commit rules: release past `threshold` px always navigates (no time limit — the
 * arm indicator and the commit distance are the same line, so "indicator visible"
 * ⇒ "release will switch"), and a fast flick commits below the distance line.
 */

import { useRef, useEffect, useCallback } from 'react';
import { triggerHaptic, type VibrationIntensity } from '../utils/haptics';

export interface SwipeGestureOptions {
  /** Distance in px that commits the swipe on release (also arms the indicator) */
  threshold?: number;
  /** Max vertical movement before the drag commits — scroll-intent guard */
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
   * Fires when drag crosses the commit threshold.
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
  touchId: number;
  startX: number;
  startY: number;
  isTracking: boolean;
  isDragging: boolean;
  lastThresholdDir: 'left' | 'right' | null;
  /** Genuinely overflow-x-scrollable ancestors of the touch target */
  scrollables: HTMLElement[];
  /** Recent move samples (~last 100ms) for flick velocity */
  samples: { x: number; t: number }[];
}

// Horizontal movement that starts the visual drag
const MOVEMENT_THRESHOLD = 12;
// Flick commit: at least this fast (px/ms over the last ~100ms) and this far
const FLICK_VELOCITY = 0.5;
const FLICK_MIN_DISTANCE = 28;
// Window of move samples kept for velocity estimation
const VELOCITY_WINDOW_MS = 100;

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
    touchId: -1,
    startX: 0,
    startY: 0,
    isTracking: false,
    isDragging: false,
    lastThresholdDir: null,
    scrollables: [],
    samples: [],
  });

  // Pending cleanup for settle animations (cancelled if new touch starts)
  const animCleanupRef = useRef<(() => void) | null>(null);

  const clearAnimCleanup = useCallback(() => {
    animCleanupRef.current?.();
    animCleanupRef.current = null;
  }, []);

  /**
   * Animate the drag target back to translateX(0) and clear inline styles after.
   * With jumpFromPx set, the element first jumps there without transition — used
   * as the entrance slide when a swipe commits (new agent slides in from the
   * incoming side instead of teleporting to x=0).
   */
  const settleToZero = useCallback((jumpFromPx: number | null) => {
    const el = dragTarget?.current;
    if (!el) return;
    clearAnimCleanup();
    if (jumpFromPx !== null) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${jumpFromPx}px)`;
      // Flush layout so the transition below animates from the jump position
      void el.offsetWidth;
    }
    el.style.transition = 'transform 210ms ease-out';
    el.style.transform = 'translateX(0)';
    const cleanup = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
      animCleanupRef.current = null;
    };
    const tid = setTimeout(cleanup, 260);
    el.addEventListener('transitionend', cleanup, { once: true });
    animCleanupRef.current = () => {
      clearTimeout(tid);
      el.removeEventListener('transitionend', cleanup);
    };
  }, [dragTarget, clearAnimCleanup]);

  const snapBack = useCallback(() => settleToZero(null), [settleToZero]);

  /** Abort the gesture (vertical scroll takeover, second finger, touchcancel). */
  const cancelGesture = useCallback(() => {
    const state = touchStateRef.current;
    if (!state.isTracking) return;
    const wasDragging = state.isDragging;
    state.isTracking = false;
    state.isDragging = false;
    state.lastThresholdDir = null;
    if (wasDragging) {
      snapBack();
      onSwipeCancel?.();
    } else if (dragTarget?.current) {
      dragTarget.current.style.willChange = '';
    }
  }, [snapBack, onSwipeCancel, dragTarget]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Second finger landing mid-gesture → yield (two-finger gestures live elsewhere)
    if (touchStateRef.current.isTracking && e.touches.length > 1) {
      cancelGesture();
      return;
    }
    if (e.touches.length !== 1) return;
    // Mobile-layout check per gesture (not at bind time) so rotation/resize
    // while mounted never leaves stale bindings
    if (window.innerWidth > 768) return;

    // Collect genuinely scrollable-x ancestors. The yield decision is deferred to
    // the first directional move: a wide code block already at its scroll edge
    // should NOT eat the swipe (and overflow:hidden elements never should).
    const scrollables: HTMLElement[] = [];
    let el = e.target as HTMLElement | null;
    while (el && el !== ref.current) {
      if (el.scrollWidth > el.clientWidth + 1) {
        const ox = window.getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'overlay') scrollables.push(el);
      }
      el = el.parentElement;
    }

    // Cancel any in-progress settle animation so the new drag starts cleanly
    if (animCleanupRef.current && dragTarget?.current) {
      clearAnimCleanup();
      dragTarget.current.style.transition = '';
      dragTarget.current.style.transform = '';
    }

    const touch = e.touches[0];
    touchStateRef.current = {
      touchId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      isTracking: true,
      isDragging: false,
      lastThresholdDir: null,
      scrollables,
      samples: [{ x: touch.clientX, t: Date.now() }],
    };
  }, [ref, dragTarget, clearAnimCleanup, cancelGesture]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const state = touchStateRef.current;
    if (!state.isTracking) return;
    if (e.touches.length !== 1) {
      cancelGesture();
      return;
    }
    const touch = e.touches[0];
    if (touch.identifier !== state.touchId) return;

    const deltaX = touch.clientX - state.startX;
    const deltaY = Math.abs(touch.clientY - state.startY);
    const absDeltaX = Math.abs(deltaX);

    const now = Date.now();
    state.samples.push({ x: touch.clientX, t: now });
    while (state.samples.length > 2 && now - state.samples[0].t > VELOCITY_WINDOW_MS) {
      state.samples.shift();
    }

    if (!state.isDragging) {
      // Clearly vertical → hand the gesture to native scroll
      if (deltaY > absDeltaX * 2 && absDeltaX < 20) {
        state.isTracking = false;
        return;
      }
      if (deltaY > maxVerticalMovement && deltaY >= absDeltaX) {
        state.isTracking = false;
        return;
      }
      if (absDeltaX < MOVEMENT_THRESHOLD) return;
      // Wait for horizontal dominance before committing to the drag
      if (deltaY >= absDeltaX) return;

      // Native scroll already owns this gesture (preventDefault would be ignored)
      if (!e.cancelable) {
        state.isTracking = false;
        return;
      }

      // Yield only to ancestors that can actually scroll in this direction
      for (const scrollable of state.scrollables) {
        const canScroll = deltaX > 0
          ? scrollable.scrollLeft > 0
          : scrollable.scrollLeft < scrollable.scrollWidth - scrollable.clientWidth - 1;
        if (canScroll) {
          state.isTracking = false;
          return;
        }
      }

      state.isDragging = true;
      if (dragTarget?.current) {
        dragTarget.current.style.willChange = 'transform';
      }
      onDragStart?.();
    }

    // Committed horizontal drag: vertical drift no longer cancels (thumbs arc
    // naturally) and the page can't scroll because we prevent default here.
    e.preventDefault();

    // Apply live transform — directly to DOM, no React re-render
    if (dragTarget?.current) {
      const maxDelta = window.innerWidth * 0.55;
      const clamped = Math.max(-maxDelta, Math.min(maxDelta, deltaX));
      dragTarget.current.style.transform = `translateX(${clamped}px)`;
    }

    // Arm indicator exactly at the commit distance so a visible indicator always
    // means "release will switch". Ultra-light haptic tick when it arms.
    const newDir: 'left' | 'right' | null =
      deltaX >= threshold ? 'right' :
      deltaX <= -threshold ? 'left' :
      null;
    if (newDir !== state.lastThresholdDir) {
      state.lastThresholdDir = newDir;
      if (newDir !== null && vibrationIntensity > 0) triggerHaptic(1);
      onDragThreshold?.(newDir);
    }
  }, [threshold, maxVerticalMovement, vibrationIntensity, onDragStart, onDragThreshold, dragTarget, cancelGesture]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const state = touchStateRef.current;
    if (!state.isTracking) return;
    let touch: Touch | null = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === state.touchId) {
        touch = e.changedTouches[i];
        break;
      }
    }
    if (!touch) return; // some other finger lifted

    const deltaX = touch.clientX - state.startX;
    const wasDragging = state.isDragging;
    const firstSample = state.samples[0];
    state.isTracking = false;
    state.isDragging = false;
    state.lastThresholdDir = null;

    // Flick: fast recent movement in the same direction as the drag
    const dt = Date.now() - firstSample.t;
    const velocity = dt > 0 ? (touch.clientX - firstSample.x) / dt : 0;
    const isFlick =
      Math.abs(deltaX) >= FLICK_MIN_DISTANCE &&
      Math.abs(velocity) >= FLICK_VELOCITY &&
      Math.sign(velocity) === Math.sign(deltaX);

    const isValidSwipe = wasDragging && (Math.abs(deltaX) >= threshold || isFlick);

    if (isValidSwipe) {
      triggerHaptic(vibrationIntensity as VibrationIntensity);
      // Entrance slide: incoming agent settles in from the side it arrives from
      const entranceOffset = Math.min(56, window.innerWidth * 0.14);
      settleToZero(deltaX < 0 ? entranceOffset : -entranceOffset);
      if (deltaX > 0) {
        onSwipeRight?.();
      } else {
        onSwipeLeft?.();
      }
    } else if (wasDragging) {
      snapBack();
      onSwipeCancel?.();
    } else if (dragTarget?.current) {
      dragTarget.current.style.willChange = '';
    }
  }, [threshold, vibrationIntensity, onSwipeLeft, onSwipeRight, onSwipeCancel, dragTarget, snapBack, settleToZero]);

  const handleTouchCancel = useCallback(() => {
    cancelGesture();
  }, [cancelGesture]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    if (!('ontouchstart' in window)) return;

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
