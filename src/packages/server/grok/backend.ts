/**
 * Grok CLI Backend (headless mode)
 *
 * Spawns: grok -p … --output-format streaming-json [--yolo] [--resume id] …
 * Large prompts go through --prompt-file (Grok does not read the prompt from stdin).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CLIBackend, BackendConfig, StandardEvent } from '../claude/types.js';
import { GrokJsonEventParser } from './json-event-parser.js';
import { TIDE_COMMANDER_APPENDED_PROMPT } from '../prompts/tide-commander.js';
import { getSystemPrompt, isEchoPromptEnabled } from '../services/system-prompt-service.js';
import { consumeInstructionsDirty, isBareSlashCommand } from '../services/instruction-refresh.js';
import { loadAreas } from '../data/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GrokBackend');

interface GrokRawEvent {
  type?: string;
  sessionId?: string;
}

/** Prompt size above which we switch from -p to --prompt-file (argv safety). */
const PROMPT_FILE_THRESHOLD = 4000;

export function buildGrokPrompt(config: BackendConfig): string {
  const userPrompt = config.prompt?.trim() || 'Continue the task.';
  // Bare slash commands must reach the CLI verbatim.
  if (isBareSlashCommand(userPrompt)) {
    return userPrompt;
  }

  const echoedUserPrompt = isEchoPromptEnabled()
    ? userPrompt + '\n\n---\n\n' + userPrompt
    : userPrompt;

  // On resume the instruction block is already in session history — only
  // re-inject when an instruction source was dirtied mid-session.
  const refreshInstructions = consumeInstructionsDirty(config.agentId);
  if (config.sessionId && !refreshInstructions) {
    return echoedUserPrompt;
  }

  const injectedSections: string[] = [];

  const systemLevelPrompt = getSystemPrompt().trim();
  if (systemLevelPrompt) {
    injectedSections.push(`## System-Level Custom Prompt\n${systemLevelPrompt}`);
  }

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

function shouldPassGrokModel(model: string | undefined): model is string {
  if (!model) return false;
  // Reject Claude/Codex short names that may leak across provider switches
  if (
    model === 'sonnet' ||
    model === 'opus' ||
    model === 'haiku' ||
    model === 'codex' ||
    model.startsWith('claude-') ||
    model.startsWith('gpt-')
  ) {
    return false;
  }
  return true;
}

export class GrokBackend implements CLIBackend {
  readonly name = 'grok';
  // ONE GrokBackend serves every Grok agent — parser state (stream uuids,
  // accumulated text for breakOpenStreams) must be per agent or concurrent
  // agents leak each other's text into their finalize events.
  private parsers = new Map<string, GrokJsonEventParser>();

  private parserFor(agentId?: string): GrokJsonEventParser {
    const key = agentId || '__default';
    let parser = this.parsers.get(key);
    if (!parser) {
      parser = new GrokJsonEventParser();
      this.parsers.set(key, parser);
    }
    return parser;
  }
  /** Temp prompt files created for this process; cleaned after formatStdin (no-op) or next buildArgs. */
  private lastPromptFile: string | undefined;

  buildArgs(config: BackendConfig): string[] {
    // Clean previous prompt file if any (best-effort)
    this.cleanupPromptFile();

    const prompt = buildGrokPrompt(config);
    const args: string[] = ['--output-format', 'streaming-json', '--no-auto-update'];

    // Autonomous by default (matches OpenCode/Codex Tide defaults). Interactive
    // mode still uses yolo for headless — Grok can't prompt through our UI yet.
    if (config.permissionMode !== 'interactive') {
      args.push('--yolo');
    } else {
      // Interactive still needs unattended tool approval for headless; use
      // always-approve so runs don't hang waiting for a TTY prompt.
      args.push('--always-approve');
    }

    if (config.workingDir) {
      args.push('--cwd', config.workingDir);
    }

    if (shouldPassGrokModel(config.model)) {
      args.push('-m', config.model);
    }

    if (config.effort) {
      // Map Tide effort labels to Grok reasoning-effort values
      const effortMap: Record<string, string> = {
        low: 'low',
        medium: 'medium',
        high: 'high',
        xHigh: 'xhigh',
        max: 'max',
      };
      const mapped = effortMap[config.effort] || config.effort.toLowerCase();
      args.push('--reasoning-effort', mapped);
    }

    // Session resume / fork
    if (config.sessionId) {
      args.push('--resume', config.sessionId);
      if (config.forkSession) {
        args.push('--fork-session');
      }
    }

    // Prompt delivery: -p for small prompts, --prompt-file for large ones
    // (Grok does not read the prompt from stdin).
    if (prompt.length > PROMPT_FILE_THRESHOLD) {
      const promptFile = path.join(
        os.tmpdir(),
        `tide-grok-prompt-${config.agentId || 'anon'}-${Date.now()}.txt`
      );
      fs.writeFileSync(promptFile, prompt, 'utf-8');
      this.lastPromptFile = promptFile;
      args.push('--prompt-file', promptFile);
      log.log(`buildArgs: prompt via file (${prompt.length} chars) sessionId=${config.sessionId ? 'yes' : 'no'}`);
    } else {
      args.push('-p', prompt);
      log.log(`buildArgs: prompt via -p (${prompt.length} chars) sessionId=${config.sessionId ? 'yes' : 'no'}`);
    }

    return args;
  }

  parseEvent(rawEvent: unknown, agentId?: string): StandardEvent | StandardEvent[] | null {
    const events = this.parserFor(agentId).parseEvent(rawEvent);
    if (events.length === 0) return null;
    return events.length === 1 ? events[0] : events;
  }

  /** See CLIBackend.breakOpenStreams — tool-boundary stream split for Grok. */
  breakOpenStreams(agentId?: string): StandardEvent[] {
    return this.parserFor(agentId).breakOpenStreams();
  }

  extractSessionId(rawEvent: unknown): string | null {
    const event = rawEvent as GrokRawEvent;
    if (event?.sessionId && typeof event.sessionId === 'string') {
      return event.sessionId;
    }
    // end event also carries sessionId
    if (event?.type === 'end' && typeof (event as { sessionId?: string }).sessionId === 'string') {
      return (event as { sessionId: string }).sessionId;
    }
    return null;
  }

  getExecutablePath(): string {
    const envBinary = process.env.GROK_BINARY;
    if (envBinary && fs.existsSync(envBinary)) {
      return envBinary;
    }
    return this.detectInstallation() || 'grok';
  }

  detectInstallation(): string | null {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const possiblePaths = isWindows
      ? [
          path.join(homeDir, '.grok', 'bin', 'grok.exe'),
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'grok.cmd'),
        ]
      : [
          path.join(homeDir, '.grok', 'bin', 'grok'),
          path.join(homeDir, '.local', 'bin', 'grok'),
          '/usr/local/bin/grok',
          '/usr/bin/grok',
        ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }

    try {
      const result = execSync('which grok', { encoding: 'utf-8', timeout: 5000 }).trim();
      return result || null;
    } catch {
      return null;
    }
  }

  getExtraEnv(): Record<string, string> {
    // Ensure ~/.grok/bin is on PATH if present (managed installs live there)
    const grokBin = path.join(os.homedir(), '.grok', 'bin');
    if (fs.existsSync(grokBin)) {
      const sep = process.platform === 'win32' ? ';' : ':';
      return { PATH: grokBin + sep + (process.env.PATH || '') };
    }
    return {};
  }

  /**
   * Prompt is passed via -p / --prompt-file, not stdin.
   */
  requiresStdinInput(): boolean {
    return false;
  }

  /**
   * Mark as stdin-closed so mid-run follow-ups queue until the process exits,
   * then respawn with --resume (same delivery path as Codex/OpenCode).
   * Callers may force-interrupt instead via sendCommand({ forceInterrupt: true }).
   */
  shouldCloseStdinAfterPrompt(): boolean {
    return true;
  }

  supportsSessionResume(): boolean {
    return true;
  }

  formatStdinInput(_prompt: string): string {
    // Not used (requiresStdinInput=false). Clean up any leftover prompt file.
    this.cleanupPromptFile();
    return '';
  }

  private cleanupPromptFile(): void {
    if (!this.lastPromptFile) return;
    try {
      if (fs.existsSync(this.lastPromptFile)) {
        fs.unlinkSync(this.lastPromptFile);
      }
    } catch {
      // best-effort
    }
    this.lastPromptFile = undefined;
  }
}
