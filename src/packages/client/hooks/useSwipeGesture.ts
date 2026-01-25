/**
 * Hook for detecting horizontal swipe gestures on mobile.
 * Used for navigating between agents in the guake terminal.
 */

import { useRef, useEffect, useCallback } from 'react';

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
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  isTracking: boolean;
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
  } = options;

  const touchStateRef = useRef<TouchState>({
    startX: 0,
    startY: 0,
    startTime: 0,
    isTracking: false,
  });

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      isTracking: true,
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStateRef.current.isTracking || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaY = Math.abs(touch.clientY - touchStateRef.current.startY);

    // If vertical movement exceeds threshold, stop tracking (it's a scroll)
    if (deltaY > maxVerticalMovement) {
      touchStateRef.current.isTracking = false;
    }
  }, [maxVerticalMovement]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStateRef.current.isTracking) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStateRef.current.startX;
    const deltaY = Math.abs(touch.clientY - touchStateRef.current.startY);
    const duration = Date.now() - touchStateRef.current.startTime;

    // Reset tracking
    touchStateRef.current.isTracking = false;

    // Check if it's a valid horizontal swipe
    // Must be primarily horizontal (deltaX > deltaY) and exceed threshold
    if (
      Math.abs(deltaX) >= threshold &&
      deltaY <= maxVerticalMovement &&
      duration < 500 // Must complete within 500ms for quick swipe
    ) {
      // Haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(15);
      }

      if (deltaX > 0) {
        // Swiped right (left-to-right)
        onSwipeRight?.();
      } else {
        // Swiped left (right-to-left)
        onSwipeLeft?.();
      }
    }
  }, [threshold, maxVerticalMovement, onSwipeLeft, onSwipeRight]);

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
