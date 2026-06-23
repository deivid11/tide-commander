/**
 * OpenCode CLI Backend
 * Handles argument building and event parsing for the OpenCode CLI
 */

import { execSync } from 'child_process';
import type { CLIBackend, BackendConfig, StandardEvent } from '../claude/types.js';
import { OpencodeJsonEventParser } from './json-event-parser.js';
import { TIDE_COMMANDER_APPENDED_PROMPT } from '../prompts/tide-commander.js';
import { getSystemPrompt, isEchoPromptEnabled } from '../services/system-prompt-service.js';
import { consumeInstructionsDirty, isBareSlashCommand } from '../services/instruction-refresh.js';
import { loadAreas } from '../data/index.js';
import { createLogger } from '../utils/logger.js';

// Backend adapter for OpenCode CLI sessions.
const log = createLogger('OpencodeBackend');

interface OpencodeRawEvent {
  type?: string;
  sessionID?: string;
}

export function buildOpencodePrompt(config: BackendConfig): string {
  const userPrompt = config.prompt?.trim() || 'Continue the task.';
  // Bare slash commands (/compact, /clear, …) must reach the CLI verbatim — never
  // wrap them in the instruction block (or echo them), or the slash gets buried
  // under "## User Request" and the command is treated as text instead of running.
  if (isBareSlashCommand(userPrompt)) {
    return userPrompt;
  }
  // Echo Prompt: duplicate the user message for improved attention coverage.
  const echoedUserPrompt = isEchoPromptEnabled()
    ? userPrompt + '\n\n---\n\n' + userPrompt
    : userPrompt;

  // OpenCode has no system-prompt channel, so the instruction block lands inside
  // a user turn. On resume (-s <sessionId>) that block is already in the session's
  // conversation history from the first turn — re-injecting it every message would
  // duplicate it into the history and bloat the context window. So resumed turns
  // send only the user prompt; the full block is sent once when the session starts.
  // Exception: when an instruction source changed mid-session (skill edit, system
  // prompt update), re-inject the full block once so the change reaches the agent.
  const refreshInstructions = consumeInstructionsDirty(config.agentId);
  if (config.sessionId && !refreshInstructions) {
    return echoedUserPrompt;
  }

  const injectedSections: string[] = [];

  const systemLevelPrompt = getSystemPrompt().trim();
  if (systemLevelPrompt) {
    injectedSections.push(`## System-Level Custom Prompt\n${systemLevelPrompt}`);
  }

  // Area-level prompt
  if (config.agentId) {
    const areas = loadAreas();
    const agentArea = areas.find(a => a.assignedAgentIds.includes(config.agentId!));
    const areaPrompt = agentArea?.prompt?.trim();
    if (areaPrompt) {
      injectedSections.push(`## Area-Level Prompt (${agentArea!.name})\n${areaPrompt}`);
    }
  }

  const customPrompt = config.customAgent?.definition?.prompt?.trim();
  if (customPrompt) {
    injectedSections.push(`## Agent Instructions\n${customPrompt}`);
  }

  const systemPrompt = config.systemPrompt?.trim();
  if (systemPrompt) {
    injectedSections.push(`## System Context\n${systemPrompt}`);
  }

  injectedSections.push(TIDE_COMMANDER_APPENDED_PROMPT);

  return [
    'Follow all instructions below for this task.',
    ...injectedSections,
    '## User Request',
    echoedUserPrompt,
  ].join('\n\n');
}

export class OpencodeBackend implements CLIBackend {
  readonly name = 'opencode';
  private parser = new OpencodeJsonEventParser();
  private pendingStdinPrompt: string | undefined;

  buildArgs(config: BackendConfig): string[] {
    const args: string[] = ['run', '--format', 'json'];

    // Always skip permissions for autonomous agents
    args.push('--dangerously-skip-permissions');

    // Session resume
    if (config.sessionId) {
      args.push('-s', config.sessionId);
    }

    // Model selection
    if (config.model) {
      args.push('-m', config.model);
    }

    // Build and cache the full prompt for stdin delivery
    // (avoids exposing it in process list and handles large prompts safely)
    this.pendingStdinPrompt = buildOpencodePrompt(config);

    log.log(`buildArgs: ${args.length} args, sessionId=${config.sessionId ? 'yes' : 'no'}, model=${config.model || 'default'}`);
    return args;
  }

  parseEvent(rawEvent: unknown): StandardEvent | StandardEvent[] | null {
    const events = this.parser.parseEvent(rawEvent);
    if (events.length === 0) return null;
    return events.length === 1 ? events[0] : events;
  }

  extractSessionId(rawEvent: unknown): string | null {
    const event = rawEvent as OpencodeRawEvent;
    if (event?.sessionID && typeof event.sessionID === 'string') {
      return event.sessionID;
    }
    return null;
  }

  getExecutablePath(): string {
    return this.detectInstallation() || 'opencode';
  }

  detectInstallation(): string | null {
    try {
      const result = execSync('which opencode', { encoding: 'utf-8', timeout: 5000 }).trim();
      return result || null;
    } catch {
      return null;
    }
  }

  getExtraEnv(): Record<string, string> {
    return {};
  }

  requiresStdinInput(): boolean {
    return true;
  }

  shouldCloseStdinAfterPrompt(): boolean {
    return true;
  }

  supportsSessionResume(): boolean {
    return true;
  }

  formatStdinInput(_prompt: string): string {
    // Return the full prompt cached during buildArgs (includes system prompt, agent instructions, etc.)
    const fullPrompt = this.pendingStdinPrompt || _prompt;
    this.pendingStdinPrompt = undefined;

    return fullPrompt;
  }
}
