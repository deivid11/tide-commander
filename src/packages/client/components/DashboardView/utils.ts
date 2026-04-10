import { Agent } from '@shared/types';
import type { DrawingArea } from '../../../shared/common-types';

// Agent collision avoidance constants
const AGENT_RADIUS = 1; // 1 unit radius for each agent
const MIN_DISTANCE = AGENT_RADIUS * 2.5; // Minimum distance between agent centers
import {
  ZoneGroup,
  StatusFilter,
} from './types';

/**
 * Find a safe position within an area that avoids collisions with existing agents
 * Returns coordinates that don't overlap with other agents in the area
 */
export function findSafePositionInArea(
  area: DrawingArea,
  existingAgents: Agent[],
  preferredPos?: { x: number; z: number }
): { x: number; z: number } {
  const areaAgents = existingAgents.filter(a =>
    a.position && !isNaN(a.position.x) && !isNaN(a.position.z)
  );

  // Get area bounds
  let minX: number, maxX: number, minZ: number, maxZ: number;

  if (area.type === 'rectangle') {
    const w = (area.width || 10) / 2;
    const h = (area.height || 10) / 2;
    minX = area.center.x - w;
    maxX = area.center.x + w;
    minZ = area.center.z - h;
    maxZ = area.center.z + h;
  } else {
    // circle
    const r = area.radius || 5;
    minX = area.center.x - r;
    maxX = area.center.x + r;
    minZ = area.center.z - r;
    maxZ = area.center.z + r;
  }

  // Add padding to stay within bounds
  const padding = 2;
  minX += padding;
  maxX -= padding;
  minZ += padding;
  maxZ -= padding;

  // Try preferred position first if provided
  if (preferredPos) {
    const pos = { ...preferredPos };

    // Clamp to area bounds
    pos.x = Math.max(minX, Math.min(maxX, pos.x));
    pos.z = Math.max(minZ, Math.min(maxZ, pos.z));

    // Check if position is safe
    if (isSafePosition(pos, areaAgents, area)) {
      return pos;
    }
  }

  // Try a spiral pattern to find a safe position
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const maxRadius = Math.min(maxX - centerX, maxZ - centerZ);

  for (let radius = 0; radius < maxRadius; radius += MIN_DISTANCE * 0.5) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;

      const pos = { x, z };

      // Clamp to bounds
      pos.x = Math.max(minX, Math.min(maxX, pos.x));
      pos.z = Math.max(minZ, Math.min(maxZ, pos.z));

      if (isSafePosition(pos, areaAgents, area)) {
        return pos;
      }
    }
  }

  // Fallback: return center of area
  return { x: centerX, z: centerZ };
}

/**
 * Check if a position is safe (no collisions) in the context of an area
 */
function isSafePosition(
  pos: { x: number; z: number },
  existingAgents: Agent[],
  area: DrawingArea
): boolean {
  // Check distance from other agents
  for (const agent of existingAgents) {
    if (!agent.position) continue;
    const distance = Math.hypot(
      pos.x - agent.position.x,
      pos.z - agent.position.z
    );
    if (distance < MIN_DISTANCE) {
      return false;
    }
  }

  // Check if position is within area bounds
  if (area.type === 'rectangle') {
    const w = (area.width || 10) / 2;
    const h = (area.height || 10) / 2;
    const withinX = pos.x >= area.center.x - w + 1 && pos.x <= area.center.x + w - 1;
    const withinZ = pos.z >= area.center.z - h + 1 && pos.z <= area.center.z + h - 1;
    return withinX && withinZ;
  } else {
    // circle
    const r = (area.radius || 5) - 1;
    const distance = Math.hypot(
      pos.x - area.center.x,
      pos.z - area.center.z
    );
    return distance <= r;
  }
}

/**
 * Get status color for display
 */
export function getStatusColor(status: string): 'healthy' | 'working' | 'error' | 'unknown' {
  switch (status) {
    case 'idle':
    case 'running':
      return 'healthy';
    case 'working':
    case 'waiting':
    case 'waiting_permission':
    case 'starting':
    case 'stopping':
      return 'working';
    case 'error':
    case 'offline':
    case 'orphaned':
    case 'stopped':
      return 'error';
    default:
      return 'unknown';
  }
}

