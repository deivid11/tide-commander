/**
 * Building Service
 * Handles building/infrastructure command operations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Building, ServerMessage } from '../../shared/types.js';
import { loadBuildings, saveBuildings } from '../data/index.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('BuildingService');
const execAsync = promisify(exec);

export type BuildingCommand = 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs';

export interface BuildingCommandResult {
  success: boolean;
  error?: string;
  logs?: string;
}

/**
 * Broadcast function type - passed in from websocket handler
 */
type BroadcastFn = (message: ServerMessage) => void;

/**
 * Update building status and persist
 */
function updateBuildingStatus(
  buildingId: string,
  status: Building['status'],
  broadcast: BroadcastFn,
  additionalFields?: Partial<Building>
): void {
  const buildings = loadBuildings();
  const idx = buildings.findIndex(b => b.id === buildingId);
  if (idx !== -1) {
    buildings[idx] = {
      ...buildings[idx],
      status,
      lastActivity: Date.now(),
      ...additionalFields,
    };
    saveBuildings(buildings);
    broadcast({
      type: 'building_updated',
      payload: buildings[idx],
    });
  }
}

/**
 * Execute a building command
 */
export async function executeCommand(
  buildingId: string,
  command: BuildingCommand,
  broadcast: BroadcastFn
): Promise<BuildingCommandResult> {
  const buildings = loadBuildings();
  const building = buildings.find(b => b.id === buildingId);

  if (!building) {
    return { success: false, error: `Building not found: ${buildingId}` };
  }

  const cmdString = building.commands?.[command];
  if (!cmdString && command !== 'logs') {
    return {
      success: false,
      error: `No ${command} command configured for building: ${building.name}`,
    };
  }

  try {
    switch (command) {
      case 'start':
        updateBuildingStatus(buildingId, 'starting', broadcast);
        exec(cmdString!, { cwd: building.cwd }, (error) => {
          if (error) {
            updateBuildingStatus(buildingId, 'error', broadcast);
            broadcast({
              type: 'building_logs',
              payload: { buildingId, logs: `Start error: ${error.message}`, timestamp: Date.now() },
            });
          } else {
            updateBuildingStatus(buildingId, 'running', broadcast);
          }
        });
        log.log(` Building ${building.name}: starting with command: ${cmdString}`);
        return { success: true };

      case 'stop':
        updateBuildingStatus(buildingId, 'stopping', broadcast);
        exec(cmdString!, { cwd: building.cwd }, (error) => {
          if (error) {
            broadcast({
              type: 'building_logs',
              payload: { buildingId, logs: `Stop error: ${error.message}`, timestamp: Date.now() },
            });
          }
          updateBuildingStatus(buildingId, 'stopped', broadcast);
        });
        log.log(` Building ${building.name}: stopping with command: ${cmdString}`);
        return { success: true };

      case 'restart':
        updateBuildingStatus(buildingId, 'starting', broadcast);
        exec(cmdString!, { cwd: building.cwd }, (error) => {
          if (error) {
            updateBuildingStatus(buildingId, 'error', broadcast);
            broadcast({
              type: 'building_logs',
              payload: { buildingId, logs: `Restart error: ${error.message}`, timestamp: Date.now() },
            });
          } else {
            updateBuildingStatus(buildingId, 'running', broadcast);
          }
        });
        log.log(` Building ${building.name}: restarting with command: ${cmdString}`);
        return { success: true };

      case 'healthCheck':
        try {
          await execAsync(cmdString!, { cwd: building.cwd, timeout: 10000 });
          updateBuildingStatus(buildingId, 'running', broadcast, {
            lastHealthCheck: Date.now(),
          });
          log.log(` Building ${building.name}: health check passed`);
          return { success: true };
        } catch (error: any) {
          updateBuildingStatus(buildingId, 'error', broadcast, {
            lastHealthCheck: Date.now(),
            lastError: error.message,
          });
          log.log(` Building ${building.name}: health check failed: ${error.message}`);
          return { success: false, error: error.message };
        }

      case 'logs':
        const logsCmd = building.commands?.logs || 'echo "No logs command configured"';
        exec(logsCmd, { cwd: building.cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
          const logs = error ? `Error: ${error.message}\n${stderr}` : stdout;
          broadcast({
            type: 'building_logs',
            payload: { buildingId, logs, timestamp: Date.now() },
          });
        });
        log.log(` Building ${building.name}: fetching logs`);
        return { success: true };

      default:
        return { success: false, error: `Unknown command: ${command}` };
    }
  } catch (error: any) {
    log.error(` Building command error:`, error);
    return { success: false, error: `Building command error: ${error.message}` };
  }
}

/**
 * Get all buildings
 */
export function getBuildings(): Building[] {
  return loadBuildings();
}

/**
 * Get a single building by ID
 */
export function getBuilding(id: string): Building | undefined {
  return loadBuildings().find(b => b.id === id);
}
