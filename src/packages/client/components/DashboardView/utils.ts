import { Agent, Building } from '@shared/types';
import type { DrawingArea } from '../../../shared/common-types';
import {
  DashboardMetrics,
  AgentCardData,
  BuildingCardData,
  RecentEvent,
  DashboardFilters,
  DashboardError,
  ZoneGroup,
  StatusFilter,
} from './types';

/**
 * Calculate dashboard metrics from agent and building maps
 */
export function calculateMetrics(
  agents: Map<string, Agent>,
  buildings: Map<string, Building>,
  recentErrors: DashboardError[]
): DashboardMetrics {
  const agentArray = Array.from(agents.values());
  const buildingArray = Array.from(buildings.values());

  // Agent statistics
  const totalAgents = agentArray.length;
  const activeAgents = agentArray.filter((a) => a.status !== 'idle').length;
  const idleAgents = agentArray.filter((a) => a.status === 'idle').length;
  const workingAgents = agentArray.filter(
    (a) => a.status === 'working' || a.status === 'waiting' || a.status === 'waiting_permission'
  ).length;
  const errorAgents = agentArray.filter(
    (a) => a.status === 'error' || a.status === 'offline' || a.status === 'orphaned'
  ).length;

  // Building statistics
  const totalBuildings = buildingArray.length;
  const healthyBuildings = buildingArray.filter((b) => b.status === 'running').length;
  const errorBuildings = buildingArray.filter((b) => b.status === 'error' || b.status === 'stopped').length;

  // Rates
  const taskCompletionRate = totalAgents > 0 ? (idleAgents / totalAgents) * 100 : 0;
  const errorRate = totalAgents > 0 ? (errorAgents / totalAgents) * 100 : 0;

  return {
    totalAgents,
    activeAgents,
    idleAgents,
    workingAgents,
    errorAgents,
    totalBuildings,
    healthyBuildings,
    errorBuildings,
    taskCompletionRate: Math.round(taskCompletionRate),
    errorRate: Math.round(errorRate),
    recentErrors: recentErrors.slice(0, 5),  // Top 5 recent errors
  };
}

/**
 * Build agent card data from agent
 */
export function buildAgentCardData(
  agent: Agent,
  agents: Map<string, Agent>,
  taskProgress: number = 0,
  taskDescription: string = ''
): AgentCardData {
  const subordinateIds = agent.subordinateIds || [];
  const subordinates = subordinateIds
    .map((id) => agents.get(id))
    .filter((a): a is Agent => a !== undefined);

  const subordinateActive = subordinates.filter(
    (a) => a.status !== 'idle' && a.status !== 'offline'
  ).length;

  return {
    agent,
    taskProgress,
    currentTaskDescription: taskDescription,
    isWorking: agent.status === 'working' || agent.status === 'waiting' || agent.status === 'waiting_permission',
    hasError: agent.status === 'error' || agent.status === 'offline' || agent.status === 'orphaned',
    subordinateCount: subordinateIds.length,
    subordinateActive,
  };
}

/**
 * Build building card data from building
 */
