/**
 * Pi coding agent CLI Backend (headless mode)
 *
 * Spawns: pi --mode json -p [--session id | --fork id] [--model pattern] [--thinking level] <prompt>
 * Large prompts go through a temp file passed as an @file argument (pi does
 * not read the prompt from stdin; @file contents are included in the message).
 *
 * IMPORTANT: `which pi` can resolve to unrelated binaries (e.g. anaconda ships
 * a python packaging tool named `pi`), so installation detection validates that
 * the resolved target actually belongs to @earendil-works/pi-coding-agent.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CLIBackend, BackendConfig, StandardEvent } from '../claude/types.js';
import { PiJsonEventParser } from './json-event-parser.js';
import { addPiDetailedReasoningExtension } from './detailed-reasoning.js';
import { TIDE_COMMANDER_APPENDED_PROMPT } from '../prompts/tide-commander.js';
import { getSystemPrompt, isEchoPromptEnabled } from '../services/system-prompt-service.js';
import { consumeInstructionsDirty, isBareSlashCommand } from '../services/instruction-refresh.js';
import { loadAreas } from '../data/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PiBackend');

interface PiSessionHeaderEvent {
  type?: string;
  id?: string;
}

/** Prompt size above which we switch from argv to a temp @file (argv safety). */
const PROMPT_FILE_THRESHOLD = 4000;

export function buildPiPrompt(config: BackendConfig): string {
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

export function shouldPassPiModel(model: string | undefined): model is string {
  if (!model) return false;
  // Reject other providers' model values that may leak across provider
  // switches. Pi accepts 'provider/id' patterns and fuzzy names; TC-specific
  // '[1m]' suffixes and Codex/Grok ids would error out.
  if (
    model.includes('[1m]') ||
    model.startsWith('gpt-5.6-') ||
    model.startsWith('grok-')
  ) {
    return false;
  }
  return true;
}

/** Map Tide effort labels to pi thinking levels (off|minimal|low|medium|high|xhigh). */
export function piThinkingLevelForEffort(effort: string): string {
  const effortMap: Record<string, string> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xHigh: 'xhigh',
    max: 'xhigh',
  };
  return effortMap[effort] || effort.toLowerCase();
}

/** True when the file at `p` is the real pi coding agent entrypoint. */
function isPiCodingAgentBinary(p: string): boolean {
  try {
    const real = fs.realpathSync(p);
    if (real.includes('pi-coding-agent')) return true;
    // Standalone (bun-compiled) installs: accept executables that are not
    // scripts of some other interpreter (e.g. anaconda's python `pi` tool).
    const fd = fs.openSync(real, 'r');
    const buf = Buffer.alloc(64);
    fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf-8');
    if (head.startsWith('#!')) {
      return head.includes('node') || head.includes('bun');
    }
    // Non-script executable (ELF/Mach-O standalone build) — assume pi.
    return true;
  } catch {
    return false;
  }
}

export class PiBackend implements CLIBackend {
  readonly name = 'pi';
  // ONE PiBackend serves every Pi agent — parser state (stream uuids,
  // accumulated text, usage) must be per agent.
  private parsers = new Map<string, PiJsonEventParser>();

  private parserFor(agentId?: string): PiJsonEventParser {
    const key = agentId || '__default';
    let parser = this.parsers.get(key);
    if (!parser) {
      parser = new PiJsonEventParser();
      this.parsers.set(key, parser);
    }
    return parser;
  }

  /** Temp prompt files created for this process; cleaned on next buildArgs. */
  private lastPromptFile: string | undefined;
  private cachedInstallPath: string | null | undefined;

