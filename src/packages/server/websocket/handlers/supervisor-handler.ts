import type { ClientMessage } from '../../../shared/types.js';
import { supervisorService } from '../../services/index.js';
import { createLogger, logger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

const log = logger.ws;
const supervisorLog = createLogger('Supervisor');

type SetSupervisorConfigPayload = Extract<ClientMessage, { type: 'set_supervisor_config' }>['payload'];
type RequestAgentSupervisorHistoryPayload = Extract<ClientMessage, { type: 'request_agent_supervisor_history' }>['payload'];

export function handleSetSupervisorConfig(
  _ctx: HandlerContext,
  payload: SetSupervisorConfigPayload
): void {
  supervisorService.setConfig(payload);
}

export async function handleRequestSupervisorReport(
  ctx: HandlerContext,
  _payload: Record<string, never>
): Promise<void> {
  supervisorLog.log('Report requested by frontend');

  try {
    const report = await supervisorService.generateReport();
    ctx.sendToClient({
      type: 'supervisor_report',
      payload: report,
    });
  } catch (err: any) {
    log.error(' Supervisor report failed:', err);
    ctx.sendError(`Supervisor report failed: ${err.message}`);
  }
}

export function handleRequestAgentSupervisorHistory(
  ctx: HandlerContext,
  payload: RequestAgentSupervisorHistoryPayload
): void {
  const history = supervisorService.getAgentSupervisorHistory(payload.agentId);
  ctx.sendToClient({
    type: 'agent_supervisor_history',
    payload: history,
  });
}

export async function handleRequestGlobalUsage(
  ctx: HandlerContext,
  _payload: Record<string, never>
): Promise<void> {
  const cachedUsage = supervisorService.getGlobalUsage();
  if (cachedUsage) {
    ctx.sendToClient({
      type: 'global_usage',
      payload: cachedUsage,
    });
  }

  const agentId = await supervisorService.requestUsageRefresh();
  if (!agentId && !cachedUsage) {
    ctx.sendToClient({
      type: 'global_usage',
      payload: null,
    });
  }
}
