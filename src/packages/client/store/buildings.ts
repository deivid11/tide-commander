/**
 * Buildings Store Actions
 *
 * Handles building management: CRUD, selection, commands, logs.
 */

import type { ClientMessage, Building } from '../../shared/types';
import type { StoreState } from './types';

export interface BuildingActions {
  selectBuilding(buildingId: string | null): void;
  selectMultipleBuildings(buildingIds: string[]): void;
  toggleBuildingSelection(buildingId: string): void;
  isBuildingSelected(buildingId: string): boolean;
  getSelectedBuildingIds(): string[];
  deleteSelectedBuildings(): void;
  addBuilding(building: Building): void;
  updateBuilding(buildingId: string, updates: Partial<Building>): void;
  deleteBuilding(buildingId: string): void;
  moveBuilding(buildingId: string, position: { x: number; z: number }): void;
  updateBuildingPosition(buildingId: string, position: { x: number; z: number }): void;
  createBuilding(data: Omit<Building, 'id' | 'createdAt' | 'status'>): void;
  sendBuildingCommand(buildingId: string, command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs'): void;
  addBuildingLogs(buildingId: string, logs: string): void;
  getBuildingLogs(buildingId: string): string[];
  clearBuildingLogs(buildingId: string): void;
  setBuildingsFromServer(buildingsArray: Building[]): void;
  updateBuildingFromServer(building: Building): void;
  removeBuildingFromServer(buildingId: string): void;
}

export function createBuildingActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): BuildingActions {
  const syncBuildingsToServer = (): void => {
    const buildingsArray = Array.from(getState().buildings.values());
    getSendMessage()?.({
      type: 'sync_buildings',
      payload: buildingsArray,
    });
  };

  const actions: BuildingActions = {
    selectBuilding(buildingId: string | null): void {
      setState((state) => {
        state.selectedBuildingIds.clear();
        if (buildingId) {
          state.selectedBuildingIds.add(buildingId);
        }
      });
      notify();
    },

    selectMultipleBuildings(buildingIds: string[]): void {
      setState((state) => {
        state.selectedBuildingIds.clear();
        for (const id of buildingIds) {
          state.selectedBuildingIds.add(id);
        }
      });
      notify();
    },

    toggleBuildingSelection(buildingId: string): void {
      setState((state) => {
        if (state.selectedBuildingIds.has(buildingId)) {
          state.selectedBuildingIds.delete(buildingId);
        } else {
          state.selectedBuildingIds.add(buildingId);
        }
      });
      notify();
    },

    isBuildingSelected(buildingId: string): boolean {
      return getState().selectedBuildingIds.has(buildingId);
    },

    getSelectedBuildingIds(): string[] {
      return Array.from(getState().selectedBuildingIds);
    },

    deleteSelectedBuildings(): void {
      setState((state) => {
        for (const buildingId of state.selectedBuildingIds) {
          state.buildings.delete(buildingId);
        }
        state.selectedBuildingIds.clear();
      });
      syncBuildingsToServer();
      notify();
    },

    addBuilding(building: Building): void {
      setState((state) => {
        const newBuildings = new Map(state.buildings);
        newBuildings.set(building.id, building);
        state.buildings = newBuildings;
      });
      syncBuildingsToServer();
      notify();
    },

    updateBuilding(buildingId: string, updates: Partial<Building>): void {
      const state = getState();
      const building = state.buildings.get(buildingId);
      if (building) {
        setState((s) => {
          const newBuildings = new Map(s.buildings);
          newBuildings.set(buildingId, { ...building, ...updates });
          s.buildings = newBuildings;
        });
        syncBuildingsToServer();
        notify();
      }
    },

    deleteBuilding(buildingId: string): void {
      setState((state) => {
        const newBuildings = new Map(state.buildings);
        newBuildings.delete(buildingId);
        state.buildings = newBuildings;
        state.selectedBuildingIds.delete(buildingId);
      });
      syncBuildingsToServer();
      notify();
    },

    moveBuilding(buildingId: string, position: { x: number; z: number }): void {
      const state = getState();
      const building = state.buildings.get(buildingId);
      if (building) {
        setState((s) => {
          const newBuildings = new Map(s.buildings);
          newBuildings.set(buildingId, { ...building, position });
          s.buildings = newBuildings;
        });
        syncBuildingsToServer();
        notify();
      }
    },

    updateBuildingPosition(buildingId: string, position: { x: number; z: number }): void {
      actions.moveBuilding(buildingId, position);
    },

    createBuilding(data: Omit<Building, 'id' | 'createdAt' | 'status'>): void {
      const building: Building = {
        ...data,
        id: `building_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'stopped',
        createdAt: Date.now(),
      };
      actions.addBuilding(building);
    },

    sendBuildingCommand(
      buildingId: string,
      command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs'
    ): void {
      getSendMessage()?.({
        type: 'building_command',
        payload: { buildingId, command },
      });
    },

    addBuildingLogs(buildingId: string, logs: string): void {
      setState((state) => {
        const existingLogs = state.buildingLogs.get(buildingId) || [];
        const newLogs = [...existingLogs, logs];
        if (newLogs.length > 500) {
          newLogs.splice(0, newLogs.length - 500);
        }
        const newBuildingLogs = new Map(state.buildingLogs);
        newBuildingLogs.set(buildingId, newLogs);
        state.buildingLogs = newBuildingLogs;
      });
      notify();
    },

    getBuildingLogs(buildingId: string): string[] {
      return getState().buildingLogs.get(buildingId) || [];
    },

    clearBuildingLogs(buildingId: string): void {
      setState((state) => {
        const newBuildingLogs = new Map(state.buildingLogs);
        newBuildingLogs.delete(buildingId);
        state.buildingLogs = newBuildingLogs;
      });
      notify();
    },

    setBuildingsFromServer(buildingsArray: Building[]): void {
      setState((state) => {
        const newBuildings = new Map<string, Building>();
        for (const building of buildingsArray) {
          newBuildings.set(building.id, building);
        }
        state.buildings = newBuildings;
      });
      notify();
    },

    updateBuildingFromServer(building: Building): void {
      setState((state) => {
        const newBuildings = new Map(state.buildings);
        newBuildings.set(building.id, building);
        state.buildings = newBuildings;
      });
      notify();
    },

    removeBuildingFromServer(buildingId: string): void {
      setState((state) => {
        const newBuildings = new Map(state.buildings);
        newBuildings.delete(buildingId);
        state.buildings = newBuildings;
        state.selectedBuildingIds.delete(buildingId);
      });
      notify();
    },
  };

  return actions;
}
