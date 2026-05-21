import type { AgentPrompt, ServerMessage } from '../../../shared/types.js';
import { agentPromptService } from '../../services/index.js';
import { logger } from '../../utils/index.js';

const log = logger.ws;

interface Context { broadcast: (m: ServerMessage) => void; }

export function setupAgentPromptListeners(ctx: Context): void {
  agentPromptService.subscribe((prompt: AgentPrompt) => {
    log.log(` Broadcasting agent_prompt_request: ${prompt.id} tool=${prompt.tool} agent=${prompt.agentId}`);
    ctx.broadcast({ type: 'agent_prompt_request', payload: prompt });
  });
  agentPromptService.subscribeResolved((requestId, approved) => {
    log.log(` Broadcasting agent_prompt_resolved: ${requestId} approved=${approved}`);
    ctx.broadcast({ type: 'agent_prompt_resolved', payload: { requestId, approved } });
  });
}
