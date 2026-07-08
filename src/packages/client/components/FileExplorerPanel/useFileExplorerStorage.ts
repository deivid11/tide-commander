/**
 * useFileExplorerStorage - Persist file explorer state to localStorage
 *
 * State is scoped PER PROJECT (the current folder path), so open tabs, the active
 * tab, view mode and expanded folders are remembered independently for each project
 * instead of being shared across every folder of an area.
 *
 * Also tracks the list of recently-visited projects (used by the header chips and to
 * pick the initial folder when the panel reopens on an area).
 */

import { useCallback } from 'react';
import type { FileTab, ViewMode } from './types';
import { apiUrl, authFetch } from '../../utils/storage';

// ============================================================================
// TYPES
// ============================================================================

interface StoredProjectState {
  tabs: FileTab[];
  activeTabPath: string | null;
  viewMode: ViewMode;
  expandedPaths: string[];
  timestamp: number;
}

interface ProjectStateResult {
  tabs: FileTab[];
  activeTabPath: string | null;
  viewMode: ViewMode;
  expandedPaths: Set<string>;
}

interface ProjectStateToSave {
  tabs: FileTab[];
  activeTabPath: string | null;
  viewMode: ViewMode;
  expandedPaths: Set<string>;
}

interface UseFileExplorerStorageReturn {
  loadProjectState: (projectPath: string) => Promise<ProjectStateResult | null>;
  saveProjectState: (projectPath: string, state: ProjectStateToSave) => void;
  loadRecentProjects: () => string[];
  pushRecentProject: (projectPath: string) => string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEY_PREFIX = 'file-explorer-state';
const RECENT_PROJECTS_KEY = 'file-explorer-recent-projects';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Keep a few more than we render so the chip row stays populated as projects rotate.
const MAX_RECENT_PROJECTS = 12;

// ============================================================================
// HELPERS
// ============================================================================

function getProjectStorageKey(projectPath: string): string {
  return `${STORAGE_KEY_PREFIX}-folder-${projectPath}`;
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

export function useFileExplorerStorage(): UseFileExplorerStorageReturn {
  const loadProjectState = useCallback(
    async (projectPath: string): Promise<ProjectStateResult | null> => {
      if (!projectPath) return null;

      try {
        const stored = localStorage.getItem(getProjectStorageKey(projectPath));
        if (!stored) return null;

        const state: StoredProjectState = JSON.parse(stored);

        // Check if state is too old
        if (Date.now() - state.timestamp > MAX_AGE_MS) {
          localStorage.removeItem(getProjectStorageKey(projectPath));
          return null;
        }

        // Validate tabs - check if files still exist (in parallel for speed)
        const existsChecks = await Promise.all(
          (state.tabs || []).map(async (tab) => ({
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
          expandedPaths: new Set(state.expandedPaths || []),
        };
      } catch (err) {
        console.error('[FileExplorerStorage] Failed to load project state:', err);
        return null;
      }
    },
    []
  );

  const saveProjectState = useCallback(
    (projectPath: string, state: ProjectStateToSave) => {
      // No isOpen guard: callers gate on isOpen where needed, but flush-on-close must
      // still persist even as the panel is closing.
      if (!projectPath) return;

      try {
        const toStore: StoredProjectState = {
          tabs: state.tabs,
          activeTabPath: state.activeTabPath,
          viewMode: state.viewMode,
          expandedPaths: Array.from(state.expandedPaths),
          timestamp: Date.now(),
        };
        localStorage.setItem(getProjectStorageKey(projectPath), JSON.stringify(toStore));
      } catch (err) {
        console.error('[FileExplorerStorage] Failed to save project state:', err);
      }
    },
    []
  );

  const loadRecentProjects = useCallback((): string[] => {
    try {
      const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  }, []);

  // Move projectPath to the front of the most-recently-visited list (deduped, capped).
  const pushRecentProject = useCallback(
    (projectPath: string): string[] => {
      if (!projectPath) return loadRecentProjects();
      const next = [projectPath, ...loadRecentProjects().filter((p) => p !== projectPath)].slice(
        0,
        MAX_RECENT_PROJECTS
      );
      try {
        localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    },
    [loadRecentProjects]
  );

  return { loadProjectState, saveProjectState, loadRecentProjects, pushRecentProject };
}
