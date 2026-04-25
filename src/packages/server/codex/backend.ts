import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CLIBackend, BackendConfig, StandardEvent } from '../claude/types.js';
import { CodexJsonEventParser } from './json-event-parser.js';
import { TIDE_COMMANDER_APPENDED_PROMPT } from '../prompts/tide-commander.js';
import { isEchoPromptEnabled, getCodexBinaryPath } from '../services/system-prompt-service.js';
import { loadAreas } from '../data/index.js';

interface CodexRawEvent {
  type?: string;
  thread_id?: string;
}

function shouldPassCodexModel(model: string | undefined): model is string {
  if (!model) return false;
  if (
    model === 'codex' ||
    model === 'sonnet' ||
    model === 'opus' ||
    model === 'haiku' ||
    model.startsWith('claude-')
  ) {
    return false;
  }
  return true;
}

export function buildCodexPrompt(config: BackendConfig): string {
  const userPrompt = config.prompt?.trim() || 'Continue the task.';
  const injectedSections: string[] = [];

  const customPrompt = config.customAgent?.definition?.prompt?.trim();
  if (customPrompt) {
    injectedSections.push(`## Agent Instructions\n${customPrompt}`);
  }

  const systemPrompt = config.systemPrompt?.trim();
  if (systemPrompt) {
    injectedSections.push(`## System Context\n${systemPrompt}`);
  }

  // Area-level prompt (per-area instructions for agents assigned to this area)
  if (config.agentId) {
    const areas = loadAreas();
    const agentArea = areas.find(a => a.assignedAgentIds.includes(config.agentId!));
    const areaPrompt = agentArea?.prompt?.trim();
    if (areaPrompt) {
      injectedSections.push(`## Area-Level Prompt (${agentArea!.name})\n${areaPrompt}`);
    }
  }

  injectedSections.push(TIDE_COMMANDER_APPENDED_PROMPT);

  if (injectedSections.length === 0) {
    return isEchoPromptEnabled() ? userPrompt + '\n\n---\n\n' + userPrompt : userPrompt;
  }

  // Echo Prompt: duplicate the user message for improved attention coverage
  const echoedUserPrompt = isEchoPromptEnabled()
    ? userPrompt + '\n\n---\n\n' + userPrompt
    : userPrompt;

  return [
    'Follow all instructions below for this task.',
    ...injectedSections,
    '## User Request',
    echoedUserPrompt,
  ].join('\n\n');
}

export class CodexBackend implements CLIBackend {
  readonly name = 'codex';
  private parser = new CodexJsonEventParser({ enableFileDiffEnrichment: true });
  // Prompts are passed via stdin (not argv) so large prompts (skills + system
  // prompt + class instructions) don't blow past tmux's ~16KB argv limit,
  // which silently rejects the spawn with "command too long".
  private pendingStdinPrompt: string | undefined;

  buildArgs(config: BackendConfig): string[] {
    this.parser.setWorkingDirectory(config.workingDir);
    this.pendingStdinPrompt = buildCodexPrompt(config);
    const args: string[] = ['exec', '--experimental-json'];
    // Codex renamed [features].collab → [features].multi_agent. Enable the new
    // flag explicitly so subagent orchestration (collab_tool_call items) works
    // without the user needing `[features].collab = true` in ~/.codex/config.toml,
    // which Codex now emits a deprecation error for on every turn.
    args.push('--enable', 'multi_agent');
    const codexConfig = config.codexConfig;
    const fullAuto = codexConfig?.fullAuto !== false;

    if (fullAuto) {
      // --full-auto uses --sandbox workspace-write which blocks localhost network
      // access (needed for Tide Commander notifications and API calls).
      // Use --dangerously-bypass-approvals-and-sandbox to match Claude's bypass mode.
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      if (codexConfig?.approvalMode) {
        args.push('--ask-for-approval', codexConfig.approvalMode);
      }
      if (codexConfig?.sandbox) {
        args.push('--sandbox', codexConfig.sandbox);
      }
    }

    if (codexConfig?.search) {
      args.push('--search');
    }
    if (codexConfig?.profile) {
      args.push('--profile', codexConfig.profile);
    }
    if (codexConfig?.reasoningEffort) {
      // Pass as a two-arg pair so the spawned process receives the flag and
      // value as separate argv entries — no shell-level quoting needed.
      args.push('-c', `model_reasoning_effort=${codexConfig.reasoningEffort}`);
    }

    if (config.workingDir) {
      args.push('-C', config.workingDir);
    }

    if (shouldPassCodexModel(config.model)) {
      args.push('--model', config.model);
    }

    // `-` in the PROMPT positional tells codex to read the prompt from stdin.
    // Omitting it works too for `exec`, but being explicit makes the intent
    // clear and is required by the `resume` subcommand.
    if (config.sessionId) {
      args.push('resume', config.sessionId, '-');
      return args;
    }

    args.push('-');
    return args;
  }

