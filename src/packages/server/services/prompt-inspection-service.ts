/**
 * Prompt Inspection Service
 *
 * Rebuilds the full prompt that gets injected into an agent so the user can
 * review exactly what the agent sees. Calls the same composition functions used
 * at agent-run time so the output stays faithful.
 *
 * Claude agents receive the prompt via --append-system-prompt-file (composed by
 * buildAppendedProjectInstructions). Codex agents receive it embedded in the
 * user message (composed by buildCodexPrompt). This service handles both.
 */

import * as agentService from './agent-service.js';
import { buildCustomAgentConfig } from '../websocket/handlers/command-handler.js';
import { buildAppendedProjectInstructions } from '../claude/backend.js';
import { buildCodexPrompt } from '../codex/backend.js';
import { buildOpencodePrompt } from '../opencode/backend.js';
import {
  buildBossSystemPrompt,
  buildBossInstructionsForMessage,
} from './boss-message-service.js';
import { buildBossContext } from './subordinate-context-service.js';
import { BOSS_CONTEXT_START, BOSS_CONTEXT_END } from '../../shared/types.js';
import type { BackendConfig } from '../claude/types.js';

const DYNAMIC_USER_REQUEST_PLACEHOLDER =
  '<Dynamic: the user message the agent is responding to goes here.>';

/**
 * Build the runtime system prompt that would be injected for a boss agent at the
 * time of inspection. The real prompt is built per-turn from the live team
 * context; this returns a representative snapshot.
 */
async function buildBossRuntimeSystemPrompt(bossId: string, bossName: string): Promise<string> {
  return buildBossSystemPrompt(bossName, bossId);
}

/**
 * Build the dynamic context block that is prepended to the user message for
 * boss agents. This reflects the current live team state at inspection time.
 */
async function buildBossContextBlock(bossId: string, bossName: string): Promise<string> {
  const context = await buildBossContext(bossId);
  const hasSubordinates = context !== null;
  const instructions = buildBossInstructionsForMessage(bossName, hasSubordinates);

  if (!context) {
    return `${BOSS_CONTEXT_START}\n${instructions}\n${BOSS_CONTEXT_END}`;
  }

  const contextBlock = instructions ? `${instructions}\n\n${context}` : context;
  return `${BOSS_CONTEXT_START}\n${contextBlock}\n${BOSS_CONTEXT_END}`;
}

/**
 * Compose the full injected prompt for an agent for inspection purposes.
 * Returns a markdown-friendly string that mirrors what the CLI actually receives.
 */
export async function buildInjectedPromptForAgent(agentId: string): Promise<string | null> {
  const agent = agentService.getAgent(agentId);
  if (!agent) return null;

  const customAgentConfig = buildCustomAgentConfig(agentId, agent.class);
  const isBoss = agent.isBoss || agent.class === 'boss';

  // Boss agents build their runtime system prompt + user-message context block
  // differently from regular agents. For regular agents the systemPrompt is
  // empty (they receive only the appended project instructions).
  let runtimeSystemPrompt = '';
  let bossContextBlock = '';
  if (isBoss) {
    runtimeSystemPrompt = await buildBossRuntimeSystemPrompt(agentId, agent.name);
    bossContextBlock = await buildBossContextBlock(agentId, agent.name);
  }

  const provider = agent.provider || 'claude';

  if (provider === 'codex') {
    const config: BackendConfig = {
      agentId,
      workingDir: agent.cwd,
      customAgent: customAgentConfig,
      systemPrompt: runtimeSystemPrompt,
      prompt: DYNAMIC_USER_REQUEST_PLACEHOLDER,
    };
    const composed = buildCodexPrompt(config);
    const header =
      '# Injected Prompt (Codex)\n\n' +
      '_The Codex backend embeds all injected instructions inside the user message. ' +
      'The `## User Request` section below is where each new user message is inserted per turn._\n';
    return `${header}\n\n${composed}`;
  }

  if (provider === 'opencode') {
    const config: BackendConfig = {
      agentId,
      workingDir: agent.cwd,
      customAgent: customAgentConfig,
      systemPrompt: runtimeSystemPrompt,
      prompt: DYNAMIC_USER_REQUEST_PLACEHOLDER,
    };
    const composed = buildOpencodePrompt(config);
    const header =
      '# Injected Prompt (OpenCode)\n\n' +
      '_OpenCode embeds all injected instructions inside the user message via stdin. ' +
      'The `## User Request` section below is where each new user message is inserted per turn._\n';
    return `${header}\n\n${composed}`;
  }

  // Claude (default)
  const config: BackendConfig = {
    agentId,
    workingDir: agent.cwd,
    customAgent: customAgentConfig,
    systemPrompt: runtimeSystemPrompt,
  };
  const appended = buildAppendedProjectInstructions(config);

  const sections: string[] = [];
  sections.push('# Injected Prompt (Claude)');
  sections.push(
    '_This is the exact content written to `--append-system-prompt-file` at agent launch. ' +
      'Claude also applies its own built-in system prompt before this block._',
  );
  sections.push('## Appended System Prompt');
  sections.push(appended);

  if (isBoss && bossContextBlock) {
    sections.push('---');
    sections.push('## Per-Turn Boss Context (injected into the user message)');
    sections.push(
      '_This block is rebuilt live on every user turn from the current team state, ' +
        'then wrapped in the boss-context delimiters and prepended to the user message._',
    );
    sections.push('```markdown');
    sections.push(bossContextBlock);
    sections.push('```');
  }

  return sections.join('\n\n');
}
