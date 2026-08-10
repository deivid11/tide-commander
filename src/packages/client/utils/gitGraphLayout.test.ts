import { describe, it, expect } from 'vitest';
import { computeGitGraphLayout, laneColor, LANE_COLORS } from './gitGraphLayout';

/** Helper: commits are listed newest-first, like `git log`. */
const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe('computeGitGraphLayout', () => {
  it('handles an empty history', () => {
    expect(computeGitGraphLayout([])).toEqual({ nodes: [], edges: [], laneCount: 0 });
  });

  it('keeps a linear history in one lane', () => {
    const layout = computeGitGraphLayout([c('c', 'b'), c('b', 'a'), c('a')]);

    expect(layout.laneCount).toBe(1);
    expect(layout.nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    expect(layout.nodes.map((n) => n.row)).toEqual([0, 1, 2]);
  });

  it('gives a merge its second parent a separate lane', () => {
    //   m        row 0  lane 0   (merge of main + feature)
    //   |\
    //   | f      row 1  lane 1   (feature)
    //   b |      row 2  lane 0   (main)
    //   |/
    //   a        row 3  lane 0   (base)
    const layout = computeGitGraphLayout([
      c('m', 'b', 'f'),
      c('f', 'a'),
      c('b', 'a'),
      c('a'),
    ]);

    const lane = (h: string) => layout.nodes.find((n) => n.hash === h)!.lane;
    expect(lane('m')).toBe(0);
    expect(lane('b')).toBe(0);          // first parent inherits the lane
    expect(lane('f')).not.toBe(lane('b')); // second parent branches off
    expect(layout.laneCount).toBeGreaterThanOrEqual(2);

    const mergeEdges = layout.edges.filter((e) => e.fromHash === 'm');
    expect(mergeEdges).toHaveLength(2);
    expect(mergeEdges[0].isMerge).toBe(false);
    expect(mergeEdges[1].isMerge).toBe(true);
  });

  it('anchors every edge to a real node position', () => {
    const layout = computeGitGraphLayout([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);

    for (const edge of layout.edges) {
      const from = layout.nodes.find((n) => n.hash === edge.fromHash)!;
      expect(edge.fromRow).toBe(from.row);
      expect(edge.fromLane).toBe(from.lane);
      if (edge.toRow !== -1) {
        const to = layout.nodes.find((n) => n.hash === edge.toHash)!;
        expect(edge.toRow).toBe(to.row);
        expect(edge.toLane).toBe(to.lane);
      }
    }
  });

  // Pagination: the last page's parents live outside the loaded window.
  it('marks parents outside the loaded page with row -1', () => {
    const layout = computeGitGraphLayout([c('b', 'a')]);

    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].toRow).toBe(-1);
    // Runs straight off the bottom rather than veering to a phantom lane.
    expect(layout.edges[0].toLane).toBe(layout.edges[0].fromLane);
  });

  // Without releasing duplicate reservations the graph drifts right forever.
  it('reuses a lane once a branch is merged back', () => {
    const layout = computeGitGraphLayout([
      c('m', 'b', 'f'),
      c('f', 'a'),
      c('b', 'a'),
      c('a'),
      c('z1', 'z2'),
      c('z2'),
    ]);

    expect(layout.laneCount).toBeLessThanOrEqual(2);
    expect(layout.nodes.find((n) => n.hash === 'z1')!.lane).toBe(0);
  });

  it('ends a lane at a root commit', () => {
    const layout = computeGitGraphLayout([c('a')]);
    expect(layout.nodes[0].lane).toBe(0);
    expect(layout.edges).toHaveLength(0);
  });

  it('handles two independent root histories', () => {
    const layout = computeGitGraphLayout([c('a1', 'a0'), c('a0'), c('b1', 'b0'), c('b0')]);
    expect(layout.nodes).toHaveLength(4);
    expect(layout.nodes.every((n) => n.lane >= 0)).toBe(true);
  });

  it('cycles lane colours instead of running out', () => {
    expect(laneColor(0)).toBe(LANE_COLORS[0]);
    expect(laneColor(LANE_COLORS.length)).toBe(LANE_COLORS[0]);
    expect(laneColor(LANE_COLORS.length + 3)).toBe(LANE_COLORS[3]);
  });
});
