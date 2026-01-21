/**
 * Agent Lifecycle Handler
 * Handles spawn, kill, stop, remove, rename, and update operations for agents
 */

import * as fs from 'fs';
import type { Agent } from '../../../shared/types.js';
import { agentService, claudeService, skillService, customClassService, bossService } from '../../services/index.js';
import { createLogger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

const log = createLogger('AgentHandler');

// Test change: Server restart validation - if you see this log, the server restarted successfully
log.log('🔄 AgentHandler loaded - server restart test');

/**
 * Unlink an agent from boss hierarchy before deletion.
 * If agent is a subordinate, remove from their boss.
 * If agent is a boss, unlink all their subordinates.
 */
export function unlinkAgentFromBossHierarchy(agentId: string): void {
  const agent = agentService.getAgent(agentId);
  if (!agent) return;

  // If this agent has a boss, remove from boss's subordinate list
  if (agent.bossId) {
    try {
      bossService.removeSubordinate(agent.bossId, agentId);
    } catch (err) {
      log.error(` Failed to unlink from boss: ${err}`);
    }
  }

  // If this agent is a boss, unlink all subordinates
  if ((agent.isBoss || agent.class === 'boss') && agent.subordinateIds?.length) {
    for (const subId of agent.subordinateIds) {
      try {
        // Clear the bossId from subordinate
        agentService.updateAgent(subId, { bossId: undefined });
      } catch (err) {
        log.error(` Failed to unlink subordinate ${subId}: ${err}`);
      }
    }
  }
}

/**
 * Handle spawn_agent message
 */
export async function handleSpawnAgent(
  ctx: HandlerContext,
  payload: {
    name: string;
    class: string;
    cwd: string;
    sessionId?: string;
    useChrome?: boolean;
    permissionMode?: string;
    position?: { x: number; y: number; z: number };
    initialSkillIds?: string[];
    model?: string;
  }
): Promise<void> {
  log.log('Request received:', {
    name: payload.name,
    class: payload.class,
    cwd: payload.cwd,
    sessionId: payload.sessionId,
    useChrome: payload.useChrome,
    permissionMode: payload.permissionMode,
    position: payload.position,
    initialSkillIds: payload.initialSkillIds,
    model: payload.model,
  });

  try {
    const agent = await agentService.createAgent(
      payload.name,
      payload.class,
      payload.cwd,
      payload.position,
      payload.sessionId,
      payload.useChrome,
      payload.permissionMode as any,
      undefined, // initialSkillIds handled separately below
      undefined, // isBoss
      payload.model as any
    );

    log.log('Agent created successfully:', {
      id: agent.id,
      name: agent.name,
      class: agent.class,
      sessionId: agent.sessionId,
    });

    // Assign initial skills if provided
    const initialSkillIds = payload.initialSkillIds || [];

    // Also get default skills from custom class if applicable
    const classDefaultSkills = customClassService.getClassDefaultSkillIds(agent.class);
    const allSkillIds = [...new Set([...initialSkillIds, ...classDefaultSkills])];

    if (allSkillIds.length > 0) {
      log.log(`Assigning ${allSkillIds.length} skills to ${agent.name}`);
      for (const skillId of allSkillIds) {
        skillService.assignSkillToAgent(skillId, agent.id);
      }
    }

    ctx.broadcast({
      type: 'agent_created',
      payload: agent,
    });

    ctx.sendActivity(agent.id, `${agent.name} deployed`);
  } catch (err: any) {
    log.error('Failed to spawn agent:', err);

    // Check if this is a directory not found error
    if (err.message?.includes('Directory does not exist')) {
      ctx.sendToClient({
        type: 'directory_not_found' as any,
        payload: {
          path: payload.cwd,
          name: payload.name,
          class: payload.class,
        },
      });
    } else {
      ctx.sendError(err.message);
    }
  }
}

/**
 * Handle kill_agent message - stops and deletes agent
 */
export async function handleKillAgent(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  log.log(`Agent ${agent?.name || payload.agentId}: User requested agent deletion`);

  await claudeService.stopAgent(payload.agentId);
  unlinkAgentFromBossHierarchy(payload.agentId);
  agentService.deleteAgent(payload.agentId);

  log.log(`Agent ${agent?.name || payload.agentId}: Agent deleted successfully`);
}

/**
 * Handle stop_agent message - stops current operation but keeps agent alive
 */
export async function handleStopAgent(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  log.log(`Agent ${agent?.name || payload.agentId}: Stop requested`);

  await claudeService.stopAgent(payload.agentId);
  agentService.updateAgent(payload.agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
  });
  ctx.sendActivity(payload.agentId, 'Operation cancelled');

  log.log(`Agent ${agent?.name || payload.agentId}: Stopped successfully, agent now idle`);
}

/**
 * Handle clear_context message - clears agent's context and forces new session
 */
export async function handleClearContext(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  log.log(`Agent ${agent?.name || payload.agentId}: User requested context clear`);

  await claudeService.stopAgent(payload.agentId);
  agentService.updateAgent(payload.agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
    sessionId: undefined, // Clear session to force new one
    tokensUsed: 0,
    contextUsed: 0,
  });
  ctx.sendActivity(payload.agentId, 'Context cleared - new session on next command');

  log.log(`Agent ${agent?.name || payload.agentId}: Context cleared, session reset`);
}