/**
 * Format timestamp to human-readable time
 */
export function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

/**
 * Get icon for agent class
 */
export function getAgentClassIcon(agentClass: string): string {
  switch (agentClass) {
    case 'scout':
      return '🔍';
    case 'builder':
      return '🔨';
    case 'debugger':
      return '🐛';
    case 'architect':
      return '📐';
    case 'warrior':
      return '⚔️';
    case 'support':
      return '🛟';
    case 'boss':
      return '👑';
    default:
      return '🤖';
  }
}

/**
 * Get icon for building type
 */
export function getBuildingTypeIcon(buildingType: string): string {
  switch (buildingType) {
    case 'server':
      return '🖥️';
    case 'link':
      return '🔗';
    case 'database':
      return '🗄️';
    case 'docker':
      return '🐳';
    case 'monitor':
      return '📊';
    case 'folder':
      return '📁';
    case 'boss':
      return '🏰';
    default:
      return '🏢';
  }
}

/**
 * Group agents by their DrawingArea (zone).
 * Agents not assigned to any area go into an "Unassigned" group.
 */
export function groupAgentsByZone(
  agents: Map<string, Agent>,
  areas: Map<string, DrawingArea>,
): ZoneGroup[] {
  const groups: ZoneGroup[] = [];
  const assignedAgentIds = new Set<string>();

  // Build a group for EACH non-archived area (even if empty)
  // This matches UnitPanel's approach: all areas included
  for (const area of areas.values()) {
    if (area.archived) continue;
    const zoneAgents: Agent[] = [];
    for (const agentId of area.assignedAgentIds) {
      const agent = agents.get(agentId);
      if (agent) {
        zoneAgents.push(agent);
        assignedAgentIds.add(agentId);
      }
    }
    // Add group even if empty (filtering will happen later)
    groups.push({
      area,
      agents: zoneAgents,
      label: area.name,
      color: area.color,
    });
  }

  // Sort zone groups alphabetically
  groups.sort((a, b) => a.label.localeCompare(b.label));

  // Collect unassigned agents
  const unassigned: Agent[] = [];
  for (const agent of agents.values()) {
    if (!assignedAgentIds.has(agent.id)) {
      unassigned.push(agent);
    }
  }

  // Add unassigned group if there are unassigned agents
  if (unassigned.length > 0) {
    groups.push({
      area: null,
      agents: unassigned,
      label: 'Unassigned',
      color: '#555',
    });
  }

  return groups;
}

/**
 * Group agents by status category
 */
export function groupAgentsByStatus(agents: Map<string, Agent>, unseenAgentIds?: Set<string>): ZoneGroup[] {
  const workingAndUnseen: Agent[] = [];
  const idle: Agent[] = [];
  const errored: Agent[] = [];

  for (const agent of agents.values()) {
    if (agent.status === 'working' || agent.status === 'waiting' || agent.status === 'waiting_permission') {
      workingAndUnseen.push(agent);
    } else if (agent.status === 'error' || agent.status === 'offline' || agent.status === 'orphaned') {
      errored.push(agent);
    } else if (unseenAgentIds && unseenAgentIds.has(agent.id)) {
      // Unseen idle agents go into Working & Unseen group
      workingAndUnseen.push(agent);
    } else {
      idle.push(agent);
    }
  }

  const groups: ZoneGroup[] = [];
  if (errored.length > 0) groups.push({ area: null, agents: errored, label: 'Errors', color: '#d64545' });
  if (workingAndUnseen.length > 0) groups.push({ area: null, agents: workingAndUnseen, label: 'Working & Unseen', color: '#f5d76e' });
  if (idle.length > 0) groups.push({ area: null, agents: idle, label: 'Idle', color: '#5cb88a' });
  return groups;
}

/**
 * Group agents by activity (idle time)
 * Shows agents from least idle time (most recently active) to most idle time
 */
