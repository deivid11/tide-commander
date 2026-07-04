import type { Agent, ServerMessage } from '../../../shared/types.js';
import { agentService } from '../../services/index.js';
import { setupBossListeners } from './boss-listeners.js';
import { setupPermissionListeners } from './permission-listeners.js';
import { setupAgentPromptListeners } from './agent-prompt-listeners.js';
import { setupRuntimeListeners } from './runtime-listeners.js';
import { setupSkillListeners } from './skill-listeners.js';

interface ServiceListenerContext {
  broadcast: (message: ServerMessage) => void;
  sendActivity: (agentId: string, message: string) => void;
}

export function setupServiceListeners(ctx: ServiceListenerContext): void {
  agentService.subscribe((event, data, meta) => {
    switch (event) {
      case 'created':
        break;
      case 'updated':
        // Quiet updates only changed high-churn metric fields (currentTool,
        // context tokens) — clients already get those through the lightweight
        // `context_update` and `event` messages, so skip the full-Agent
        // broadcast (fires several times per tool call during streaming).
        if (meta?.quiet) break;
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
  setupAgentPromptListeners(ctx);
  setupBossListeners(ctx);
  setupSkillListeners(ctx);
}
