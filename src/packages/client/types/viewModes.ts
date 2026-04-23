/**
 * View Mode Types
 *
 * Defines the available view modes for the main application viewport.
 */

export type ViewMode = '2d' | '3d' | 'dashboard' | 'flat';

export const VIEW_MODES: readonly ViewMode[] = ['3d', '2d', 'flat', 'dashboard'] as const;

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  '2d': '2D',
  '3d': '3D',
  'dashboard': 'Dashboard',
  'flat': 'Flat',
};

export const VIEW_MODE_DESCRIPTIONS: Record<ViewMode, string> = {
  '2d': 'Lightweight top-down view',
  '3d': 'Full 3D isometric view',
  'dashboard': 'Metrics and status overview',
  'flat': 'Flat UI layout',
};

export const DEFAULT_VIEW_MODE: ViewMode = '3d';
