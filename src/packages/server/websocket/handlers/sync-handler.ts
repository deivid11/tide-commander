import type { ClientMessage, ServerMessage } from '../../../shared/types.js';
import { saveAreas, saveBuildings } from '../../data/index.js';
import { buildingService } from '../../services/index.js';
import { logger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

const log = logger.ws;

type SyncAreasPayload = Extract<ClientMessage, { type: 'sync_areas' }>['payload'];
type SyncBuildingsPayload = Extract<ClientMessage, { type: 'sync_buildings' }>['payload'];

function handleSyncMessage<T>(
  ctx: HandlerContext,
  payload: T[],
  entityName: string,
  saveFn: (data: T[]) => void,
  updateType: ServerMessage['type']
): void {
  saveFn(payload);
  log.log(` Saved ${payload.length} ${entityName}`);

  ctx.broadcastToOthers({
    type: updateType,
    payload,
  } as ServerMessage);
}

export function handleSyncAreas(
  ctx: HandlerContext,
  payload: SyncAreasPayload
): void {
  handleSyncMessage(ctx, payload, 'areas', saveAreas, 'areas_update');
}

export async function handleSyncBuildings(
  ctx: HandlerContext,
  payload: SyncBuildingsPayload
): Promise<void> {
  await buildingService.handleBuildingSync(payload, ctx.broadcast);
  handleSyncMessage(ctx, payload, 'buildings', saveBuildings, 'buildings_update');
}
