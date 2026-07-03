/**
 * usePinnedSwipeNavigation — horizontal swipe on the chat/output area cycles the
 * PINNED agents (the same list/order the PinnedAgentsBar shows).
 *
 * Touch-only (the underlying useSwipeGesture ignores mouse and non-mobile), so it
 * never fights text selection or the xterm/embedded terminal. Enabled only when
 * there are >= 2 pinned agents; otherwise it binds nothing and the existing
 * all-agent swipe (useSwipeNavigation) stays in charge.
 *
 * Direction matches the all-agent swipe + the boss spec: swipe LEFT → next pinned
 * agent, swipe RIGHT → previous, wrapping at both ends. Selection goes through the
 * shared store.cyclePinnedAgent() — the same next/prev-pinned logic the Alt+J/K
 * shortcut uses and ultimately the same store.selectAgent() a pinned chip click uses.
 */

import { useCallback, useMemo } from 'react';
import { store, useAgents, usePinnedAgentIds, useSettings } from '../../store';
import { useSwipeGesture } from '../../hooks';
import type { VibrationIntensity } from '../../utils/haptics';
import type { Agent } from '../../../shared/types';

export interface UsePinnedSwipeNavigationProps {
  /** The chat/output scroll element the gesture is attached to. */
  outputRef: React.RefObject<HTMLElement | null>;
  /** Only bind while the pane is actually visible/open. */
  enabled?: boolean;
}

export interface UsePinnedSwipeNavigationReturn {
  /** True when the pinned swipe is live (>= 2 pinned agents and enabled). */
  active: boolean;
  /** How many pinned agents currently resolve to a live agent. */
  pinnedCount: number;
}

export function usePinnedSwipeNavigation({
  outputRef,
  enabled = true,
}: UsePinnedSwipeNavigationProps): UsePinnedSwipeNavigationReturn {
  const pinnedIds = usePinnedAgentIds();
  const agents = useAgents();
  const settings = useSettings();
  const vibrationIntensity = (settings.vibrationIntensity ?? 1) as VibrationIntensity;

  // Same list + order the PinnedAgentsBar renders: pin order, existing agents only.
  // Memoized so the gesture callbacks/listeners don't churn on unrelated pane
  // re-renders (this pane re-renders on every streamed output line).
  const pinned = useMemo(
    () => pinnedIds.map((id) => agents.get(id)).filter((a): a is Agent => !!a),
    [pinnedIds, agents],
  );
  const active = enabled && pinned.length >= 2;

  // Delegate the next/prev-pinned selection (wrap + sensible entry when the active
  // agent isn't pinned) to the shared store method, so swipe and Alt+J/K stay in sync.
  const step = useCallback((dir: 1 | -1) => {
    store.setLastSelectionViaSwipe(true);
    store.cyclePinnedAgent(dir);
  }, []);

  const onSwipeLeft = useCallback(() => step(1), [step]); // left → next
  const onSwipeRight = useCallback(() => step(-1), [step]); // right → previous

  useSwipeGesture(outputRef, {
    enabled: active,
    threshold: 50,
    maxVerticalMovement: 35,
    onSwipeLeft,
    onSwipeRight,
    // Live translateX drag feel + snap-back (same target the all-agent swipe uses;
    // outputRef is the scroll area, NOT an ancestor of the fixed input wrapper).
    dragTarget: outputRef,
    vibrationIntensity,
  });

  return { active, pinnedCount: pinned.length };
}
