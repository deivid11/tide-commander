import { describe, expect, it } from 'vitest';
import {
  buildDockRoster,
  settleWorkingHolds,
  settleWorkRecency,
  DOCK_RECENT_SIZE,
  DOCK_WORKING_HOLD_MS,
  EMPTY_DOCK_SLOTS,
} from '../dockRoster';
import type { Agent } from '../../../../shared/types';

function agent(id: string, status: Agent['status'], lastActivity: number, lastWorkedAt?: number): Agent {
  return { id, status, lastActivity, lastWorkedAt } as Agent;
}

describe('settleWorkingHolds', () => {
  it('keeps an agent working across the idle gaps between tool calls', () => {
    const releaseAt = new Map<string, number>();

    settleWorkingHolds([agent('a', 'working', 0)], releaseAt, 1_000);
    // The agent blinks to idle a moment later, as it does between tool calls.
    const gap = settleWorkingHolds([agent('a', 'idle', 0)], releaseAt, 1_500);

    expect(gap.workingIds).toEqual(new Set(['a']));
    expect(gap.nextDeadline).toBe(1_000 + DOCK_WORKING_HOLD_MS);
  });

  it('releases the slot once the agent stays idle past the hold', () => {
    const releaseAt = new Map<string, number>();
    settleWorkingHolds([agent('a', 'working', 0)], releaseAt, 1_000);

    const settled = settleWorkingHolds([agent('a', 'idle', 0)], releaseAt, 1_000 + DOCK_WORKING_HOLD_MS + 1);

    expect(settled.workingIds.size).toBe(0);
    expect(settled.nextDeadline).toBeNull();
    expect(releaseAt.size).toBe(0);
  });

  it('re-arms the hold while the agent keeps working', () => {
    const releaseAt = new Map<string, number>();
    settleWorkingHolds([agent('a', 'working', 0)], releaseAt, 1_000);

    const later = settleWorkingHolds([agent('a', 'working', 0)], releaseAt, 5_000);

    expect(later.workingIds).toEqual(new Set(['a']));
    expect(later.nextDeadline).toBe(5_000 + DOCK_WORKING_HOLD_MS);
  });

  it('drops an agent that left the roster instead of holding its slot', () => {
    const releaseAt = new Map<string, number>();
    settleWorkingHolds([agent('a', 'working', 0)], releaseAt, 1_000);

    const removed = settleWorkingHolds([], releaseAt, 1_100);

    expect(removed.workingIds.size).toBe(0);
    expect(releaseAt.has('a')).toBe(false);
  });
});