export function buildBuildingCardData(
  building: Building,
  buildings: Map<string, Building>
): BuildingCardData {
  const subordinateIds = building.subordinateBuildingIds || [];
  const subordinates = subordinateIds
    .map((id) => buildings.get(id))
    .filter((b): b is Building => b !== undefined);

  const subordinateHealthy = subordinates.filter((b) => b.status === 'running').length;

  return {
    building,
    isHealthy: building.status === 'running',
    hasError: building.status === 'error',
    lastHealthCheck: building.lastHealthCheck,
    subordinateCount: subordinateIds.length,
    subordinateHealthy,
  };
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
 * Format duration from milliseconds
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${hours}h ${minutes % 60}m`;
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
 * Filter agents by criteria
 */
export function filterAgents(
  agents: Agent[],
  filters: DashboardFilters
): Agent[] {
  return agents.filter((agent) => {
    if (filters.showOnlyActive && agent.status === 'idle') return false;
    if (filters.showOnlyErrors && (agent.status !== 'error' && agent.status !== 'offline' && agent.status !== 'orphaned'))
      return false;
    if (filters.agentClassFilter !== 'all' && agent.class !== filters.agentClassFilter) return false;
    return true;
  });
}

/**
 * Filter buildings by criteria
 */
export function filterBuildings(
  buildings: Building[],
  filters: DashboardFilters
): Building[] {
  return buildings.filter((building) => {
    if (filters.showOnlyActive && building.status === 'stopped') return false;
    if (filters.showOnlyErrors && building.status !== 'error' && building.status !== 'stopped') return false;
    if (filters.buildingTypeFilter !== 'all' && building.type !== filters.buildingTypeFilter) return false;
    return true;
  });
}

/**
 * Generate recent events from agents and buildings
 */
export function generateRecentEvents(
  agents: Map<string, Agent>,
  buildings: Map<string, Building>
): RecentEvent[] {
  const events: RecentEvent[] = [];
  const now = Date.now();

  // Add agent status changes (simulated from current state)
  // In a real implementation, these would come from activity history
  Array.from(agents.values()).forEach((agent) => {
    if (agent.status === 'working') {
      events.push({
        id: `agent-${agent.id}-working`,
        type: 'agent_status',
        timestamp: now - Math.random() * 3600000,  // Random time in last hour
        agentId: agent.id,
        agentName: agent.name,
        message: `${agent.name} is working`,
        severity: 'info',
      });
    }
    if (agent.status === 'error' || agent.status === 'offline') {
      events.push({
        id: `agent-${agent.id}-error`,
        type: 'error',
        timestamp: now - Math.random() * 1800000,  // Random time in last 30 min
        agentId: agent.id,
        agentName: agent.name,
        message: `${agent.name} encountered an error`,
        severity: 'error',
      });
    }
  });

  // Add building status changes
  Array.from(buildings.values()).forEach((building) => {
    if (building.status === 'error') {
      events.push({
        id: `building-${building.id}-error`,
        type: 'building_offline',
        timestamp: now - Math.random() * 1800000,
        buildingId: building.id,
        buildingName: building.name,
        message: `${building.name} is offline`,
        severity: 'error',
      });
    }
  });

  // Sort by timestamp descending (most recent first)
  return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
}

/**
 * Calculate task completion percentage
 */
export function getTaskProgress(agent: Agent): number {
  // In a real implementation, this would come from task tracking
  // For now, return a simulated value based on agent status
  if (agent.status === 'idle') return 100;
  if (agent.status === 'working') return 45;
  if (agent.status === 'error') return 0;
  return 25;
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

  // Build a group for each non-archived area that has agents
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
    if (zoneAgents.length > 0) {
      groups.push({
        area,
        agents: zoneAgents,
        label: area.name,
        color: area.color,
      });
    }
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
export function groupAgentsByStatus(agents: Map<string, Agent>): ZoneGroup[] {
  const working: Agent[] = [];
  const idle: Agent[] = [];
  const errored: Agent[] = [];

  for (const agent of agents.values()) {
    if (agent.status === 'working' || agent.status === 'waiting' || agent.status === 'waiting_permission') {
      working.push(agent);
    } else if (agent.status === 'error' || agent.status === 'offline' || agent.status === 'orphaned') {
      errored.push(agent);
    } else {
      idle.push(agent);
    }
  }

  const groups: ZoneGroup[] = [];
  if (errored.length > 0) groups.push({ area: null, agents: errored, label: 'Errors', color: '#d64545' });
  if (working.length > 0) groups.push({ area: null, agents: working, label: 'Working', color: '#f5d76e' });
  if (idle.length > 0) groups.push({ area: null, agents: idle, label: 'Idle', color: '#5cb88a' });
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
  return [...agents].sort((a, b) => {
    const statusOrder: Record<string, number> = {
      error: 0, offline: 0, orphaned: 0,
      working: 1, waiting: 1, waiting_permission: 1,
      idle: 2,
    };
    const orderA = statusOrder[a.status] ?? 3;
    const orderB = statusOrder[b.status] ?? 3;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}
