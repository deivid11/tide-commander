/**
 * Line-level diff operations for the side-by-side DiffViewer.
 *
 * Kept free of React/Prism imports so it stays unit-testable under vitest's
 * node environment.
 *
 * The naive LCS this replaced allocated the full `(m+1) x (n+1)` table. Against
 * a real 31,841-line file (docs/openapi.json) that is 1.01 BILLION cells —
 * ~7.6 GB of JS numbers and 7.7s just to allocate, before the fill loop even
 * ran. It hung the tab. Two bounds fix that:
 *   - peel the identical prefix/suffix first, which is what actually shrinks
 *     real edits (a one-line change drops the table from 1.01B cells to 4);
 *   - refuse to build a table past MAX_LCS_CELLS, emitting the changed region
 *     as one removed block plus one added block instead.
 */

export type DiffOp = {
  type: 'equal' | 'delete' | 'insert';
  origIdx?: number;
  modIdx?: number;
};

export const MAX_LCS_CELLS = 4_000_000;

/**
 * Ordered edit script turning `originalLines` into `modifiedLines`.
 * Indices are absolute positions in the respective input arrays.
 */
export function computeDiffOps(originalLines: string[], modifiedLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];

  let head = 0;
  const maxHead = Math.min(originalLines.length, modifiedLines.length);
  while (head < maxHead && originalLines[head] === modifiedLines[head]) head++;

  let tail = 0;
  const maxTail = Math.min(originalLines.length, modifiedLines.length) - head;
  while (
    tail < maxTail &&
    originalLines[originalLines.length - 1 - tail] === modifiedLines[modifiedLines.length - 1 - tail]
  ) tail++;

  for (let k = 0; k < head; k++) {
    ops.push({ type: 'equal', origIdx: k, modIdx: k });
  }

  const origMid = originalLines.slice(head, originalLines.length - tail);
  const modMid = modifiedLines.slice(head, modifiedLines.length - tail);
  const m = origMid.length;
  const n = modMid.length;

  if (m === 0 || n === 0 || (m + 1) * (n + 1) > MAX_LCS_CELLS) {
    // One side empty (pure insert/delete), or too big to align line-by-line:
    // render the whole changed region as removed-then-added.
    for (let k = 0; k < m; k++) ops.push({ type: 'delete', origIdx: head + k });
    for (let k = 0; k < n; k++) ops.push({ type: 'insert', modIdx: head + k });
  } else {
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (origMid[i - 1] === modMid[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const midOps: DiffOp[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && origMid[i - 1] === modMid[j - 1]) {
        midOps.push({ type: 'equal', origIdx: head + i - 1, modIdx: head + j - 1 });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        midOps.push({ type: 'insert', modIdx: head + j - 1 });
        j--;
      } else if (i > 0) {
        midOps.push({ type: 'delete', origIdx: head + i - 1 });
        i--;
      }
    }
    midOps.reverse();
    ops.push(...midOps);
  }

  for (let k = 0; k < tail; k++) {
    ops.push({
      type: 'equal',
      origIdx: originalLines.length - tail + k,
      modIdx: modifiedLines.length - tail + k,
    });
  }

  return ops;
}
