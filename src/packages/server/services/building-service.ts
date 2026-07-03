/**
 * Building Service
 * Handles building/infrastructure command operations
 * Supports custom commands, PM2-managed processes, and Docker containers
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  Building,
  BuildingStatus,
  BuildingStyle,
  BuildingType,
  DatabaseEngine,
  PM2Interpreter,
  ServerMessage,
} from '../../shared/types.js';
import { loadBuildings, saveBuildings } from '../data/index.js';
import { createLogger, generateId } from '../utils/index.js';
import * as pm2Service from './pm2-service.js';
import * as dockerService from './docker-service.js';
import * as terminalService from './terminal-service.js';
import * as databaseService from './database-service.js';

const log = createLogger('BuildingService');
const execAsync = promisify(exec);

export type BuildingCommand = 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs' | 'delete';
export type BossBuildingCommand = 'start_all' | 'stop_all' | 'restart_all';

export interface BuildingCommandResult {
  success: boolean;
  error?: string;
  logs?: string;
}

export type CrudResult<T> =
  | { ok: true; building: T }
  | { ok: false; status: number; errors: string[] };

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Broadcast function type - passed in from websocket handler
 */
type BroadcastFn = (message: ServerMessage) => void;

/**
 * Update building status and persist
 */
function computeBossStatus(subordinates: Building[]): BuildingStatus {
  if (subordinates.length === 0) return 'unknown';
  const allRunning = subordinates.every(s => s.status === 'running');
  if (allRunning) return 'running';
  const noneRunning = subordinates.every(s => s.status !== 'running' && s.status !== 'starting');
  if (noneRunning) return 'error';
  // Mixed state — some running, some not (warning)
  return 'unknown';
}

function updateBossBuildings(
  buildings: Building[],
  subordinateId: string,
  broadcast: BroadcastFn
): void {
  // Find any boss buildings that manage this subordinate
  const bosses = buildings.filter(
    b => b.type === 'boss' && b.subordinateBuildingIds?.includes(subordinateId)
  );
  for (const boss of bosses) {
    const subs = buildings.filter(b => boss.subordinateBuildingIds?.includes(b.id));
    const newStatus = computeBossStatus(subs);
    if (boss.status !== newStatus) {
      const bossIdx = buildings.findIndex(b => b.id === boss.id);
      if (bossIdx !== -1) {
        buildings[bossIdx] = {
          ...buildings[bossIdx],
          status: newStatus,
          lastActivity: Date.now(),
        };
        broadcast({
          type: 'building_updated',
          payload: buildings[bossIdx],
        });
      }
    }
  }
}

function recomputeAllBossStatuses(broadcast: BroadcastFn): void {
  const buildings = loadBuildings();
  let changed = false;
  for (const boss of buildings) {
    if (boss.type !== 'boss' || !boss.subordinateBuildingIds?.length) continue;
    const subs = buildings.filter(b => boss.subordinateBuildingIds!.includes(b.id));
    const newStatus = computeBossStatus(subs);
    if (boss.status !== newStatus) {
      const idx = buildings.findIndex(b => b.id === boss.id);
      buildings[idx] = { ...buildings[idx], status: newStatus, lastActivity: Date.now() };
      changed = true;
      broadcast({ type: 'building_updated', payload: buildings[idx] });
    }
  }
  if (changed) {
    saveBuildings(buildings);
  }
}

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
    // Update boss buildings that manage this subordinate
    updateBossBuildings(buildings, buildingId, broadcast);
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
 * Execute a Docker command for a building
 */
