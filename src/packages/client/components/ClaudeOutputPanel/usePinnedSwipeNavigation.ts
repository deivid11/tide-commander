/**
 * usePinnedSwipeNavigation — horizontal swipe on the Guake chat/output area
 * follows the quick-select bar rendered below the composer.
 *
 * The bar contains pins followed by working/recent agents when the activity dock
 * is in `composer` mode. Reading its live DOM order at commit time guarantees a
 * swipe visits exactly what the user sees, including grouping/filter changes and
 * stable recent-agent slots, without duplicating the bar's roster logic here.
 *
 * Touch-only (the underlying useSwipeGesture ignores mouse and non-mobile), so it
 * never fights desktop text selection or the xterm/embedded terminal. Swipe LEFT
 * selects the next visible chip, swipe RIGHT the previous one, with wrapping.
 */

import { useCallback, useMemo } from 'react';
import { store, useAgents, usePinnedAgentIds, useSettings } from '../../store';
import { useSwipeGesture } from '../../hooks';
import { useAgentDockPosition } from './agentDockPosition';
import type { VibrationIntensity } from '../../utils/haptics';
import type { Agent } from '../../../shared/types';
import { getQuickSelectSwipeTarget } from './quickSelectSwipe';

export interface UsePinnedSwipeNavigationProps {
  /** Agent currently rendered by this pane (important when split panes exist). */
  activeAgentId: string;
  /** The chat/output scroll element the gesture is attached to. */
  outputRef: React.RefObject<HTMLElement | null>;
  /** Only bind while the pane is actually visible/open. */
  enabled?: boolean;
}

export interface UsePinnedSwipeNavigationReturn {
  /** True when the quick-select-bar swipe owns the Guake output gesture. */
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
  const dockPosition = useAgentDockPosition();
  const vibrationIntensity = (settings.vibrationIntensity ?? 1) as VibrationIntensity;

  // Same list + order the PinnedAgentsBar renders: pin order, existing agents only.
  // Memoized so the gesture callbacks/listeners don't churn on unrelated pane
  // re-renders (this pane re-renders on every streamed output line).
  const pinned = useMemo(
    () => pinnedIds.map((id) => agents.get(id)).filter((a): a is Agent => !!a),
    [pinnedIds, agents],
  );
  // In composer mode the bar may have zero pins but several working/recent
  // agents, so it must own the gesture regardless of pin count. Outside that
  // mode it remains the pinned-only navigator when there are at least two pins.
  const active = enabled && (dockPosition === 'composer' || pinned.length >= 2);

  const step = useCallback((dir: 1 | -1) => {
    const output = outputRef.current;
    if (!output) return;
    const pane = output.closest<HTMLElement>('.split-terminal-pane, .split-terminal-layout, .flat-terminal-wrapper');
    const bar = pane?.querySelector<HTMLElement>('.pinned-agents-bar');
    if (!bar) return;

    // Exiting recent chips remain mounted briefly for animation but no longer
    // belong to the live roster and must not become swipe targets.
    const ids = Array.from(bar.querySelectorAll<HTMLElement>('.pinned-agent[data-agent-id]:not(.exiting)'))
      .map((chip) => chip.dataset.agentId)
      .filter((id): id is string => !!id && store.getState().agents.has(id));
    const target = getQuickSelectSwipeTarget(ids, activeAgentId, dir);
    if (!target) return;
    store.setLastSelectionViaSwipe(true);
    store.selectAgent(target);
  }, [activeAgentId, outputRef]);

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
