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
 * Color palette for drawing areas
 */
export const AREA_COLORS: string[] = [
  // Bright colors
  '#4a9eff', // blue
  '#4aff9e', // green
  '#ff9e4a', // orange
  '#ff4a9e', // pink
  '#9e4aff', // purple
  '#ff4a4a', // red
  '#4affff', // cyan
  '#ffff4a', // yellow
  '#4ad7ff', // sky blue
  '#00e6a8', // mint
  '#ff6b4a', // coral
  '#ff66cc', // hot pink
  '#b84aff', // violet
  '#ff4a7a', // rose
  '#00d9ff', // aqua
  '#e6ff4a', // lime
  // Dark colors
  '#1a3a6e', // dark blue
  '#1a5e3a', // dark green
  '#6e3a1a', // dark orange/brown
  '#6e1a4a', // dark pink/magenta
  '#4a1a6e', // dark purple
  '#6e1a1a', // dark red
  '#1a5e5e', // dark cyan/teal
  '#5e5e1a', // dark yellow/olive
  '#1a4a6e', // dark sky blue
  '#145a47', // dark mint
  '#6e2c1a', // dark coral
  '#6e1a5e', // dark hot pink
  '#3b1a6e', // dark violet
  '#6e1a33', // dark rose
  '#14566e', // dark aqua
  '#4f5e1a', // dark lime/olive

  // Mid-tone reds and oranges
  '#f87171', // salmon
  '#ef4444', // ruby
  '#dc2626', // crimson
  '#b91c1c', // garnet
  '#fb923c', // tangerine
  '#f97316', // pumpkin
  '#ea580c', // burnt orange
  '#c2410c', // rust

  // Mid-tone yellows and greens
  '#fbbf24', // amber
  '#f59e0b', // goldenrod
  '#eab308', // sunflower
  '#ca8a04', // mustard
  '#84cc16', // chartreuse
  '#65a30d', // leaf
  '#22c55e', // grass
  '#16a34a', // forest

  // Mid-tone teals and blues
  '#10b981', // emerald
  '#059669', // jade
  '#14b8a6', // teal
  '#0d9488', // deep teal
  '#06b6d4', // cyan
  '#0891b2', // ocean
  '#38bdf8', // azure
  '#0284c7', // cerulean
  '#3b82f6', // royal blue
  '#2563eb', // cobalt
  '#6366f1', // indigo
  '#4f46e5', // iris

  // Mid-tone purples and pinks
  '#8b5cf6', // amethyst
  '#7c3aed', // violet
  '#a855f7', // purple
  '#9333ea', // grape
  '#d946ef', // fuchsia
  '#c026d3', // orchid
  '#ec4899', // magenta
  '#db2777', // raspberry
  '#f43f5e', // rose
  '#e11d48', // deep rose

  // Neutrals and muted accents
  '#94a3b8', // slate
  '#64748b', // steel
  '#475569', // blue gray
  '#334155', // charcoal blue
  '#a3a3a3', // neutral gray
  '#737373', // graphite
  '#525252', // dark graphite
  '#404040', // charcoal
  '#a16207', // ochre
  '#854d0e', // umber
  '#78716c', // stone
  '#57534e', // dark stone
  '#0f766e', // pine teal
  '#155e75', // deep cyan
  '#1d4ed8', // deep blue
  '#6d28d9', // deep violet
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
