/**
 * View Mode Types
 *
 * Defines the available view modes for the main application viewport.
 */

export type ViewMode = '2d' | '3d' | 'dashboard';

export const VIEW_MODES: readonly ViewMode[] = ['3d', '2d', 'dashboard'] as const;

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  '2d': '2D',
  '3d': '3D',
  'dashboard': 'Dashboard',
};

export const VIEW_MODE_DESCRIPTIONS: Record<ViewMode, string> = {
  '2d': 'Lightweight top-down view',
  '3d': 'Full 3D isometric view',
  'dashboard': 'Metrics and status overview',
};

export const DEFAULT_VIEW_MODE: ViewMode = '3d';
