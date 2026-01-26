import { useEffect } from 'react';
import { store } from '../store';
import { SceneManager } from '../scene/SceneManager';

/**
 * Hook to subscribe to selection changes and update scene visuals.
 * Uses efficient shallow comparison to prevent geometry churn.
 */
export function useSelectionSync(sceneRef: React.RefObject<SceneManager | null>): void {
  useEffect(() => {
    let lastSelectedIds = '';
    let lastAgentVersion = new Map<string, number>();

    const getAgentVersion = (agents: Map<string, any>) => {
      let changed = false;
      const newVersion = new Map<string, number>();

      for (const [id, agent] of agents) {
        const hash = `${agent.position.x.toFixed(2)},${agent.position.z.toFixed(2)},${agent.status},${agent.class},${agent.isBoss},${agent.subordinateIds?.length ?? 0}`;
        const hashCode = hash.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
        newVersion.set(id, hashCode);

        if (lastAgentVersion.get(id) !== hashCode) {
          changed = true;
        }
      }

      if (newVersion.size !== lastAgentVersion.size) {
        changed = true;
      }

      return { newVersion, changed };
    };

    return store.subscribe(() => {
      const state = store.getState();
      const selectedIds = Array.from(state.selectedAgentIds).sort().join(',');
      const selectionChanged = selectedIds !== lastSelectedIds;
      const { newVersion, changed: agentsChanged } = getAgentVersion(state.agents);

      if (selectionChanged || agentsChanged) {
        lastSelectedIds = selectedIds;
        lastAgentVersion = newVersion;
        sceneRef.current?.refreshSelectionVisuals();
      }
    });
  }, [sceneRef]);
}

/**
 * Hook to sync areas when they change.
 */
export function useAreaSync(sceneRef: React.RefObject<SceneManager | null>): void {
  useEffect(() => {
    sceneRef.current?.syncAreas();

    let lastAreasSize = 0;
    let lastAreasHash = 0;

    return store.subscribe(() => {
      const state = store.getState();
      const areas = state.areas;

      if (areas.size !== lastAreasSize) {
        lastAreasSize = areas.size;
        lastAreasHash = Date.now();
        sceneRef.current?.syncAreas();
        return;
      }

      let hash = 0;
      for (const [id, area] of areas) {
        let areaHash = id.charCodeAt(0);
        areaHash += (area.width ?? 0) + (area.height ?? 0) + (area.radius ?? 0);
        areaHash += Math.floor(area.center.x * 100) + Math.floor(area.center.z * 100);
        for (let i = 0; i < area.name.length; i++) {
          areaHash += area.name.charCodeAt(i);
        }
        for (let i = 0; i < area.color.length; i++) {
          areaHash += area.color.charCodeAt(i);
        }
        hash ^= areaHash | 0;
      }

      if (hash !== lastAreasHash) {
        lastAreasHash = hash;
        sceneRef.current?.syncAreas();
      }
    });
  }, [sceneRef]);
}

/**
 * Hook to sync buildings when they change.
 */
export function useBuildingSync(sceneRef: React.RefObject<SceneManager | null>): void {
  useEffect(() => {
    sceneRef.current?.syncBuildings();

    let lastBuildingsSize = 0;
    let lastBuildingsHash = 0;

    return store.subscribe(() => {
      const state = store.getState();
      const buildings = state.buildings;

      if (buildings.size !== lastBuildingsSize) {
        lastBuildingsSize = buildings.size;
        lastBuildingsHash = Date.now();
        sceneRef.current?.syncBuildings();
        return;
      }

      let hash = 0;
      for (const [id, building] of buildings) {
        hash ^= (building.position.x * 1000 + building.position.z) | 0;
      }

      if (hash !== lastBuildingsHash) {
        lastBuildingsHash = hash;
        sceneRef.current?.syncBuildings();
      }
    });
  }, [sceneRef]);
}

/**
 * Hook to update area highlight when selection changes.
 */
export function useAreaHighlight(
  sceneRef: React.RefObject<SceneManager | null>,
  selectedAreaId: string | null
): void {
  useEffect(() => {
    sceneRef.current?.highlightArea(selectedAreaId);
  }, [sceneRef, selectedAreaId]);
}

/**
 * Hook to apply power saving setting to scene.
 */
export function usePowerSaving(
  sceneRef: React.RefObject<SceneManager | null>,
  powerSaving: boolean
): void {
  useEffect(() => {
    sceneRef.current?.setPowerSaving(powerSaving);
  }, [sceneRef, powerSaving]);
}