describe('settleWorkRecency', () => {
  it('seeds from lastActivity on first sight, clamped to now', () => {
    const state = new Map<string, number>();

    settleWorkRecency([agent('old', 'idle', 500), agent('skewed', 'idle', 99_999)], state, 1_000);

    expect(state.get('old')).toBe(500);
    expect(state.get('skewed')).toBe(1_000);
  });

  it('ignores later lastActivity bumps — a click must not create recency', () => {
    const state = new Map<string, number>();
    settleWorkRecency([agent('a', 'idle', 500)], state, 1_000);

    // The user clicks the agent; the server restamps lastActivity.
    settleWorkRecency([agent('a', 'idle', 2_000)], state, 2_000);

    expect(state.get('a')).toBe(500);
  });

  it('advances recency when the agent is actually observed working', () => {
    const state = new Map<string, number>();
    settleWorkRecency([agent('a', 'idle', 500)], state, 1_000);

    settleWorkRecency([agent('a', 'working', 500)], state, 3_000);

    expect(state.get('a')).toBe(3_000);
  });

  it('drops agents that left the roster', () => {
    const state = new Map<string, number>();
    settleWorkRecency([agent('a', 'idle', 500)], state, 1_000);

    settleWorkRecency([], state, 2_000);

    expect(state.size).toBe(0);
  });

  it('prefers the server lastWorkedAt over click-tainted lastActivity when seeding', () => {
    const state = new Map<string, number>();

    // lastActivity was restamped by a click on another device; lastWorkedAt
    // holds the real last work. Every device seeding from it agrees.
    settleWorkRecency([agent('a', 'idle', 5_000, 700)], state, 6_000);

    expect(state.get('a')).toBe(700);
  });

  it('advances recency from server-observed work this client never saw live', () => {
    const state = new Map<string, number>();
    settleWorkRecency([agent('a', 'idle', 500, 500)], state, 1_000);

    // Another browser/APK drove the agent; this client only receives the
    // refreshed lastWorkedAt on sync — status here never showed 'working'.
    settleWorkRecency([agent('a', 'idle', 500, 4_000)], state, 5_000);

    expect(state.get('a')).toBe(4_000);
  });

  it('clamps a skewed future lastWorkedAt to now and never regresses recency', () => {
    const state = new Map<string, number>();
    settleWorkRecency([agent('a', 'idle', 500, 99_999)], state, 1_000);
    expect(state.get('a')).toBe(1_000);

    // A stale lastWorkedAt older than what this client already observed
    // must not pull recency backwards.
    settleWorkRecency([agent('a', 'working', 500, 700)], state, 2_000);
    settleWorkRecency([agent('a', 'idle', 500, 700)], state, 3_000);
    expect(state.get('a')).toBe(2_000);
  });
});

