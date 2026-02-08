import type { ServerMessage } from '../../../shared/types.js';
import { supervisorService } from '../../services/index.js';

interface SupervisorListenerContext {
  broadcast: (message: ServerMessage) => void;
}

export function setupSupervisorListeners(ctx: SupervisorListenerContext): void {
  supervisorService.subscribe((event, data) => {
    switch (event) {
      case 'report':
        ctx.broadcast({
          type: 'supervisor_report',
          payload: data,
        } as ServerMessage);
        break;
      case 'agent_analysis':
        ctx.broadcast({
          type: 'agent_analysis',
          payload: data,
        } as ServerMessage);
        break;
      case 'narrative':
        ctx.broadcast({
          type: 'narrative_update',
          payload: data,
        } as ServerMessage);
        break;
      case 'config_changed':
        ctx.broadcast({
          type: 'supervisor_status',
          payload: supervisorService.getStatus(),
        } as ServerMessage);
        break;
      case 'global_usage':
        ctx.broadcast({
          type: 'global_usage',
          payload: data,
        } as ServerMessage);
        break;
    }
  });
}
