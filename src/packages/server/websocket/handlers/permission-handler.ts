import type { ClientMessage } from '../../../shared/types.js';
import { permissionService } from '../../services/index.js';
import { logger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

const log = logger.ws;

type PermissionResponsePayload = Extract<ClientMessage, { type: 'permission_response' }>['payload'];

export function handlePermissionResponse(
  ctx: HandlerContext,
  payload: PermissionResponsePayload
): void {
  const { requestId, approved, reason, remember } = payload;
  log.log(` Permission response: ${requestId} -> ${approved ? 'approved' : 'denied'}${remember ? ' (remember)' : ''}`);

  const handled = permissionService.respondToPermissionRequest({
    requestId,
    approved,
    reason,
    remember,
  });

  if (handled) {
    ctx.broadcast({
      type: 'permission_resolved',
      payload: { requestId, approved },
    });
    return;
  }

  log.log(` No pending request found for ${requestId}`);
}
