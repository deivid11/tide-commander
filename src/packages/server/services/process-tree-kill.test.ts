import { describe, it, expect } from 'vitest';
import { parseProcStat, collectProcessTree, type ProcInfo } from './process-tree-kill.js';

describe('parseProcStat', () => {
  it('reads pid / ppid / pgrp from a /proc/<pid>/stat line', () => {
    // Fields: pid (comm) state ppid pgrp session ...
    expect(parseProcStat('691958 (sleep) S 691956 691958 691958 34816 691958 4194304 …'))
      .toEqual({ pid: 691958, ppid: 691956, pgrp: 691958 });
  });

  it('handles a comm containing spaces and parens (the reason we split on the LAST ")")', () => {
    expect(parseProcStat('1234 (weird )( name) R 1000 4321 4321 0 -1 …'))
      .toEqual({ pid: 1234, ppid: 1000, pgrp: 4321 });
  });

  it('returns null for malformed input', () => {
    expect(parseProcStat('no parens here')).toBeNull();
  });
});

describe('collectProcessTree', () => {
  // Models the confirmed script(1) topology: script (own group) → the command
  // in a NEW session/group → its children in yet more groups.
  const table: ProcInfo[] = [
    { pid: 100, ppid: 1, pgrp: 100 },     // server (the node process — the root's parent, NOT descended)
    { pid: 200, ppid: 100, pgrp: 200 },   // script  (root) — group 200
    { pid: 201, ppid: 200, pgrp: 201 },   // command (bash under the pty) — SEPARATE group 201
    { pid: 202, ppid: 201, pgrp: 201 },   // a child in the command's group
    { pid: 203, ppid: 201, pgrp: 203 },   // a grandchild that made its own group (benchmark server)
    { pid: 999, ppid: 1, pgrp: 999 },     // unrelated process — must never be touched
  ];

  it('collects the root and every descendant, and the distinct groups among them', () => {
    const { pids, pgrps } = collectProcessTree(200, table);
    expect(pids.sort((a, b) => a - b)).toEqual([200, 201, 202, 203]);
    expect(pgrps.sort((a, b) => a - b)).toEqual([200, 201, 203]);
    // Unrelated process and its group are excluded.
    expect(pids).not.toContain(999);
    expect(pgrps).not.toContain(999);
  });

  it('never includes init group 1 / group 0', () => {
    const weird: ProcInfo[] = [
      { pid: 200, ppid: 1, pgrp: 1 },   // (shouldn't happen, but guard anyway)
      { pid: 201, ppid: 200, pgrp: 0 },
      { pid: 202, ppid: 200, pgrp: 202 },
    ];
    const { pgrps } = collectProcessTree(200, weird);
    expect(pgrps).toEqual([202]);
  });

  it('handles a leaf root with no descendants', () => {
    expect(collectProcessTree(203, table)).toEqual({ pids: [203], pgrps: [203] });
  });
});