  buildArgs(config: BackendConfig): string[] {
    // Clean previous prompt file if any (best-effort)
    this.cleanupPromptFile();

    const prompt = buildPiPrompt(config);
    const args: string[] = ['--mode', 'json', '-p'];
    addPiDetailedReasoningExtension(args);

    if (shouldPassPiModel(config.model)) {
      args.push('--model', config.model);
    }

    if (config.effort) {
      args.push('--thinking', piThinkingLevelForEffort(config.effort));
    }

    // Session resume / fork
    if (config.sessionId) {
      if (config.forkSession) {
        // Fork the source session into a NEW session file (first run of a fork).
        args.push('--fork', config.sessionId);
      } else {
        args.push('--session', config.sessionId);
      }
    }

    // Prompt delivery: argv for small prompts, temp @file for large ones
    // (pi includes @file contents in the initial message; it does not read stdin).
    if (prompt.length > PROMPT_FILE_THRESHOLD) {
      const promptFile = path.join(
        os.tmpdir(),
        `tide-pi-prompt-${config.agentId || 'anon'}-${Date.now()}.md`
      );
      fs.writeFileSync(promptFile, prompt, 'utf-8');
      this.lastPromptFile = promptFile;
      args.push(`@${promptFile}`);
      log.log(`buildArgs: prompt via @file (${prompt.length} chars) sessionId=${config.sessionId ? 'yes' : 'no'}`);
    } else {
      args.push(prompt);
      log.log(`buildArgs: prompt via argv (${prompt.length} chars) sessionId=${config.sessionId ? 'yes' : 'no'}`);
    }

    return args;
  }

  parseEvent(rawEvent: unknown, agentId?: string): StandardEvent | StandardEvent[] | null {
    const events = this.parserFor(agentId).parseEvent(rawEvent);
    if (events.length === 0) return null;
    return events.length === 1 ? events[0] : events;
  }

  extractSessionId(rawEvent: unknown): string | null {
    const event = rawEvent as PiSessionHeaderEvent;
    if (event?.type === 'session' && typeof event.id === 'string' && event.id) {
      return event.id;
    }
    return null;
  }

  getExecutablePath(): string {
    const envBinary = process.env.PI_BINARY;
    if (envBinary && fs.existsSync(envBinary)) {
      return envBinary;
    }
    return this.detectInstallation() || 'pi';
  }

  detectInstallation(): string | null {
    if (this.cachedInstallPath !== undefined) {
      return this.cachedInstallPath;
    }
    this.cachedInstallPath = this.detectInstallationUncached();
    return this.cachedInstallPath;
  }

  private detectInstallationUncached(): string | null {
    const homeDir = os.homedir();
    const candidates: string[] = [];

    // nvm-managed npm globals (preferred install channel for pi)
    const nvmVersionsDir = path.join(homeDir, '.nvm', 'versions', 'node');
    try {
      for (const version of fs.readdirSync(nvmVersionsDir)) {
        candidates.push(path.join(nvmVersionsDir, version, 'bin', 'pi'));
      }
    } catch {
      // no nvm
    }

    candidates.push(
      path.join(homeDir, '.local', 'bin', 'pi'),
      '/usr/local/bin/pi',
      '/usr/bin/pi',
    );

    // PATH entries last — `which -a` may surface unrelated `pi` binaries first.
    try {
      const whichAll = execSync('which -a pi', { encoding: 'utf-8', timeout: 5000 })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      candidates.push(...whichAll);
    } catch {
      // not on PATH
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && isPiCodingAgentBinary(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  getExtraEnv(): Record<string, string> {
    return {};
  }

  /**
   * Prompt is passed via argv / temp @file, not stdin.
   */
  requiresStdinInput(): boolean {
    return false;
  }

  /**
   * Mark as stdin-closed so mid-run follow-ups queue until the process exits,
   * then respawn with --session (same delivery path as Codex/OpenCode/Grok).
   */
  shouldCloseStdinAfterPrompt(): boolean {
    return true;
  }

  supportsSessionResume(): boolean {
    return true;
  }

  formatStdinInput(_prompt: string): string {
    // Not used (requiresStdinInput=false).
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
