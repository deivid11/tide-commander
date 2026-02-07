/**
 * Boss Handler
 * Handles boss agent operations including spawning, subordinate management, and delegation
 */

import { agentService, runtimeService, bossService } from '../../services/index.js';
import { createLogger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';
import { buildCustomAgentConfig } from './command-handler.js';
import type { AgentProvider, CodexConfig } from '../../../shared/types.js';

const log = createLogger('BossHandler');

/**
 * Handle spawn_boss_agent message
 */
export async function handleSpawnBossAgent(
  ctx: HandlerContext,
  payload: {
    name: string;
    class?: string;
    cwd: string;
    position?: { x: number; y: number; z: number };
    useChrome?: boolean;
    permissionMode?: string;
    provider?: AgentProvider;
    codexConfig?: CodexConfig;
    subordinateIds?: string[];
    model?: string;
    codexModel?: string;
    customInstructions?: string;
    initialSkillIds?: string[];
  }
): Promise<void> {
  try {
    const agent = await agentService.createAgent(
      payload.name,
      payload.class || 'boss', // Use selected class or default to 'boss'
      payload.cwd,
      payload.position,
      undefined, // sessionId - bosses start fresh
      payload.useChrome,
      payload.permissionMode as any,
      payload.initialSkillIds,
      true, // isBoss flag
      payload.model as any,
      payload.codexModel as any,
      payload.customInstructions,
      payload.provider,
      payload.codexConfig
    );

    // Assign initial subordinates if provided
    if (payload.subordinateIds && payload.subordinateIds.length > 0) {
      bossService.assignSubordinates(agent.id, payload.subordinateIds);
    }

    ctx.broadcast({
      type: 'agent_created',
      payload: agentService.getAgent(agent.id) || agent, // Get updated version with subordinates
    });
    ctx.sendActivity(agent.id, `Boss ${agent.name} deployed`);
  } catch (err: any) {
    log.error(' Failed to spawn boss agent:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle assign_subordinates message
 */
export function handleAssignSubordinates(
  ctx: HandlerContext,
  payload: { bossId: string; subordinateIds: string[] }
): void {
  try {
    bossService.assignSubordinates(payload.bossId, payload.subordinateIds);
    const boss = agentService.getAgent(payload.bossId);
    if (boss) {
      ctx.broadcast({
        type: 'boss_subordinates_updated',
        payload: {
          bossId: payload.bossId,
          subordinateIds: boss.subordinateIds || [],
        },
      });
      ctx.sendActivity(payload.bossId, `Team updated: ${payload.subordinateIds.length} subordinates`);
    }
  } catch (err: any) {
    log.error(' Failed to assign subordinates:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle remove_subordinate message
 */
export function handleRemoveSubordinate(
  ctx: HandlerContext,
  payload: { bossId: string; subordinateId: string }
): void {
  try {
    bossService.removeSubordinate(payload.bossId, payload.subordinateId);
    const boss = agentService.getAgent(payload.bossId);
    if (boss) {
      ctx.broadcast({
        type: 'boss_subordinates_updated',
        payload: {
          bossId: payload.bossId,
          subordinateIds: boss.subordinateIds || [],
        },
      });
    }
  } catch (err: any) {
    log.error(' Failed to remove subordinate:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle send_boss_command message (explicit delegation)
 */
export async function handleSendBossCommand(
  ctx: HandlerContext,
  payload: { bossId: string; command: string }
): Promise<void> {
  const { bossId, command } = payload;
  log.log(` Boss command: ${bossId} -> "${command.slice(0, 50)}..."`);

  try {
    const decision = await bossService.delegateCommand(bossId, command);

    // Send the command to the selected subordinate with its class instructions
    try {
      const targetAgent = agentService.getAgent(decision.selectedAgentId);
      const customAgentConfig = targetAgent ? buildCustomAgentConfig(decision.selectedAgentId, targetAgent.class) : undefined;
      await runtimeService.sendCommand(decision.selectedAgentId, command, undefined, undefined, customAgentConfig);
      ctx.sendActivity(bossId, `Delegated to ${decision.selectedAgentName}`);
    } catch (err: any) {
      log.error(' Failed to send delegated command:', err);
      ctx.sendActivity(bossId, `Delegation failed: ${err.message}`);
    }
  } catch (err: any) {
    log.error(' Delegation failed:', err);
    ctx.sendActivity(bossId, `Delegation error: ${err.message}`);
    ctx.sendError(`Delegation failed: ${err.message}`);
  }
}

/**
 * Handle request_delegation_history message
 */
export function handleRequestDelegationHistory(
  ctx: HandlerContext,
  payload: { bossId: string }
): void {
  const history = bossService.getDelegationHistory(payload.bossId);
  ctx.sendToClient({
    type: 'delegation_history',
    payload: {
      bossId: payload.bossId,
      decisions: history,
    },
  });
}
