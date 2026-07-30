import { describe, it, expect } from 'vitest';
import { computeDiffOps, MAX_LCS_CELLS, type DiffOp } from './diffLineOps';

/** Replay an edit script to recover both sides — an op list that can't do this is wrong. */
function replay(ops: DiffOp[], original: string[], modified: string[]) {
  const left: string[] = [];
  const right: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      left.push(original[op.origIdx!]);
      right.push(modified[op.modIdx!]);
    } else if (op.type === 'delete') {
      left.push(original[op.origIdx!]);
    } else {
      right.push(modified[op.modIdx!]);
    }
  }
  return { left, right };
}

describe('computeDiffOps', () => {
  it('reports every line equal for identical input', () => {
    const lines = ['a', 'b', 'c'];
    const ops = computeDiffOps(lines, lines);
    expect(ops).toHaveLength(3);
    expect(ops.every((o) => o.type === 'equal')).toBe(true);
  });

  it('isolates a single changed line in the middle', () => {
    const original = ['a', 'b', 'c', 'd', 'e'];
    const modified = ['a', 'b', 'X', 'd', 'e'];
    const ops = computeDiffOps(original, modified);
    expect(ops.filter((o) => o.type === 'delete').map((o) => o.origIdx)).toEqual([2]);
    expect(ops.filter((o) => o.type === 'insert').map((o) => o.modIdx)).toEqual([2]);
    expect(ops.filter((o) => o.type === 'equal')).toHaveLength(4);
  });

  it('indices stay absolute after the prefix/suffix peel', () => {
    const original = ['a', 'b', 'c', 'd'];
    const modified = ['a', 'X', 'Y', 'd'];
    const ops = computeDiffOps(original, modified);
    const { left, right } = replay(ops, original, modified);
    expect(left).toEqual(original);
    expect(right).toEqual(modified);
  });

  it('handles pure insertion and pure deletion', () => {
    expect(computeDiffOps([], ['a', 'b'])).toEqual([
      { type: 'insert', modIdx: 0 },
      { type: 'insert', modIdx: 1 },
    ]);
    expect(computeDiffOps(['a', 'b'], [])).toEqual([
      { type: 'delete', origIdx: 0 },
      { type: 'delete', origIdx: 1 },
    ]);
  });

  it('reconstructs both sides for an arbitrary edit', () => {
    const original = ['one', 'two', 'three', 'four', 'five'];
    const modified = ['one', 'three', 'inserted', 'four', 'five', 'six'];
    const ops = computeDiffOps(original, modified);
    const { left, right } = replay(ops, original, modified);
    expect(left).toEqual(original);
    expect(right).toEqual(modified);
  });

  it('a one-line edit in a huge file stays cheap and exact', () => {
    // The case that used to want a 1.01-billion-cell table.
    const original = Array.from({ length: 31_841 }, (_, i) => `line ${i}`);
    const modified = original.slice();
    modified[15_000] = 'edited';

    const started = performance.now();
    const ops = computeDiffOps(original, modified);
    const elapsed = performance.now() - started;

    expect(ops.filter((o) => o.type === 'delete').map((o) => o.origIdx)).toEqual([15_000]);
    expect(ops.filter((o) => o.type === 'insert').map((o) => o.modIdx)).toEqual([15_000]);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('falls back to a block diff instead of an oversized table', () => {
    // Nothing shared at either end, so the peel can't shrink it.
    const size = 3_000; // (3000+1)^2 ≈ 9M cells > MAX_LCS_CELLS
    expect((size + 1) * (size + 1)).toBeGreaterThan(MAX_LCS_CELLS);
    const original = Array.from({ length: size }, (_, i) => `a${i}`);
    const modified = Array.from({ length: size }, (_, i) => `b${i}`);

    const started = performance.now();
    const ops = computeDiffOps(original, modified);
    const elapsed = performance.now() - started;

    expect(ops.filter((o) => o.type === 'equal')).toHaveLength(0);
    expect(ops.filter((o) => o.type === 'delete')).toHaveLength(size);
    expect(ops.filter((o) => o.type === 'insert')).toHaveLength(size);
    // Deletions come first so the panes render removed-then-added.
    expect(ops[0].type).toBe('delete');
    expect(ops[ops.length - 1].type).toBe('insert');
    expect(elapsed).toBeLessThan(1_000);

    const { left, right } = replay(ops, original, modified);
    expect(left).toEqual(original);
    expect(right).toEqual(modified);
  });
});
