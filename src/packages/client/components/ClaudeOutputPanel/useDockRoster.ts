/**
 * Agent activity dock — React glue around the roster logic in dockRoster.ts.
 *
 * Owns the working-hold timer and keeps departed agents mounted for one exit
 * animation. An agent that merely swaps lanes is NOT an exit: it stays mounted
 * so the panel's FLIP pass glides it across the divider instead of popping out
 * of one lane and back in on the other.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDockRoster,
  dockLayoutSignature,
  haveSameIds,
  settleWorkingHolds,
  settleWorkRecency,
  DOCK_EXIT_MS,
  EMPTY_DOCK_SLOTS,
  type DockEntry,
  type DockSlots,
} from './dockRoster';
import type { Agent } from '../../../shared/types';

/**
 * Persistent state for a dock scope, living OUTSIDE the component lifecycle.
 *
 * AgentTerminalPane is keyed by agent id (FlatView/index.tsx,
 * SplitTerminalLayout.tsx), so selecting an agent REMOUNTS everything inside it
 * — component-local refs die on every click. Keeping recency seeds, held slots
 * and working holds in refs is what made the bar reshuffle on selection no
 * matter how stable the in-lifetime logic was: each remount re-seeded recency
 * from the click-restamped lastActivity. Anything that must survive selection
 * lives here instead, keyed by a stable scope string ('pinned-bar',
 * 'overview-dock'). Instances sharing a scope share state — that is the point.
 */
interface DockScopeState {
  recency: Map<string, number>;
  releaseAt: Map<string, number>;
  slots: DockSlots;
}
const dockScopes = new Map<string, DockScopeState>();
function getDockScope(key: string): DockScopeState {
  let state = dockScopes.get(key);
  if (!state) {
    state = { recency: new Map(), releaseAt: new Map(), slots: EMPTY_DOCK_SLOTS };
    dockScopes.set(key, state);
  }
  return state;
}

/**
 * Click-immune recency for a set of agents: seeded once from `lastActivity`
 * when an agent is first seen, advanced only by observed work thereafter (see
 * settleWorkRecency). The returned Map is a stable, mutated-in-place identity —
 * consumers must depend on `agents` (they inevitably already do), not on the
 * map, to pick up new values.
 *
 * Pass `scope` so the seeds survive host remounts (see DockScopeState); without
 * it the tracker is per-instance and dies with the component.
 */
export function useWorkRecency(agents: Agent[], scope?: string): ReadonlyMap<string, number> {
  const localRef = useRef<Map<string, number> | null>(null);
  const state = scope ? getDockScope(scope).recency : (localRef.current ??= new Map());
  return useMemo(() => settleWorkRecency(agents, state, Date.now()), [agents, state]);
}

export interface DockRoster {
  /** Working lane first, then the recent lane; includes agents still animating out. */
  entries: DockEntry[];
  /** Agents playing their exit animation — they no longer belong to either lane. */
  exitingIds: Set<string>;
  /** Agents holding a working slot (the hold outlives brief drops to idle). */
  workingIds: Set<string>;
  /** Changes only when a thumb actually has to move — cheap dep for the FLIP pass. */
  layoutSignature: string;
}

export interface DockRosterOptions {
  /** Shared recency map (useWorkRecency over a superset of `agents`) — pass it
   * when the host already tracks one, so both stay consistent. Defaults to an
   * internal tracker over `agents`. */
  recency?: ReadonlyMap<string, number>;
  /** Persistence scope. Without it every host remount (AgentTerminalPane is
   * keyed by agent id, so EVERY selection remounts) resets slots and holds —
   * i.e. the bar reshuffles on click. Real dock hosts must pass one. */
  scope?: string;
  /** Size of the "recently active" lane (default DOCK_RECENT_SIZE). 0 hides the
   * lane entirely — the dock then only shows agents working right now. */
  recentSize?: number;
}

