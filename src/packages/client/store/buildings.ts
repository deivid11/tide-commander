/**
 * Buildings Store Actions
 *
 * Handles building management: CRUD, selection, commands, logs.
 */

import type { ClientMessage, Building, ExistingDockerContainer, ExistingComposeProject } from '../../shared/types';
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
  updateBuildingLocal(buildingId: string, updates: Partial<Building>): void;
  deleteBuilding(buildingId: string): void;
  moveBuilding(buildingId: string, position: { x: number; z: number }): void;
  updateBuildingPosition(buildingId: string, position: { x: number; z: number }): void;
  createBuilding(data: Omit<Building, 'id' | 'createdAt' | 'status'>): void;
  sendBuildingCommand(buildingId: string, command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs' | 'delete'): void;
  addBuildingLogs(buildingId: string, logs: string): void;
  getBuildingLogs(buildingId: string): string[];
  clearBuildingLogs(buildingId: string): void;
  setBuildingsFromServer(buildingsArray: Building[]): void;
  updateBuildingFromServer(building: Building): void;
  removeBuildingFromServer(buildingId: string): void;
  // Streaming log actions
  startLogStreaming(buildingId: string, lines?: number): void;
  stopLogStreaming(buildingId: string): void;
  appendStreamingLogChunk(buildingId: string, chunk: string): void;
  setStreamingStatus(buildingId: string, streaming: boolean): void;
  getStreamingLogs(buildingId: string): string;
  clearStreamingLogs(buildingId: string): void;
  isLogStreaming(buildingId: string): boolean;
  // Boss building actions
  sendBossBuildingCommand(buildingId: string, command: 'start_all' | 'stop_all' | 'restart_all'): void;
  assignBuildingsToBoSS(bossBuildingId: string, subordinateBuildingIds: string[]): void;
  startBossLogStreaming(buildingId: string, lines?: number): void;
  stopBossLogStreaming(buildingId: string): void;
  appendBossStreamingLogChunk(bossBuildingId: string, subordinateBuildingId: string, subordinateBuildingName: string, chunk: string, isError?: boolean): void;
  getBossStreamingLogs(buildingId: string): Array<{ subordinateId: string; subordinateName: string; chunk: string; timestamp: number; isError?: boolean }>;
  clearBossStreamingLogs(buildingId: string): void;
  // Docker container discovery actions
  requestDockerContainersList(): void;
  setDockerContainersList(containers: ExistingDockerContainer[], composeProjects: ExistingComposeProject[]): void;
  getDockerContainersList(): ExistingDockerContainer[];
  getDockerComposeProjectsList(): ExistingComposeProject[];
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
      const state = getState();
      // Delete PM2/Docker processes for buildings that have them enabled
      for (const buildingId of state.selectedBuildingIds) {
        const building = state.buildings.get(buildingId);
        if (building?.pm2?.enabled || building?.docker?.enabled) {
          getSendMessage()?.({
            type: 'building_command',
            payload: { buildingId, command: 'delete' },
          });
        }
      }
      setState((s) => {
        const newBuildings = new Map(s.buildings);
        for (const buildingId of s.selectedBuildingIds) {
          newBuildings.delete(buildingId);
        }
        s.buildings = newBuildings;
        s.selectedBuildingIds.clear();
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

    // Update building locally without syncing to server (for runtime-only fields like gitChangesCount)
    updateBuildingLocal(buildingId: string, updates: Partial<Building>): void {
      const state = getState();
      const building = state.buildings.get(buildingId);
      if (building) {
        setState((s) => {
          const newBuildings = new Map(s.buildings);
          newBuildings.set(buildingId, { ...building, ...updates });
          s.buildings = newBuildings;
        });
        notify();
      }
    },

    deleteBuilding(buildingId: string): void {
      const state = getState();
      const building = state.buildings.get(buildingId);
      // Delete PM2/Docker process if building has them enabled
      if (building?.pm2?.enabled || building?.docker?.enabled) {
        getSendMessage()?.({
          type: 'building_command',
          payload: { buildingId, command: 'delete' },
        });
      }
      setState((s) => {
        const newBuildings = new Map(s.buildings);
        newBuildings.delete(buildingId);
        s.buildings = newBuildings;
        s.selectedBuildingIds.delete(buildingId);
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
      command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs' | 'delete'
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

    // ========================================================================
    // Streaming Log Actions
    // ========================================================================

    startLogStreaming(buildingId: string, lines: number = 100): void {
      const building = getState().buildings.get(buildingId);
      // Clear previous streaming logs and request new stream
      setState((state) => {
        const newStreamingLogs = new Map(state.streamingBuildingLogs);
        newStreamingLogs.set(buildingId, '');
        state.streamingBuildingLogs = newStreamingLogs;
      });

      // Dispatch to PM2 or Docker based on building configuration
      if (building?.docker?.enabled) {
        getSendMessage()?.({
          type: 'docker_logs_start',
          payload: { buildingId, lines },
        });
      } else {
        getSendMessage()?.({
          type: 'pm2_logs_start',
          payload: { buildingId, lines },
        });
      }
    },

    stopLogStreaming(buildingId: string): void {
      const building = getState().buildings.get(buildingId);

      // Dispatch to PM2 or Docker based on building configuration
      if (building?.docker?.enabled) {
        getSendMessage()?.({
          type: 'docker_logs_stop',
          payload: { buildingId },
        });
      } else {
        getSendMessage()?.({
          type: 'pm2_logs_stop',
          payload: { buildingId },
        });
      }
    },

    appendStreamingLogChunk(buildingId: string, chunk: string): void {
      setState((state) => {
        const existingLogs = state.streamingBuildingLogs.get(buildingId) || '';
        // Limit buffer size to prevent memory issues (keep last 500KB)
        const maxSize = 500 * 1024;
        let newLogs = existingLogs + chunk;
        if (newLogs.length > maxSize) {
          // Find a newline near the start to cut cleanly
          const cutPoint = newLogs.indexOf('\n', newLogs.length - maxSize);
          if (cutPoint > 0) {
            newLogs = newLogs.slice(cutPoint + 1);
          } else {
            newLogs = newLogs.slice(-maxSize);
          }
        }
        const newStreamingLogs = new Map(state.streamingBuildingLogs);
        newStreamingLogs.set(buildingId, newLogs);
        state.streamingBuildingLogs = newStreamingLogs;
      });
      notify();
    },

    setStreamingStatus(buildingId: string, streaming: boolean): void {
      setState((state) => {
        const newStreamingIds = new Set(state.streamingBuildingIds);
        if (streaming) {
          newStreamingIds.add(buildingId);
        } else {
          newStreamingIds.delete(buildingId);
        }
        state.streamingBuildingIds = newStreamingIds;
      });
      notify();
    },

    getStreamingLogs(buildingId: string): string {
      return getState().streamingBuildingLogs.get(buildingId) || '';
    },

    clearStreamingLogs(buildingId: string): void {
      setState((state) => {
        const newStreamingLogs = new Map(state.streamingBuildingLogs);
        newStreamingLogs.delete(buildingId);
        state.streamingBuildingLogs = newStreamingLogs;
      });
      notify();
    },

    isLogStreaming(buildingId: string): boolean {
      return getState().streamingBuildingIds.has(buildingId);
    },

    // ========================================================================
    // Boss Building Actions
    // ========================================================================

    sendBossBuildingCommand(
      buildingId: string,
      command: 'start_all' | 'stop_all' | 'restart_all'
    ): void {
      getSendMessage()?.({
        type: 'boss_building_command',
        payload: { buildingId, command },
      });
    },

    assignBuildingsToBoSS(bossBuildingId: string, subordinateBuildingIds: string[]): void {
      // Update local state
      const state = getState();
      const bossBuilding = state.buildings.get(bossBuildingId);
      if (bossBuilding) {
        setState((s) => {
          const newBuildings = new Map(s.buildings);
          newBuildings.set(bossBuildingId, {
            ...bossBuilding,
            subordinateBuildingIds,
          });
          s.buildings = newBuildings;
        });
        syncBuildingsToServer();
        notify();
      }

      // Also notify the server
      getSendMessage()?.({
        type: 'assign_buildings',
        payload: { bossBuildingId, subordinateBuildingIds },
      });
    },

    startBossLogStreaming(buildingId: string, lines: number = 50): void {
      // Clear previous boss streaming logs
      setState((state) => {
        const newBossStreamingLogs = new Map(state.bossStreamingLogs);
        newBossStreamingLogs.set(buildingId, []);
        state.bossStreamingLogs = newBossStreamingLogs;
      });
      getSendMessage()?.({
        type: 'boss_building_logs_start',
        payload: { buildingId, lines },
      });
    },

    stopBossLogStreaming(buildingId: string): void {
      getSendMessage()?.({
        type: 'boss_building_logs_stop',
        payload: { buildingId },
      });
    },

    appendBossStreamingLogChunk(
      bossBuildingId: string,
      subordinateBuildingId: string,
      subordinateBuildingName: string,
      chunk: string,
      isError?: boolean
    ): void {
      setState((state) => {
        const existingLogs = state.bossStreamingLogs.get(bossBuildingId) || [];
        const newEntry = {
          subordinateId: subordinateBuildingId,
          subordinateName: subordinateBuildingName,
          chunk,
          timestamp: Date.now(),
          isError,
        };
        // Limit to last 1000 entries
        const newLogs = [...existingLogs, newEntry];
        if (newLogs.length > 1000) {
          newLogs.splice(0, newLogs.length - 1000);
        }
        const newBossStreamingLogs = new Map(state.bossStreamingLogs);
        newBossStreamingLogs.set(bossBuildingId, newLogs);
        state.bossStreamingLogs = newBossStreamingLogs;
      });
      notify();
    },

    getBossStreamingLogs(buildingId: string): Array<{
      subordinateId: string;
      subordinateName: string;
      chunk: string;
      timestamp: number;
      isError?: boolean;
    }> {
      return getState().bossStreamingLogs.get(buildingId) || [];
    },

    clearBossStreamingLogs(buildingId: string): void {
      setState((state) => {
        const newBossStreamingLogs = new Map(state.bossStreamingLogs);
        newBossStreamingLogs.delete(buildingId);
        state.bossStreamingLogs = newBossStreamingLogs;
      });
      notify();
    },

    // ========================================================================
    // Docker Container Discovery Actions
    // ========================================================================

    requestDockerContainersList(): void {
      getSendMessage()?.({
        type: 'docker_list_containers',
        payload: {},
      });
    },

    setDockerContainersList(
      containers: ExistingDockerContainer[],
      composeProjects: ExistingComposeProject[]
    ): void {
      setState((state) => {
        state.dockerContainersList = containers;
        state.dockerComposeProjectsList = composeProjects;
      });
      notify();
    },

    getDockerContainersList(): ExistingDockerContainer[] {
      return getState().dockerContainersList;
    },

    getDockerComposeProjectsList(): ExistingComposeProject[] {
      return getState().dockerComposeProjectsList;
    },
  };

  return actions;
}
