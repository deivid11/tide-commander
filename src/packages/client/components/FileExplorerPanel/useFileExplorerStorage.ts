/**
 * useFileExplorerStorage - Persist file explorer state to localStorage
 *
 * Saves and restores: open tabs, active tab, view mode, selected folder index, expanded folders
 * Validates that files still exist before restoring tabs.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { FileTab, ViewMode } from './types';
import { apiUrl, authFetch } from '../../utils/storage';

// ============================================================================
// TYPES
// ============================================================================

interface StoredState {
  tabs: FileTab[];
  activeTabPath: string | null;
  viewMode: ViewMode;
  selectedFolderIndex: number;
  expandedPaths: string[];
  timestamp: number;
}

interface UseFileExplorerStorageProps {
  areaId: string | null;
  folderPath: string | null;
  isOpen: boolean;
}

interface StoredStateResult {
  tabs: FileTab[];
  activeTabPath: string | null;
  viewMode: ViewMode;
  selectedFolderIndex: number;
  expandedPaths: Set<string>;
}

interface StateToSave {
  tabs: FileTab[];
  activeTabPath: string | null;
  viewMode: ViewMode;
  selectedFolderIndex: number;
  expandedPaths: Set<string>;
}

interface UseFileExplorerStorageReturn {
  loadStoredState: () => Promise<StoredStateResult | null>;
  saveState: (state: StateToSave) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEY_PREFIX = 'file-explorer-state';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ============================================================================
// HELPERS
// ============================================================================

function getStorageKey(areaId: string | null, folderPath: string | null): string {
  if (folderPath) {
    // Direct folder mode - use folder path as key
    return `${STORAGE_KEY_PREFIX}-folder-${folderPath}`;
  }
  if (areaId) {
    return `${STORAGE_KEY_PREFIX}-area-${areaId}`;
  }
  return `${STORAGE_KEY_PREFIX}-default`;
}

async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    const response = await authFetch(apiUrl(`/api/files/exists?path=${encodeURIComponent(filePath)}`));
    if (!response.ok) return false;
    const data = await response.json();
    return data.exists === true;
  } catch {
    return false;
  }
}

// ============================================================================
// HOOK
// ============================================================================

export function useFileExplorerStorage({
  areaId,
  folderPath,
  isOpen,
}: UseFileExplorerStorageProps): UseFileExplorerStorageReturn {
  const storageKey = getStorageKey(areaId, folderPath);
  const hasLoadedRef = useRef(false);

  // Reset loaded flag when area/folder changes
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [areaId, folderPath]);

  const loadStoredState = useCallback(async (): Promise<StoredStateResult | null> => {
    // Only load once per area/folder
    if (hasLoadedRef.current) return null;
    hasLoadedRef.current = true;

    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return null;

      const state: StoredState = JSON.parse(stored);

      // Check if state is too old
      if (Date.now() - state.timestamp > MAX_AGE_MS) {
        localStorage.removeItem(storageKey);
        return null;
      }

      // Validate tabs - check if files still exist (in parallel for speed)
      const existsChecks = await Promise.all(
        state.tabs.map(async (tab) => ({
          tab,
          exists: await checkFileExists(tab.path),
        }))
      );

      const validatedTabs = existsChecks
        .filter(({ exists }) => exists)
        .map(({ tab }) => tab);

      // If active tab was removed, pick the first available
      let activeTabPath = state.activeTabPath;
      if (activeTabPath && !validatedTabs.some((t) => t.path === activeTabPath)) {
        activeTabPath = validatedTabs.length > 0 ? validatedTabs[0].path : null;
      }

      return {
        tabs: validatedTabs,
        activeTabPath,
        viewMode: state.viewMode || 'files',
        selectedFolderIndex: state.selectedFolderIndex || 0,
        expandedPaths: new Set(state.expandedPaths || []),
      };
    } catch (err) {
      console.error('[FileExplorerStorage] Failed to load state:', err);
      return null;
    }
  }, [storageKey]);

  const saveState = useCallback(
    (state: StateToSave) => {
      if (!isOpen) return;

      try {
        const toStore: StoredState = {
          tabs: state.tabs,
          activeTabPath: state.activeTabPath,
          viewMode: state.viewMode,
          selectedFolderIndex: state.selectedFolderIndex,
          expandedPaths: Array.from(state.expandedPaths),
          timestamp: Date.now(),
        };
        localStorage.setItem(storageKey, JSON.stringify(toStore));
      } catch (err) {
        console.error('[FileExplorerStorage] Failed to save state:', err);
      }
    },
    [storageKey, isOpen]
  );

  return { loadStoredState, saveState };
}
