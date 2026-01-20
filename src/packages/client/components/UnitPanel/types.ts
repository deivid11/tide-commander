/**
 * Types and constants for the UnitPanel component family
 */

import type { Agent, DrawingArea, AgentSupervisorHistoryEntry, DelegationDecision } from '../../../shared/types';

// ============================================================================
// Props Types
// ============================================================================

export interface UnitPanelProps {
  onFocusAgent: (agentId: string) => void;
  onKillAgent: (agentId: string) => void;
  onCallSubordinates?: (bossId: string) => void;
  onOpenAreaExplorer?: (areaId: string) => void;
}

export interface AgentsListProps {
  onOpenAreaExplorer?: (areaId: string) => void;
}

export interface AgentListItemProps {
  agent: Agent;
  area?: DrawingArea | null;
}

export interface SingleAgentPanelProps {
  agent: Agent;
  onFocusAgent: (agentId: string) => void;
  onKillAgent: (agentId: string) => void;
  onCallSubordinates?: (bossId: string) => void;
  onOpenAreaExplorer?: (areaId: string) => void;
}

export interface MultiAgentPanelProps {
  agents: Agent[];
}

export interface GlobalSupervisorStatusProps {
  agents: Agent[];
}

export interface SupervisorHistoryItemProps {
  entry: AgentSupervisorHistoryEntry;
  defaultExpanded?: boolean;
}

export interface BossAgentSectionProps {
  agent: Agent;
}

export interface DelegationDecisionItemProps {
  decision: DelegationDecision;
}

export interface SubordinateBadgeProps {
  agentId: string;
  bossId: string;
}

export interface LinkToBossSectionProps {
  agentId: string;
}

// ============================================================================
// Data Types
// ============================================================================

/**
 * Remembered pattern type for interactive mode agents (matches server)
 */
export interface RememberedPattern {
  tool: string;
  pattern: string;
  description: string;
  createdAt: number;
}

/**
 * Context information computed from agent stats
 */
export interface ContextInfo {
  remainingPercent: number;
  usedPercent: number;
  hasData: boolean;
  totalTokens: number;
  contextWindow: number;
  freeTokens: number;
}

/**
 * Agent status with supervisor history entry
 */
export interface AgentStatusWithHistory {
  agent: Agent;
  entry: AgentSupervisorHistoryEntry | null;
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Confidence level colors for delegation decisions
 */
export const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#4aff9e',
  medium: '#ff9e4a',
  low: '#ff4a4a',
};

/**
 * Context action types for confirmation modal
 */
export type ContextAction = 'collapse' | 'clear' | null;
