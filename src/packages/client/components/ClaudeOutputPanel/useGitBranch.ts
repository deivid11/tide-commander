/**
 * useGitBranches - Fetch current git branch for a list of directories
 *
 * Lightweight hook that calls GET /api/files/git-branch?path=... for each
 * directory and caches the result. Refreshes every 30 seconds.
 * Uses a stable string key derived from directory paths to avoid
 * re-fetching when the array reference changes but contents don't.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getApiBaseUrl, getAuthToken, apiUrl, authFetch } from '../../utils/storage';

const REFRESH_INTERVAL = 30_000; // 30s

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
  const [branches, setBranches] = useState<Map<string, BranchInfo>>(new Map());
  const [fetchingDirs, setFetchingDirs] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Create a stable key from the sorted directory paths so the effect
  // only re-runs when the actual set of directories changes.
  const dirPaths = useMemo(() => {
    if (!directories || directories.length === 0) return null;
    return [...new Set(directories.map((d) => d.dir))].sort();
  }, [directories]);

  const dirsKey = dirPaths ? dirPaths.join('\n') : '';

  const loadBranches = useCallback(async () => {
    if (!dirPaths || dirPaths.length === 0) {
      setBranches(new Map());
      return;
    }

    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const baseUrl = getApiBaseUrl();

    const results = new Map<string, BranchInfo>();
    await Promise.all(
      dirPaths.map(async (dir) => {
        try {
          const res = await fetch(
            `${baseUrl}/api/files/git-branch?path=${encodeURIComponent(dir)}`,
            { headers }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.branch) {
              results.set(dir, {
                branch: data.branch,
                ahead: data.ahead || 0,
                behind: data.behind || 0,
              });
            }
          }
        } catch {
          // Non-git dir or network error — skip
        }
      })
    );
    setBranches(results);
  }, [dirPaths]);

  useEffect(() => {
    if (!dirPaths || dirPaths.length === 0) {
      setBranches(new Map());
      return;
    }

    loadBranches();

    timerRef.current = setInterval(loadBranches, REFRESH_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [dirsKey, loadBranches]);

  // Run git fetch for a specific directory, then refresh branch info
  const fetchRemote = useCallback(async (dir: string) => {
    setFetchingDirs(prev => new Set(prev).add(dir));
    try {
      await authFetch(apiUrl('/api/files/git-fetch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      });
      // Refresh branch info after fetch to get updated ahead/behind
      await loadBranches();
    } catch {
      // Fetch failed — ignore
    } finally {
      setFetchingDirs(prev => {
        const next = new Set(prev);
        next.delete(dir);
        return next;
      });
    }
  }, [loadBranches]);

  return { branches, fetchRemote, fetchingDirs, refetch: loadBranches };
}
