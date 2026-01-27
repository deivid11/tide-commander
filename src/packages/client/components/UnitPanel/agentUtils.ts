/**
 * Utility functions for the UnitPanel component family
 */

import type { Agent } from '../../../shared/types';
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
  const stats = agent.contextStats;
  if (stats) {
    // Use data from /context command
    const usedPercent = stats.usedPercent;
    const freePercent = 100 - usedPercent;
    const freeTokens = stats.contextWindow - stats.totalTokens;
    return {
      remainingPercent: freePercent,
      usedPercent,
      hasData: true,
      totalTokens: stats.totalTokens,
      contextWindow: stats.contextWindow,
      freeTokens: freeTokens,
    };
  }
  // Fallback to basic calculation if no /context data
  const used = agent.contextUsed || 0;
  const limit = agent.contextLimit || 200000;
  const remaining = Math.max(0, limit - used);
  return {
    remainingPercent: (remaining / limit) * 100,
    usedPercent: (used / limit) * 100,
    hasData: false,
    totalTokens: used,
    contextWindow: limit,
    freeTokens: remaining,
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
