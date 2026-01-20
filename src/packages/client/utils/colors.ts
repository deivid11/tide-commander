/**
 * Centralized color definitions for the application
 * All color constants should be imported from here to ensure consistency
 */

import type { AgentStatus, BuildingStatus } from '../../shared/types';

/**
 * Agent status colors - used for status indicators across the UI
 * Available in both hex string and numeric formats for different use cases
 */
export const AGENT_STATUS_COLORS: Record<AgentStatus | 'default', string> = {
  idle: '#4aff9e',           // Green - ready
  working: '#4a9eff',        // Blue - active
  waiting: '#ff9e4a',        // Orange - waiting for input
  waiting_permission: '#ffcc00', // Yellow/gold - awaiting permission
  error: '#ff4a4a',          // Red - error state
  offline: '#888888',        // Gray - offline
  orphaned: '#ff9e4a',       // Orange - orphaned process
  default: '#888888',        // Gray - fallback
};

/**
 * Agent status colors as numeric values (for Three.js materials)
 */
export const AGENT_STATUS_COLORS_HEX: Record<AgentStatus | 'default', number> = {
  idle: 0x4aff9e,
  working: 0x4a9eff,
  waiting: 0xff9e4a,
  waiting_permission: 0xffcc00,
  error: 0xff4a4a,
  offline: 0x888888,
  orphaned: 0xff9e4a,
  default: 0x888888,
};

/**
 * Building status colors - used for building status indicators
 */
export const BUILDING_STATUS_COLORS: Record<BuildingStatus, string> = {
  running: '#4aff9e',    // Green
  stopped: '#888888',    // Gray
  error: '#ff4a4a',      // Red
  unknown: '#ffaa00',    // Orange
  starting: '#4a9eff',   // Blue
  stopping: '#ffaa00',   // Orange
};

/**
 * Building status colors as numeric values (for Three.js materials)
 */
export const BUILDING_STATUS_COLORS_HEX: Record<BuildingStatus, number> = {
  running: 0x4aff9e,
  stopped: 0x888888,
  error: 0xff4a4a,
  unknown: 0xffaa00,
  starting: 0x4a9eff,
  stopping: 0xffaa00,
};

/**
 * Progress indicator colors for supervisor status
 */
export const PROGRESS_COLORS: Record<string, string> = {
  on_track: '#4aff9e',   // Green
  stalled: '#ff9e4a',    // Orange
  blocked: '#ff4a4a',    // Red
  completed: '#4a9eff',  // Blue
  idle: '#888888',       // Gray
};

/**
 * Color palette for drawing areas
 */
export const AREA_COLORS: string[] = [
  '#4a9eff', // blue
  '#4aff9e', // green
  '#ff9e4a', // orange
  '#ff4a9e', // pink
  '#9e4aff', // purple
  '#ff4a4a', // red
  '#4affff', // cyan
  '#ffff4a', // yellow
];

/**
 * Idle timer color thresholds
 * Green: 0-1 min, Yellow: 1-5 min, Orange: 5-30 min, Red: >30 min
 */
export const IDLE_TIMER_COLORS = {
  recent: '#50fa7b',    // Green - less than 1 minute
  short: '#f1fa8c',     // Yellow - 1-5 minutes
  medium: '#ffb86c',    // Orange - 5-30 minutes
  long: '#ff5555',      // Red - over 30 minutes
};

/**
 * Get color for idle timer based on duration
 */
export function getIdleTimerColor(lastActivity: number): string {
  const seconds = Math.floor((Date.now() - lastActivity) / 1000);
  const minutes = seconds / 60;

  if (minutes < 1) {
    return IDLE_TIMER_COLORS.recent;
  } else if (minutes < 5) {
    return IDLE_TIMER_COLORS.short;
  } else if (minutes < 30) {
    return IDLE_TIMER_COLORS.medium;
  } else {
    return IDLE_TIMER_COLORS.long;
  }
}

/**
 * Get agent status color by status string
 */
export function getAgentStatusColor(status: string): string {
  return AGENT_STATUS_COLORS[status as AgentStatus] ?? AGENT_STATUS_COLORS.default;
}

/**
 * Get agent status color as hex number by status string (for Three.js)
 */
export function getAgentStatusColorHex(status: string): number {
  return AGENT_STATUS_COLORS_HEX[status as AgentStatus] ?? AGENT_STATUS_COLORS_HEX.default;
}

/**
 * Get building status color by status string
 */
export function getBuildingStatusColor(status: BuildingStatus): string {
  return BUILDING_STATUS_COLORS[status];
}

/**
 * Get building status color as hex number by status string (for Three.js)
 */
export function getBuildingStatusColorHex(status: BuildingStatus): number {
  return BUILDING_STATUS_COLORS_HEX[status];
}
