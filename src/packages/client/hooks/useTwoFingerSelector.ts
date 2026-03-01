/**
 * Hook for two-finger agent selection (mobile).
 *
 * Gesture detection happens on the terminal output area (gestureRef).
 * When two fingers are detected, the vertical movement drives a cursor
 * on the agent overview panel (agentListRef). The agent list scrolls
 * under a fixed center cursor — like a slot-machine / pick-wheel.
 *
 * Sets `touch-action: none` on the gesture container so the browser
 * never hijacks two-finger sequences. One-finger vertical scrolling
 * is re-implemented manually with momentum.
 *
 * Requirements:
 * - Agent card elements must have `data-agent-id` attributes for hit-testing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { triggerHaptic, type VibrationIntensity } from '../utils/haptics';
import { store } from '../store';

export interface TwoFingerSelectorOptions {
  /** Element where the two-finger gesture is detected (terminal output). */
  gestureRef: React.RefObject<HTMLElement | null>;
  /** Element containing the agent cards (overview panel list). */
  agentListRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  onSelect: (agentId: string) => void;
}

export interface TwoFingerSelectorState {
  isActive: boolean;
  hoveredAgentId: string | null;
}

// ── scroll constants ────────────────────────────────────────────────
const DIRECTION_THRESHOLD = 8;   // px before we decide scroll vs swipe
const MOMENTUM_FRICTION   = 0.93;
const MOMENTUM_MIN_VEL    = 0.4; // px per frame

