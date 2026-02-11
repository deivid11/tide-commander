/**
 * useBuildingGitStatus - Polls git status for buildings and area directories
 *
 * Periodically checks git status for:
 * 1. Buildings that represent git repositories (folder-type with folderPath, or server-type with cwd)
 * 2. Area directories (each area can have multiple associated directory paths)
 *
 * Uses local-only store updates (no server sync) since git counts are runtime-only.
 */

import { useEffect, useRef } from 'react';
import { store } from '../store';
import { apiUrl, authFetch } from '../utils/storage';

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function useBuildingGitStatus(): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetchGitStatuses = async () => {
      const state = store.getState();

      // Shared cache of git counts keyed by dir path (avoids duplicate API calls)
      const countCache = new Map<string, number>();

      // ── Buildings ──
      const pathToBuildings = new Map<string, string[]>();
      for (const [id, building] of state.buildings) {
        const dirPath = building.folderPath || building.cwd;
        if (!dirPath) continue;
        if (!pathToBuildings.has(dirPath)) pathToBuildings.set(dirPath, []);
        pathToBuildings.get(dirPath)!.push(id);
      }

      for (const [dirPath, buildingIds] of pathToBuildings) {
        try {
          const res = await authFetch(
            apiUrl(`/api/files/git-status?path=${encodeURIComponent(dirPath)}`)
          );
          if (!res.ok) continue;
          const data = await res.json();
          const count = data.files?.length || 0;
          countCache.set(dirPath, count);

          for (const buildingId of buildingIds) {
            const building = store.getState().buildings.get(buildingId);
            if (building && building.gitChangesCount !== count) {
              store.updateBuildingLocal(buildingId, { gitChangesCount: count });
            }
          }
        } catch {
          // Ignore errors - building may have invalid path
        }
      }

      // ── Area directories ──
      const pathToAreaDirs = new Map<string, { areaId: string; dirIndex: number }[]>();

      for (const [areaId, area] of state.areas) {
        if (area.archived || !area.directories) continue;
        area.directories.forEach((dirPath, dirIndex) => {
          if (!dirPath) return;
          if (!pathToAreaDirs.has(dirPath)) pathToAreaDirs.set(dirPath, []);
          pathToAreaDirs.get(dirPath)!.push({ areaId, dirIndex });
        });
      }

      if (pathToAreaDirs.size === 0) return;

      for (const [dirPath, refs] of pathToAreaDirs) {
        try {
          // Reuse count from cache (may have been fetched for buildings already)
          let count: number;
          if (countCache.has(dirPath)) {
            count = countCache.get(dirPath)!;
          } else {
            const res = await authFetch(
              apiUrl(`/api/files/git-status?path=${encodeURIComponent(dirPath)}`)
            );
            if (!res.ok) continue;
            const data = await res.json();
            count = data.files?.length || 0;
            countCache.set(dirPath, count);
          }

          // Group updates by area
          const areaUpdates = new Map<string, { dirIndex: number; count: number }[]>();
          for (const ref of refs) {
            if (!areaUpdates.has(ref.areaId)) areaUpdates.set(ref.areaId, []);
            areaUpdates.get(ref.areaId)!.push({ dirIndex: ref.dirIndex, count });
          }

          for (const [areaId, updates] of areaUpdates) {
            const area = store.getState().areas.get(areaId);
            if (!area) continue;

            const counts = area.directoryGitCounts
              ? [...area.directoryGitCounts]
              : new Array(area.directories.length).fill(0);

            let changed = false;
            for (const { dirIndex, count: c } of updates) {
              if (counts[dirIndex] !== c) {
                counts[dirIndex] = c;
                changed = true;
              }
            }

            if (changed) {
              store.updateAreaLocal(areaId, { directoryGitCounts: counts });
            }
          }
        } catch {
          // Ignore errors - directory may be invalid
        }
      }
    };

    // Initial fetch
    fetchGitStatuses();

    // Set up polling interval
    timerRef.current = setInterval(fetchGitStatuses, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
}