async function executeDockerCommand(
  building: Building,
  command: BuildingCommand,
  broadcast: BroadcastFn
): Promise<BuildingCommandResult> {
  const buildingId = building.id;
  const isCompose = building.docker?.mode === 'compose';
  const _isExisting = building.docker?.mode === 'existing';

  switch (command) {
    case 'start': {
      updateBuildingStatus(buildingId, 'starting', broadcast);
      const result = isCompose
        ? await dockerService.composeUp(building)
        : await dockerService.startContainer(building); // Works for both 'container' and 'existing' modes

      if (result.success) {
        // Fetch actual status after short delay to let Docker initialize
        setTimeout(async () => {
          const status = await dockerService.getStatus(building);
          const newStatus: BuildingStatus = status?.status === 'running' ? 'running' : 'error';
          updateBuildingStatus(buildingId, newStatus, broadcast, {
            dockerStatus: status || undefined,
            lastError: status?.status !== 'running' ? 'Container failed to start' : undefined,
          });
        }, 2000);
        log.log(`Building ${building.name}: Docker ${isCompose ? 'compose up' : 'start'} initiated`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: Docker start failed: ${result.error}`);
      }
      return result;
    }

    case 'stop': {
      updateBuildingStatus(buildingId, 'stopping', broadcast);
      const result = isCompose
        ? await dockerService.composeDown(building)
        : await dockerService.stopContainer(building);

      if (result.success) {
        updateBuildingStatus(buildingId, 'stopped', broadcast, { dockerStatus: undefined });
        log.log(`Building ${building.name}: Docker ${isCompose ? 'compose down' : 'stop'} completed`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: Docker stop failed: ${result.error}`);
      }
      return result;
    }

    case 'restart': {
      updateBuildingStatus(buildingId, 'starting', broadcast);
      const result = isCompose
        ? await dockerService.composeRestart(building)
        : await dockerService.restartContainer(building);

      if (result.success) {
        // Fetch actual status after short delay
        setTimeout(async () => {
          const status = await dockerService.getStatus(building);
          const newStatus: BuildingStatus = status?.status === 'running' ? 'running' : 'error';
          updateBuildingStatus(buildingId, newStatus, broadcast, {
            dockerStatus: status || undefined,
          });
        }, 2000);
        log.log(`Building ${building.name}: Docker restart initiated`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: Docker restart failed: ${result.error}`);
      }
      return result;
    }

    case 'logs': {
      const logs = await dockerService.getLogs(building, 200);
      broadcast({
        type: 'building_logs',
        payload: { buildingId, logs, timestamp: Date.now() },
      });
      log.log(`Building ${building.name}: Docker logs fetched`);
      return { success: true, logs };
    }

    case 'healthCheck': {
      const status = await dockerService.getStatus(building);
      const isHealthy = status?.status === 'running' &&
        (status.health === 'healthy' || status.health === 'none');
      updateBuildingStatus(buildingId, isHealthy ? 'running' : 'error', broadcast, {
        lastHealthCheck: Date.now(),
        dockerStatus: status || undefined,
        lastError: isHealthy ? undefined : `Docker status: ${status?.status || 'not found'}`,
      });
      log.log(`Building ${building.name}: Docker health check: ${isHealthy ? 'passed' : 'failed'}`);
      return { success: isHealthy };
    }

    case 'delete': {
      const result = isCompose
        ? await dockerService.composeDown(building)
        : await dockerService.removeContainer(building);
      if (result.success) {
        log.log(`Building ${building.name}: Docker container/compose removed`);
      } else {
        log.error(`Building ${building.name}: Docker remove failed: ${result.error}`);
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
 * Execute a terminal (ttyd) command for a building
 */
async function executeTerminalCommand(
  building: Building,
  command: BuildingCommand,
  broadcast: BroadcastFn
): Promise<BuildingCommandResult> {
  const buildingId = building.id;

  switch (command) {
    case 'start': {
      updateBuildingStatus(buildingId, 'starting', broadcast);
      const result = await terminalService.startTerminal(building);

      if (result.success) {
        // Check status after short delay to confirm
        setTimeout(() => {
          const status = terminalService.getTerminalStatus(building);
          if (status) {
            updateBuildingStatus(buildingId, 'running', broadcast, {
              terminalStatus: status,
            });
          } else {
            updateBuildingStatus(buildingId, 'error', broadcast, {
              lastError: 'ttyd process exited unexpectedly',
            });
          }
        }, 1000);
        log.log(`Building ${building.name}: terminal start initiated`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: terminal start failed: ${result.error}`);
      }
      return result;
    }

    case 'stop': {
      updateBuildingStatus(buildingId, 'stopping', broadcast);
      const result = await terminalService.stopTerminal(building);

      if (result.success) {
        updateBuildingStatus(buildingId, 'stopped', broadcast, { terminalStatus: undefined });
        log.log(`Building ${building.name}: terminal stopped`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: terminal stop failed: ${result.error}`);
      }
      return result;
    }

    case 'restart': {
      updateBuildingStatus(buildingId, 'starting', broadcast);
      const result = await terminalService.restartTerminal(building);

      if (result.success) {
        setTimeout(() => {
          const status = terminalService.getTerminalStatus(building);
          if (status) {
            updateBuildingStatus(buildingId, 'running', broadcast, {
              terminalStatus: status,
            });
          } else {
            updateBuildingStatus(buildingId, 'error', broadcast, {
              lastError: 'ttyd process exited after restart',
            });
          }
        }, 1000);
        log.log(`Building ${building.name}: terminal restart initiated`);
      } else {
        updateBuildingStatus(buildingId, 'error', broadcast, { lastError: result.error });
        log.error(`Building ${building.name}: terminal restart failed: ${result.error}`);
      }
      return result;
    }

    case 'healthCheck': {
      const status = terminalService.getTerminalStatus(building);
      const isHealthy = !!status;
      updateBuildingStatus(buildingId, isHealthy ? 'running' : 'error', broadcast, {
        lastHealthCheck: Date.now(),
        terminalStatus: status || undefined,
        lastError: isHealthy ? undefined : 'ttyd process not running',
      });
      log.log(`Building ${building.name}: terminal health check: ${isHealthy ? 'passed' : 'failed'}`);
      return { success: isHealthy };
    }

    case 'delete': {
      await terminalService.cleanupTerminal(building, true);
      log.log(`Building ${building.name}: terminal cleaned up`);
      return { success: true };
    }

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

    // Route to Docker if enabled
    if (building.docker?.enabled) {
      return executeDockerCommand(building, command, broadcast);
    }

    // Route to Terminal if enabled
    if (building.terminal?.enabled) {
      return executeTerminalCommand(building, command, broadcast);
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

  // Recompute boss building statuses
  recomputeAllBossStatuses(broadcast);
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

// ============================================================================
// Docker Status Polling
// ============================================================================

let dockerPollInterval: NodeJS.Timeout | null = null;

/**
 * Start polling Docker for status updates
 * Syncs Docker container status with building status
 */
export function startDockerStatusPolling(broadcast: BroadcastFn, intervalMs: number = 10000): void {
  if (dockerPollInterval) {
    log.log('Docker status polling already running');
    return;
  }

  log.log(`Starting Docker status polling (interval: ${intervalMs}ms)`);

  // Initial poll
  pollDockerStatus(broadcast);

  // Set up interval
  dockerPollInterval = setInterval(() => pollDockerStatus(broadcast), intervalMs);
}

/**
 * Stop Docker status polling
 */
export function stopDockerStatusPolling(): void {
  if (dockerPollInterval) {
    clearInterval(dockerPollInterval);
    dockerPollInterval = null;
    log.log('Docker status polling stopped');
  }
}

/**
 * Poll Docker for status updates and sync with buildings
 */
async function pollDockerStatus(broadcast: BroadcastFn): Promise<void> {
  const buildings = loadBuildings().filter(b => b.docker?.enabled);

  if (buildings.length === 0) {
    return; // No Docker-enabled buildings, skip polling
  }

  // For container mode buildings, we can batch the status check
  const containerBuildings = buildings.filter(b => b.docker?.mode === 'container');
  const composeBuildings = buildings.filter(b => b.docker?.mode === 'compose');

  // Get all container statuses
  const containerStatusMap = await dockerService.getAllContainerStatus();

  // Process container mode buildings
  for (const building of containerBuildings) {
    const containerName = dockerService.getContainerName(building);
    const status = containerStatusMap.get(containerName);

    if (status) {
      const newBuildingStatus: BuildingStatus =
        status.status === 'running' ? 'running' :
        status.status === 'exited' || status.status === 'created' ? 'stopped' :
        status.status === 'dead' || status.health === 'unhealthy' ? 'error' :
        'unknown';

      // Only update if status changed or metrics updated
      const statusChanged = building.status !== newBuildingStatus;
      const metricsChanged = building.dockerStatus?.containerId !== status.containerId;
      // Check if ports changed
      const oldPorts = (building.dockerStatus?.ports || [])
        .map(p => `${p.host}:${p.container}`)
        .sort()
        .join(',');
      const newPorts = (status.ports || [])
        .map(p => `${p.host}:${p.container}`)
        .sort()
        .join(',');
      const portsChanged = oldPorts !== newPorts;

      if (statusChanged || metricsChanged || portsChanged) {
        if (portsChanged && status.ports && status.ports.length > 0) {
          log.log(`Building ${building.name}: detected Docker ports ${status.ports.map(p => `${p.host}:${p.container}`).join(', ')}`);
        }
        updateBuildingStatus(building.id, newBuildingStatus, broadcast, {
          dockerStatus: status,
        });
      }
    } else {
      // Container not found - might be stopped or not started
      if (building.status === 'running' || building.status === 'starting') {
        updateBuildingStatus(building.id, 'stopped', broadcast, {
          dockerStatus: undefined,
        });
      }
    }
  }

  // Process compose mode buildings (need individual status checks)
  for (const building of composeBuildings) {
    const status = await dockerService.getComposeStatus(building);

    if (status) {
      const newBuildingStatus: BuildingStatus =
        status.status === 'running' ? 'running' :
        status.status === 'exited' || status.status === 'created' ? 'stopped' :
        status.status === 'dead' ? 'error' :
        'unknown';

      const statusChanged = building.status !== newBuildingStatus;

      if (statusChanged) {
        updateBuildingStatus(building.id, newBuildingStatus, broadcast, {
          dockerStatus: status,
        });
      }
    } else {
      if (building.status === 'running' || building.status === 'starting') {
        updateBuildingStatus(building.id, 'stopped', broadcast, {
          dockerStatus: undefined,
        });
      }
    }
  }

  // Recompute boss building statuses
  recomputeAllBossStatuses(broadcast);
}

/**
 * Sync Docker status for a single building (called on demand)
 */
export async function syncDockerStatus(buildingId: string, broadcast: BroadcastFn): Promise<void> {
  const building = getBuilding(buildingId);
  if (!building || !building.docker?.enabled) {
    return;
  }

  const status = await dockerService.getStatus(building);
  if (status) {
    const newBuildingStatus: BuildingStatus =
      status.status === 'running' ? 'running' :
      status.status === 'exited' || status.status === 'created' ? 'stopped' :
      status.status === 'dead' || status.health === 'unhealthy' ? 'error' :
      'unknown';

    updateBuildingStatus(buildingId, newBuildingStatus, broadcast, {
      dockerStatus: status,
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
 * Check if Docker config has changed between old and new building
 */
function hasDockerConfigChanged(oldBuilding: Building, newBuilding: Building): boolean {
  const oldDocker = oldBuilding.docker;
  const newDocker = newBuilding.docker;

  if (!oldDocker || !newDocker) return false;

  // Check mode
  if (oldDocker.mode !== newDocker.mode) return true;

  // For container mode
  if (newDocker.mode === 'container') {
    if (oldDocker.image !== newDocker.image) return true;
    if (oldDocker.command !== newDocker.command) return true;
    if (oldDocker.network !== newDocker.network) return true;
    if (oldDocker.restart !== newDocker.restart) return true;

    // Check ports
    const oldPorts = (oldDocker.ports || []).sort().join(',');
    const newPorts = (newDocker.ports || []).sort().join(',');
    if (oldPorts !== newPorts) return true;

    // Check volumes
    const oldVolumes = (oldDocker.volumes || []).sort().join(',');
    const newVolumes = (newDocker.volumes || []).sort().join(',');
    if (oldVolumes !== newVolumes) return true;
  }

  // For compose mode
  if (newDocker.mode === 'compose') {
    if (oldDocker.composePath !== newDocker.composePath) return true;
    if (oldDocker.composeProject !== newDocker.composeProject) return true;
    const oldServices = (oldDocker.services || []).sort().join(',');
    const newServices = (newDocker.services || []).sort().join(',');
    if (oldServices !== newServices) return true;
  }

  // Check cwd (building level)
  if (oldBuilding.cwd !== newBuilding.cwd) return true;

  // Check env variables
  const oldEnv = oldDocker.env || {};
  const newEnv = newDocker.env || {};
  const oldEnvKeys = Object.keys(oldEnv);
  const newEnvKeys = Object.keys(newEnv);

  if (oldEnvKeys.length !== newEnvKeys.length) return true;

  for (const key of oldEnvKeys) {
    if (oldEnv[key] !== newEnv[key]) return true;
  }

  return false;
}

// ============================================================================
// Terminal Status Polling
// ============================================================================

let terminalPollInterval: NodeJS.Timeout | null = null;

/**
 * Start polling terminal (ttyd) status
 */
export function startTerminalStatusPolling(broadcast: BroadcastFn, intervalMs: number = 10000): void {
  if (terminalPollInterval) {
    log.log('Terminal status polling already running');
    return;
  }

  // Register immediate exit callback so clients are notified without waiting for the poll
  terminalService.onTerminalExit((buildingId, code) => {
    log.log(`Terminal process exited for building ${buildingId} (code ${code}), broadcasting status update`);
    updateBuildingStatus(buildingId, 'stopped', broadcast, { terminalStatus: undefined });
  });

  log.log(`Starting terminal status polling (interval: ${intervalMs}ms)`);
  terminalPollInterval = setInterval(() => pollTerminalStatus(broadcast), intervalMs);
}

/**
 * Stop terminal status polling
 */
export function stopTerminalStatusPolling(): void {
  if (terminalPollInterval) {
    clearInterval(terminalPollInterval);
    terminalPollInterval = null;
    log.log('Terminal status polling stopped');
  }
}

/**
 * Poll terminal statuses and sync with buildings
 */
function pollTerminalStatus(broadcast: BroadcastFn): void {
  const buildings = loadBuildings().filter(b => b.terminal?.enabled);

  if (buildings.length === 0) return;

  const statuses = terminalService.pollTerminalStatuses();

  for (const building of buildings) {
    const status = statuses.get(building.id);

    if (status && building.status !== 'running') {
      updateBuildingStatus(building.id, 'running', broadcast, { terminalStatus: status });
    } else if (!status && (building.status === 'running' || building.status === 'starting')) {
      updateBuildingStatus(building.id, 'stopped', broadcast, { terminalStatus: undefined });
    }
  }
}

/**
 * Cleanup all terminals (called on server shutdown)
 */
export function cleanupAllTerminals(): void {
  terminalService.cleanupAllTerminals();
}

/**
 * Reconcile runtime state for a single building when its config changes.
 * Handles PM2 rename/restart, Docker rename/restart, and database tunnel teardown.
 * Shared by handleBuildingSync (full sync from client) and updateBuilding (REST patch).
 */
async function reconcileBuilding(oldBuilding: Building, newBuilding: Building): Promise<void> {
  if (newBuilding.pm2?.enabled && oldBuilding.pm2?.enabled) {
    const oldPM2Name = pm2Service.getPM2Name(oldBuilding);
    const newPM2Name = pm2Service.getPM2Name(newBuilding);
    const nameChanged = oldPM2Name !== newPM2Name;
    const configChanged = hasPM2ConfigChanged(oldBuilding, newBuilding);

    if (nameChanged || configChanged) {
      const changeType = nameChanged ? 'name' : 'config';
      log.log(`Building ${newBuilding.id}: PM2 ${changeType} changed`);

      const oldStatus = await pm2Service.getStatus(oldBuilding);
      const wasRunning = oldStatus?.status === 'online';

      await pm2Service.deleteProcess(oldBuilding);
      log.log(`Deleted old PM2 process: ${oldPM2Name}`);

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

  // Database connection changes — tear down tunnels for connections that
  // were removed or whose SSH config materially changed.
  if (oldBuilding.type === 'database') {
    const oldConns = oldBuilding.database?.connections || [];
    const newConns = newBuilding.type === 'database'
      ? (newBuilding.database?.connections || [])
      : [];
    const newConnsById = new Map(newConns.map(c => [c.id, c]));
    for (const oldConn of oldConns) {
      const fresh = newConnsById.get(oldConn.id);
      if (!fresh) {
        await databaseService.closeConnection(oldConn.id);
        continue;
      }
      const oldKey = JSON.stringify({
        ssh: oldConn.ssh ?? null,
        host: oldConn.host,
        port: oldConn.port,
      });
      const newKey = JSON.stringify({
        ssh: fresh.ssh ?? null,
        host: fresh.host,
        port: fresh.port,
      });
      if (oldKey !== newKey) {
        await databaseService.closeConnection(oldConn.id);
      }
    }
  }

  if (newBuilding.docker?.enabled && oldBuilding.docker?.enabled) {
    const oldContainerName = dockerService.getContainerName(oldBuilding);
    const newContainerName = dockerService.getContainerName(newBuilding);
    const nameChanged = oldContainerName !== newContainerName;
    const configChanged = hasDockerConfigChanged(oldBuilding, newBuilding);

    if (nameChanged || configChanged) {
      const changeType = nameChanged ? 'name' : 'config';
      log.log(`Building ${newBuilding.id}: Docker ${changeType} changed`);

      const oldStatus = await dockerService.getStatus(oldBuilding);
      const wasRunning = oldStatus?.status === 'running';

      if (oldBuilding.docker.mode === 'compose') {
        await dockerService.composeDown(oldBuilding);
      } else {
        await dockerService.removeContainer(oldBuilding);
      }
      log.log(`Removed old Docker container: ${oldContainerName}`);

      if (wasRunning) {
        const result = newBuilding.docker.mode === 'compose'
          ? await dockerService.composeUp(newBuilding)
          : await dockerService.startContainer(newBuilding);

        if (result.success) {
          log.log(`Started Docker container with new ${changeType}: ${newContainerName}`);
        } else {
          log.error(`Failed to start Docker container ${newContainerName}: ${result.error}`);
        }
      }
    }
  }
}

/**
 * Handle building sync - detect PM2/Docker name/config changes and update processes
 * Called when buildings are synced from the client
 */
export async function handleBuildingSync(
  newBuildings: Building[],
  _broadcast: BroadcastFn
): Promise<void> {
  const oldBuildings = loadBuildings();
  const oldBuildingsMap = new Map(oldBuildings.map(b => [b.id, b]));
  const newBuildingIds = new Set(newBuildings.map(b => b.id));

  log.log(`handleBuildingSync called with ${newBuildings.length} buildings`);

  // Tear down database tunnels for buildings that were entirely deleted.
  for (const oldBuilding of oldBuildings) {
    if (newBuildingIds.has(oldBuilding.id)) continue;
    if (oldBuilding.type !== 'database') continue;
    for (const conn of oldBuilding.database?.connections || []) {
      await databaseService.closeConnection(conn.id);
    }
  }

  for (const newBuilding of newBuildings) {
    const oldBuilding = oldBuildingsMap.get(newBuilding.id);
    if (oldBuilding) {
      await reconcileBuilding(oldBuilding, newBuilding);
    }
  }
}

// ============================================================================
// Validation & CRUD (Phase 1 - REST API support)
// ============================================================================

const VALID_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>([
  'server', 'link', 'database', 'docker', 'monitor', 'folder', 'boss', 'terminal', 'tests',
]);

const VALID_STYLES: ReadonlySet<BuildingStyle> = new Set<BuildingStyle>([
  'server-rack', 'tower', 'dome', 'pyramid', 'desktop',
  'filing-cabinet', 'satellite', 'crystal', 'factory', 'command-center',
]);

const VALID_INTERPRETERS: ReadonlySet<PM2Interpreter> = new Set<PM2Interpreter>([
  '', 'node', 'bun', 'python3', 'python', 'java', 'php', 'bash', 'none',
]);

const VALID_DOCKER_MODES: ReadonlySet<'container' | 'compose' | 'existing'> = new Set([
  'container', 'compose', 'existing',
]);

const VALID_DB_ENGINES: ReadonlySet<DatabaseEngine> = new Set<DatabaseEngine>([
  'mysql', 'postgresql', 'oracle', 'sqlite', 'mssql',
]);

const DEFAULT_STYLE_BY_TYPE: Record<BuildingType, BuildingStyle> = {
  server: 'server-rack',
  link: 'tower',
  database: 'dome',
  docker: 'crystal',
  monitor: 'satellite',
  folder: 'filing-cabinet',
  boss: 'command-center',
  terminal: 'desktop',
  tests: 'dome',
};

function generateBuildingId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `building_${Date.now()}_${slug || generateId()}`;
}

/**
 * Pure schema validator. Does not consult other buildings (cross-building
 * checks like dangling boss subordinates happen in createBuilding/updateBuilding).
 */
export function validateBuilding(input: Partial<Building>): ValidationResult {
  const errors: string[] = [];

  if (typeof input.name !== 'string' || !input.name.trim()) {
    errors.push('name is required (non-empty string)');
  }

  if (!input.type || !VALID_TYPES.has(input.type)) {
    errors.push(`type must be one of: ${[...VALID_TYPES].join(', ')}`);
  }

  if (input.style && !VALID_STYLES.has(input.style)) {
    errors.push(`style must be one of: ${[...VALID_STYLES].join(', ')}`);
  }

  if (!input.position
      || typeof input.position.x !== 'number'
      || typeof input.position.z !== 'number') {
    errors.push('position is required ({x: number, z: number})');
  }

  if (input.pm2?.enabled) {
    if (!input.pm2.script || typeof input.pm2.script !== 'string') {
      errors.push('pm2.script is required when pm2.enabled is true');
    }
    if (input.pm2.interpreter !== undefined && !VALID_INTERPRETERS.has(input.pm2.interpreter)) {
      const allowed = [...VALID_INTERPRETERS].filter(i => i).join(', ');
      errors.push(`pm2.interpreter must be one of: ${allowed} (or "" for auto-detect)`);
    }
  }

  if (input.docker?.enabled) {
    if (!input.docker.mode || !VALID_DOCKER_MODES.has(input.docker.mode)) {
      errors.push(`docker.mode must be one of: ${[...VALID_DOCKER_MODES].join(', ')}`);
    }
    if (input.docker.mode === 'container' && !input.docker.image) {
      errors.push('docker.image is required when docker.mode is "container"');
    }
    if (input.docker.mode === 'compose' && !input.docker.composePath) {
      errors.push('docker.composePath is required when docker.mode is "compose"');
    }
    if (input.docker.mode === 'existing' && !input.docker.containerName) {
      errors.push('docker.containerName is required when docker.mode is "existing"');
    }
  }

  if (input.type === 'database') {
    const conns = input.database?.connections;
    if (!Array.isArray(conns) || conns.length === 0) {
      errors.push('database.connections must be a non-empty array for database buildings');
    } else {
      for (const conn of conns) {
        const label = conn.id || conn.name || '(unnamed)';
        if (!conn.id) errors.push(`database.connection ${label}: id is required`);
        if (!conn.name) errors.push(`database.connection ${label}: name is required`);
        if (!conn.engine || !VALID_DB_ENGINES.has(conn.engine)) {
          errors.push(`database.connection ${label}: engine must be one of ${[...VALID_DB_ENGINES].join(', ')}`);
        }
        if (conn.engine === 'sqlite') {
          if (!conn.filepath) {
            errors.push(`database.connection ${label}: filepath is required for sqlite`);
          }
        } else if (conn.engine) {
          if (!conn.host) errors.push(`database.connection ${label}: host is required for ${conn.engine}`);
          if (typeof conn.port !== 'number') errors.push(`database.connection ${label}: port must be a number for ${conn.engine}`);
        }
      }
    }
  }

  if (input.type === 'terminal' && !input.terminal?.enabled) {
    errors.push('terminal.enabled must be true for terminal buildings');
  }

  if (input.type === 'folder' && !input.folderPath) {
    errors.push('folderPath is required for folder buildings');
  }

  if (input.type === 'tests' && !input.folderPath) {
    errors.push('folderPath is required for tests buildings (the folder whose tests it browses)');
  }

  if (input.type === 'link' && (!input.urls || input.urls.length === 0)) {
    errors.push('urls is required (non-empty array) for link buildings');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Create a new building. Server assigns id, createdAt, and initial status.
 * Validates schema and cross-building references (boss subordinates).
 */
export async function createBuilding(
  input: Partial<Building>,
  broadcast: BroadcastFn
): Promise<CrudResult<Building>> {
  const validation = validateBuilding(input);
  if (!validation.ok) {
    return { ok: false, status: 400, errors: validation.errors };
  }

  const buildings = loadBuildings();

  if (input.type === 'boss' && input.subordinateBuildingIds?.length) {
    const existingIds = new Set(buildings.map(b => b.id));
    const dangling = input.subordinateBuildingIds.filter(id => !existingIds.has(id));
    if (dangling.length > 0) {
      return {
        ok: false,
        status: 400,
        errors: [`subordinateBuildingIds reference unknown buildings: ${dangling.join(', ')}`],
      };
    }
  }

  const now = Date.now();
  const building: Building = {
    ...(input as Building),
    id: generateBuildingId(input.name!),
    createdAt: now,
    lastActivity: now,
    status: 'stopped',
    style: input.style || DEFAULT_STYLE_BY_TYPE[input.type!],
  };

  buildings.push(building);
  saveBuildings(buildings);

  broadcast({ type: 'building_created', payload: building });
  log.log(`Created building ${building.name} (${building.id})`);

  return { ok: true, building };
}

/**
 * Update an existing building. Strips server-managed fields from the patch,
 * runs the same validation as create, and reconciles runtime state
 * (PM2 / Docker / DB tunnels) if relevant fields changed.
 */
export async function updateBuilding(
  id: string,
  patch: Partial<Building>,
  broadcast: BroadcastFn
): Promise<CrudResult<Building>> {
  const buildings = loadBuildings();
  const idx = buildings.findIndex(b => b.id === id);
  if (idx === -1) {
    return { ok: false, status: 404, errors: [`Building not found: ${id}`] };
  }

  const oldBuilding = buildings[idx];

  // Strip server-managed fields from the patch — clients cannot change them.
  const safePatch = { ...patch };
  delete safePatch.id;
  delete safePatch.createdAt;
  delete safePatch.pm2Status;
  delete safePatch.dockerStatus;
  delete safePatch.terminalStatus;

  const newBuilding: Building = {
    ...oldBuilding,
    ...safePatch,
    id: oldBuilding.id,
    createdAt: oldBuilding.createdAt,
    lastActivity: Date.now(),
  };

  const validation = validateBuilding(newBuilding);
  if (!validation.ok) {
    return { ok: false, status: 400, errors: validation.errors };
  }

  if (newBuilding.type === 'boss' && newBuilding.subordinateBuildingIds?.length) {
    const existingIds = new Set(buildings.map(b => b.id));
    const dangling = newBuilding.subordinateBuildingIds.filter(sid => !existingIds.has(sid));
    if (dangling.length > 0) {
      return {
        ok: false,
        status: 400,
        errors: [`subordinateBuildingIds reference unknown buildings: ${dangling.join(', ')}`],
      };
    }
  }

  buildings[idx] = newBuilding;
  saveBuildings(buildings);

  try {
    await reconcileBuilding(oldBuilding, newBuilding);
  } catch (err) {
    log.error(`Reconcile failed for building ${id}:`, err);
  }

  broadcast({ type: 'building_updated', payload: newBuilding });
  log.log(`Updated building ${newBuilding.name} (${newBuilding.id})`);

  return { ok: true, building: newBuilding };
}

/**
 * Delete a building. By default runs runtime cleanup (PM2 delete, Docker rm,
 * terminal teardown, DB tunnel close) before removing from the list.
 * Pass { cleanup: false } to skip cleanup (caller takes responsibility for orphan processes).
 * Also removes the deleted ID from any boss building's subordinate list.
 */
export async function deleteBuilding(
  id: string,
  broadcast: BroadcastFn,
  opts: { cleanup?: boolean } = {}
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const buildings = loadBuildings();
  const idx = buildings.findIndex(b => b.id === id);
  if (idx === -1) {
    return { ok: false, status: 404, error: `Building not found: ${id}` };
  }

  const building = buildings[idx];

  if (opts.cleanup !== false) {
    try {
      await executeCommand(id, 'delete', broadcast);
    } catch (err) {
      log.error(`Cleanup during delete failed for ${building.name}:`, err);
    }

    if (building.type === 'database') {
      for (const conn of building.database?.connections || []) {
        try {
          await databaseService.closeConnection(conn.id);
        } catch (err) {
          log.error(`Failed to close DB connection ${conn.id}:`, err);
        }
      }
    }
  }

  buildings.splice(idx, 1);

  // Drop dangling subordinate references in remaining boss buildings.
  for (const b of buildings) {
    if (b.type === 'boss' && b.subordinateBuildingIds?.includes(id)) {
      b.subordinateBuildingIds = b.subordinateBuildingIds.filter(sid => sid !== id);
    }
  }

  saveBuildings(buildings);
  broadcast({ type: 'building_deleted', payload: { id } });
  log.log(`Deleted building ${building.name} (${id})`);

  return { ok: true };
}

/**
 * Assign / replace the subordinates of a boss building.
 * Validates that the building is a boss and that all subordinate IDs exist.
 */
export async function assignSubordinates(
  bossId: string,
  subordinateBuildingIds: string[],
  broadcast: BroadcastFn
): Promise<CrudResult<Building>> {
  const buildings = loadBuildings();
  const idx = buildings.findIndex(b => b.id === bossId);
  if (idx === -1) {
    return { ok: false, status: 404, errors: [`Building not found: ${bossId}`] };
  }
  if (buildings[idx].type !== 'boss') {
    return { ok: false, status: 400, errors: [`Building ${bossId} is not a boss building`] };
  }

  const existingIds = new Set(buildings.map(b => b.id));
  const dangling = subordinateBuildingIds.filter(sid => !existingIds.has(sid));
  if (dangling.length > 0) {
    return {
      ok: false,
      status: 400,
      errors: [`subordinateBuildingIds reference unknown buildings: ${dangling.join(', ')}`],
    };
  }

  buildings[idx] = {
    ...buildings[idx],
    subordinateBuildingIds: [...subordinateBuildingIds],
    lastActivity: Date.now(),
  };
  saveBuildings(buildings);

  broadcast({ type: 'building_updated', payload: buildings[idx] });
  return { ok: true, building: buildings[idx] };
}

/**
 * Snapshot logs for a building. Returns logs as a string and the source
 * ('pm2' | 'docker' | 'custom' | 'none') so the caller can label them.
 */
export async function getBuildingLogs(
  id: string,
  lines: number = 200,
  service?: string
): Promise<
  | { ok: true; source: 'pm2' | 'docker' | 'custom' | 'none'; logs: string }
  | { ok: false; status: number; error: string }
> {
  const building = getBuilding(id);
  if (!building) {
    return { ok: false, status: 404, error: `Building not found: ${id}` };
  }

  if (building.pm2?.enabled) {
    const logs = await pm2Service.getLogs(building, lines);
    return { ok: true, source: 'pm2', logs };
  }

  if (building.docker?.enabled) {
    const logs = await dockerService.getLogs(building, lines, service);
    return { ok: true, source: 'docker', logs };
  }

  const customLogsCmd = building.commands?.logs;
  if (customLogsCmd) {
    try {
      const { stdout, stderr } = await execAsync(customLogsCmd, {
        cwd: building.cwd,
        maxBuffer: 1024 * 1024,
        timeout: 15000,
      });
      return { ok: true, source: 'custom', logs: stdout + (stderr ? `\n${stderr}` : '') };
    } catch (err: any) {
      return { ok: true, source: 'custom', logs: `Error running logs command: ${err.message}` };
    }
  }

  return { ok: true, source: 'none', logs: '' };
}
