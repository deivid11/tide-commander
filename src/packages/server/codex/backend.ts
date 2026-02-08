import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CLIBackend, BackendConfig, StandardEvent } from '../claude/types.js';
import { CodexJsonEventParser } from './json-event-parser.js';

interface CodexRawEvent {
  type?: string;
  thread_id?: string;
}

function shouldPassCodexModel(model: string | undefined): model is string {
  if (!model) return false;
  if (model === 'codex' || model === 'sonnet' || model === 'opus' || model === 'haiku') {
    return false;
  }
  return true;
}

function buildCodexPrompt(config: BackendConfig): string {
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

  if (injectedSections.length === 0) {
    return userPrompt;
  }

  return [
    'Follow all instructions below for this task.',
    ...injectedSections,
    '## User Request',
    userPrompt,
  ].join('\n\n');
}

export class CodexBackend implements CLIBackend {
  readonly name = 'codex';
  private parser = new CodexJsonEventParser();

  buildArgs(config: BackendConfig): string[] {
    const prompt = buildCodexPrompt(config);
    const args: string[] = ['exec', '--json'];
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

    if (config.workingDir) {
      args.push('-C', config.workingDir);
    }

    if (shouldPassCodexModel(config.model)) {
      args.push('--model', config.model);
    }

    if (config.sessionId) {
      args.push('resume', config.sessionId, prompt);
      return args;
    }

    args.push(prompt);
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

  requiresStdinInput(): boolean {
    return false;
  }

  formatStdinInput(prompt: string): string {
    return prompt;
  }
}
