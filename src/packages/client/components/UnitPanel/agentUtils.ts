/**
 * Utility functions for the UnitPanel component family
 */

import type { Agent } from '../../../shared/types';
import { getDisplayContextInfo } from '../../utils/context';
import type { ContextInfo } from './types';

/**
 * Format compact idle time (e.g., "2m", "1h")
 */
export function formatIdleCompact(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Format relative time (e.g., "just now", "2m ago", "1h ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Calculate context info from agent stats
 */
export function calculateContextInfo(agent: Agent): ContextInfo {
  if (agent.contextStats) {
    const context = getDisplayContextInfo(agent);
    return {
      remainingPercent: context.freePercent,
      usedPercent: context.usedPercent,
      hasData: true,
      totalTokens: context.totalTokens,
      contextWindow: context.contextWindow,
      freeTokens: context.contextWindow - context.totalTokens,
    };
  }
  const context = getDisplayContextInfo(agent);
  return {
    remainingPercent: context.freePercent,
    usedPercent: context.usedPercent,
    hasData: false,
    totalTokens: context.totalTokens,
    contextWindow: context.contextWindow,
    freeTokens: context.contextWindow - context.totalTokens,
  };
}

/**
 * Get context bar color based on remaining percent
 */
export function getContextBarColor(remainingPercent: number): string {
  if (remainingPercent < 20) return '#c85858';  // Muted red
  if (remainingPercent < 50) return '#c89858';  // Muted orange
  return '#6a9a78';  // Muted sage green
}

/**
 * Status priority for sorting: active statuses first
 */
const STATUS_PRIORITY: Record<string, number> = {
  working: 0,
  waiting_permission: 1,
  waiting: 2,
  error: 3,
  orphaned: 4,
  idle: 5,
  offline: 6,
};

/**
 * Sort agents by activity: active statuses first, then by most recent activity
 */
export function sortAgentsByActivity(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const priorityA = STATUS_PRIORITY[a.status] ?? 5;
    const priorityB = STATUS_PRIORITY[b.status] ?? 5;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });
}

/**
 * Group agents by area ID
 */
export function groupAgentsByArea(
  agents: Agent[],
  getAreaForAgent: (agentId: string) => { id: string } | null
): Map<string | null, Agent[]> {
  const agentsByArea = new Map<string | null, Agent[]>();

  for (const agent of agents) {
    const area = getAreaForAgent(agent.id);
    const areaId = area?.id || null;
    if (!agentsByArea.has(areaId)) {
      agentsByArea.set(areaId, []);
    }
    agentsByArea.get(areaId)!.push(agent);
  }

  return agentsByArea;
}

/**
 * Sort area IDs with unassigned (null) last, areas alphabetically
 */
export function sortAreaIds(
  areaIds: (string | null)[],
  getArea: (id: string) => { name: string } | undefined
): (string | null)[] {
  return [...areaIds].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const areaA = a ? getArea(a) : undefined;
    const areaB = b ? getArea(b) : undefined;
    return (areaA?.name || '').localeCompare(areaB?.name || '');
  });
}
