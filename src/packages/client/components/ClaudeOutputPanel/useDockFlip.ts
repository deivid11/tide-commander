/**
 * FLIP glide for the agent activity thumbs.
 *
 * Thumbs slide from their previous screen position to the new one, so an agent
 * that finishes work travels to its new slot instead of popping out of one and
 * back in at the other.
 *
 * Drive it off a layout signature, never off the agent data: agents stream, so
 * measuring on every metric tick would force a layout several times a second
 * only to discover that nothing moved.
 */

import { useCallback, useLayoutEffect, useRef } from 'react';

const GLIDE_MS = 320;
const GLIDE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export interface DockFlip {
  /** Ref callback factory — attach as `ref={registerItem(agent.id)}`. */
  registerItem: (id: string) => (element: HTMLElement | null) => void;
}

export function useDockFlip(layoutSignature: string, exitingIds: ReadonlySet<string>): DockFlip {
  const items = useRef(new Map<string, HTMLElement>());
  const previousPositions = useRef(new Map<string, DOMRect>());
  // Read inside the layout effect without making it a dependency — re-running on
  // a new Set identity would re-measure on every render.
  const exitingRef = useRef(exitingIds);
  exitingRef.current = exitingIds;

  useLayoutEffect(() => {
    const nextPositions = new Map<string, DOMRect>();
    for (const [id, element] of items.current) {
      const next = element.getBoundingClientRect();
      nextPositions.set(id, next);
      const previous = previousPositions.current.get(id);
      if (!previous || exitingRef.current.has(id)) continue;
      const deltaX = previous.left - next.left;
      if (Math.abs(deltaX) < 1) continue;
      element.animate(
        [{ transform: `translateX(${deltaX}px)` }, { transform: 'translateX(0)' }],
        { duration: GLIDE_MS, easing: GLIDE_EASING },
      );
    }
    previousPositions.current = nextPositions;
  }, [layoutSignature]);

  // Cached per id: a fresh closure each render would make React detach and
  // re-attach every element on every render.
  const callbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const registerItem = useCallback((id: string) => {
    const existing = callbacks.current.get(id);
    if (existing) return existing;
    const callback = (element: HTMLElement | null) => {
      if (element) items.current.set(id, element);
      else items.current.delete(id);
    };
    callbacks.current.set(id, callback);
    return callback;
  }, []);

  return { registerItem };
}
