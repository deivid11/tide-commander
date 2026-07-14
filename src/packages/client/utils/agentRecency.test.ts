import { describe, expect, it } from 'vitest';
import { agentRecency } from './agentRecency';

describe('agentRecency', () => {
  it('uses the later of lastActivity and the explicit pick time', () => {
    expect(agentRecency('picked-later', 100, { 'picked-later': 500 })).toBe(500);
    expect(agentRecency('active-later', 900, { 'active-later': 500 })).toBe(900);
  });

  it('never lets an old pick outrank genuinely newer activity of another agent', () => {
    const recentTimes = { clicked: 1_000 };
    const clickedLongAgo = agentRecency('clicked', 100, recentTimes);
    const activeNow = agentRecency('background', 2_000, recentTimes);

    expect(activeNow).toBeGreaterThan(clickedLongAgo);
  });

  it('falls back to lastActivity for agents never selected', () => {
    expect(agentRecency('newer', 200, {})).toBeGreaterThan(agentRecency('older', 100, {}));
  });
});
