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
 * Build customAgentConfig for an agent based on its class instructions and skills
 * Returns undefined if no instructions or skills are configured
 */
export function buildCustomAgentConfig(agentId: string, agentClass: string): { name: string; definition: { description: string; prompt: string } } | undefined {
  // Skip boss agents - they have their own prompt handling
  if (agentClass === 'boss') {
    return undefined;
  }

  const classInstructions = customClassService.getClassInstructions(agentClass);
  const skillsContent = skillService.buildSkillPromptContent(agentId, agentClass);

  // Combine instructions and skills into a single prompt
  let combinedPrompt = '';
  if (classInstructions) {
    combinedPrompt += classInstructions;
  }
  if (skillsContent) {
    if (combinedPrompt) combinedPrompt += '\n\n';
    combinedPrompt += skillsContent;
  }

  if (!combinedPrompt) {
    return undefined;
  }

  const customClass = customClassService.getCustomClass(agentClass);
  return {
    name: customClass?.id || agentClass,
    definition: {
      description: customClass?.description || `Agent class: ${agentClass}`,
      prompt: combinedPrompt,
    },
  };
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

  // Handle /clear command - clear session and start fresh
  if (command.trim() === '/clear') {
    log.log(`Agent ${agent.name}: /clear command - clearing session`);
    await claudeService.stopAgent(agentId);
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      sessionId: undefined,
      tokensUsed: 0,
      contextUsed: 0,
    });
    ctx.sendActivity(agentId, 'Session cleared - new session on next command');
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
  const customAgentConfig = buildCustomAgentConfig(agentId, agent.class);

  if (customAgentConfig) {
    log.log(` Agent ${agent.name} customAgentConfig: name=${customAgentConfig.name}, promptLen=${customAgentConfig.definition.prompt.length}`);
  } else {
    log.log(` Agent ${agent.name} NO customAgentConfig (no instructions or skills)`);
  }

  try {
    await claudeService.sendCommand(agentId, command, undefined, undefined, customAgentConfig);
  } catch (err: any) {
    log.error(' Failed to send command:', err);
    ctx.sendActivity(agentId, `Error: ${err.message}`);
  }
}
