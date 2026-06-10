/**
 * Shared agent ordering used by the Agent Overview panel.
 *
 * Extracted so other surfaces (e.g. the Spotlight "Areas" tab) can list agents
 * in the EXACT same order the overview uses, instead of inventing a parallel
 * sort that could drift out of sync.
 */

import type { Agent } from '../../../shared/types';

export type AgentSortMode = 'name' | 'status' | 'recent';

// Status priority used by the 'status' sort mode (earlier = higher priority).
export const STATUS_SORT_ORDER = ['working', 'waiting_input', 'waiting_permission', 'error', 'idle', 'stopped'];

export interface AgentOverviewComparatorOptions {
  sortMode: AgentSortMode;
  /** Agents that currently have unseen output (boosted within the 'status' mode). */
  agentsWithUnseenOutput: Set<string>;
  /**
   * Latest tool-execution timestamp for an agent (newest first), used by the
   * 'recent' mode. Returns undefined when the agent has no tool executions, in
   * which case the comparator falls back to the agent's lastActivity.
   */
  getLatestToolTimestamp?: (agentId: string) => number | undefined;
}

/**
 * Build the comparator the Agent Overview panel uses for a full re-sort.
 * Bosses always come first; the remaining ordering depends on the sort mode.
 */
export function makeAgentOverviewComparator({
  sortMode,
  agentsWithUnseenOutput,
  getLatestToolTimestamp,
}: AgentOverviewComparatorOptions): (a: Agent, b: Agent) => number {
  return (a, b) => {
    const aIsBoss = !!(a.isBoss || a.class === 'boss');
    const bIsBoss = !!(b.isBoss || b.class === 'boss');
    if (aIsBoss !== bIsBoss) return aIsBoss ? -1 : 1;

    if (sortMode === 'name') return a.name.localeCompare(b.name);
    if (sortMode === 'status') {
      const statusCmp = STATUS_SORT_ORDER.indexOf(a.status) - STATUS_SORT_ORDER.indexOf(b.status);
      if (statusCmp !== 0) return statusCmp;

      const aUnread = agentsWithUnseenOutput.has(a.id);
      const bUnread = agentsWithUnseenOutput.has(b.id);
      if (aUnread !== bUnread) return aUnread ? -1 : 1;

      if (a.status === 'working' && b.status === 'working') {
        return a.name.localeCompare(b.name);
      }

      if (a.status === 'idle' && b.status === 'idle') {
        const aHasTask = !!a.taskLabel;
        const bHasTask = !!b.taskLabel;
        if (aHasTask !== bHasTask) return aHasTask ? -1 : 1;
        return (b.lastActivity || 0) - (a.lastActivity || 0);
      }

      return (b.lastActivity || 0) - (a.lastActivity || 0);
    }

    // 'recent' mode — most recent tool activity first, falling back to lastActivity.
    const aTime = getLatestToolTimestamp?.(a.id) || a.lastActivity || 0;
    const bTime = getLatestToolTimestamp?.(b.id) || b.lastActivity || 0;
    return bTime - aTime;
  };
}
