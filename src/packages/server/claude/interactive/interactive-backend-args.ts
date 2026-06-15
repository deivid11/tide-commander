/**
 * Argument builder for the experimental interactive-TUI Claude mode.
 *
 * Unlike ClaudeBackend.buildArgs (which targets `claude --print` with
 * stream-json I/O), this builds the flag set for the real interactive TUI:
 * NO `--print`, NO `--output-format`/`--input-format` (those are print-only).
 * The session id is self-assigned by the caller so the transcript JSONL path is
 * deterministic, and permissions are bypassed because TUI permission popups
 * cannot be answered from a non-attached process.
 */

import type { BackendConfig } from '../types.js';
import { buildAppendedProjectInstructions, writePromptToFile } from '../backend.js';

export interface InteractiveArgsOptions {
  /** Self-assigned (new) or existing session UUID. */
  sessionId: string;
  /** true → resume an existing transcript; false → start a fresh session id. */
  resume: boolean;
}

/**
 * Translate Tide Commander's '[1m]'-suffixed model labels to the bare model id
 * the CLI accepts (mirrors the mapping in ClaudeBackend.buildArgs).
 */
function translateCliModel(model: string): string {
  if (model === 'opus[1m]') return 'claude-opus-4-7';
  if (model === 'claude-opus-4-8[1m]') return 'claude-opus-4-8';
  if (model === 'claude-fable-5[1m]') return 'claude-fable-5';
  return model;
}

export function buildInteractiveClaudeArgs(
  config: BackendConfig,
  opts: InteractiveArgsOptions,
): string[] {
  const args: string[] = [];

  // Session selection: brand-new sessions self-assign the id; existing ones resume.
  if (opts.resume) {
    args.push('--resume', opts.sessionId);
  } else {
    args.push('--session-id', opts.sessionId);
  }

  // Permissions: interactive permission popups cannot be answered via JSONL
  // polling, so bypass is mandatory in this mode.
  args.push('--dangerously-skip-permissions');

  // Model + reasoning effort
  if (config.model) {
    args.push('--model', translateCliModel(config.model));
  }
  if (config.effort) {
    args.push('--effort', config.effort);
  }

  // TC's full prompt hierarchy (CLAUDE.md rules, system prompt, area, memory,
  // class instructions, runtime context) — shared with the headless path.
  const projectInstructions = buildAppendedProjectInstructions(config);
  const projectPromptFile = writePromptToFile(
    projectInstructions,
    `${config.agentId || 'agent'}-interactive`,
  );
  args.push('--append-system-prompt-file', projectPromptFile);

  return args;
}
