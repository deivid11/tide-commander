import { describe, expect, it } from 'vitest';
import { getQuickSelectSwipeTarget } from './quickSelectSwipe';

describe('getQuickSelectSwipeTarget', () => {
  const roster = ['pinned-a', 'working-b', 'recent-c'];

  it('moves left-swipe navigation forward through the visible bar order', () => {
    expect(getQuickSelectSwipeTarget(roster, 'pinned-a', 1)).toBe('working-b');
    expect(getQuickSelectSwipeTarget(roster, 'working-b', 1)).toBe('recent-c');
  });

  it('moves right-swipe navigation backward and wraps', () => {
    expect(getQuickSelectSwipeTarget(roster, 'pinned-a', -1)).toBe('recent-c');
    expect(getQuickSelectSwipeTarget(roster, 'recent-c', 1)).toBe('pinned-a');
  });

  it('enters at the corresponding edge when the open agent is outside the bar', () => {
    expect(getQuickSelectSwipeTarget(roster, 'other', 1)).toBe('pinned-a');
    expect(getQuickSelectSwipeTarget(roster, 'other', -1)).toBe('recent-c');
  });

  it('does not navigate when the bar has fewer than two agents', () => {
    expect(getQuickSelectSwipeTarget([], 'other', 1)).toBeNull();
    expect(getQuickSelectSwipeTarget(['only'], 'only', -1)).toBeNull();
  });
});
