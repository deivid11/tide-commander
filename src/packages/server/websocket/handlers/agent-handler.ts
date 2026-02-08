/**
 * Agent Lifecycle Handler
 * Handles spawn, kill, stop, remove, rename, and update operations for agents
 */

import * as fs from 'fs';
import type { Agent, AgentProvider, CodexConfig } from '../../../shared/types.js';
import { agentService, runtimeService, skillService, customClassService, bossService, permissionService } from '../../services/index.js';
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
    provider?: AgentProvider;
    codexConfig?: CodexConfig;
    codexModel?: string;
    position?: { x: number; y: number; z: number };
    initialSkillIds?: string[];
    model?: string;
    customInstructions?: string;
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
    customInstructions: payload.customInstructions ? `${payload.customInstructions.length} chars` : undefined,
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
      payload.model as any,
      payload.codexModel as any,
      payload.customInstructions,
      payload.provider,
      payload.codexConfig
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

  // Cancel any pending permissions and notify clients
  const cancelledPermissions = permissionService.cancelRequestsForAgent(payload.agentId);
  for (const requestId of cancelledPermissions) {
    ctx.broadcast({
      type: 'permission_resolved',
      payload: { requestId, approved: false },
    });
  }

  await runtimeService.stopAgent(payload.agentId);
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

  // Cancel any pending permissions and notify clients
  const cancelledPermissions = permissionService.cancelRequestsForAgent(payload.agentId);
  for (const requestId of cancelledPermissions) {
    ctx.broadcast({
      type: 'permission_resolved',
      payload: { requestId, approved: false },
    });
  }

  await runtimeService.stopAgent(payload.agentId);
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

  await runtimeService.stopAgent(payload.agentId);
  agentService.updateAgent(payload.agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
    lastAssignedTask: undefined,
    lastAssignedTaskTime: undefined,
    sessionId: undefined, // Clear session to force new one
    tokensUsed: 0,
    contextUsed: 0,
    contextStats: undefined,
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
      await runtimeService.sendCommand(payload.agentId, '/compact');
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
  if (agent?.provider === 'codex') {
    const contextUsed = Math.max(0, Math.round(agent.contextUsed || 0));
    const contextLimit = Math.max(1, Math.round(agent.contextLimit || 200000));
    const usedPercent = Math.min(100, Math.round((contextUsed / contextLimit) * 100));
    const freePercent = 100 - usedPercent;

    ctx.broadcast({
      type: 'output',
      payload: {
        agentId: payload.agentId,
        text: `Context (estimated from Codex turn usage): ${(contextUsed / 1000).toFixed(1)}k/${(contextLimit / 1000).toFixed(1)}k (${freePercent}% free)`,
        isStreaming: false,
        timestamp: Date.now(),
      },
    });
    return;
  }

  if (agent && agent.status === 'idle') {
    try {
      await runtimeService.sendCommand(payload.agentId, '/context');
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
      provider?: AgentProvider;
      codexConfig?: CodexConfig;
      model?: string;
      codexModel?: string;
      useChrome?: boolean;
      skillIds?: string[];
      cwd?: string;
    };
  }
): Promise<void> {
  const { agentId, updates } = payload;
  const agent = agentService.getAgent(agentId);

  if (!agent) {
    ctx.sendError(`Agent not found: ${agentId}`);
    return;
  }

  const nextProvider = updates.provider ?? agent.provider;
  const normalizedUpdatedModel =
    updates.model !== undefined
      ? agentService.sanitizeModelForProvider(nextProvider, updates.model)
      : undefined;
  const normalizedUpdatedCodexModel =
    updates.codexModel !== undefined
      ? agentService.sanitizeCodexModel(updates.codexModel)
      : undefined;

  // Track if model changed (requires hot restart to apply new model while preserving context)
  const modelChanged = updates.model !== undefined && normalizedUpdatedModel !== agent.model;
  const codexModelChanged = updates.codexModel !== undefined && normalizedUpdatedCodexModel !== agent.codexModel;
  const providerChanged = updates.provider !== undefined && updates.provider !== agent.provider;
  const codexConfigChanged = updates.codexConfig !== undefined
    && JSON.stringify(updates.codexConfig || {}) !== JSON.stringify(agent.codexConfig || {});
  const sessionId = agent.sessionId; // Save before update

  // Track if Chrome flag changed (requires hot restart to add/remove --chrome flag)
  const useChromeChanged = updates.useChrome !== undefined && updates.useChrome !== agent.useChrome;

  // Track if cwd changed (requires hot restart to change working directory)
  const cwdChanged = updates.cwd !== undefined && updates.cwd !== agent.cwd;

  // Track if skills changed (requires hot restart to apply new skills in system prompt)
  let skillsChanged = false;
  if (updates.skillIds !== undefined) {
    const currentSkills = skillService.getSkillsForAgent(agentId, agent.class);
    const currentDirectSkillIds = currentSkills
      .filter(s => s.assignedAgentIds.includes(agentId))
      .map(s => s.id)
      .sort();
    const newSkillIds = [...updates.skillIds].sort();
    skillsChanged = JSON.stringify(currentDirectSkillIds) !== JSON.stringify(newSkillIds);
  }

  // Update agent properties
  const agentUpdates: Partial<Agent> = {};

  if (updates.class !== undefined) {
    agentUpdates.class = updates.class;
  }

  if (updates.permissionMode !== undefined) {
    agentUpdates.permissionMode = updates.permissionMode as any;
  }

  if (updates.provider !== undefined) {
    agentUpdates.provider = updates.provider;
  }

  if (updates.codexConfig !== undefined) {
    agentUpdates.codexConfig = updates.codexConfig;
  }

  if (updates.model !== undefined) {
    agentUpdates.model = normalizedUpdatedModel as any;
    if (nextProvider === 'claude' && normalizedUpdatedModel === undefined) {
      ctx.sendActivity(agentId, `Ignored unsupported Claude model "${updates.model}"`);
    }
  }

  if (updates.codexModel !== undefined) {
    agentUpdates.codexModel = normalizedUpdatedCodexModel as any;
  }

  if (updates.useChrome !== undefined) {
    agentUpdates.useChrome = updates.useChrome;
  }

  if (updates.cwd !== undefined) {
    // Validate directory exists
    if (!fs.existsSync(updates.cwd)) {
      ctx.sendError(`Directory does not exist: ${updates.cwd}`);
      return;
    }
    agentUpdates.cwd = updates.cwd;
  }

  // Apply agent property updates if any
  // agentService.updateAgent tracks pending property changes for notification on next command
  if (Object.keys(agentUpdates).length > 0) {
    agentService.updateAgent(agentId, agentUpdates, false);
  }

  // If model changed, do a hot restart: stop process, resume with new model
  // This preserves context by using --resume with the existing sessionId
  if ((modelChanged || codexModelChanged || providerChanged || codexConfigChanged) && sessionId) {
    const reason = providerChanged
      ? `runtime changed to ${updates.provider}`
      : codexConfigChanged
        ? 'Codex config changed'
        : codexModelChanged
          ? `Codex model changed to ${updates.codexModel}`
        : `model changed to ${updates.model}`;
    log.log(`Agent ${agent.name}: ${reason}, hot restarting with --resume to preserve context`);
    try {
      await runtimeService.stopAgent(agentId);
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
      }, false);
      ctx.sendActivity(agentId, `${reason} - context preserved`);
    } catch (err) {
      log.error(`Failed to hot restart agent ${agent.name} after runtime config change:`, err);
    }
  } else if ((modelChanged || codexModelChanged || providerChanged || codexConfigChanged) && !sessionId) {
    const reason = providerChanged
      ? `runtime changed to ${updates.provider}`
      : codexConfigChanged
        ? 'Codex config changed'
        : codexModelChanged
          ? `Codex model changed to ${updates.codexModel}`
        : `model changed to ${updates.model}`;
    log.log(`Agent ${agent.name}: ${reason}, will apply on next session start`);
  }

  // If Chrome flag changed, do a hot restart to add/remove --chrome flag
  // Only restart if model didn't already trigger a restart
  if (useChromeChanged && !modelChanged && !codexModelChanged && !providerChanged && !codexConfigChanged && sessionId) {
    const chromeStatus = updates.useChrome ? 'enabled' : 'disabled';
    log.log(`Agent ${agent.name}: Chrome ${chromeStatus}, hot restarting with --resume to apply change`);
    try {
      // Stop the current Claude process
      await runtimeService.stopAgent(agentId);

      // Mark as idle temporarily (the resume will happen on next command)
      // Keep sessionId to allow resume with chrome flag change
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        // Keep sessionId! This allows --resume to work with the new chrome setting
      }, false);

      ctx.sendActivity(agentId, `Chrome browser ${chromeStatus} - context preserved`);
    } catch (err) {
      log.error(`Failed to hot restart agent ${agent.name} after Chrome change:`, err);
    }
  } else if (useChromeChanged && !providerChanged && !codexConfigChanged && !codexModelChanged && !sessionId) {
    // No existing session, chrome flag will apply on next start
    const chromeStatus = updates.useChrome ? 'enabled' : 'disabled';
    log.log(`Agent ${agent.name}: Chrome ${chromeStatus}, will apply on next session start`);
  }

  // If cwd changed, stop the process and clear the session
  // Unlike model/chrome changes, cwd changes cannot preserve context because
  // Claude sessions are tied to the directory they were created in
  if (cwdChanged && sessionId) {
    log.log(`Agent ${agent.name}: Working directory changed to ${updates.cwd}, clearing session (cwd change requires new session)`);
    try {
      // Stop the current Claude process
      await runtimeService.stopAgent(agentId);

      // Mark as idle and CLEAR sessionId - cwd changes require a fresh session
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        sessionId: undefined, // Clear session - can't resume in different directory
        tokensUsed: 0,
        contextUsed: 0,
      }, false);

      ctx.sendActivity(agentId, `Working directory changed - new session will start on next command`);
    } catch (err) {
      log.error(`Failed to stop agent ${agent.name} after cwd change:`, err);
    }
  } else if (cwdChanged && !sessionId) {
    // No existing session, cwd will apply on next start
    log.log(`Agent ${agent.name}: Working directory changed to ${updates.cwd}, will apply on next session start`);
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

    // If skills changed and we didn't already hot restart for model/chrome/cwd change, do it now
    // Skills are injected into the system prompt, so we need to restart to apply them
    if (skillsChanged && !modelChanged && !codexModelChanged && !providerChanged && !codexConfigChanged && !useChromeChanged && !cwdChanged && sessionId) {
      log.log(`Agent ${agent.name}: Skills changed, hot restarting with --resume to apply new system prompt`);
      try {
        // Stop the current Claude process
        await runtimeService.stopAgent(agentId);

        // Mark as idle temporarily (the resume will happen on next command)
        // Keep sessionId to allow resume with new skills in system prompt
        agentService.updateAgent(agentId, {
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
          // Keep sessionId! This allows --resume to work with updated skills
        }, false);

        const newSkillCount = updates.skillIds.length;
        ctx.sendActivity(agentId, `Skills updated (${newSkillCount} skill${newSkillCount !== 1 ? 's' : ''}) - context preserved`);
      } catch (err) {
        log.error(`Failed to hot restart agent ${agent.name} after skill change:`, err);
      }
    } else if (skillsChanged && !sessionId) {
      // No existing session, skills will apply on next start
      log.log(`Agent ${agent.name}: Skills changed, will apply on next session start`);
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

/**
 * Handle reattach_agent message - reattach a detached agent to its existing session
 * Detached agents are those with running Claude processes that survived a server restart
 */
export async function handleReattachAgent(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  if (!agent) {
    log.error(` Agent not found: ${payload.agentId}`);
    ctx.sendError(`Agent not found: ${payload.agentId}`);
    return;
  }

  if (!agent.isDetached) {
    log.log(` Agent ${payload.agentId} is not detached, no action needed`);
    ctx.sendActivity(payload.agentId, 'Agent is already attached to the session');
    return;
  }

  if (!agent.sessionId) {
    log.error(` Cannot reattach agent ${payload.agentId} - no session ID available`);
    ctx.sendError(`Cannot reattach agent - no existing session found`);
    return;
  }

  try {
    log.log(` Reattaching agent ${payload.agentId} to existing session ${agent.sessionId}`);

    // Clear detached mode while preserving "working" status if this agent
    // already appears to be processing. This avoids flipping back/forth.
    const shouldRemainWorking = agent.status === 'working';
    agentService.updateAgent(payload.agentId, {
      isDetached: false,
      status: shouldRemainWorking ? 'working' : 'idle',
      currentTask: shouldRemainWorking ? (agent.currentTask || 'Processing...') : undefined,
      currentTool: undefined,
    });

    ctx.sendActivity(payload.agentId, `Reattached to existing session ${agent.sessionId}`);
    log.log(` Successfully reattached agent ${payload.agentId}`);
  } catch (err: any) {
    log.error(` Failed to reattach agent ${payload.agentId}:`, err);
    ctx.sendError(`Failed to reattach agent: ${err.message}`);
  }
}
