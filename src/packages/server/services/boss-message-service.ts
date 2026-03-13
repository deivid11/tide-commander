/**
 * Boss Message Service
 * Builds context and instructions for boss agent commands
 */

import { BOSS_CONTEXT_START, BOSS_CONTEXT_END } from '../../shared/types.js';
import * as agentService from './agent-service.js';
import { buildBossContext } from './subordinate-context-service.js';

/**
 * Build minimal system prompt for boss agent.
 * The detailed instructions are injected in the user message instead.
 */
export function buildBossSystemPrompt(bossName: string, bossId: string): string {
  const agent = agentService.getAgent(bossId);
  const customInstructions = agent?.customInstructions;

  let prompt = `You are "${bossName}", a Boss Agent manager with ID \`${bossId}\`. You have access to all tools, but prefer delegating coding tasks to your subordinates when available. Use tools yourself only for quick lookups, exploration, or when you have no subordinates.

Your agent ID for notifications: ${bossId}`;

  // Append agent-specific custom instructions
  if (customInstructions) {
    prompt += `\n\n# Custom Instructions\n\n${customInstructions}`;
  }

  return prompt;
}

/**
 * Build the dynamic context to inject in user message for boss agents.
 * Only contains the "no subordinates" notice when team is empty.
 * Static boss instructions are now injected via the 'boss-instructions' built-in skill.
 */
export function buildBossInstructionsForMessage(bossName: string, hasSubordinates: boolean): string {
  if (!hasSubordinates) {
    return `# BOSS STATUS

You are "${bossName}", a Boss Agent in Tide Commander.

**CURRENT TEAM:** No subordinates assigned yet.

To be effective, you need subordinate agents assigned to your team. Ask the user to assign agents to you.`;
  }

  // When subordinates exist, static instructions come from the boss-instructions skill.
  // Only dynamic team context (built by buildBossContext) is injected per-message.
  return '';
}

/**
 * Build full boss message with instructions and context injected at the beginning.
 * Both instructions and context are wrapped in delimiters for the frontend to detect and collapse.
 */
export async function buildBossMessage(bossId: string, command: string): Promise<{ message: string; systemPrompt: string }> {
  const agent = agentService.getAgent(bossId);
  const bossName = agent?.name || 'Boss';

  const context = await buildBossContext(bossId);
  const hasSubordinates = context !== null;
  const systemPrompt = buildBossSystemPrompt(bossName, bossId);
  const instructions = buildBossInstructionsForMessage(bossName, hasSubordinates);

  if (!context) {
    // No subordinates - just inject instructions
    const message = `${BOSS_CONTEXT_START}
${instructions}
${BOSS_CONTEXT_END}

${command}`;
    return { message, systemPrompt };
  }

  // Inject dynamic team context at the beginning of the user message with delimiters.
  // Static boss instructions are injected once via the boss-instructions skill.
  const contextBlock = instructions ? `${instructions}\n\n${context}` : context;
  const message = `${BOSS_CONTEXT_START}
${contextBlock}
${BOSS_CONTEXT_END}

${command}`;

  return { message, systemPrompt };
}
