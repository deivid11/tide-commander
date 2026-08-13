import { describe, it, expect } from 'vitest';
import {
  consumeInstructionsDirty,
  resolveAreaPromptForAgent,
  markInstructionsDirtyForAreaChanges,
  type AreaPromptSource,
} from './instruction-refresh.js';

const area = (
  name: string,
  assignedAgentIds: string[],
  prompt?: string
): AreaPromptSource => ({ name, assignedAgentIds, prompt });

describe('resolveAreaPromptForAgent', () => {
  it('returns the prompt of the area that lists the agent', () => {
    const areas = [area('Backend', ['a1'], 'Ship small PRs')];
    expect(resolveAreaPromptForAgent(areas, 'a1')).toBe('Backend\nShip small PRs');
  });

  it('returns undefined for an unassigned agent or an area with no prompt', () => {
    const areas = [area('Backend', ['a1']), area('Frontend', ['a2'], '   ')];
    expect(resolveAreaPromptForAgent(areas, 'a1')).toBeUndefined();
    expect(resolveAreaPromptForAgent(areas, 'a2')).toBeUndefined();
    expect(resolveAreaPromptForAgent(areas, 'nobody')).toBeUndefined();
  });

  it('lets the FIRST matching area win even when it has no prompt', () => {
    // Mirrors the backends' areas.find(...) — they do not fall through.
    const areas = [area('Empty', ['a1']), area('Later', ['a1'], 'never used')];
    expect(resolveAreaPromptForAgent(areas, 'a1')).toBeUndefined();
  });
});

describe('markInstructionsDirtyForAreaChanges', () => {
  it('flags an agent when its area prompt text is edited', () => {
    const before = [area('Backend', ['edit-1'], 'old text')];
    const after = [area('Backend', ['edit-1'], 'new text')];

    expect(markInstructionsDirtyForAreaChanges(before, after)).toEqual(['edit-1']);
    expect(consumeInstructionsDirty('edit-1')).toBe(true);
    expect(consumeInstructionsDirty('edit-1')).toBe(false); // one-shot
  });

  it('flags an agent moved into an area with a prompt', () => {
    const before = [area('Backend', [], 'be rigorous')];
    const after = [area('Backend', ['move-1'], 'be rigorous')];

    expect(markInstructionsDirtyForAreaChanges(before, after)).toEqual(['move-1']);
    expect(consumeInstructionsDirty('move-1')).toBe(true);
  });

  it('flags an agent whose area was deleted', () => {
    const before = [area('Backend', ['gone-1'], 'be rigorous')];

    expect(markInstructionsDirtyForAreaChanges(before, [])).toEqual(['gone-1']);
    expect(consumeInstructionsDirty('gone-1')).toBe(true);
  });

  it('flags an agent when only the area name changed (the block embeds it)', () => {
    const before = [area('Backend', ['rename-1'], 'same text')];
    const after = [area('Platform', ['rename-1'], 'same text')];

    expect(markInstructionsDirtyForAreaChanges(before, after)).toEqual(['rename-1']);
    expect(consumeInstructionsDirty('rename-1')).toBe(true);
  });

  it('does not flag agents whose resolved prompt is unchanged', () => {
    const before = [area('Backend', ['keep-1'], 'stable'), area('Empty', ['keep-2'])];
    const after = [area('Backend', ['keep-1'], 'stable'), area('Empty', ['keep-2'])];

    expect(markInstructionsDirtyForAreaChanges(before, after)).toEqual([]);
    expect(consumeInstructionsDirty('keep-1')).toBe(false);
    expect(consumeInstructionsDirty('keep-2')).toBe(false);
  });

  it('does not flag a move between two prompt-less areas', () => {
    const before = [area('A', ['quiet-1']), area('B', [])];
    const after = [area('A', []), area('B', ['quiet-1'])];

    expect(markInstructionsDirtyForAreaChanges(before, after)).toEqual([]);
    expect(consumeInstructionsDirty('quiet-1')).toBe(false);
  });

  it('flags only the agents actually affected by an edit', () => {
    const before = [area('Backend', ['hit-1', 'hit-2'], 'old'), area('Frontend', ['miss-1'], 'stable')];
    const after = [area('Backend', ['hit-1', 'hit-2'], 'new'), area('Frontend', ['miss-1'], 'stable')];

    expect(markInstructionsDirtyForAreaChanges(before, after).sort()).toEqual(['hit-1', 'hit-2']);
    expect(consumeInstructionsDirty('miss-1')).toBe(false);
  });
});