  parseEvent(rawEvent: unknown): StandardEvent | StandardEvent[] | null {
    const events = this.parser.parseEvent(rawEvent);
    if (events.length === 0) return null;
    return events.length === 1 ? events[0] : events;
  }

  extractSessionId(rawEvent: unknown): string | null {
    const event = rawEvent as CodexRawEvent;
    if (event?.type === 'thread.started' && typeof event.thread_id === 'string') {
      return event.thread_id;
    }
    return null;
  }

  getExecutablePath(): string {
    // Priority: 1) Settings UI  2) CODEX_BINARY env var  3) auto-detect
    // The Settings UI value is an explicit user override and must win over
    // the env var default so the user can point Tide Commander at a specific
    // codex install without clearing their shell environment.
    const settingsBinary = getCodexBinaryPath();
    if (settingsBinary && fs.existsSync(settingsBinary)) {
      return settingsBinary;
    }
    const envBinary = process.env.CODEX_BINARY;
    if (envBinary && fs.existsSync(envBinary)) {
      return envBinary;
    }
    return this.detectInstallation() || 'codex';
  }

  detectInstallation(): string | null {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const possiblePaths = isWindows
      ? [
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
          path.join(homeDir, '.bun', 'bin', 'codex.exe'),
        ]
      : [
          path.join(homeDir, '.local', 'bin', 'codex'),
          path.join(homeDir, '.bun', 'bin', 'codex'),
          '/usr/local/bin/codex',
          '/usr/bin/codex',
        ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  getExtraEnv(): Record<string, string> {
    // When using the native binary directly, we need to add
    // the vendor path directory to PATH so codex can find bundled tools like rg.
    // Match the precedence used by getExecutablePath(): Settings UI wins over env var.
    const binary = getCodexBinaryPath() || process.env.CODEX_BINARY;
    if (!binary) return {};

    const codexDir = path.dirname(binary);    // .../codex/
    const archRoot = path.dirname(codexDir);      // .../x86_64-unknown-linux-musl/
    const pathDir = path.join(archRoot, 'path');
    if (fs.existsSync(pathDir)) {
      const sep = process.platform === 'win32' ? ';' : ':';
      return { PATH: pathDir + sep + (process.env.PATH || '') };
    }
    return {};
  }

  requiresStdinInput(): boolean {
    return true;
  }

  shouldCloseStdinAfterPrompt(): boolean {
    // codex exec reads the prompt once then processes. EOF on stdin lets it
    // start without waiting for more input.
    return true;
  }

  formatStdinInput(prompt: string): string {
    // buildArgs caches the fully-assembled prompt (including injected
    // system/area/class sections). Fall back to the raw prompt for the
    // sendMessage path where buildArgs isn't re-invoked.
    const full = this.pendingStdinPrompt ?? prompt;
    this.pendingStdinPrompt = undefined;
    return full;
  }
}