export function useTwoFingerSelector(options: TwoFingerSelectorOptions): TwoFingerSelectorState {
  const { gestureRef, agentListRef, enabled, onSelect } = options;

  const [isActive, setIsActive] = useState(false);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);

  const isActiveRef        = useRef(false);
  const hoveredAgentIdRef  = useRef<string | null>(null);
  const onSelectRef        = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* ── helpers ──────────────────────────────────────────────────── */

  const activate = useCallback(() => {
    if (isActiveRef.current) return;
    isActiveRef.current = true;
    setIsActive(true);
    // Add padding so first/last cards can be scrolled to center for hit-testing
    const agentList = agentListRef.current;
    if (agentList) {
      const halfHeight = Math.round(agentList.clientHeight / 2);
      agentList.style.paddingTop = `${halfHeight}px`;
      agentList.style.paddingBottom = `${halfHeight}px`;
    }
  }, [agentListRef]);

  const reset = useCallback(() => {
    isActiveRef.current = false;
    hoveredAgentIdRef.current = null;
    setIsActive(false);
    setHoveredAgentId(null);
    // Remove the selection padding
    const agentList = agentListRef.current;
    if (agentList) {
      agentList.style.paddingTop = '';
      agentList.style.paddingBottom = '';
    }
  }, [agentListRef]);

  /**
   * Scroll the agent list by `deltaY` and hit-test the card under the
   * center of the visible agent list.
   */
  const scrollAndHitTest = useCallback((deltaY: number) => {
    const agentList = agentListRef.current;
    if (!agentList) return;

    // Scroll the agent list by the gesture delta
    agentList.scrollTop += deltaY;

    // Hit-test at the vertical center of the visible agent list
    const rect = agentList.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const centerX = rect.left + rect.width / 2;
    const el = document.elementFromPoint(centerX, centerY);
    let newId: string | null = null;
    if (el) {
      const card = el.closest<HTMLElement>('[data-agent-id]');
      if (card && agentList.contains(card)) newId = card.dataset.agentId!;
    }
    if (newId !== hoveredAgentIdRef.current) {
      hoveredAgentIdRef.current = newId;
      setHoveredAgentId(newId);
      if (newId) {
        const intensity = (store.getState().settings.vibrationIntensity ?? 1) as VibrationIntensity;
        triggerHaptic(intensity);
      }
    }
  }, [agentListRef]);

  const selectAndReset = useCallback(() => {
    const id = hoveredAgentIdRef.current;
    if (id) {
      const base = (store.getState().settings.vibrationIntensity ?? 1) as number;
      const confirmIntensity = Math.min(base + 1, 3) as VibrationIntensity;
      triggerHaptic(confirmIntensity);
      onSelectRef.current(id);
    }
    reset();
  }, [reset]);

  /* ── main effect ─────────────────────────────────────────────── */

  useEffect(() => {
    const container = gestureRef.current;
    if (!container || !enabled) return;

    // ── take full control of touch on this element ──
    const prev = container.style.touchAction;
    container.style.touchAction = 'none';

    // ── manual-scroll bookkeeping (one-finger scroll for the terminal) ──
    let trackingTouch = false;   // first finger down, direction unknown
    let scrolling     = false;   // confirmed vertical scroll
    let startX = 0, startY = 0;
    let startScrollTop = 0;
    let lastY = 0, lastTime = 0, velY = 0;
    let rafId = 0;

    // ── two-finger bookkeeping ──
    let twoFingerLastMidY = 0;

    const stopMomentum = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };

    const tick = () => {
      if (Math.abs(velY) < MOMENTUM_MIN_VEL) { velY = 0; return; }
      container.scrollTop += velY;
      velY *= MOMENTUM_FRICTION;
      rafId = requestAnimationFrame(tick);
    };

    // ── touch handlers ──

    const onStart = (e: TouchEvent) => {
      stopMomentum();

      if (e.touches.length >= 2) {
        // Two fingers → agent selection mode
        e.preventDefault();
        trackingTouch = false;
        scrolling = false;
        twoFingerLastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        activate();
        // Initial hit-test with 0 delta
        scrollAndHitTest(0);
        return;
      }

      // One finger → begin tracking (we'll decide scroll vs swipe on move)
      trackingTouch = true;
      scrolling = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startScrollTop = container.scrollTop;
      lastY = startY;
      lastTime = performance.now();
      velY = 0;
    };

    const onMove = (e: TouchEvent) => {
      // ── two-finger mode ──
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (scrolling || trackingTouch) { scrolling = false; trackingTouch = false; }
        if (!isActiveRef.current) {
          twoFingerLastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          activate();
          scrollAndHitTest(0);
          return;
        }

        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const deltaY = twoFingerLastMidY - midY; // scroll down when fingers move up
        twoFingerLastMidY = midY;
        scrollAndHitTest(deltaY);
        return;
      }

      // ── selection still active with one remaining finger ──
      if (isActiveRef.current && e.touches.length === 1) {
        e.preventDefault();
        const curY = e.touches[0].clientY;
        const deltaY = twoFingerLastMidY - curY;
        twoFingerLastMidY = curY;
        scrollAndHitTest(deltaY);
        return;
      }

      // ── one-finger manual scroll (for the terminal) ──
      if (!trackingTouch && !scrolling) return;

      const curX = e.touches[0].clientX;
      const curY = e.touches[0].clientY;

      // Direction lock: decide once whether it's vertical (scroll) or horizontal (swipe)
      if (trackingTouch && !scrolling) {
        const dx = Math.abs(curX - startX);
        const dy = Math.abs(curY - startY);
        if (dx < DIRECTION_THRESHOLD && dy < DIRECTION_THRESHOLD) return;
        if (dy >= dx) {
          scrolling = true;
          trackingTouch = false;
          e.preventDefault();
        } else {
          trackingTouch = false;
          return;
        }
      }

      if (scrolling) {
        e.preventDefault();
        const now = performance.now();
        const dt = now - lastTime;
        container.scrollTop = startScrollTop + (startY - curY);
        if (dt > 0) velY = ((lastY - curY) / dt) * 16;
        lastY = curY;
        lastTime = now;
      }
    };

    const onEnd = (e: TouchEvent) => {
      // All fingers released while selecting → select agent
      if (isActiveRef.current && e.touches.length === 0) {
        selectAndReset();
        return;
      }

      // Still have fingers down while selecting → keep going
      if (isActiveRef.current) return;

      // One-finger release → start momentum scroll
      if ((scrolling || trackingTouch) && e.touches.length === 0) {
        if (scrolling && Math.abs(velY) > MOMENTUM_MIN_VEL) {
          rafId = requestAnimationFrame(tick);
        }
        scrolling = false;
        trackingTouch = false;
      }
    };

    const onCancel = () => {
      scrolling = false;
      trackingTouch = false;
      stopMomentum();
      if (isActiveRef.current) reset();
    };

    container.addEventListener('touchstart',  onStart,  { passive: false });
    container.addEventListener('touchmove',   onMove,   { passive: false });
    container.addEventListener('touchend',    onEnd,    { passive: true  });
    container.addEventListener('touchcancel', onCancel, { passive: true  });

    return () => {
      container.removeEventListener('touchstart',  onStart);
      container.removeEventListener('touchmove',   onMove);
      container.removeEventListener('touchend',    onEnd);
      container.removeEventListener('touchcancel', onCancel);
      container.style.touchAction = prev;
      stopMomentum();
      // Restore padding if unmounted while active
      const al = agentListRef.current;
      if (al) { al.style.paddingTop = ''; al.style.paddingBottom = ''; }
    };
  }, [gestureRef, agentListRef, enabled, activate, reset, scrollAndHitTest, selectAndReset]);

  return { isActive, hoveredAgentId };
}
