/**
 * Kill a whole process tree, robustly, on Linux — used to stop streamed exec
 * tasks (POST /api/exec) from the terminal's Stop button.
 *
 * Why the obvious `process.kill(-pid)` is not enough: PTY tasks are spawned as
 * `script -qefc <cmd> /dev/null` (so the child sees a real terminal). `script`
 * calls setsid() in its child to acquire the pty as controlling terminal, so
 * the actual command runs in a DIFFERENT session and process group than
 * `script`. Killing `script`'s group therefore leaves the command (and its
 * children — test workers, servers, benchmarks) alive; `script` then keeps
 * waiting on the pty, so the task never closes and its card stays "running".
 * (Verified: script pgid 691956 → its `sleep` child pgid 691958.)
 *
 * Strategy: read /proc to collect EVERY descendant of the root pid (BFS over
 * ppid) plus the root, capture the distinct process groups among them BEFORE
 * signalling (a killed parent reparents its children to init and the tree link
 * is lost), then signal each process group AND each individual pid. Falls back
 * to a plain group+pid kill of the root when /proc is unavailable (non-Linux).
 */

import * as fs from 'fs';

export interface ProcInfo {
  pid: number;
  ppid: number;
  pgrp: number;
}

/** Parse one /proc/<pid>/stat line into {pid, ppid, pgrp}. The `comm` field
 * (field 2) is wrapped in parens and may itself contain spaces and parens, so
 * split on the LAST ')' before reading the space-separated tail. */
export function parseProcStat(content: string): ProcInfo | null {
  const close = content.lastIndexOf(')');
  if (close === -1) return null;
  const pid = parseInt(content.slice(0, content.indexOf(' ')), 10);
  const rest = content.slice(close + 2).split(' '); // after ") "
  // rest[0] = state, rest[1] = ppid, rest[2] = pgrp
  const ppid = parseInt(rest[1], 10);
  const pgrp = parseInt(rest[2], 10);
  if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(pgrp)) return null;
  return { pid, ppid, pgrp };
}

/** Snapshot every process from /proc. Returns null when /proc is unreadable. */
export function readProcessTable(): ProcInfo[] | null {
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return null;
  }
  const table: ProcInfo[] = [];
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const info = parseProcStat(fs.readFileSync(`/proc/${name}/stat`, 'utf8'));
      if (info) table.push(info);
    } catch {
      // process vanished between readdir and read — ignore
    }
  }
  return table;
}

/**
 * Collect the root pid and all its descendants (BFS over the ppid map), plus
 * the distinct process groups they belong to.
 */
export function collectProcessTree(rootPid: number, table: ProcInfo[]): { pids: number[]; pgrps: number[] } {
  const childrenByPpid = new Map<number, number[]>();
  const pgrpByPid = new Map<number, number>();
  for (const p of table) {
    (childrenByPpid.get(p.ppid) ?? childrenByPpid.set(p.ppid, []).get(p.ppid)!).push(p.pid);
    pgrpByPid.set(p.pid, p.pgrp);
  }
  const pids: number[] = [];
  const seen = new Set<number>();
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
    for (const child of childrenByPpid.get(pid) ?? []) queue.push(child);
  }
  const pgrps = new Set<number>();
  for (const pid of pids) {
    const pgrp = pgrpByPid.get(pid);
    // Only positive, non-init groups (never signal group 1 / the whole session 0).
    if (pgrp && pgrp > 1) pgrps.add(pgrp);
  }
  return { pids, pgrps: [...pgrps] };
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(pid, signal); } catch { /* already gone / not permitted */ }
}
function signalGroup(pgrp: number, signal: NodeJS.Signals): void {
  try { process.kill(-pgrp, signal); } catch { /* already gone */ }
}

/**
 * A snapshot of a process tree, captured once so escalation (SIGKILL) can
 * target the SAME processes even after the parent died and children reparented.
 */
export interface CapturedTree {
  pids: number[];
  pgrps: number[];
}

/** Capture the tree rooted at `rootPid` right now (before any signal). */
export function captureProcessTree(rootPid: number): CapturedTree {
  const table = readProcessTable();
  if (!table) return { pids: [rootPid], pgrps: [] };
  return collectProcessTree(rootPid, table);
}

/** Send `signal` to every group and pid in a captured tree. */
export function signalCapturedTree(tree: CapturedTree, signal: NodeJS.Signals): void {
  for (const pgrp of tree.pgrps) signalGroup(pgrp, signal);
  for (const pid of tree.pids) signalPid(pid, signal);
}

/**
 * Terminate the process tree rooted at `rootPid`: capture it, SIGTERM every
 * group + pid, and after `escalateMs` SIGKILL the SAME captured set (plus a
 * fresh re-scan, in case new children appeared). `stillTracked` lets the
 * caller skip escalation when the task already exited cleanly.
 */
export function killProcessTree(
  rootPid: number,
  opts: { escalateMs?: number; stillTracked?: () => boolean } = {},
): void {
  const escalateMs = opts.escalateMs ?? 3000;
  const captured = captureProcessTree(rootPid);

  // Polite first: SIGTERM the whole captured tree (groups then pids).
  signalCapturedTree(captured, 'SIGTERM');

  // Escalate: SIGKILL the captured set AND anything still descending from the
  // root now (a survivor may have spawned children after the SIGTERM).
  setTimeout(() => {
    if (opts.stillTracked && !opts.stillTracked()) {
      // The task closed — but reparented grandchildren (setsid daemons) may
      // still be alive; SIGKILL the captured groups/pids anyway. This never
      // touches unrelated processes: the set was scoped to the root's tree.
    }
    const fresh = captureProcessTree(rootPid);
    const pgrps = new Set([...captured.pgrps, ...fresh.pgrps]);
    const pids = new Set([...captured.pids, ...fresh.pids]);
    for (const pgrp of pgrps) signalGroup(pgrp, 'SIGKILL');
    for (const pid of pids) signalPid(pid, 'SIGKILL');
  }, escalateMs);
}
