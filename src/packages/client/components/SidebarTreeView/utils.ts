import { Agent, Building } from '@shared/types';
import { TreeNodeData, StatusColor, ExpandedState, FilterOptions } from './types';

/**
 * Map agent status to color indicator
 */
export function getAgentStatusColor(agent: Agent): StatusColor {
  switch (agent.status) {
    case 'idle':
      return 'healthy';
    case 'working':
    case 'waiting':
    case 'waiting_permission':
      return 'working';
    case 'error':
    case 'offline':
    case 'orphaned':
      return 'error';
    default:
      return 'unknown';
  }
}

/**
 * Map building status to color indicator
 */
export function getBuildingStatusColor(building: Building): StatusColor {
  switch (building.status) {
    case 'running':
      return 'healthy';
    case 'starting':
    case 'stopping':
      return 'working';
    case 'stopped':
    case 'error':
      return 'error';
    case 'unknown':
    default:
      return 'unknown';
  }
}

/**
 * Get icon emoji for agent class
 */
export function getAgentIcon(agent: Agent): string {
  switch (agent.class) {
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
 * Get icon emoji for building type
 */
export function getBuildingIcon(building: Building): string {
  switch (building.type) {
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
 * Build hierarchical tree node data from agents
 */
export function buildAgentTreeNodes(
  agents: Map<string, Agent>,
  selectedIds: Set<string>
): TreeNodeData[] {
  const rootAgents = Array.from(agents.values()).filter(
    (agent) => !agent.bossId  // Root agents have no boss
  );

  return rootAgents
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((agent) => createAgentTreeNode(agent, agents, 0, selectedIds));
}

/**
 * Recursively create agent tree node with subordinates
 */
function createAgentTreeNode(
  agent: Agent,
  agents: Map<string, Agent>,
  level: number,
  _selectedIds: Set<string>
): TreeNodeData {
  const subordinates = (agent.subordinateIds || [])
    .map((id) => agents.get(id))
    .filter((agent): agent is Agent => agent !== undefined);

  return {
    id: agent.id,
    label: agent.name,
    type: 'agent',
    icon: getAgentIcon(agent),
    status: getAgentStatusColor(agent),
    level,
    hasChildren: subordinates.length > 0,
    data: agent,
  };
}

/**
 * Build hierarchical tree node data from buildings
 */
export function buildBuildingTreeNodes(
  buildings: Map<string, Building>,
  selectedIds: Set<string>
): TreeNodeData[] {
  // Find all building IDs that are subordinates (have a boss)
  const subordinateIds = new Set<string>();
  buildings.forEach((building) => {
    if (building.subordinateBuildingIds) {
      building.subordinateBuildingIds.forEach((id) => subordinateIds.add(id));
    }
  });

  // Root buildings are those that are NOT subordinates of any boss
  const rootBuildings = Array.from(buildings.values()).filter(
    (building) => !subordinateIds.has(building.id)
  );

  return rootBuildings
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((building) => createBuildingTreeNode(building, buildings, 0, selectedIds));
}

/**
 * Recursively create building tree node with subordinates
 */
function createBuildingTreeNode(
  building: Building,
  buildings: Map<string, Building>,
  level: number,
  _selectedIds: Set<string>
): TreeNodeData {
  const subordinates = (building.subordinateBuildingIds || [])
    .map((id) => buildings.get(id))
    .filter((building): building is Building => building !== undefined);

  return {
    id: building.id,
    label: building.name,
    type: 'building',
    icon: getBuildingIcon(building),
    status: getBuildingStatusColor(building),
    level,
    hasChildren: subordinates.length > 0,
    data: building,
  };
}

/**
 * Filter tree nodes by search query and status
 */
export function filterTreeNodes(
  nodes: TreeNodeData[],
  filters: FilterOptions
): TreeNodeData[] {
  const { searchQuery, statusFilter } = filters;
  const query = searchQuery.toLowerCase();

  return nodes.filter((node) => {
    // Apply search filter
    if (query && !node.label.toLowerCase().includes(query)) {
      return false;
    }

    // Apply status filter
    if (statusFilter && statusFilter !== 'all' && node.status !== statusFilter) {
      return false;
    }

    return true;
  });
}

/**
 * Recursively get all subordinate IDs for an agent
 */
export function getAgentSubordinateIds(
  agentId: string,
  agents: Map<string, Agent>
): string[] {
  const agent = agents.get(agentId);
  if (!agent || !agent.subordinateIds) return [];

  const subordinateIds: string[] = [...agent.subordinateIds];
  for (const subId of agent.subordinateIds) {
    subordinateIds.push(...getAgentSubordinateIds(subId, agents));
  }
  return subordinateIds;
}

/**
 * Recursively get all subordinate IDs for a building
 */
export function getBuildingSubordinateIds(
  buildingId: string,
  buildings: Map<string, Building>
): string[] {
  const building = buildings.get(buildingId);
  if (!building || !building.subordinateBuildingIds) return [];

  const subordinateIds: string[] = [...building.subordinateBuildingIds];
  for (const subId of building.subordinateBuildingIds) {
    subordinateIds.push(...getBuildingSubordinateIds(subId, buildings));
  }
  return subordinateIds;
}

/**
 * Toggle expanded state for a node
 */
export function toggleExpandedState(
  nodeId: string,
  expanded: ExpandedState
): ExpandedState {
  return {
    ...expanded,
    [nodeId]: !expanded[nodeId],
  };
}

/**
 * Expand all ancestors of a node (for search results)
 */
export function expandAncestors(
  nodeId: string,
  agents: Map<string, Agent>,
  expanded: ExpandedState
): ExpandedState {
  const newExpanded = { ...expanded, [nodeId]: true };
  const agent = agents.get(nodeId);

  if (agent && agent.bossId) {
    return expandAncestors(agent.bossId, agents, newExpanded);
  }

  return newExpanded;
}
