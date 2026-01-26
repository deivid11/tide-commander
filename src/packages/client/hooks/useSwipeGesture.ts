/**
 * Hook for detecting horizontal swipe gestures on mobile.
 * Used for navigating between agents in the guake terminal.
 * Supports visual feedback during swipe with onSwipeMove callback.
 */

import { useRef, useEffect, useCallback } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

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
  /** Callback during swipe movement with current offset (-1 to 1, negative = left) */
  onSwipeMove?: (offset: number) => void;
  /** Callback when swipe ends without triggering navigation (resets animation) */
  onSwipeCancel?: () => void;
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  isTracking: boolean;
  hasMovedEnough: boolean; // Track if we've started showing visual feedback
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
    onSwipeMove,
    onSwipeCancel,
  } = options;

  const touchStateRef = useRef<TouchState>({
    startX: 0,
    startY: 0,
    startTime: 0,
    isTracking: false,
    hasMovedEnough: false,
  });

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      isTracking: true,
      hasMovedEnough: false,
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStateRef.current.isTracking || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStateRef.current.startX;
    const deltaY = Math.abs(touch.clientY - touchStateRef.current.startY);

    // If vertical movement exceeds threshold, stop tracking (it's a scroll)
    if (deltaY > maxVerticalMovement) {
      touchStateRef.current.isTracking = false;
      // Reset visual feedback if we had started showing it
      if (touchStateRef.current.hasMovedEnough) {
        onSwipeCancel?.();
      }
      return;
    }

    // Calculate normalized offset for visual feedback
    // Use screen width to normalize, with a max offset of ~0.5 (half screen)
    const screenWidth = window.innerWidth;
    const maxOffset = screenWidth * 0.4; // Max visual offset is 40% of screen
    const normalizedOffset = Math.max(-1, Math.min(1, deltaX / maxOffset));

    // Only start showing visual feedback once we've moved a bit (12px minimum for more sensitivity)
    const movementThreshold = 12;
    if (Math.abs(deltaX) >= movementThreshold) {
      touchStateRef.current.hasMovedEnough = true;
      onSwipeMove?.(normalizedOffset);
    }
  }, [maxVerticalMovement, onSwipeMove, onSwipeCancel]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const wasTracking = touchStateRef.current.isTracking;
    const hadMovedEnough = touchStateRef.current.hasMovedEnough;

    if (!wasTracking) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStateRef.current.startX;
    const deltaY = Math.abs(touch.clientY - touchStateRef.current.startY);
    const duration = Date.now() - touchStateRef.current.startTime;

    // Reset tracking
    touchStateRef.current.isTracking = false;
    touchStateRef.current.hasMovedEnough = false;

    // Check if it's a valid horizontal swipe
    // Must be primarily horizontal (deltaX > deltaY) and exceed threshold
    if (
      Math.abs(deltaX) >= threshold &&
      deltaY <= maxVerticalMovement &&
      duration < 500 // Must complete within 500ms for quick swipe
    ) {
      // Light haptic feedback using Capacitor Haptics
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
        // Fallback to web vibration API if Haptics not available
        if (navigator.vibrate) {
          navigator.vibrate(8);
        }
      });

      if (deltaX > 0) {
        // Swiped right (left-to-right)
        onSwipeRight?.();
      } else {
        // Swiped left (right-to-left)
        onSwipeLeft?.();
      }
    } else if (hadMovedEnough) {
      // Swipe didn't complete but we showed visual feedback, so animate back
      onSwipeCancel?.();
    }
  }, [threshold, maxVerticalMovement, onSwipeLeft, onSwipeRight, onSwipeCancel]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    // Only enable on mobile (check for touch support and screen width)
    const isMobile = window.innerWidth <= 768 && 'ontouchstart' in window;
    if (!isMobile) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref, enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);
}
