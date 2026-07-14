/**
 * Agent activity dock — roster logic.
 *
 * The dock reads live signals that are far noisier than what they represent:
 *
 * - `agent.lastActivity` is rewritten by EVERY updateAgent (agent-service
 *   restamps it unconditionally) — metric ticks while streaming, but also the
 *   calls provoked by merely opening an agent. It answers "when was this agent
 *   last touched", not "when did it last work", so anything ordered or filtered
 *   by it live moves the moment you click.
 * - `agent.status` drops to a non-working value for a few hundred ms between
 *   tool calls, so a working agent flickers out of the working lane and back.
 *
 * All of it is smoothed here: working slots are held across the gaps
 * (DOCK_WORKING_HOLD_MS), slots never reorder while occupied, and recency comes
 * from settleWorkRecency — seeded once from lastActivity at first sight, then
 * advanced only by actually observed work — so a click changes nothing.
 */

import type { Agent } from '../../../shared/types';

/** Actively running, or blocked mid-task waiting on input/permission. */
export function isWorkingStatus(status: Agent['status']): boolean {
  return status === 'working' || status === 'waiting' || status === 'waiting_permission';
}

/** Default size of the "recently active" lane — the user can override it via
 * Settings (see useAgentDockRecentSize in agentDockPosition.ts). */
export const DOCK_RECENT_SIZE = 4;

/** How long an agent keeps its working-lane slot after its last sign of work. */
export const DOCK_WORKING_HOLD_MS = 4000;

/** Exit animation length — must match the keyframes in _overview-panel.scss. */
export const DOCK_EXIT_MS = 260;

export type DockLane = 'recent' | 'working';

export interface DockEntry {
  agent: Agent;
  lane: DockLane;
}

/**
 * Refresh the working-hold deadlines from the current agent list.
 *
 * `releaseAt` is mutated in place: agents seen working get their deadline pushed
 * out, agents that left the roster are dropped. Returns the ids that still hold
 * a working slot plus the next deadline to wake up on (null when none is
 * pending), so the caller can arm a single timer instead of one per agent.
 */
export function settleWorkingHolds(
  agents: readonly Agent[],
  releaseAt: Map<string, number>,
  now: number,
): { workingIds: Set<string>; nextDeadline: number | null } {
  const present = new Set(agents.map((agent) => agent.id));

  for (const agent of agents) {
    if (isWorkingStatus(agent.status)) releaseAt.set(agent.id, now + DOCK_WORKING_HOLD_MS);
  }

  const workingIds = new Set<string>();
  let nextDeadline: number | null = null;

  for (const [id, deadline] of releaseAt) {
    // An agent that vanished from the roster has nothing left to hold a slot for.
    if (!present.has(id) || deadline <= now) {
      releaseAt.delete(id);
      continue;
    }
    workingIds.add(id);
    if (nextDeadline === null || deadline < nextDeadline) nextDeadline = deadline;
  }

  return { workingIds, nextDeadline };
}

/**
 * Session-scoped work recency, the click-immune replacement for `lastActivity`.
 *
 * Each agent's recency is seeded ONCE when first seen — from its persisted
 * `lastActivity`, the only boot-time signal there is — and from then on
 * advances only when the agent is actually observed working. The live
 * `lastActivity` is never read again, so the selection-provoked updateAgents
 * that restamp it (the "every click reshuffles the bar" bug) have no effect.
 *
 * `state` is mutated in place and returned; agents that left the roster are
 * dropped so it cannot grow unbounded.
 */
export function settleWorkRecency(
  agents: readonly Agent[],
  state: Map<string, number>,
  now: number,
): Map<string, number> {
  const present = new Set<string>();
  for (const agent of agents) {
    present.add(agent.id);
    if (!state.has(agent.id)) {
      // Clamp the seed — client/server clock skew must not mint recency from
      // the future and permanently outrank genuinely working agents.
      state.set(agent.id, Math.min(agent.lastActivity || 0, now));
    }
    if (isWorkingStatus(agent.status)) state.set(agent.id, now);
  }
  for (const id of state.keys()) {
    if (!present.has(id)) state.delete(id);
  }
  return state;
}

/** The slot order each lane held on the previous pass, keyed by agent id. */
export interface DockSlots {
  working: readonly string[];
  recent: readonly string[];
}

export const EMPTY_DOCK_SLOTS: DockSlots = { working: [], recent: [] };

/**
 * Keep whoever is already docked in the slot they occupy; departures simply
 * free their slot. Newcomers are inserted by recency RELATIVE to the held
 * members — in front of the first member they outrank — without ever
 * reordering the held members among themselves. So an agent that just finished
 * working (recency ≈ now) enters the recent lane at the FRONT, where "most
 * recent" belongs, while an agent that merely re-qualified for a freed slot
 * (older than everyone held) joins at the back. Clicks still move nothing:
 * recency here is WORK recency (settleWorkRecency), which clicks don't touch.
 */
function orderBySlots(
  agents: readonly Agent[],
  previousSlots: readonly string[],
  recencyOf: (agent: Agent) => number,
): Agent[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const held = previousSlots
    .map((id) => byId.get(id))
    .filter((agent): agent is Agent => agent !== undefined);
  const heldIds = new Set(held.map((agent) => agent.id));
  const joined = agents
    .filter((agent) => !heldIds.has(agent.id))
    .sort((a, b) => recencyOf(b) - recencyOf(a));

  const result = [...held];
  for (const agent of joined) {
    const at = result.findIndex((existing) => recencyOf(existing) < recencyOf(agent));
    if (at === -1) result.push(agent);
    else result.splice(at, 0, agent);
  }
  return result;
}

/**
 * Lay out the dock: the recent lane first, then the working lane. Both lanes
 * hold their slots (see orderBySlots); only lane MEMBERSHIP follows recency.
 *
 * `recency` should come from settleWorkRecency. Falling back to `lastActivity`
 * (when an id is missing, or no map is passed) reintroduces the every-click-
 * reshuffles bug, so real callers must always pass the settled map.
 */
export function buildDockRoster(
  agents: readonly Agent[],
  workingIds: ReadonlySet<string>,
  previousSlots: DockSlots,
  recency?: ReadonlyMap<string, number>,
  recentSize: number = DOCK_RECENT_SIZE,
): { entries: DockEntry[]; slots: DockSlots } {
  const recencyOf = (agent: Agent) => recency?.get(agent.id) ?? agent.lastActivity ?? 0;

  const working = orderBySlots(
    agents.filter((agent) => workingIds.has(agent.id)),
    previousSlots.working,
    recencyOf,
  );

  // Membership by recency (who deserves one of the few slots), then held order.
  const recentMembers = agents
    .filter((agent) => !workingIds.has(agent.id))
    .sort((a, b) => recencyOf(b) - recencyOf(a))
    .slice(0, recentSize);
  const recent = orderBySlots(recentMembers, previousSlots.recent, recencyOf);

  return {
    entries: [
      ...recent.map((agent): DockEntry => ({ agent, lane: 'recent' })),
      ...working.map((agent): DockEntry => ({ agent, lane: 'working' })),
    ],
    slots: {
      working: working.map((agent) => agent.id),
      recent: recent.map((agent) => agent.id),
    },
  };
}

/** True when both sets hold exactly the same ids. */
export function haveSameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** The lane+order fingerprint of a roster — changes only when a thumb must move. */
export function dockLayoutSignature(entries: readonly DockEntry[]): string {
  return entries.map((entry) => `${entry.lane}:${entry.agent.id}`).join(',');
}
