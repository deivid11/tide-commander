import type { Agent, ServerMessage } from '../../../shared/types.js';
import { agentService } from '../../services/index.js';
import { setupBossListeners } from './boss-listeners.js';
import { setupPermissionListeners } from './permission-listeners.js';
import { setupRuntimeListeners } from './runtime-listeners.js';
import { setupSkillListeners } from './skill-listeners.js';
import { setupSupervisorListeners } from './supervisor-listeners.js';

interface ServiceListenerContext {
  broadcast: (message: ServerMessage) => void;
  sendActivity: (agentId: string, message: string) => void;
}

export function setupServiceListeners(ctx: ServiceListenerContext): void {
  agentService.subscribe((event, data) => {
    switch (event) {
      case 'created':
        break;
      case 'updated':
        ctx.broadcast({
          type: 'agent_updated',
          payload: data as Agent,
        });
        break;
      case 'deleted':
        ctx.broadcast({
          type: 'agent_deleted',
          payload: { id: data as string },
        });
        ctx.sendActivity(data as string, 'Agent terminated');
        break;
    }
  });

  setupRuntimeListeners(ctx);
  setupPermissionListeners(ctx);
  setupSupervisorListeners(ctx);
  setupBossListeners(ctx);
  setupSkillListeners(ctx);
}
