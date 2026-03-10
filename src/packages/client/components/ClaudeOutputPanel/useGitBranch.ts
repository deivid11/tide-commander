/**
 * useGitBranches - Fetch current git branch for a list of directories
 *
 * Lightweight hook that calls GET /api/files/git-branch?path=... for each
 * directory and caches the result. Refreshes every 30 seconds.
 * Uses a stable string key derived from directory paths to avoid
 * re-fetching when the array reference changes but contents don't.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { getApiBaseUrl, getAuthToken } from '../../utils/storage';

const REFRESH_INTERVAL = 30_000; // 30s

interface DirEntry {
  areaId: string;
  areaName: string;
  dir: string;
}

export function useGitBranches(
  directories: DirEntry[] | null
): Map<string, string> {
  const [branches, setBranches] = useState<Map<string, string>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Create a stable key from the sorted directory paths so the effect
  // only re-runs when the actual set of directories changes.
  const dirPaths = useMemo(() => {
    if (!directories || directories.length === 0) return null;
    return [...new Set(directories.map((d) => d.dir))].sort();
  }, [directories]);

  const dirsKey = dirPaths ? dirPaths.join('\n') : '';

  useEffect(() => {
    if (!dirPaths || dirPaths.length === 0) {
      setBranches(new Map());
      return;
    }

    let cancelled = false;
    const baseUrl = getApiBaseUrl();

    const fetchBranches = async () => {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const results = new Map<string, string>();
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
                results.set(dir, data.branch);
              }
            }
          } catch {
            // Non-git dir or network error — skip
          }
        })
      );
      if (!cancelled) {
        setBranches(results);
      }
    };

    fetchBranches();

    timerRef.current = setInterval(fetchBranches, REFRESH_INTERVAL);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [dirsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return branches;
}
