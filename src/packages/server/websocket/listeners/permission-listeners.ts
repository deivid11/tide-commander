import type { PermissionRequest, ServerMessage } from '../../../shared/types.js';
import { agentService, permissionService } from '../../services/index.js';
import { logger } from '../../utils/index.js';

const log = logger.ws;

interface PermissionListenerContext {
  broadcast: (message: ServerMessage) => void;
}

export function setupPermissionListeners(ctx: PermissionListenerContext): void {
  permissionService.subscribe((request: PermissionRequest) => {
    log.log(` Broadcasting permission_request: ${request.id} for tool ${request.tool}`);
    ctx.broadcast({
      type: 'permission_request',
      payload: request,
    });

    const agent = agentService.getAgent(request.agentId);
    if (agent) {
      agentService.updateAgent(request.agentId, {
        status: 'waiting',
        currentTask: `Waiting for permission: ${request.tool}`,
      });
    }
  });
}
