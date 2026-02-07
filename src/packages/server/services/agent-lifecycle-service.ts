/**
 * Agent Lifecycle Service
 * Handles agent restart operations when skills or class instructions change
 */

import type { Agent, Skill } from '../../shared/types.js';
import * as agentService from './agent-service.js';
import * as runtimeService from './runtime-service.js';
import * as customClassService from './custom-class-service.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('AgentLifecycle');

/**
 * Callback type for activity notifications during restart
 */
export type ActivityCallback = (agentId: string, message: string) => void;

/**
 * Restart all agents using a given skill when the skill is updated.
 * An agent uses a skill if:
 * 1. The skill is directly assigned to the agent
 * 2. The skill is assigned to the agent's class
 * 3. The agent's custom class has the skill as a default
 */
export async function restartAgentsWithSkill(
  skill: Skill,
  sendActivity?: ActivityCallback
): Promise<void> {
  const allAgents = agentService.getAllAgents();
  const affectedAgents = allAgents.filter(agent => {
    // Check direct assignment
    if (skill.assignedAgentIds.includes(agent.id)) return true;

    // Check class assignment (skill assigned to agent's class)
    if (skill.assignedAgentClasses.includes(agent.class)) return true;

    // Check custom class default skills
    const customClass = customClassService.getCustomClass(agent.class);
    if (customClass?.defaultSkillIds?.includes(skill.id)) return true;

    return false;
  });

  if (affectedAgents.length === 0) {
    log.log(`🔄 No agents using skill "${skill.name}" to restart`);
    return;
  }

  log.log(`🔄 Restarting ${affectedAgents.length} agent(s) using skill "${skill.name}" due to skill update`);

  for (const agent of affectedAgents) {
    await restartAgent(agent, `skill "${skill.name}" updated`, sendActivity);
  }
}

/**
 * Restart all agents with a given class when the class instructions are updated.
 * This stops the agent's current session and clears the sessionId so the next
 * command will start a fresh session with the new instructions.
 */
export async function restartAgentsWithClass(
  classId: string,
  sendActivity?: ActivityCallback
): Promise<void> {
  const allAgents = agentService.getAllAgents();
  const affectedAgents = allAgents.filter(agent => agent.class === classId);

  if (affectedAgents.length === 0) {
    log.log(`🔄 No agents with class "${classId}" to restart`);
    return;
  }

  log.log(`🔄 Restarting ${affectedAgents.length} agent(s) with class "${classId}" due to instructions update`);

  for (const agent of affectedAgents) {
    await restartAgent(agent, 'class instructions updated', sendActivity);
  }
}

/**
 * Internal helper to restart a single agent
 */
async function restartAgent(
  agent: Agent,
  reason: string,
  sendActivity?: ActivityCallback
): Promise<void> {
  try {
    log.log(`🔄 Restarting agent ${agent.name} (${agent.id}) due to ${reason}`);

    // Stop the current process if running
    await runtimeService.stopAgent(agent.id);

    // Reset status but preserve sessionId - the session will resume with new instructions
    agentService.updateAgent(agent.id, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      // Note: sessionId is preserved - Claude will resume the existing session
      // with the new instructions/skills on the next command
    });

    // Notify the user
    sendActivity?.(agent.id, `Agent restarted - ${reason}`);

    log.log(`🔄 Agent ${agent.name} restarted successfully`);
  } catch (err) {
    log.error(`🔄 Failed to restart agent ${agent.name}:`, err);
    sendActivity?.(agent.id, `Failed to restart after ${reason}`);
  }
}
