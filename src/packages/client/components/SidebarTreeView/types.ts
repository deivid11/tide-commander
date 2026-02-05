import { Agent, Building } from '@packages/shared/types';

/**
 * Status indicator colors based on entity state
 */
export type StatusColor = 'healthy' | 'working' | 'error' | 'unknown';

/**
 * Hierarchical tree node representing an agent or building
 */
export interface TreeNodeData {
  id: string;
  label: string;
  type: 'agent' | 'building' | 'boss-subordinates' | 'building-subordinates';
  icon: string;
  status: StatusColor;
  level: number;
  hasChildren: boolean;
  data: Agent | Building | null;  // Original entity data
}

/**
 * Tracking expanded/collapsed state per node
 */
export interface ExpandedState {
  [nodeId: string]: boolean;
}

/**
 * Search and filter options
 */
export interface FilterOptions {
  searchQuery: string;
  statusFilter?: StatusColor | 'all';
  typeFilter?: 'agents' | 'buildings' | 'all';
}

/**
 * Selection state for tree items
 */
export interface SelectionState {
  selectedAgentIds: Set<string>;
  selectedBuildingIds: Set<string>;
}
