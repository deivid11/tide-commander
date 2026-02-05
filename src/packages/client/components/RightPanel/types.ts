/**
 * Types for the RightPanel component system
 */

export type RightPanelTab = 'details' | 'chat' | 'logs' | 'snapshot';

export const RIGHT_PANEL_TABS: { id: RightPanelTab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'chat', label: 'Chat' },
  { id: 'logs', label: 'Logs' },
  { id: 'snapshot', label: 'Snapshot' },
];

// Panel width constraints (pixels)
export const DEFAULT_PANEL_WIDTH = 420;
export const MIN_PANEL_WIDTH = 280;
export const MAX_PANEL_WIDTH = 800;

// Storage key for persisted width
export const STORAGE_KEY_PANEL_WIDTH = 'right-panel-width';
export const STORAGE_KEY_PANEL_COLLAPSED = 'right-panel-collapsed';
export const STORAGE_KEY_PANEL_TAB = 'right-panel-tab';
