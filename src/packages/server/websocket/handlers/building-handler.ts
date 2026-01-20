/**
 * Building Handler
 * Handles building/infrastructure command operations via WebSocket
 */

import { buildingService } from '../../services/index.js';
import type { BuildingCommand } from '../../services/building-service.js';
import { createLogger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

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
