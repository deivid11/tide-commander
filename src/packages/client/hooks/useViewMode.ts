/**
 * useViewMode - Hook for managing the main viewport view mode
 *
 * Provides the current view mode and a setter that persists to localStorage.
 * Uses the centralized store for state management.
 */

import { useCallback } from 'react';
import { useViewMode as useViewModeSelector } from '../store/selectors';
import { store } from '../store';
import type { ViewMode } from '../types/viewModes';

export function useViewMode() {
  const viewMode = useViewModeSelector();

  const setViewMode = useCallback((mode: ViewMode) => {
    store.setViewMode(mode);
  }, []);

  return [viewMode, setViewMode] as const;
}
