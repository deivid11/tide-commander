/**
 * Command Handler
 * Handles sending commands to agents (both regular and boss agents)
 */

import { agentService, claudeService, skillService, customClassService } from '../../services/index.js';
import { createLogger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

const log = createLogger('CommandHandler');

/**
 * Track last boss commands for delegation parsing
 */
const lastBossCommands = new Map<string, string>();

/**
 * Get the last command sent to a boss agent
 */
export function getLastBossCommand(bossId: string): string | undefined {
  return lastBossCommands.get(bossId);
}

/**
 * Set the last command sent to a boss agent
 */
export function setLastBossCommand(bossId: string, command: string): void {
  lastBossCommands.set(bossId, command);
}

/**
 * Handle send_command message
 * Routes commands differently for boss agents vs regular agents
 */
export async function handleSendCommand(
  ctx: HandlerContext,
  payload: { agentId: string; command: string },
  buildBossMessage: (bossId: string, command: string) => Promise<{ message: string; systemPrompt: string }>
): Promise<void> {
  const { agentId, command } = payload;
  const agent = agentService.getAgent(agentId);

  if (!agent) {
    log.error(` Agent not found: ${agentId}`);
    return;
  }

  // If this is a boss agent, handle differently
  if (agent.isBoss || agent.class === 'boss') {
    await handleBossCommand(ctx, agentId, command, agent.name, buildBossMessage);
  } else {
    await handleRegularAgentCommand(ctx, agentId, command, agent);
  }
}

/**
 * Handle command for boss agents
 * Boss agents get context injected in the user message
 */
async function handleBossCommand(
  ctx: HandlerContext,
  agentId: string,
  command: string,
  agentName: string,
  buildBossMessage: (bossId: string, command: string) => Promise<{ message: string; systemPrompt: string }>
): Promise<void> {
  log.log(` Boss ${agentName} received command: "${command.slice(0, 50)}..."`);

  // Track the last command sent to this boss (for delegation parsing)
  lastBossCommands.set(agentId, command);

  // Detect if this is a team/status question vs a coding task
  const isTeamQuestion = /\b(subordinat|team|equipo|status|estado|hacen|doing|trabajando|working|progress|reporte|report|agentes|agents|chavos|who are you|hello|hola|hi\b)\b/i.test(command);

  try {
    // Boss agents get context injected in the user message with delimiters
    const { message: bossMessage, systemPrompt } = await buildBossMessage(agentId, command);
    claudeService.sendCommand(agentId, bossMessage, systemPrompt);
  } catch (err: any) {
    log.error(` Boss ${agentName}: failed to build boss message:`, err);
    // Fallback to sending raw command
    claudeService.sendCommand(agentId, command);
  }

  if (isTeamQuestion) {
    log.log(` Boss ${agentName}: detected team question`);
  } else {
    log.log(` Boss ${agentName}: detected coding task, delegation will be in response`);
  }
}

/**
 * Handle command for regular agents
 * Regular agents get custom class instructions and skills combined into a prompt
 */
async function handleRegularAgentCommand(
  ctx: HandlerContext,
  agentId: string,
  command: string,
  agent: { id: string; name: string; class: string }
): Promise<void> {
  // Build custom agent config combining:
  // 1. Custom class instructions (if any)
  // 2. Skills assigned to this agent (via class or directly)

  const classInstructions = customClassService.getClassInstructions(agent.class);
  const skillsContent = skillService.buildSkillPromptContent(agentId, agent.class);

  // Combine instructions and skills into a single prompt
  let combinedPrompt = '';
  if (classInstructions) {
    combinedPrompt += classInstructions;
  }
  if (skillsContent) {
    if (combinedPrompt) combinedPrompt += '\n\n';
    combinedPrompt += skillsContent;
  }

  // Build custom agent config if we have any instructions or skills
  let customAgentConfig: { name: string; definition: { description: string; prompt: string } } | undefined;
  if (combinedPrompt) {
    const customClass = customClassService.getCustomClass(agent.class);
    customAgentConfig = {
      name: customClass?.id || agent.class,
      definition: {
        description: customClass?.description || `Agent class: ${agent.class}`,
        prompt: combinedPrompt,
      },
    };
    log.log(` Agent ${agent.name} using custom agent config (${combinedPrompt.length} chars: ${classInstructions ? 'instructions' : ''}${classInstructions && skillsContent ? ' + ' : ''}${skillsContent ? 'skills' : ''})`);
  }

  try {
    await claudeService.sendCommand(agentId, command, undefined, undefined, customAgentConfig);
  } catch (err: any) {
    log.error(' Failed to send command:', err);
    ctx.sendActivity(agentId, `Error: ${err.message}`);
  }
}