/**
 * Handle collapse_context message - sends /compact command to collapse context
 */
export async function handleCollapseContext(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  if (agent && agent.status === 'idle') {
    try {
      await claudeService.sendCommand(payload.agentId, '/compact');
      ctx.sendActivity(payload.agentId, 'Context collapse initiated');
    } catch (err) {
      log.error(` Failed to collapse context: ${err}`);
      ctx.sendActivity(payload.agentId, 'Failed to collapse context');
    }
  } else {
    ctx.sendActivity(payload.agentId, 'Cannot collapse context while agent is busy');
  }
}

/**
 * Handle request_context_stats message - requests detailed context breakdown
 */
export async function handleRequestContextStats(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  if (agent && agent.status === 'idle') {
    try {
      await claudeService.sendCommand(payload.agentId, '/context');
    } catch (err) {
      log.error(` Failed to request context stats: ${err}`);
    }
  } else {
    log.log(` Cannot request context stats while agent ${payload.agentId} is busy`);
  }
}

/**
 * Handle move_agent message
 */
export function handleMoveAgent(
  ctx: HandlerContext,
  payload: { agentId: string; position: { x: number; y: number; z: number } }
): void {
  // Don't update lastActivity for position changes
  agentService.updateAgent(payload.agentId, {
    position: payload.position,
  }, false);
}

/**
 * Handle remove_agent message - removes from persistence only
 */
export function handleRemoveAgent(
  ctx: HandlerContext,
  payload: { agentId: string }
): void {
  unlinkAgentFromBossHierarchy(payload.agentId);
  agentService.deleteAgent(payload.agentId);
}

/**
 * Handle rename_agent message
 */
export function handleRenameAgent(
  ctx: HandlerContext,
  payload: { agentId: string; name: string }
): void {
  // Don't update lastActivity for name changes
  agentService.updateAgent(payload.agentId, {
    name: payload.name,
  }, false);
}

/**
 * Handle update_agent_properties message
 */
export async function handleUpdateAgentProperties(
  ctx: HandlerContext,
  payload: {
    agentId: string;
    updates: {
      class?: string;
      permissionMode?: string;
      model?: string;
      useChrome?: boolean;
      skillIds?: string[];
    };
  }
): Promise<void> {
  const { agentId, updates } = payload;
  const agent = agentService.getAgent(agentId);

  if (!agent) {
    ctx.sendError(`Agent not found: ${agentId}`);
    return;
  }

  // Track if model changed (requires session restart)
  const modelChanged = updates.model !== undefined && updates.model !== agent.model;

  // Update agent properties
  const agentUpdates: Partial<Agent> = {};

  if (updates.class !== undefined) {
    agentUpdates.class = updates.class;
  }

  if (updates.permissionMode !== undefined) {
    agentUpdates.permissionMode = updates.permissionMode as any;
  }

  if (updates.model !== undefined) {
    agentUpdates.model = updates.model as any;
  }

  if (updates.useChrome !== undefined) {
    agentUpdates.useChrome = updates.useChrome;
  }

  // Apply agent property updates if any
  if (Object.keys(agentUpdates).length > 0) {
    agentService.updateAgent(agentId, agentUpdates, false);
  }

  // If model changed, restart the agent session
  if (modelChanged) {
    log.log(`Agent ${agent.name}: Model changed to ${updates.model}, restarting session`);
    try {
      await claudeService.stopAgent(agentId);
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        sessionId: undefined, // Clear session to force new one with new model
        tokensUsed: 0,
        contextUsed: 0,
      });
      ctx.sendActivity(agentId, `Session restarted - model changed to ${updates.model}`);
    } catch (err) {
      log.error(`Failed to restart agent ${agent.name} after model change:`, err);
    }
  }

  // Handle skill reassignment
  if (updates.skillIds !== undefined) {
    // First, unassign all current skills from this agent
    const currentSkills = skillService.getSkillsForAgent(agentId, agent.class);
    for (const skill of currentSkills) {
      // Only unassign if it's a direct assignment (not class-based)
      if (skill.assignedAgentIds.includes(agentId)) {
        skillService.unassignSkillFromAgent(skill.id, agentId);
      }
    }

    // Then assign the new skills
    for (const skillId of updates.skillIds) {
      skillService.assignSkillToAgent(skillId, agentId);
    }
  }

  log.log(`Updated agent properties for ${agent.name}: ${JSON.stringify(updates)}`);
}

/**
 * Handle create_directory message - creates directory then spawns agent
 */
export async function handleCreateDirectory(
  ctx: HandlerContext,
  payload: { path: string; name: string; class: string }
): Promise<void> {
  try {
    fs.mkdirSync(payload.path, { recursive: true });
    log.log(` Created directory: ${payload.path}`);

    const agent = await agentService.createAgent(
      payload.name,
      payload.class,
      payload.path
    );

    ctx.broadcast({
      type: 'agent_created',
      payload: agent,
    });
    ctx.sendActivity(agent.id, `${agent.name} deployed`);
  } catch (err: any) {
    log.error(' Failed to create directory:', err);
    ctx.sendError(`Failed to create directory: ${err.message}`);
  }
}
