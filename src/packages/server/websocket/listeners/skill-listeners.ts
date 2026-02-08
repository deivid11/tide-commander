import type { CustomAgentClass, ServerMessage, Skill } from '../../../shared/types.js';
import { agentLifecycleService, customClassService, skillService } from '../../services/index.js';

interface SkillListenerContext {
  broadcast: (message: ServerMessage) => void;
  sendActivity: (agentId: string, message: string) => void;
}

export function setupSkillListeners(ctx: SkillListenerContext): void {
  skillService.subscribe((event, data) => {
    switch (event) {
      case 'created':
        ctx.broadcast({
          type: 'skill_created',
          payload: data as Skill,
        });
        break;
      case 'updated':
        ctx.broadcast({
          type: 'skill_updated',
          payload: data as Skill,
        });
        agentLifecycleService.restartAgentsWithSkill(data as Skill, ctx.sendActivity);
        break;
      case 'deleted':
        ctx.broadcast({
          type: 'skill_deleted',
          payload: { id: data as string },
        });
        break;
      case 'assigned':
        ctx.broadcast({
          type: 'skill_updated',
          payload: data as Skill,
        });
        break;
    }
  });

  customClassService.customClassEvents.on('created', (customClass: CustomAgentClass) => {
    ctx.broadcast({
      type: 'custom_agent_class_created',
      payload: customClass,
    });
  });

  customClassService.customClassEvents.on('updated', (customClass: CustomAgentClass) => {
    ctx.broadcast({
      type: 'custom_agent_class_updated',
      payload: customClass,
    });

    agentLifecycleService.restartAgentsWithClass(customClass.id, ctx.sendActivity);
  });

  customClassService.customClassEvents.on('deleted', (id: string) => {
    ctx.broadcast({
      type: 'custom_agent_class_deleted',
      payload: { id },
    });
  });
}
