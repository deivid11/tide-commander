/**
 * Types and constants for the CommanderView component family
 */

// Re-export shared types for convenience
export type { HistoryMessage, AttachedFile } from '../shared/outputTypes';
export { MESSAGES_PER_PAGE } from '../shared/outputTypes';

/**
 * Agent history state for a single agent
 */
export interface AgentHistory {
  agentId: string;
  messages: import('../shared/outputTypes').HistoryMessage[];
  loading: boolean;
  hasMore: boolean;
  totalCount: number;
}

/**
 * View mode for CommanderView: 'simple' shows only user/assistant messages, 'advanced' shows everything
 */
export type CommanderViewMode = 'simple' | 'advanced';

/**
 * Tab identifier: 'all', 'unassigned', or an area ID
 */
export type TabId = 'all' | 'unassigned' | string;

/**
 * Tab configuration for area tabs
 */
export interface TabConfig {
  id: TabId;
  name: string;
  color?: string;
}

// Layout constants
export const AGENTS_PER_PAGE = 20;
export const GRID_COLS = 3;
export const SCROLL_THRESHOLD = 50; // px from top to trigger load more

// Status colors for agent states
export const STATUS_COLORS: Record<string, string> = {
  idle: '#4aff9e',
  working: '#4a9eff',
  waiting: '#ff9e4a',
  waiting_permission: '#ffcc00',
  error: '#ff4a4a',
  offline: '#888888',
  orphaned: '#ff9e4a',
};
