/**
 * Swipe-left-to-dismiss for in-app toasts / notifications (mobile).
 *
 * Uses refs for the live offset so touchend always sees the true finger
 * position (React state alone is often one frame behind and fails to dismiss).
 * Horizontal axis is locked after a short dead zone so vertical scroll still works.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

export interface UseSwipeToDismissOptions {
  /** Called when the user commits a left swipe past the threshold */
  onDismiss: () => void;
  /** Optional tap (no meaningful swipe) */
  onTap?: () => void;
  /** Distance in px that commits dismiss (default 72) */
  threshold?: number;
  /** CSS selector for buttons that should not count as a toast tap */
  ignoreTapSelector?: string;
  /** Haptic feedback when dismiss commits */
  onDismissHaptic?: () => void;
}

export interface UseSwipeToDismissResult {
  /** Attach to the swipeable element */
  ref: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  isDismissing: boolean;
  isSwiping: boolean;
}

const DEAD_ZONE = 8;
const DISMISS_SLIDE_MS = 200;

export function useSwipeToDismiss({
  onDismiss,
  onTap,
  threshold = 72,
  ignoreTapSelector = 'button, a, input, textarea, [role="button"]',
  onDismissHaptic,
}: UseSwipeToDismissOptions): UseSwipeToDismissResult {
  const elRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const axisRef = useRef<'none' | 'h' | 'v'>('none');
  const offsetRef = useRef(0);
  const swipingRef = useRef(false);
  const dismissingRef = useRef(false);

  const [offsetX, setOffsetX] = useState(0);
  const [isDismissing, setIsDismissing] = useState(false);
  const [isSwiping, setIsSwiping] = useState(false);

  // Keep latest callbacks without re-binding listeners every render
  const onDismissRef = useRef(onDismiss);
  const onTapRef = useRef(onTap);
  const onHapticRef = useRef(onDismissHaptic);
  onDismissRef.current = onDismiss;
  onTapRef.current = onTap;
  onHapticRef.current = onDismissHaptic;

  const reset = useCallback(() => {
    offsetRef.current = 0;
    swipingRef.current = false;
    axisRef.current = 'none';
    setOffsetX(0);
    setIsSwiping(false);
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (dismissingRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      startRef.current = { x: t.clientX, y: t.clientY };
      axisRef.current = 'none';
      offsetRef.current = 0;
      swipingRef.current = false;
      setIsSwiping(false);
      setOffsetX(0);
    };

    const onMove = (e: TouchEvent) => {
      if (dismissingRef.current) return;
      const t = e.touches[0];
      if (!t) return;

      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;

      if (axisRef.current === 'none') {
        if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
        axisRef.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }

      // Vertical gesture: leave scrolling alone
      if (axisRef.current === 'v') return;

      // Only left swipe dismisses
      if (dx >= 0) {
        if (offsetRef.current !== 0) {
          offsetRef.current = 0;
          setOffsetX(0);
        }
        swipingRef.current = false;
        setIsSwiping(false);
        return;
      }

      // Claim the gesture so the browser / parent doesn't steal it
      if (e.cancelable) e.preventDefault();

      swipingRef.current = true;
      offsetRef.current = dx;
      setIsSwiping(true);
      setOffsetX(dx);
    };

    const onEnd = (e: TouchEvent) => {
      if (dismissingRef.current) return;

      const dx = offsetRef.current;
      const wasHorizontal = axisRef.current === 'h' && swipingRef.current;
      const axis = axisRef.current;
      axisRef.current = 'none';

      if (wasHorizontal && dx < -threshold) {
        dismissingRef.current = true;
        setIsDismissing(true);
        setOffsetX(-Math.max(window.innerWidth, 400));
        setIsSwiping(false);
        onHapticRef.current?.();
        window.setTimeout(() => {
          onDismissRef.current();
        }, DISMISS_SLIDE_MS);
        return;
      }

      // Snap back
      if (dx !== 0) {
        reset();
      } else {
        swipingRef.current = false;
        setIsSwiping(false);
      }

      // Tap: no axis lock past dead zone, not on interactive child
      if (axis === 'none' && onTapRef.current) {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(ignoreTapSelector)) return;
        onTapRef.current();
      }
    };

    const onCancel = () => {
      if (dismissingRef.current) return;
      reset();
    };

    // non-passive so preventDefault works during horizontal swipe
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [threshold, ignoreTapSelector, reset]);

  const style: CSSProperties = {
    transform: isDismissing
      ? 'translateX(-120%)'
      : offsetX
        ? `translateX(${offsetX}px)`
        : undefined,
    opacity: isDismissing
      ? 0
      : offsetX < 0
        ? Math.max(0.35, 1 - Math.abs(offsetX) / (threshold * 2.2))
        : undefined,
    transition: isSwiping && !isDismissing
      ? 'none'
      : `transform ${DISMISS_SLIDE_MS}ms ease-out, opacity ${DISMISS_SLIDE_MS}ms ease-out`,
    touchAction: 'pan-y',
    willChange: isSwiping || isDismissing ? 'transform, opacity' : undefined,
  };

  return {
    ref: elRef,
    style,
    isDismissing,
    isSwiping,
  };
}
