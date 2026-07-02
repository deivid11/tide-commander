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
 * exact same store.selectAgent() call a pinned chip click uses.
 */

import { useCallback, useMemo } from 'react';
import { store, useAgents, usePinnedAgentIds, useSettings } from '../../store';
import { useSwipeGesture } from '../../hooks';
import type { VibrationIntensity } from '../../utils/haptics';
import type { Agent } from '../../../shared/types';

export interface UsePinnedSwipeNavigationProps {
  /** The agent currently shown in this pane. */
  activeAgentId: string | null;
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
  activeAgentId,
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

  // Move `dir` steps through the pinned ring. When the active agent isn't pinned,
  // "next" starts at the first pin and "previous" at the last (sensible entry).
  const step = useCallback(
    (dir: 1 | -1) => {
      if (pinned.length < 2) return;
      const cur = pinned.findIndex((a) => a.id === activeAgentId);
      const base = cur === -1 ? (dir === 1 ? -1 : 0) : cur;
      const nextIdx = (base + dir + pinned.length) % pinned.length;
      store.setLastSelectionViaSwipe(true);
      store.selectAgent(pinned[nextIdx].id);
    },
    [pinned, activeAgentId],
  );

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
