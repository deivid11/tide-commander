/**
 * Building Service
 * Handles building/infrastructure command operations
 * Supports both custom commands and PM2-managed processes
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Building, ServerMessage, BuildingStatus } from '../../shared/types.js';
import { loadBuildings, saveBuildings } from '../data/index.js';
import { createLogger } from '../utils/index.js';
import * as pm2Service from './pm2-service.js';

const log = createLogger('BuildingService');
const execAsync = promisify(exec);

export type BuildingCommand = 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs' | 'delete';
export type BossBuildingCommand = 'start_all' | 'stop_all' | 'restart_all';

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
 * Execute a PM2 command for a building
 */
async function executePM2Command(
  building: Building,
  command: BuildingCommand,
  broadcast: BroadcastFn
): Promise<BuildingCommandResult> {
  const buildingId = building.id;

  switch (command) {
    case 'start': {
      updateBuildingStatus(buildingId, 'starting', broadcast);
      const result = await pm2Service.startProcess(building);

      if (result.success) {
        // Fetch actual status after short delay to let PM2 initialize
        setTimeout(async () => {
          const status = await pm2Service.getStatus(building);
          const newStatus: BuildingStatus = status?.status === 'online' ? 'running' : 'error';
          updateBuildingStatus(buildingId, newStatus, broadcast, {
            pm2Status: status || undefined,
            lastError: status?.status !== 'online' ? 'Process failed to start' : undefined,
          });
        }, 2000);
        log.log(`Building ${building.name}: PM2 start initiated`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: PM2 start failed: ${result.error}`);
      }
      return result;
    }

    case 'stop': {
      updateBuildingStatus(buildingId, 'stopping', broadcast);
      const result = await pm2Service.stopProcess(building);

      if (result.success) {
        updateBuildingStatus(buildingId, 'stopped', broadcast, { pm2Status: undefined });
        log.log(`Building ${building.name}: PM2 stopped`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: PM2 stop failed: ${result.error}`);
      }
      return result;
    }

    case 'restart': {
      updateBuildingStatus(buildingId, 'starting', broadcast);
      const result = await pm2Service.restartProcess(building);

      if (result.success) {
        // Fetch actual status after short delay
        setTimeout(async () => {
          const status = await pm2Service.getStatus(building);
          const newStatus: BuildingStatus = status?.status === 'online' ? 'running' : 'error';
          updateBuildingStatus(buildingId, newStatus, broadcast, {
            pm2Status: status || undefined,
          });
        }, 2000);
        log.log(`Building ${building.name}: PM2 restart initiated`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: PM2 restart failed: ${result.error}`);
      }
      return result;
    }

    case 'logs': {
      const logs = await pm2Service.getLogs(building, 200);
      broadcast({
        type: 'building_logs',
        payload: { buildingId, logs, timestamp: Date.now() },
      });
      log.log(`Building ${building.name}: PM2 logs fetched`);
      return { success: true, logs };
    }

    case 'healthCheck': {
      const status = await pm2Service.getStatus(building);
      const isHealthy = status?.status === 'online';
      updateBuildingStatus(buildingId, isHealthy ? 'running' : 'error', broadcast, {
        lastHealthCheck: Date.now(),
        pm2Status: status || undefined,
        lastError: isHealthy ? undefined : `PM2 status: ${status?.status || 'not found'}`,
      });
      log.log(`Building ${building.name}: PM2 health check: ${isHealthy ? 'passed' : 'failed'}`);
      return { success: isHealthy };
    }

    case 'delete': {
      const result = await pm2Service.deleteProcess(building);
      if (result.success) {
        log.log(`Building ${building.name}: PM2 process deleted`);
      } else {
        log.error(`Building ${building.name}: PM2 delete failed: ${result.error}`);
      }
      return result;
    }

    default:
      return { success: false, error: `Unknown command: ${command}` };
  }
}

/**
 * Execute a custom command for a building (non-PM2)
 */
async function executeCustomCommand(
  building: Building,
  command: BuildingCommand,
  broadcast: BroadcastFn
): Promise<BuildingCommandResult> {
  const buildingId = building.id;

  // 'delete' is only for PM2 buildings, not supported for custom commands
  if (command === 'delete') {
    return { success: true }; // No-op for non-PM2 buildings
  }

  const cmdString = building.commands?.[command];

  if (!cmdString && command !== 'logs') {
    return {
      success: false,
      error: `No ${command} command configured for building: ${building.name}`,
    };
  }

  switch (command) {
    case 'start':
      updateBuildingStatus(buildingId, 'starting', broadcast);
      exec(cmdString!, { cwd: building.cwd }, (error) => {
        if (error) {
          updateBuildingStatus(buildingId, 'error', broadcast, { lastError: error.message });
          broadcast({
            type: 'building_logs',
            payload: { buildingId, logs: `Start error: ${error.message}`, timestamp: Date.now() },
          });
        } else {
          updateBuildingStatus(buildingId, 'running', broadcast);
        }
      });
      log.log(`Building ${building.name}: starting with command: ${cmdString}`);
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
      log.log(`Building ${building.name}: stopping with command: ${cmdString}`);
      return { success: true };

    case 'restart':
      updateBuildingStatus(buildingId, 'starting', broadcast);
      exec(cmdString!, { cwd: building.cwd }, (error) => {
        if (error) {
          updateBuildingStatus(buildingId, 'error', broadcast, { lastError: error.message });
          broadcast({
            type: 'building_logs',
            payload: { buildingId, logs: `Restart error: ${error.message}`, timestamp: Date.now() },
          });
        } else {
          updateBuildingStatus(buildingId, 'running', broadcast);
        }
      });
      log.log(`Building ${building.name}: restarting with command: ${cmdString}`);
      return { success: true };

    case 'healthCheck':
      try {
        await execAsync(cmdString!, { cwd: building.cwd, timeout: 10000 });
        updateBuildingStatus(buildingId, 'running', broadcast, {
          lastHealthCheck: Date.now(),
        });
        log.log(`Building ${building.name}: health check passed`);
        return { success: true };
      } catch (error: any) {
        updateBuildingStatus(buildingId, 'error', broadcast, {
          lastHealthCheck: Date.now(),
          lastError: error.message,
        });
        log.log(`Building ${building.name}: health check failed: ${error.message}`);
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
      log.log(`Building ${building.name}: fetching logs`);
      return { success: true };

    default:
      return { success: false, error: `Unknown command: ${command}` };
  }
}

/**
 * Execute a building command - routes to PM2 or custom command handler
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

  try {
    // Route to PM2 if enabled
    if (building.pm2?.enabled) {
      return executePM2Command(building, command, broadcast);
    }

    // Otherwise use custom commands
    return executeCustomCommand(building, command, broadcast);
  } catch (error: any) {
    log.error(`Building command error:`, error);
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

// ============================================================================
// Boss Building Commands
// ============================================================================

/**
 * Execute a boss building command (start_all, stop_all, restart_all)
 * This sends commands to all subordinate buildings managed by the boss
 */
export async function executeBossBuildingCommand(
  buildingId: string,
  command: BossBuildingCommand,
  broadcast: BroadcastFn
): Promise<{ success: boolean; results: BuildingCommandResult[] }> {
  const buildings = loadBuildings();
  const bossBuilding = buildings.find(b => b.id === buildingId);

  if (!bossBuilding) {
    return { success: false, results: [{ success: false, error: 'Boss building not found' }] };
  }

  if (bossBuilding.type !== 'boss') {
    return { success: false, results: [{ success: false, error: 'Building is not a boss building' }] };
  }

  const subordinateIds = bossBuilding.subordinateBuildingIds || [];
  if (subordinateIds.length === 0) {
    return { success: true, results: [] };
  }

  // Map boss command to regular building command
  let buildingCommand: BuildingCommand;
  switch (command) {
    case 'start_all':
      buildingCommand = 'start';
      break;
    case 'stop_all':
      buildingCommand = 'stop';
      break;
    case 'restart_all':
      buildingCommand = 'restart';
      break;
  }

  log.log(`Boss building ${bossBuilding.name}: executing ${command} on ${subordinateIds.length} subordinates`);

  // Execute commands on all subordinates
  const results: BuildingCommandResult[] = [];
  for (const subId of subordinateIds) {
    const result = await executeCommand(subId, buildingCommand, broadcast);
    results.push(result);
  }

  const allSuccess = results.every(r => r.success);
  log.log(`Boss building ${bossBuilding.name}: ${command} completed. Success: ${allSuccess}`);

  return { success: allSuccess, results };
}

/**
 * Get subordinate buildings for a boss building
 */
export function getSubordinateBuildings(buildingId: string): Building[] {
  const buildings = loadBuildings();
  const bossBuilding = buildings.find(b => b.id === buildingId);

  if (!bossBuilding || bossBuilding.type !== 'boss') {
    return [];
  }

  const subordinateIds = bossBuilding.subordinateBuildingIds || [];
  return buildings.filter(b => subordinateIds.includes(b.id));
}

// ============================================================================
// PM2 Status Polling
// ============================================================================

let pollInterval: NodeJS.Timeout | null = null;

/**
 * Start polling PM2 for status updates
 * Syncs PM2 process status with building status
 */
export function startPM2StatusPolling(broadcast: BroadcastFn, intervalMs: number = 10000): void {
  if (pollInterval) {
    log.log('PM2 status polling already running');
    return;
  }

  log.log(`Starting PM2 status polling (interval: ${intervalMs}ms)`);

  // Initial poll
  pollPM2Status(broadcast);

  // Set up interval
  pollInterval = setInterval(() => pollPM2Status(broadcast), intervalMs);
}

/**
 * Stop PM2 status polling
 */
export function stopPM2StatusPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    log.log('PM2 status polling stopped');
  }
}

/**
 * Poll PM2 for status updates and sync with buildings
 */
async function pollPM2Status(broadcast: BroadcastFn): Promise<void> {
  const buildings = loadBuildings().filter(b => b.pm2?.enabled);

  if (buildings.length === 0) {
    return; // No PM2-enabled buildings, skip polling
  }

  const statusMap = await pm2Service.getAllStatus();

  for (const building of buildings) {
    // Get the PM2 name for this building
    const pm2Name = pm2Service.getPM2Name(building);
    const status = statusMap.get(pm2Name);

    if (status) {
      // Determine building status from PM2 status
      const newBuildingStatus: BuildingStatus =
        status.status === 'online' ? 'running' :
        status.status === 'stopped' || status.status === 'stopping' ? 'stopped' :
        status.status === 'errored' ? 'error' :
        'unknown';

      // Only update if status changed or PM2 metrics updated
      const statusChanged = building.status !== newBuildingStatus;
      const metricsChanged = building.pm2Status?.pid !== status.pid ||
                             building.pm2Status?.restarts !== status.restarts;
      // Check if ports changed (compare sorted arrays)
      const oldPorts = (building.pm2Status?.ports || []).sort().join(',');
      const newPorts = (status.ports || []).sort().join(',');
      const portsChanged = oldPorts !== newPorts;

      if (statusChanged || metricsChanged || portsChanged) {
        if (portsChanged && status.ports && status.ports.length > 0) {
          log.log(`Building ${building.name}: detected ports ${status.ports.join(', ')}`);
        }
        updateBuildingStatus(building.id, newBuildingStatus, broadcast, {
          pm2Status: status,
        });
      }
    } else {
      // Process not found in PM2 - might be stopped or not started
      if (building.status === 'running' || building.status === 'starting') {
        // Was supposed to be running but PM2 doesn't have it
        updateBuildingStatus(building.id, 'stopped', broadcast, {
          pm2Status: undefined,
        });
      }
    }
  }
}

/**
 * Sync PM2 status for a single building (called on demand)
 */
export async function syncPM2Status(buildingId: string, broadcast: BroadcastFn): Promise<void> {
  const building = getBuilding(buildingId);
  if (!building || !building.pm2?.enabled) {
    return;
  }

  const status = await pm2Service.getStatus(building);
  if (status) {
    const newBuildingStatus: BuildingStatus =
      status.status === 'online' ? 'running' :
      status.status === 'stopped' || status.status === 'stopping' ? 'stopped' :
      status.status === 'errored' ? 'error' :
      'unknown';

    updateBuildingStatus(buildingId, newBuildingStatus, broadcast, {
      pm2Status: status,
    });
  }
}

/**
 * Check if PM2 config has changed between old and new building
 */
function hasPM2ConfigChanged(oldBuilding: Building, newBuilding: Building): boolean {
  const oldPM2 = oldBuilding.pm2;
  const newPM2 = newBuilding.pm2;

  if (!oldPM2 || !newPM2) return false;

  // Check script, args, interpreter, interpreterArgs
  if (oldPM2.script !== newPM2.script) return true;
  if (oldPM2.args !== newPM2.args) return true;
  if (oldPM2.interpreter !== newPM2.interpreter) return true;
  if (oldPM2.interpreterArgs !== newPM2.interpreterArgs) return true;

  // Check cwd (building level)
  if (oldBuilding.cwd !== newBuilding.cwd) return true;

  // Check env variables
  const oldEnv = oldPM2.env || {};
  const newEnv = newPM2.env || {};
  const oldEnvKeys = Object.keys(oldEnv);
  const newEnvKeys = Object.keys(newEnv);

  if (oldEnvKeys.length !== newEnvKeys.length) return true;

  for (const key of oldEnvKeys) {
    if (oldEnv[key] !== newEnv[key]) return true;
  }

  return false;
}

/**
 * Handle building sync - detect PM2 name/config changes and update processes
 * Called when buildings are synced from the client
 */
export async function handleBuildingSync(
  newBuildings: Building[],
  broadcast: BroadcastFn
): Promise<void> {
  const oldBuildings = loadBuildings();
  const oldBuildingsMap = new Map(oldBuildings.map(b => [b.id, b]));

  log.log(`handleBuildingSync called with ${newBuildings.length} buildings`);

  for (const newBuilding of newBuildings) {
    const oldBuilding = oldBuildingsMap.get(newBuilding.id);

    // Check if this is a PM2-enabled building
    if (oldBuilding && newBuilding.pm2?.enabled && oldBuilding.pm2?.enabled) {
      const oldPM2Name = pm2Service.getPM2Name(oldBuilding);
      const newPM2Name = pm2Service.getPM2Name(newBuilding);
      const nameChanged = oldPM2Name !== newPM2Name;
      const configChanged = hasPM2ConfigChanged(oldBuilding, newBuilding);

      log.log(`Building ${newBuilding.name}: nameChanged=${nameChanged}, configChanged=${configChanged}`);
      log.log(`  Old args: "${oldBuilding.pm2?.args}", New args: "${newBuilding.pm2?.args}"`);
      log.log(`  Old script: "${oldBuilding.pm2?.script}", New script: "${newBuilding.pm2?.script}"`);

      if (nameChanged || configChanged) {
        const changeType = nameChanged ? 'name' : 'config';
        log.log(`Building ${newBuilding.id}: PM2 ${changeType} changed`);

        // Check if the old process is running
        const oldStatus = await pm2Service.getStatus(oldBuilding);
        const wasRunning = oldStatus?.status === 'online';

        // Delete the old PM2 process
        await pm2Service.deleteProcess(oldBuilding);
        log.log(`Deleted old PM2 process: ${oldPM2Name}`);

        // If it was running, start the new one with updated config
        if (wasRunning) {
          const result = await pm2Service.startProcess(newBuilding);
          if (result.success) {
            log.log(`Started PM2 process with new ${changeType}: ${newPM2Name}`);
          } else {
            log.error(`Failed to start PM2 process ${newPM2Name}: ${result.error}`);
          }
        }
      }
    }
  }
}
