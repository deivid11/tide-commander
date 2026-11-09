import { describe, expect, it } from 'vitest';
import { consumeKeyboardCycleSelection, markKeyboardCycleSelection } from './selectionIntent';

describe('keyboard-cycle selection intent', () => {
  it('is consumed once, and only shortly after the cycle marked it', () => {
    markKeyboardCycleSelection(1_000);
    expect(consumeKeyboardCycleSelection(1_200)).toBe(true);
    expect(consumeKeyboardCycleSelection(1_250)).toBe(false); // already consumed

    markKeyboardCycleSelection(5_000);
    expect(consumeKeyboardCycleSelection(9_000)).toBe(false); // stale: a later, unrelated selection
  });
});
