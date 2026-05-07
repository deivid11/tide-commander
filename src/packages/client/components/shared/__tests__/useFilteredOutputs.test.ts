/**
 * Tests for useFilteredOutputs sort helper.
 *
 * Specifically verifies that mixed-source live outputs (live WebSocket events,
 * optimistic user prompts, history-merged entries) render in strict
 * chronological ascending order with an explicit, stable tiebreaker.
 */

import { describe, it, expect } from 'vitest';
import { sortOutputsChronologically } from '../useFilteredOutputs';
import type { ClaudeOutput } from '../../../store/types';

function makeOutput(overrides: Partial<ClaudeOutput> = {}): ClaudeOutput {
  return {
    text: 'msg',
    isStreaming: false,
    timestamp: 0,
    ...overrides,
  };
}

describe('sortOutputsChronologically', () => {
  it('sorts shuffled createdAt timestamps ascending with stable uuid tiebreaker', () => {
    const shuffled: ClaudeOutput[] = [
      makeOutput({ text: 'C', timestamp: 3000, uuid: 'u-c' }),
      makeOutput({ text: 'A', timestamp: 1000, uuid: 'u-a' }),
      // Two outputs sharing a timestamp — uuid lex ascending breaks the tie.
      makeOutput({ text: 'B-late', timestamp: 2000, uuid: 'u-b2' }),
      makeOutput({ text: 'B-early', timestamp: 2000, uuid: 'u-b1' }),
      // Optimistic prompt without uuid — keeps its insertion position when
      // timestamp ties are otherwise equal.
      makeOutput({ text: 'B-optimistic', timestamp: 2000 }),
      makeOutput({ text: 'D', timestamp: 4000, uuid: 'u-d' }),
    ];

    const sorted = sortOutputsChronologically(shuffled);

    expect(sorted.map((o) => o.text)).toEqual([
      'A',
      'B-optimistic', // missing uuid sorts before 'u-b1' (empty string < any non-empty)
      'B-early',
      'B-late',
      'C',
      'D',
    ]);
  });

  it('preserves insertion order for items with identical timestamp and uuid', () => {
    const inputs: ClaudeOutput[] = [
      makeOutput({ text: 'first', timestamp: 100 }),
      makeOutput({ text: 'second', timestamp: 100 }),
      makeOutput({ text: 'third', timestamp: 100 }),
    ];

    const sorted = sortOutputsChronologically(inputs);

    expect(sorted.map((o) => o.text)).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the input array', () => {
    const inputs: ClaudeOutput[] = [
      makeOutput({ text: 'b', timestamp: 2 }),
      makeOutput({ text: 'a', timestamp: 1 }),
    ];
    const inputsCopy = [...inputs];

    const sorted = sortOutputsChronologically(inputs);

    expect(inputs).toEqual(inputsCopy);
    expect(sorted.map((o) => o.text)).toEqual(['a', 'b']);
  });

  it('returns ascending order regardless of arrival pattern (live WS + optimistic mix)', () => {
    // Simulate: optimistic user prompt at T=1000 inserted first, then a stale
    // WebSocket event at T=900 arrives later, then live response at T=1100.
    const inputs: ClaudeOutput[] = [
      makeOutput({ text: 'optimistic-prompt', timestamp: 1000, isUserPrompt: true }),
      makeOutput({ text: 'late-arrival', timestamp: 900, uuid: 'srv-1' }),
      makeOutput({ text: 'live-response', timestamp: 1100, uuid: 'srv-2' }),
    ];

    const sorted = sortOutputsChronologically(inputs);

    expect(sorted.map((o) => o.timestamp)).toEqual([900, 1000, 1100]);
    expect(sorted.map((o) => o.text)).toEqual([
      'late-arrival',
      'optimistic-prompt',
      'live-response',
    ]);
  });
});
