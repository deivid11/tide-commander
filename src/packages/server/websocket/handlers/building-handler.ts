/**
 * Building Handler
 * Handles building/infrastructure command operations via WebSocket
 */

import { buildingService } from '../../services/index.js';
import * as pm2Service from '../../services/pm2-service.js';
import * as dockerService from '../../services/docker-service.js';
import type { BuildingCommand, BossBuildingCommand } from '../../services/building-service.js';
import { createLogger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

// Track active boss log streams (bossBuildingId -> Set<subordinateBuildingId>)
const activeBossLogStreams = new Map<string, Set<string>>();

const log = createLogger('BuildingHandler');

/**
 * Handle building_command message
 */
export async function handleBuildingCommand(
  ctx: HandlerContext,
  payload: { buildingId: string; command: BuildingCommand }
): Promise<void> {
  const result = await buildingService.executeCommand(
    payload.buildingId,
    payload.command,
    ctx.broadcast
  );

  if (!result.success && result.error) {
    ctx.sendError(result.error);
  }
}

/**
 * Handle pm2_logs_start message - start streaming logs for a building
 */
export async function handlePM2LogsStart(
  ctx: HandlerContext,
  payload: { buildingId: string; lines?: number }
): Promise<void> {
  const { buildingId, lines = 100 } = payload;
  const building = buildingService.getBuilding(buildingId);

  if (!building) {
    ctx.sendError(`Building not found: ${buildingId}`);
    return;
  }

  if (!building.pm2?.enabled) {
    ctx.sendError(`Building ${building.name} is not PM2-managed`);
    return;
  }

  log.log(`Starting log stream for building: ${building.name}`);

  const { success, error } = pm2Service.startLogStream(building, {
    onChunk: (chunk: string, isError: boolean) => {
      ctx.broadcast({
        type: 'pm2_logs_chunk',
        payload: {
          buildingId,
          chunk,
          timestamp: Date.now(),
          isError,
        },
      });
    },
    onEnd: () => {
      log.log(`Log stream ended for building: ${building.name}`);
      ctx.broadcast({
        type: 'pm2_logs_streaming',
        payload: {
          buildingId,
          streaming: false,
        },
      });
    },
    onError: (errorMsg: string) => {
      log.error(`Log stream error for building ${building.name}: ${errorMsg}`);
      ctx.broadcast({
        type: 'pm2_logs_chunk',
        payload: {
          buildingId,
          chunk: `\x1b[31mStream error: ${errorMsg}\x1b[0m\n`,
          timestamp: Date.now(),
          isError: true,
        },
      });
    },
  }, lines);

  if (success) {
    ctx.broadcast({
      type: 'pm2_logs_streaming',
      payload: {
        buildingId,
        streaming: true,
      },
    });
  } else {
    ctx.sendError(`Failed to start log stream: ${error}`);
  }
}

/**
 * Handle pm2_logs_stop message - stop streaming logs for a building
 */
export function handlePM2LogsStop(
  ctx: HandlerContext,
  payload: { buildingId: string }
): void {
  const { buildingId } = payload;

  log.log(`Stopping log stream for building: ${buildingId}`);
  const stopped = pm2Service.stopLogStream(buildingId);

  if (stopped) {
    ctx.broadcast({
      type: 'pm2_logs_streaming',
      payload: {
        buildingId,
        streaming: false,
      },
    });
  }
}

// ============================================================================
// Docker Log Streaming Handlers
// ============================================================================

/**
 * Handle docker_logs_start message - start streaming logs for a Docker building
 */
export async function handleDockerLogsStart(
  ctx: HandlerContext,
  payload: { buildingId: string; lines?: number; service?: string }
): Promise<void> {
  const { buildingId, lines = 100, service } = payload;
  const building = buildingService.getBuilding(buildingId);

  if (!building) {
    ctx.sendError(`Building not found: ${buildingId}`);
    return;
  }

  if (!building.docker?.enabled) {
    ctx.sendError(`Building ${building.name} is not Docker-managed`);
    return;
  }

  log.log(`Starting Docker log stream for building: ${building.name}`);

  const { success, error } = await dockerService.startLogStream(building, {
    onChunk: (chunk: string, isError: boolean, svc?: string) => {
      ctx.broadcast({
        type: 'docker_logs_chunk',
        payload: {
          buildingId,
          chunk,
          timestamp: Date.now(),
          isError,
          service: svc,
        },
      });
    },
    onEnd: () => {
      log.log(`Docker log stream ended for building: ${building.name}`);
      ctx.broadcast({
        type: 'docker_logs_streaming',
        payload: {
          buildingId,
          streaming: false,
        },
      });
    },
    onError: (errorMsg: string) => {
      log.error(`Docker log stream error for building ${building.name}: ${errorMsg}`);
      ctx.broadcast({
        type: 'docker_logs_chunk',
        payload: {
          buildingId,
          chunk: `\x1b[31mStream error: ${errorMsg}\x1b[0m\n`,
          timestamp: Date.now(),
          isError: true,
        },
      });
    },
  }, lines, service);

  if (success) {
    ctx.broadcast({
      type: 'docker_logs_streaming',
      payload: {
        buildingId,
        streaming: true,
      },
    });
  } else {
    ctx.sendError(`Failed to start Docker log stream: ${error}`);
  }
}

/**
 * Handle docker_logs_stop message - stop streaming logs for a Docker building
 */
export function handleDockerLogsStop(
  ctx: HandlerContext,
  payload: { buildingId: string }
): void {
  const { buildingId } = payload;

  log.log(`Stopping Docker log stream for building: ${buildingId}`);
  const stopped = dockerService.stopLogStream(buildingId);

  if (stopped) {
    ctx.broadcast({
      type: 'docker_logs_streaming',
      payload: {
        buildingId,
        streaming: false,
      },
    });
  }
}

/**
 * Handle docker_list_containers message - list all existing Docker containers
 */
export async function handleDockerListContainers(
  ctx: HandlerContext
): Promise<void> {
  log.log('Listing Docker containers and compose projects');

  const [containers, composeProjects] = await Promise.all([
    dockerService.listAllContainers(),
    dockerService.listComposeProjects(),
  ]);

  log.log(`Found ${containers.length} containers, ${composeProjects.length} compose projects`);

  ctx.sendToClient({
    type: 'docker_containers_list',
    payload: {
      containers,
      composeProjects,
    },
  });
}

// ============================================================================
// Boss Building Handlers
// ============================================================================

/**
 * Handle boss_building_command message - execute command on all subordinates
 */
export async function handleBossBuildingCommand(
  ctx: HandlerContext,
  payload: { buildingId: string; command: BossBuildingCommand }
): Promise<void> {
  const { buildingId, command } = payload;

  log.log(`Boss building command: ${command} for building ${buildingId}`);

  const result = await buildingService.executeBossBuildingCommand(
    buildingId,
    command,
    ctx.broadcast
  );

  if (!result.success) {
    ctx.sendError(`Boss building command failed`);
  }
}

/**
 * Handle assign_buildings message - assign subordinates to a boss building
 */
export function handleAssignBuildings(
  ctx: HandlerContext,
  payload: { bossBuildingId: string; subordinateBuildingIds: string[] }
): void {
  const { bossBuildingId, subordinateBuildingIds } = payload;

  log.log(`Assigning ${subordinateBuildingIds.length} buildings to boss ${bossBuildingId}`);

  // The building update is handled via sync_buildings from client
  // Here we just broadcast the update notification
  ctx.broadcast({
    type: 'boss_building_subordinates_updated',
    payload: {
      bossBuildingId,
      subordinateBuildingIds,
    },
  });
}

/**
 * Handle boss_building_logs_start message - start unified log streaming
 * Streams logs from all subordinate buildings with source tagging
 */
export async function handleBossBuildingLogsStart(
  ctx: HandlerContext,
  payload: { buildingId: string; lines?: number }
): Promise<void> {
  const { buildingId, lines = 50 } = payload;

  const bossBuilding = buildingService.getBuilding(buildingId);
  if (!bossBuilding || bossBuilding.type !== 'boss') {
    ctx.sendError(`Building ${buildingId} is not a boss building`);
    return;
  }

  const subordinates = buildingService.getSubordinateBuildings(buildingId);
  const pm2Subordinates = subordinates.filter(s => s.pm2?.enabled);

  if (pm2Subordinates.length === 0) {
    log.log(`Boss building ${bossBuilding.name}: no PM2-enabled subordinates`);
    return;
  }

  log.log(`Boss building ${bossBuilding.name}: starting unified logs for ${pm2Subordinates.length} subordinates`);

  // Track active streams for this boss
  activeBossLogStreams.set(buildingId, new Set());
  const activeStreams = activeBossLogStreams.get(buildingId)!;

  // Start log streams for each subordinate
  for (const subordinate of pm2Subordinates) {
    const { success } = pm2Service.startLogStream(subordinate, {
      onChunk: (chunk: string, isError: boolean) => {
        ctx.broadcast({
          type: 'boss_building_logs_chunk',
          payload: {
            bossBuildingId: buildingId,
            subordinateBuildingId: subordinate.id,
            subordinateBuildingName: subordinate.name,
            chunk,
            timestamp: Date.now(),
            isError,
          },
        });
      },
      onEnd: () => {
        activeStreams.delete(subordinate.id);
        log.log(`Boss building: log stream ended for subordinate ${subordinate.name}`);
      },
      onError: (errorMsg: string) => {
        log.error(`Boss building: log stream error for ${subordinate.name}: ${errorMsg}`);
      },
    }, lines);

    if (success) {
      activeStreams.add(subordinate.id);
    }
  }
}

/**
 * Handle boss_building_logs_stop message - stop unified log streaming
 */
export function handleBossBuildingLogsStop(
  ctx: HandlerContext,
  payload: { buildingId: string }
): void {
  const { buildingId } = payload;

  log.log(`Boss building: stopping unified logs for ${buildingId}`);

  const activeStreams = activeBossLogStreams.get(buildingId);
  if (!activeStreams) {
    return;
  }

  // Stop all subordinate log streams
  for (const subordinateId of activeStreams) {
    pm2Service.stopLogStream(subordinateId);
  }

  activeBossLogStreams.delete(buildingId);
}
