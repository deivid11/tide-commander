/**
 * Areas Store Actions
 *
 * Handles drawing areas management.
 */

import type { ClientMessage, DrawingArea, DrawingTool } from '../../shared/types';
import type { StoreState } from './types';

export interface AreaActions {
  setActiveTool(tool: DrawingTool): void;
  selectArea(areaId: string | null): void;
  addArea(area: DrawingArea): void;
  updateArea(areaId: string, updates: Partial<DrawingArea>): void;
  deleteArea(areaId: string): void;
  assignAgentToArea(agentId: string, areaId: string): void;
  unassignAgentFromArea(agentId: string, areaId: string): void;
  addDirectoryToArea(areaId: string, directoryPath: string): void;
  removeDirectoryFromArea(areaId: string, directoryPath: string): void;
  getAreaDirectories(areaId: string): string[];
  isPositionInArea(pos: { x: number; z: number }, area: DrawingArea): boolean;
  getAreaForAgent(agentId: string): DrawingArea | null;
  setAreasFromServer(areasArray: DrawingArea[]): void;
}

export function createAreaActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): AreaActions {
  const syncAreasToServer = (): void => {
    const areasArray = Array.from(getState().areas.values());
    getSendMessage()?.({
      type: 'sync_areas',
      payload: areasArray,
    });
  };

  return {
    setActiveTool(tool: DrawingTool): void {
      setState((state) => {
        state.activeTool = tool;
        if (tool !== 'select') {
          state.selectedAreaId = null;
        }
      });
      notify();
    },

    selectArea(areaId: string | null): void {
      setState((state) => {
        state.selectedAreaId = areaId;
      });
      notify();
    },

    addArea(area: DrawingArea): void {
      setState((state) => {
        state.areas.set(area.id, area);
      });
      syncAreasToServer();
      notify();
    },

    updateArea(areaId: string, updates: Partial<DrawingArea>): void {
      const state = getState();
      const area = state.areas.get(areaId);
      if (area) {
        setState((s) => {
          Object.assign(s.areas.get(areaId)!, updates);
        });
        syncAreasToServer();
        notify();
      }
    },

    deleteArea(areaId: string): void {
      setState((state) => {
        state.areas.delete(areaId);
        if (state.selectedAreaId === areaId) {
          state.selectedAreaId = null;
        }
      });
      syncAreasToServer();
      notify();
    },

    assignAgentToArea(agentId: string, areaId: string): void {
      const state = getState();
      const area = state.areas.get(areaId);
      if (area && !area.assignedAgentIds.includes(agentId)) {
        setState((s) => {
          // Remove from any other area first
          for (const otherArea of s.areas.values()) {
            const idx = otherArea.assignedAgentIds.indexOf(agentId);
            if (idx !== -1) {
              otherArea.assignedAgentIds.splice(idx, 1);
            }
          }
          s.areas.get(areaId)!.assignedAgentIds.push(agentId);
        });
        syncAreasToServer();
        notify();
      }
    },

    unassignAgentFromArea(agentId: string, areaId: string): void {
      const state = getState();
      const area = state.areas.get(areaId);
      if (area) {
        const idx = area.assignedAgentIds.indexOf(agentId);
        if (idx !== -1) {
          setState((s) => {
            s.areas.get(areaId)!.assignedAgentIds.splice(idx, 1);
          });
          syncAreasToServer();
          notify();
        }
      }
    },

    addDirectoryToArea(areaId: string, directoryPath: string): void {
      const state = getState();
      const area = state.areas.get(areaId);
      if (area && !area.directories.includes(directoryPath)) {
        setState((s) => {
          s.areas.get(areaId)!.directories.push(directoryPath);
        });
        syncAreasToServer();
        notify();
      }
    },

    removeDirectoryFromArea(areaId: string, directoryPath: string): void {
      const state = getState();
      const area = state.areas.get(areaId);
      if (area) {
        const idx = area.directories.indexOf(directoryPath);
        if (idx !== -1) {
          setState((s) => {
            s.areas.get(areaId)!.directories.splice(idx, 1);
          });
          syncAreasToServer();
          notify();
        }
      }
    },

    getAreaDirectories(areaId: string): string[] {
      const area = getState().areas.get(areaId);
      return area?.directories || [];
    },

    isPositionInArea(pos: { x: number; z: number }, area: DrawingArea): boolean {
      if (area.type === 'rectangle' && area.width && area.height) {
        const halfW = area.width / 2;
        const halfH = area.height / 2;
        return (
          pos.x >= area.center.x - halfW &&
          pos.x <= area.center.x + halfW &&
          pos.z >= area.center.z - halfH &&
          pos.z <= area.center.z + halfH
        );
      } else if (area.type === 'circle' && area.radius) {
        const dx = pos.x - area.center.x;
        const dz = pos.z - area.center.z;
        return dx * dx + dz * dz <= area.radius * area.radius;
      }
      return false;
    },

    getAreaForAgent(agentId: string): DrawingArea | null {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (!agent) return null;

      for (const area of state.areas.values()) {
        if (this.isPositionInArea({ x: agent.position.x, z: agent.position.z }, area)) {
          return area;
        }
      }
      return null;
    },

    setAreasFromServer(areasArray: DrawingArea[]): void {
      setState((state) => {
        const newAreas = new Map<string, DrawingArea>();
        for (const area of areasArray) {
          // Migration: ensure directories array exists for old areas
          if (!area.directories) {
            area.directories = [];
          }
          newAreas.set(area.id, area);
        }
        state.areas = newAreas;
      });
      notify();
    },
  };
}
