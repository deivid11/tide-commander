/**
 * Commit-graph lane layout.
 *
 * Turns a flat commit list (as returned by /api/files/git-log, newest first)
 * into the column/edge geometry a GitKraken-style graph needs.
 *
 * Deliberately dependency-free: the published graph libraries either target a
 * scripted DSL rather than real repository data, or are unmaintained. The
 * algorithm is small and the interesting part is pure, so it lives here and is
 * unit tested without a DOM.
 */

export interface GraphInputCommit {
  hash: string;
  /** Parent hashes: none for a root commit, 2+ for a merge. */
  parents: string[];
}

export interface GraphNode {
  hash: string;
  /** Index in the input list — the vertical position. */
  row: number;
  /** Column the commit dot sits in. */
  lane: number;
}

export interface GraphEdge {
  fromHash: string;
  fromRow: number;
  fromLane: number;
  toHash: string;
  /** Row of the parent, or -1 when it falls outside the loaded page. */
  toRow: number;
  toLane: number;
  /** True for the second and later parents of a merge commit. */
  isMerge: boolean;
}

export interface GitGraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Number of columns in use — drives the width of the graph gutter. */
  laneCount: number;
}

/**
 * Lane colours. Chosen to stay distinguishable on the dark terminal background
 * and to avoid the red reserved for destructive actions elsewhere in the UI.
 */
export const LANE_COLORS = [
  '#4aa3ff', // blue
  '#4ade80', // green
  '#c084fc', // purple
  '#fbbf24', // amber
  '#22d3ee', // cyan
  '#f472b6', // pink
  '#a3e635', // lime
  '#fb923c', // orange
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export function computeGitGraphLayout(commits: GraphInputCommit[]): GitGraphLayout {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (commits.length === 0) return { nodes, edges, laneCount: 0 };

  // lanes[i] holds the hash that lane i is currently waiting to draw, or null
  // when the lane is free for reuse.
  const lanes: (string | null)[] = [];
  const laneByHash = new Map<string, number>();
  const rowByHash = new Map<string, number>();
  let maxLane = 0;

  const findLane = (hash: string) => lanes.indexOf(hash);
  const allocLane = (hash: string) => {
    const free = lanes.indexOf(null);
    if (free !== -1) {
      lanes[free] = hash;
      return free;
    }
    lanes.push(hash);
    return lanes.length - 1;
  };

  // Pass 1 — assign every commit a column.
  commits.forEach((commit, row) => {
    let lane = findLane(commit.hash);
    if (lane === -1) lane = allocLane(commit.hash);

    // Several children can reserve the same parent. Keep the leftmost lane and
    // release the rest, otherwise columns leak and the graph drifts right.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.hash) lanes[i] = null;
    }

    nodes.push({ hash: commit.hash, row, lane });
    laneByHash.set(commit.hash, lane);
    rowByHash.set(commit.hash, row);
    if (lane > maxLane) maxLane = lane;

    if (commit.parents.length === 0) {
      // Root commit — nothing continues below it.
      lanes[lane] = null;
    } else {
      // The first parent inherits this lane so a straight line reads as "same
      // branch"; every extra parent of a merge needs a lane of its own.
      lanes[lane] = commit.parents[0];
      for (let p = 1; p < commit.parents.length; p++) {
        if (findLane(commit.parents[p]) === -1) allocLane(commit.parents[p]);
      }
    }
  });

  // Pass 2 — edges, using the columns actually assigned above. Doing this after
  // the fact keeps every endpoint anchored to a real node position.
  commits.forEach((commit, row) => {
    const fromLane = laneByHash.get(commit.hash) ?? 0;
    commit.parents.forEach((parentHash, index) => {
      const toRow = rowByHash.has(parentHash) ? rowByHash.get(parentHash)! : -1;
      // A parent outside the loaded page keeps the child's column so the line
      // runs straight off the bottom instead of veering to a phantom lane.
      const toLane = laneByHash.get(parentHash) ?? fromLane;
      edges.push({
        fromHash: commit.hash,
        fromRow: row,
        fromLane,
        toHash: parentHash,
        toRow,
        toLane,
        isMerge: index > 0,
      });
      if (toLane > maxLane) maxLane = toLane;
    });
  });

  return { nodes, edges, laneCount: maxLane + 1 };
}