export function useDockRoster(agents: Agent[], options?: DockRosterOptions): DockRoster {
  const scope = options?.scope ? getDockScope(options.scope) : null;
  // When an external recency is supplied, the internal tracker must NOT settle
  // the scoped map — it only sees `agents` (a subset) and its cleanup would
  // evict everyone else, re-seeding them later from click-tainted lastActivity.
  const internalRecency = useWorkRecency(agents, options?.recency ? undefined : options?.scope);
  const effectiveRecency = options?.recency ?? internalRecency;
  const releaseAtRef = useRef(new Map<string, number>());
  const releaseAt = scope ? scope.releaseAt : releaseAtRef.current;
  // Restore the working set synchronously on (re)mount — deriving it in the
  // settle effect only would paint one frame with an empty working lane after
  // every selection.
  const [workingIds, setWorkingIds] = useState<Set<string>>(() => {
    const now = Date.now();
    const ids = new Set<string>();
    for (const [id, deadline] of releaseAt) {
      if (deadline > now) ids.add(id);
    }
    return ids;
  });

  // One timer for the whole dock, armed on the earliest expiring hold. Agents
  // stream constantly, so this effect re-runs often — settling is idempotent and
  // only re-renders when the working set genuinely changed.
  useEffect(() => {
    let timer = 0;

    const settle = () => {
      const { workingIds: next, nextDeadline } = settleWorkingHolds(agents, releaseAt, Date.now());
      setWorkingIds((previous) => (haveSameIds(previous, next) ? previous : next));
      if (nextDeadline !== null) timer = window.setTimeout(settle, Math.max(16, nextDeadline - Date.now()));
    };

    settle();
    return () => window.clearTimeout(timer);
  }, [agents, releaseAt]);

  const recentSize = options?.recentSize;
  const slotsRef = useRef<DockSlots>(EMPTY_DOCK_SLOTS);
  const entries = useMemo(() => {
    const previousSlots = scope ? scope.slots : slotsRef.current;
    const roster = buildDockRoster(agents, workingIds, previousSlots, effectiveRecency, recentSize);
    if (scope) scope.slots = roster.slots;
    else slotsRef.current = roster.slots;
    return roster.entries;
  }, [agents, workingIds, effectiveRecency, scope, recentSize]);

  const [visible, setVisible] = useState<DockEntry[]>(entries);
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  const visibleRef = useRef<DockEntry[]>(entries);
  // Per-agent exit timers: `entries` gets a new identity on every metric tick, so
  // a single effect-scoped timeout would be cleared and rescheduled forever and
  // the departed thumb would linger — invisible, but still taking up its slot.
  const exitTimersRef = useRef(new Map<string, number>());

  useEffect(() => () => {
    for (const timer of exitTimersRef.current.values()) window.clearTimeout(timer);
    exitTimersRef.current.clear();
  }, []);

  useEffect(() => {
    const liveIds = new Set(entries.map((entry) => entry.agent.id));

    // An agent that came back before its exit finished keeps its slot instead.
    for (const [id, timer] of exitTimersRef.current) {
      if (!liveIds.has(id)) continue;
      window.clearTimeout(timer);
      exitTimersRef.current.delete(id);
    }

    const departed = visibleRef.current
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !liveIds.has(entry.agent.id));
    const commit = (next: DockEntry[]) => {
      visibleRef.current = next;
      setVisible(next);
      const exiting = new Set(exitTimersRef.current.keys());
      setExitingIds((previous) => (haveSameIds(previous, exiting) ? previous : exiting));
    };

    for (const { entry } of departed) {
      const { id } = entry.agent;
      if (exitTimersRef.current.has(id)) continue;
      exitTimersRef.current.set(id, window.setTimeout(() => {
        exitTimersRef.current.delete(id);
        commit(visibleRef.current.filter((current) => current.agent.id !== id));
      }, DOCK_EXIT_MS));
    }

    // Departing thumbs hold the slot they occupied so they fade out in place
    // rather than jumping to the end of the strip first.
    const merged = [...entries];
    for (const { entry, index } of departed) merged.splice(Math.min(index, merged.length), 0, entry);
    commit(merged);
  }, [entries]);

  return {
    entries: visible,
    exitingIds,
    workingIds,
    layoutSignature: useMemo(() => dockLayoutSignature(visible), [visible]),
  };
}
