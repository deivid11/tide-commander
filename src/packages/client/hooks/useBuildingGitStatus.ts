/**
 * useBuildingGitStatus - Keeps building/area git pending-change counts fresh.
 *
 * WS-backed: registers every building directory (folder-type folderPath or
 * server-type cwd) and area directory with the server-side git watcher.
 * The counts themselves are applied by store.applyGitStatusUpdate() when
 * `git_status_update` pushes arrive — this hook only maintains the watch set.
 */

import { useEffect, useMemo } from 'react';
import { acquireGitWatch } from '../services/gitWatch';
import { useAreas, useBuildings } from '../store/selectors';

export function useBuildingGitStatus(): void {
  const buildings = useBuildings();
  const areas = useAreas();

  const dirPaths = useMemo(() => {
    const dirs = new Set<string>();
    for (const building of buildings.values()) {
      const dirPath = building.folderPath || building.cwd;
      if (dirPath) dirs.add(dirPath);
    }
    for (const area of areas.values()) {
      if (area.archived || !area.directories) continue;
      for (const dirPath of area.directories) {
        if (dirPath) dirs.add(dirPath);
      }
    }
    return [...dirs].sort();
  }, [buildings, areas]);

  const dirsKey = dirPaths.join('\n');

  useEffect(() => {
    if (dirPaths.length === 0) return;
    return acquireGitWatch(dirPaths);
  }, [dirsKey]);
}