describe('buildDockRoster', () => {
  it('keeps recent-lane membership fixed when only lastActivity moves (a click)', () => {
    // Five idle agents, four slots; 'e' is the least recent and stays out.
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const recency = new Map(ids.map((id, i) => [id, 1_000 - i]));
    const before = ids.map((id) => agent(id, 'idle', 0));
    const first = buildDockRoster(before, new Set(), EMPTY_DOCK_SLOTS, recency);
    expect(first.slots.recent).toEqual(['a', 'b', 'c', 'd']);

    // The user clicks 'e' — the server restamps its lastActivity sky-high, but
    // its settled recency is unchanged, so the lane must not churn.
    const afterClick = before.map((a) => (a.id === 'e' ? agent('e', 'idle', 999_999) : a));
    const second = buildDockRoster(afterClick, new Set(), first.slots, recency);

    expect(second.slots.recent).toEqual(['a', 'b', 'c', 'd']);
  });

  it('holds each working agent in the slot it already occupies', () => {
    const agents = [agent('a', 'working', 100), agent('b', 'working', 900)];
    const workingIds = new Set(['a', 'b']);

    // 'b' is now the more recent, but reordering live would be pure churn.
    const { entries, slots } = buildDockRoster(agents, workingIds, { working: ['a', 'b'], recent: [] });

    expect(slots.working).toEqual(['a', 'b']);
    expect(entries.map((entry) => entry.agent.id)).toEqual(['a', 'b']);
  });

  it('holds recent slots too, so opening an agent does not reshuffle the lane', () => {
    // Merely opening an agent provokes an updateAgent, which restamps
    // lastActivity — the lane must not jump it to the front under the cursor.
    const before = [agent('x', 'idle', 100), agent('y', 'idle', 90)];
    const first = buildDockRoster(before, new Set(), EMPTY_DOCK_SLOTS);
    expect(first.slots.recent).toEqual(['x', 'y']);

    const afterClick = [agent('x', 'idle', 100), agent('y', 'idle', 5_000)];
    const second = buildDockRoster(afterClick, new Set(), first.slots);

    expect(second.slots.recent).toEqual(['x', 'y']);
    expect(second.entries.map((entry) => entry.agent.id)).toEqual(['x', 'y']);
  });

  it('inserts newcomers by recency relative to held members, without reordering them', () => {
    const agents = [agent('a', 'working', 100), agent('new-old', 'working', 200), agent('new-fresh', 'working', 800)];

    const { slots } = buildDockRoster(agents, new Set(['a', 'new-old', 'new-fresh']), { working: ['a'], recent: [] });

    // Both newcomers outrank held 'a', so they land in front of it, newest first.
    expect(slots.working).toEqual(['new-fresh', 'new-old', 'a']);
  });

  it('re-enters a just-finished agent at the FRONT of the recent lane', () => {
    const recency = new Map([['fin', 1_000], ['r1', 500], ['r2', 400]]);
    const agents = [agent('fin', 'idle', 0), agent('r1', 'idle', 0), agent('r2', 'idle', 0)];

    // 'fin' held a working slot until its hold expired; r1/r2 hold the recent lane.
    const { slots } = buildDockRoster(agents, new Set(), { working: ['fin'], recent: ['r1', 'r2'] }, recency);

    expect(slots.recent).toEqual(['fin', 'r1', 'r2']);
  });

  it('appends a newcomer older than every held member at the back', () => {
    const recency = new Map([['a', 900], ['b', 800], ['old', 100]]);
    const agents = [agent('a', 'idle', 0), agent('b', 'idle', 0), agent('old', 'idle', 0)];

    const { slots } = buildDockRoster(agents, new Set(), { working: [], recent: ['a', 'b'] }, recency);

    expect(slots.recent).toEqual(['a', 'b', 'old']);
  });

  it('frees the slot of an agent that left, without disturbing the others', () => {
    const agents = [agent('a', 'working', 0), agent('c', 'working', 0)];

    const { slots } = buildDockRoster(agents, new Set(['a', 'c']), { working: ['a', 'b', 'c'], recent: [] });

    expect(slots.working).toEqual(['a', 'c']);
  });

  it('picks recent-lane membership by activity and caps it', () => {
    const agents = Array.from({ length: DOCK_RECENT_SIZE + 3 }, (_, i) => agent(`idle-${i}`, 'idle', i));

    const { entries } = buildDockRoster(agents, new Set(), EMPTY_DOCK_SLOTS);

    expect(entries).toHaveLength(DOCK_RECENT_SIZE);
    expect(entries.every((entry) => entry.lane === 'recent')).toBe(true);
    expect(entries[0].agent.id).toBe(`idle-${DOCK_RECENT_SIZE + 2}`);
  });

  it('honors a custom recent-lane size, including 0 (working lane only)', () => {
    const idle = Array.from({ length: 5 }, (_, i) => agent(`idle-${i}`, 'idle', i));
    const busy = agent('busy', 'working', 100);

    const two = buildDockRoster([...idle, busy], new Set(['busy']), EMPTY_DOCK_SLOTS, undefined, 2);
    expect(two.entries.map((entry) => entry.lane)).toEqual(['working', 'recent', 'recent']);

    const none = buildDockRoster([...idle, busy], new Set(['busy']), EMPTY_DOCK_SLOTS, undefined, 0);
    expect(none.entries.map((entry) => [entry.agent.id, entry.lane])).toEqual([['busy', 'working']]);
  });

  it('renders the working lane before the recent lane and never lists an agent twice', () => {
    const agents = [agent('busy', 'working', 500), agent('done', 'idle', 400)];

    const { entries } = buildDockRoster(agents, new Set(['busy']), EMPTY_DOCK_SLOTS);

    expect(entries.map((entry) => [entry.agent.id, entry.lane])).toEqual([
      ['busy', 'working'],
      ['done', 'recent'],
    ]);
  });

  it('keeps an agent held by the working hold out of the recent lane', () => {
    // 'a' reads as idle but still holds its working slot — it must not appear twice.
    const { entries } = buildDockRoster([agent('a', 'idle', 100)], new Set(['a']), { working: ['a'], recent: [] });

    expect(entries.map((entry) => [entry.agent.id, entry.lane])).toEqual([['a', 'working']]);
  });
});
