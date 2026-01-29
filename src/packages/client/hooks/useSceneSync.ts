import { useEffect } from 'react';
import { store } from '../store';
import { SceneManager } from '../scene/SceneManager';

/**
 * Hook to subscribe to selection changes and update scene visuals.
 * Uses efficient shallow comparison to prevent geometry churn.
 */
export function useSelectionSync(sceneRef: React.RefObject<SceneManager | null>): void {
  useEffect(() => {
    let lastSelectedAgentIds = '';
    let lastSelectedBuildingIds = '';
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
      const selectedAgentIds = Array.from(state.selectedAgentIds).sort().join(',');
      const selectedBuildingIds = Array.from(state.selectedBuildingIds).sort().join(',');
      const agentSelectionChanged = selectedAgentIds !== lastSelectedAgentIds;
      const buildingSelectionChanged = selectedBuildingIds !== lastSelectedBuildingIds;
      const { newVersion, changed: agentsChanged } = getAgentVersion(state.agents);

      if (agentSelectionChanged || buildingSelectionChanged || agentsChanged) {
        lastSelectedAgentIds = selectedAgentIds;
        lastSelectedBuildingIds = selectedBuildingIds;
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
        areaHash += (area.zIndex ?? 0) * 1000; // Include zIndex in hash
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

      // Compute hash including position, scale, style, name, and status
      let hash = 0;
      for (const [_id, building] of buildings) {
        // Position
        hash ^= (building.position.x * 1000 + building.position.z) | 0;
        // Scale
        hash ^= ((building.scale || 1) * 10000) | 0;
        // Style and name (simple string hash)
        const str = `${building.style || ''}${building.name}${building.status}`;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
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
