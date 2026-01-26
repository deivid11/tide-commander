/**
 * Skill Handler
 * Handles skill CRUD operations and assignment to agents
 */

import { agentService, skillService } from '../../services/index.js';
import { createLogger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

const log = createLogger('SkillHandler');

/**
 * Handle create_skill message
 */
export function handleCreateSkill(
  ctx: HandlerContext,
  payload: { name: string; description: string; content: string; assignedClasses?: string[] }
): void {
  try {
    const skill = skillService.createSkill(payload);
    ctx.broadcast({
      type: 'skill_created',
      payload: skill,
    });
    log.log(` Created skill: ${skill.name} (${skill.id})`);
  } catch (err: any) {
    log.error(' Failed to create skill:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle update_skill message
 */
export function handleUpdateSkill(
  ctx: HandlerContext,
  payload: { id: string; updates: Partial<{ name: string; description: string; content: string; assignedClasses: string[] }> }
): void {
  try {
    // Check if trying to modify a builtin skill's protected fields
    const existingSkill = skillService.getSkill(payload.id);
    if (existingSkill?.builtin) {
      const allowedKeys = ['assignedAgentIds', 'assignedAgentClasses', 'enabled'];
      const attemptedKeys = Object.keys(payload.updates);
      const disallowedKeys = attemptedKeys.filter(k => !allowedKeys.includes(k));

      if (disallowedKeys.length > 0) {
        ctx.sendError(`Cannot modify built-in skill "${existingSkill.name}". Only assignments and enabled status can be changed.`);
        return;
      }
    }

    const skill = skillService.updateSkill(payload.id, payload.updates);
    if (skill) {
      ctx.broadcast({
        type: 'skill_updated',
        payload: skill,
      });
      log.log(` Updated skill: ${skill.name} (${skill.id})`);
    } else {
      ctx.sendError(`Skill not found: ${payload.id}`);
    }
  } catch (err: any) {
    log.error(' Failed to update skill:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle delete_skill message
 */
export function handleDeleteSkill(
  ctx: HandlerContext,
  payload: { id: string }
): void {
  try {
    // Check if trying to delete a builtin skill
    const existingSkill = skillService.getSkill(payload.id);
    if (existingSkill?.builtin) {
      ctx.sendError(`Cannot delete built-in skill "${existingSkill.name}". Built-in skills are part of Tide Commander.`);
      return;
    }

    const deleted = skillService.deleteSkill(payload.id);
    if (deleted) {
      ctx.broadcast({
        type: 'skill_deleted',
        payload: { id: payload.id },
      });
      log.log(` Deleted skill: ${payload.id}`);
    } else {
      ctx.sendError(`Skill not found: ${payload.id}`);
    }
  } catch (err: any) {
    log.error(' Failed to delete skill:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle assign_skill message
 */
export function handleAssignSkill(
  ctx: HandlerContext,
  payload: { skillId: string; agentId: string }
): void {
  try {
    const skill = skillService.assignSkillToAgent(payload.skillId, payload.agentId);
    if (skill) {
      ctx.broadcast({
        type: 'skill_updated',
        payload: skill,
      });
      log.log(` Assigned skill ${skill.name} to agent ${payload.agentId}`);
    } else {
      ctx.sendError(`Skill not found: ${payload.skillId}`);
    }
  } catch (err: any) {
    log.error(' Failed to assign skill:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle unassign_skill message
 */
export function handleUnassignSkill(
  ctx: HandlerContext,
  payload: { skillId: string; agentId: string }
): void {
  try {
    const skill = skillService.unassignSkillFromAgent(payload.skillId, payload.agentId);
    if (skill) {
      ctx.broadcast({
        type: 'skill_updated',
        payload: skill,
      });
      log.log(` Unassigned skill ${skill.name} from agent ${payload.agentId}`);
    } else {
      ctx.sendError(`Skill not found: ${payload.skillId}`);
    }
  } catch (err: any) {
    log.error(' Failed to unassign skill:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle request_agent_skills message
 */
export function handleRequestAgentSkills(
  ctx: HandlerContext,
  payload: { agentId: string }
): void {
  const agent = agentService.getAgent(payload.agentId);
  if (agent) {
    const skills = skillService.getSkillsForAgent(agent.id, agent.class);
    ctx.sendToClient({
      type: 'agent_skills',
      payload: {
        agentId: payload.agentId,
        skills,
      },
    });
  } else {
    ctx.sendError(`Agent not found: ${payload.agentId}`);
  }
}
