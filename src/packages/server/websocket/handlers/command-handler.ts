/**
 * Command Handler
 * Handles sending commands to agents (both regular and boss agents)
 */

import { agentService, runtimeService, skillService, customClassService } from '../../services/index.js';
import { createLogger } from '../../utils/index.js';
import { getAuthToken, isAuthEnabled } from '../../auth/index.js';
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
 * Build the agent identity header with ID and name
 * This helps agents know who they are for notifications and other self-referential tasks
 */
function buildAgentIdentityHeader(agentId: string): string {
  const agent = agentService.getAgent(agentId);
  const agentName = agent?.name || 'Unknown';
  const authToken = getAuthToken();
  const authHeader = authToken ? ` -H "X-Auth-Token: ${authToken}"` : '';

  return `# Agent Identity

You are agent **${agentName}** with ID \`${agentId}\`.

Use this ID when sending notifications via the Tide Commander API:
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json"${authHeader} -d '{"agentId":"${agentId}","title":"Title","message":"Message"}'
\`\`\`

---

`;
}

/**
 * Build customAgentConfig for an agent based on its class instructions, skills, and custom instructions
 * Returns undefined if no instructions or skills are configured
 */
export function buildCustomAgentConfig(agentId: string, agentClass: string): { name: string; definition: { description: string; prompt: string } } | undefined {
  // Skip boss agents - they have their own prompt handling
  if (agentClass === 'boss') {
    return undefined;
  }

  const agent = agentService.getAgent(agentId);
  const classInstructions = customClassService.getClassInstructions(agentClass);
  const skillsContent = skillService.buildSkillPromptContent(agentId, agentClass);
  const customInstructions = agent?.customInstructions;

  // Always include agent identity header so agents know their ID
  let combinedPrompt = buildAgentIdentityHeader(agentId);

  if (classInstructions) {
    combinedPrompt += classInstructions;
  }
  if (skillsContent) {
    if (classInstructions) combinedPrompt += '\n\n';
    combinedPrompt += skillsContent;
  }

  // Append agent-specific custom instructions at the end
  if (customInstructions) {
    combinedPrompt += '\n\n# Custom Instructions\n\n';
    combinedPrompt += customInstructions;
  }

  // Even if no class instructions or skills, we still return the config with identity header
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
    await runtimeService.stopAgent(agentId);
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      sessionId: undefined,
      tokensUsed: 0,
      contextUsed: 0,
      contextStats: undefined, // Clear context stats since session is reset
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
    runtimeService.sendCommand(agentId, bossMessage, systemPrompt);
  } catch (err: any) {
    log.error(` Boss ${agentName}: failed to build boss message:`, err);
    // Fallback to sending raw command
    runtimeService.sendCommand(agentId, command);
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
  agent: { id: string; name: string; class: string; provider?: 'claude' | 'codex'; contextUsed?: number; contextLimit?: number }
): Promise<void> {
  const trimmedCommand = command.trim();
  if (agent.provider === 'codex' && (trimmedCommand === '/context' || trimmedCommand === '/cost' || trimmedCommand === '/compact')) {
    const contextUsed = Math.max(0, Math.round(agent.contextUsed || 0));
    const contextLimit = Math.max(1, Math.round(agent.contextLimit || 200000));
    const usedPercent = Math.min(100, Math.round((contextUsed / contextLimit) * 100));
    const freePercent = 100 - usedPercent;

    ctx.broadcast({
      type: 'output',
      payload: {
        agentId,
        text: `Context (estimated from Codex turn usage): ${(contextUsed / 1000).toFixed(1)}k/${(contextLimit / 1000).toFixed(1)}k (${freePercent}% free)`,
        isStreaming: false,
        timestamp: Date.now(),
      },
    });
    return;
  }

  const customAgentConfig = buildCustomAgentConfig(agentId, agent.class);

  if (customAgentConfig) {
    log.log(` Agent ${agent.name} customAgentConfig: name=${customAgentConfig.name}, promptLen=${customAgentConfig.definition.prompt.length}`);
  } else {
    log.log(` Agent ${agent.name} NO customAgentConfig (no instructions or skills)`);
  }

  // Check if agent has pending updates - inject into message if so
  let finalCommand = command;

  // Property updates (class, permissionMode, useChrome)
  if (agentService.hasPendingPropertyUpdates(agentId)) {
    const propertyNotification = agentService.buildPropertyUpdateNotification(agentId);
    if (propertyNotification) {
      finalCommand = propertyNotification + finalCommand;
      log.log(` Agent ${agent.name}: Injecting property update notification (${propertyNotification.length} chars)`);
    }
    agentService.clearPendingPropertyUpdates(agentId);
  }

  // Skill updates - send as UI notification instead of injecting into conversation
  if (skillService.hasPendingSkillUpdates(agentId)) {
    const skillUpdateData = skillService.getSkillUpdateData(agentId, agent.class as import('../../../shared/types.js').AgentClass);
    if (skillUpdateData) {
      // Send skill update as a special output message for UI rendering
      ctx.broadcast({
        type: 'output',
        payload: {
          agentId,
          text: '', // Empty text - the UI will render the skillUpdate data
          isStreaming: false,
          timestamp: Date.now(),
          skillUpdate: skillUpdateData,
        },
      });
      log.log(` Agent ${agent.name}: Sent skill update notification (${skillUpdateData.skills.length} skills)`);
    }
    skillService.clearPendingSkillUpdates(agentId);
  }

  try {
    await runtimeService.sendCommand(agentId, finalCommand, undefined, undefined, customAgentConfig);
  } catch (err: any) {
    log.error(' Failed to send command:', err);
    ctx.sendActivity(agentId, `Error: ${err.message}`);
  }
}