export function groupAgentsByActivity(agents: Map<string, Agent>): ZoneGroup[] {
  const now = Date.now();
  const allAgents = Array.from(agents.values());

  // Sort agents by lastActivity timestamp (most recent first)
  const sorted = [...allAgents].sort((a, b) => {
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  // Group by idle duration
  const veryRecent: Agent[] = [];    // < 5 minutes
  const recent: Agent[] = [];        // 5 min - 1 hour
  const stale: Agent[] = [];         // 1 hour - 1 day
  const veryStale: Agent[] = [];     // > 1 day

  const FIVE_MINUTES = 5 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  for (const agent of sorted) {
    const idleTime = now - (agent.lastActivity || 0);

    if (idleTime < FIVE_MINUTES) {
      veryRecent.push(agent);
    } else if (idleTime < ONE_HOUR) {
      recent.push(agent);
    } else if (idleTime < ONE_DAY) {
      stale.push(agent);
    } else {
      veryStale.push(agent);
    }
  }

  const groups: ZoneGroup[] = [];
  if (veryRecent.length > 0) groups.push({ area: null, agents: veryRecent, label: 'Just Now (< 5m)', color: '#4ade80' });
  if (recent.length > 0) groups.push({ area: null, agents: recent, label: 'Recent (5m - 1h)', color: '#60a5fa' });
  if (stale.length > 0) groups.push({ area: null, agents: stale, label: 'Stale (1h - 1d)', color: '#facc15' });
  if (veryStale.length > 0) groups.push({ area: null, agents: veryStale, label: 'Very Stale (> 1d)', color: '#f87171' });

  return groups;
}

/**
 * Filter agents by status and search query, returning a filtered agents Map
 */
export function filterAgentsByStatusAndSearch(
  agents: Map<string, Agent>,
  statusFilter: StatusFilter,
  search: string,
): Map<string, Agent> {
  const result = new Map<string, Agent>();
  const lowerSearch = search.toLowerCase().trim();

  for (const [id, agent] of agents) {
    // Status filter
    if (statusFilter === 'working') {
      if (agent.status !== 'working' && agent.status !== 'waiting' && agent.status !== 'waiting_permission') continue;
    } else if (statusFilter === 'error') {
      if (agent.status !== 'error' && agent.status !== 'offline' && agent.status !== 'orphaned') continue;
    }

    // Search filter
    if (lowerSearch && !agent.name.toLowerCase().includes(lowerSearch) && !agent.class.toLowerCase().includes(lowerSearch)) {
      continue;
    }

    result.set(id, agent);
  }

  return result;
}

/**
 * Get context usage percentage for an agent
 */
export function getContextPercent(agent: Agent): number {
  if (agent.contextLimit <= 0) return 0;
  return Math.round((agent.contextUsed / agent.contextLimit) * 100);
}

/**
 * Get context bar color based on usage percentage
 */
export function getContextBarColor(percent: number): 'green' | 'yellow' | 'red' {
  if (percent >= 80) return 'red';
  if (percent >= 50) return 'yellow';
  return 'green';
}

/**
 * Sort agents within a group: errors first, then working, then idle, then alphabetically
 */
export function sortAgentsInGroup(agents: Agent[]): Agent[] {
  return sortAgentsInGroupWithOptions(agents);
}

export interface SortAgentsInGroupOptions {
  prioritizeRecentlyIdle?: boolean;
}

/**
 * Sort agents with optional idle-time prioritization for idle agents.
 */
export function sortAgentsInGroupWithOptions(
  agents: Agent[],
  options: SortAgentsInGroupOptions = {},
): Agent[] {
  const { prioritizeRecentlyIdle = false } = options;

  return [...agents].sort((a, b) => {
    const statusOrder: Record<string, number> = {
      error: 0, offline: 0, orphaned: 0,
      working: 1, waiting: 1, waiting_permission: 1,
      idle: 2,
    };
    const orderA = statusOrder[a.status] ?? 3;
    const orderB = statusOrder[b.status] ?? 3;
    if (orderA !== orderB) return orderA - orderB;

    if (prioritizeRecentlyIdle && a.status === 'idle' && b.status === 'idle') {
      // Idle agents with a taskLabel first (completed a task, need attention)
      const aHasTask = !!a.taskLabel;
      const bHasTask = !!b.taskLabel;
      if (aHasTask !== bHasTask) return aHasTask ? -1 : 1;

      return (b.lastActivity || 0) - (a.lastActivity || 0);
    }

    return a.name.localeCompare(b.name);
  });
}
