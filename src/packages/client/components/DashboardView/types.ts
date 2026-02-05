import { Agent, Building } from '@packages/shared/types';

/**
 * Dashboard metrics and statistics
 */
export interface DashboardMetrics {
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  workingAgents: number;
  errorAgents: number;
  totalBuildings: number;
  healthyBuildings: number;
  errorBuildings: number;
  taskCompletionRate: number;  // Percentage (0-100)
  errorRate: number;            // Percentage (0-100)
  recentErrors: DashboardError[];
}

/**
 * Agent status card data
 */
export interface AgentCardData {
  agent: Agent;
  taskProgress: number;              // Percentage (0-100)
  currentTaskDescription: string;
  isWorking: boolean;
  hasError: boolean;
  subordinateCount: number;
  subordinateActive: number;
}

/**
 * Building status data
 */
export interface BuildingCardData {
  building: Building;
  isHealthy: boolean;
  hasError: boolean;
  lastHealthCheck: number | undefined;
  subordinateCount: number;
  subordinateHealthy: number;
}

/**
 * Recent event for timeline
 */
export interface RecentEvent {
  id: string;
  type: 'agent_status' | 'task_complete' | 'task_failed' | 'building_online' | 'building_offline' | 'error';
  timestamp: number;
  agentId?: string;
  agentName?: string;
  buildingId?: string;
  buildingName?: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

/**
 * Error record for dashboard
 */
export interface DashboardError {
  id: string;
  agentId: string;
  agentName: string;
  message: string;
  timestamp: number;
  resolved: boolean;
}

/**
 * Dashboard state for filtering
 */
export interface DashboardFilters {
  showOnlyActive: boolean;
  showOnlyErrors: boolean;
  agentClassFilter: string | 'all';
  buildingTypeFilter: string | 'all';
}

/**
 * Props for main DashboardView component
 */
export interface DashboardViewProps {
  onSelectAgent?: (agentId: string) => void;
  onSelectBuilding?: (buildingId: string) => void;
  onOpenAgentDetails?: (agentId: string) => void;
}
