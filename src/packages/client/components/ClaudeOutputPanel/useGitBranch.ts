/**
 * useGitBranches - Git branch info for a list of directories.
 *
 * WS-backed: registers the directories with the server-side git watcher
 * (services/gitWatch.ts) and reads branch/ahead/behind from the store as
 * `git_status_update` pushes arrive. No HTTP polling — the server polls once
 * for all clients and only pushes when something changed.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiUrl, authFetch } from '../../utils/storage';
import { acquireGitWatch, requestGitRefresh } from '../../services/gitWatch';
import { useGitDirStatuses } from '../../store/selectors';

interface DirEntry {
  areaId: string;
  areaName: string;
  dir: string;
}

export interface BranchInfo {
  branch: string;
  ahead: number;
  behind: number;
}

interface UseGitBranchesResult {
  branches: Map<string, BranchInfo>;
  fetchRemote: (dir: string) => Promise<void>;
  fetchingDirs: Set<string>;
  refetch: () => void;
}

export function useGitBranches(
  directories: DirEntry[] | null
): UseGitBranchesResult {
  const [fetchingDirs, setFetchingDirs] = useState<Set<string>>(new Set());
  const gitStatuses = useGitDirStatuses();

  // Create a stable key from the sorted directory paths so effects only
  // re-run when the actual set of directories changes.
  const dirPaths = useMemo(() => {
    if (!directories || directories.length === 0) return null;
    return [...new Set(directories.map((d) => d.dir))].sort();
  }, [directories]);

  const dirsKey = dirPaths ? dirPaths.join('\n') : '';

  // Subscribe the directories to the server-side git watcher.
  useEffect(() => {
    if (!dirPaths || dirPaths.length === 0) return;
    return acquireGitWatch(dirPaths);
  }, [dirsKey]);

  const branches = useMemo(() => {
    const results = new Map<string, BranchInfo>();
    if (dirPaths) {
      for (const dir of dirPaths) {
        const status = gitStatuses.get(dir);
        if (status?.isGitRepo && status.branch) {
          results.set(dir, {
            branch: status.branch,
            ahead: status.ahead,
            behind: status.behind,
          });
        }
      }
    }
    return results;
  }, [gitStatuses, dirsKey]);

  // Run git fetch for a specific directory, then ask the watcher to push
  // fresh ahead/behind counts.
  const fetchRemote = useCallback(async (dir: string) => {
    setFetchingDirs(prev => new Set(prev).add(dir));
    try {
      await authFetch(apiUrl('/api/files/git-fetch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      });
      requestGitRefresh([dir]);
    } catch {
      // Fetch failed — ignore
    } finally {
      setFetchingDirs(prev => {
        const next = new Set(prev);
        next.delete(dir);
        return next;
      });
    }
  }, []);

  const refetch = useCallback(() => {
    if (dirPaths && dirPaths.length > 0) requestGitRefresh(dirPaths);
  }, [dirsKey]);

  return { branches, fetchRemote, fetchingDirs, refetch };
}
