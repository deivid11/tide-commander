import type { ClientMessage, ServerMessage } from '../../../shared/types.js';
import { saveAreas, saveBuildings, loadAreas, deleteAreaLogo } from '../../data/index.js';
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
  // Clean up orphaned logo files before saving
  try {
    const previousAreas = loadAreas();
    const newAreaIds = new Set(payload.map(a => a.id));

    for (const prev of previousAreas) {
      // Area was deleted and had a logo
      if (!newAreaIds.has(prev.id) && prev.logo?.filename) {
        deleteAreaLogo(prev.logo.filename);
      }
    }

    for (const area of payload) {
      const prev = previousAreas.find(p => p.id === area.id);
      if (!prev?.logo?.filename) continue;

      // Logo was removed from area
      if (!area.logo?.filename) {
        deleteAreaLogo(prev.logo.filename);
      }
      // Logo was replaced with a different file
      else if (area.logo.filename !== prev.logo.filename) {
        deleteAreaLogo(prev.logo.filename);
      }
    }
  } catch (err) {
    log.error(' Failed to clean up area logos:', err);
  }

  handleSyncMessage(ctx, payload, 'areas', saveAreas, 'areas_update');
}

export async function handleSyncBuildings(
  ctx: HandlerContext,
  payload: SyncBuildingsPayload
): Promise<void> {
  await buildingService.handleBuildingSync(payload, ctx.broadcast);
  handleSyncMessage(ctx, payload, 'buildings', saveBuildings, 'buildings_update');
}
