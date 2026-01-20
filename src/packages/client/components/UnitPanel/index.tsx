/**
 * UnitPanel - Main orchestrator component
 *
 * Displays agent information based on selection state:
 * - No selection: Shows AgentsList with all agents grouped by area
 * - Single selection: Shows SingleAgentPanel with detailed agent view
 * - Multi selection: Shows MultiAgentPanel with aggregate stats
 *
 * Directory structure:
 * - index.tsx: This orchestrator component
 * - types.ts: Centralized type definitions
 * - agentUtils.ts: Utility functions (formatters, calculators)
 * - useAgentSelection.ts: Custom hooks for agent selection state
 * - AgentStatsRow.tsx: Reusable stat display components
 * - AgentsList.tsx: List view with area grouping
 * - SingleAgentPanel.tsx: Detailed single agent view
 * - MultiAgentPanel.tsx: Multi-select aggregate view
 */

import React from 'react';
import { useStore, store } from '../../store';
import { AgentsList } from './AgentsList';
import { SingleAgentPanel } from './SingleAgentPanel';
import { MultiAgentPanel } from './MultiAgentPanel';
import type { UnitPanelProps } from './types';

// ============================================================================
// UnitPanel Main Component
// ============================================================================

export function UnitPanel({
  onFocusAgent,
  onKillAgent,
  onCallSubordinates,
  onOpenAreaExplorer,
}: UnitPanelProps) {
  const state = useStore();
  const selectedAgents = store.getSelectedAgents();

  // No selection: show agents list
  if (state.selectedAgentIds.size === 0) {
    return <AgentsList onOpenAreaExplorer={onOpenAreaExplorer} />;
  }

  // Single selection: show single agent panel
  if (state.selectedAgentIds.size === 1) {
    const agent = selectedAgents[0];
    if (!agent) return <AgentsList onOpenAreaExplorer={onOpenAreaExplorer} />;
    return (
      <SingleAgentPanel
        agent={agent}
        onFocusAgent={onFocusAgent}
        onKillAgent={onKillAgent}
        onCallSubordinates={onCallSubordinates}
        onOpenAreaExplorer={onOpenAreaExplorer}
      />
    );
  }

  // Multi selection: show multi agent panel
  return <MultiAgentPanel agents={selectedAgents} />;
}

// Re-export types and components for convenience
export type { UnitPanelProps } from './types';
export type {
  AgentsListProps,
  SingleAgentPanelProps,
  MultiAgentPanelProps,
  AgentListItemProps,
  GlobalSupervisorStatusProps,
  SupervisorHistoryItemProps,
  BossAgentSectionProps,
  DelegationDecisionItemProps,
  SubordinateBadgeProps,
  LinkToBossSectionProps,
  RememberedPattern,
  ContextInfo,
  ContextAction,
} from './types';

export { AgentsList, AgentListItem, GlobalSupervisorStatus } from './AgentsList';
export {
  SingleAgentPanel,
  SupervisorHistoryItem,
  BossAgentSection,
  DelegationDecisionItem,
  SubordinateBadge,
  LinkToBossSection,
} from './SingleAgentPanel';
export { MultiAgentPanel, MultiAgentListItem } from './MultiAgentPanel';
export {
  AgentStatsGrid,
  ContextBar,
  IdleTimer,
  CurrentTool,
  CurrentTask,
  WorkingDirectory,
  LastPrompt,
  LastResponse,
} from './AgentStatsRow';
export {
  formatIdleCompact,
  formatRelativeTime,
  calculateContextInfo,
  getContextBarColor,
  groupAgentsByArea,
  sortAreaIds,
} from './agentUtils';
export { useAgentSelection, useIdleTimer, useSupervisorHistory } from './useAgentSelection';
