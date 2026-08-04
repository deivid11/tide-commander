/**
 * Claude Code CLI Backend
 * Handles argument building and event parsing for Claude Code CLI
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'node:url';
import type {
  CLIBackend,
  BackendConfig,
  StandardEvent,
  ClaudeRawEvent,
} from './types.js';
import { toModelFallbackEvent } from './types.js';
import { ModelFallbackTracker } from '../../shared/model-fallback.js';
import { createLogger, sanitizeUnicode } from '../utils/index.js';
import { TIDE_COMMANDER_APPENDED_PROMPT } from '../prompts/tide-commander.js';
import { isEchoPromptEnabled, getSystemPrompt } from '../services/system-prompt-service.js';
import { isBareSlashCommand } from '../services/instruction-refresh.js';
import { loadAreas } from '../data/index.js';
import { getAgent } from '../services/agent-service.js';

const log = createLogger('Backend');

// Track tool_use_id to tool_name mapping for matching tool_result events
// This is a module-level map that persists across parseEvent calls
const toolUseIdToName: Map<string, string> = new Map();

// Marker text of the immediate tool_result the CLI returns when a Task/Agent tool
// launches in the background (the real result arrives later as a <task-notification>)
function isBackgroundLaunchStub(content: string): boolean {
  return content.includes('Async agent launched successfully')
    || content.includes('The agent is working in the background');
}

/**
 * Write prompt content to a temp file for use with --system-prompt-file / --append-system-prompt-file
 * This avoids issues with multiline prompts and shell escaping
 */
export function writePromptToFile(prompt: string, agentId?: string): string {
  const tideDataDir = path.join(os.homedir(), '.tide-commander', 'prompts');
  if (!fs.existsSync(tideDataDir)) {
    fs.mkdirSync(tideDataDir, { recursive: true });
  }
  const filename = agentId ? `prompt-${agentId}.md` : `prompt-${Date.now()}.md`;
  const promptPath = path.join(tideDataDir, filename);
  fs.writeFileSync(promptPath, prompt, 'utf-8');
  log.log(` Wrote prompt (${prompt.length} chars) to ${promptPath}`);
  return promptPath;
}

// Headless permission-prompt MCP server. Resolves AskUserQuestion and
// ExitPlanMode (which would otherwise dead-lock waiting for a TUI dialog in a
// non-interactive Claude CLI subprocess) by auto-answering / auto-approving
// via the documented `--permission-prompt-tool` MCP hook.
const PERMISSION_PROMPT_SERVER_BASENAME = 'permission-prompt-server.mjs';
// CLI tool reference shape: `mcp__<server-name-in-mcp-config>__<tool-name>`.
const PERMISSION_PROMPT_TOOL = 'mcp__tideperm__permission_prompt';

/**
 * Write the per-process mcp-config and return its path. The config registers
 * one stdio MCP server (`tideperm`) that runs the bundled permission-prompt
 * server script — same shape the SDK uses for permission_prompt_tool_name,
 * but invoked through the CLI so the agent still bills against Claude Code,
 * not the Anthropic API.
 */
function getPermissionPromptMcpConfigPath(): string {
  const tideDataDir = path.join(os.homedir(), '.tide-commander');
  if (!fs.existsSync(tideDataDir)) {
    fs.mkdirSync(tideDataDir, { recursive: true });
  }

  // Resolve the bundled server script. In dev (tsx) it lives next to this
  // file; in the prebuilt bundle the .mjs is copied alongside the .js by
  // `npm run build:server` (see package.json).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverScriptPath = path.join(here, PERMISSION_PROMPT_SERVER_BASENAME);

  const config = {
    mcpServers: {
      tideperm: {
        command: 'node',
        args: [serverScriptPath],
      },
    },
  };

  const configPath = path.join(tideDataDir, 'permission-prompt-mcp.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

export function buildAppendedProjectInstructions(config: BackendConfig): string {
  const sections: string[] = [
    '## CLAUDE.md / Project instructions — Tide Commander-specific rules',
    TIDE_COMMANDER_APPENDED_PROMPT,
  ];

  // Global custom prompt — applies to every agent. Edited from Settings →
  // System Prompt → "All Agents (Global)". Injected before the per-agent
  // prompt so agent-specific instructions take precedence over it.
  const globalPrompt = getSystemPrompt().trim();
  if (globalPrompt) {
    sections.push(
      '## Global Custom Prompt (All Agents)',
      globalPrompt
    );
  }

  // Per-agent custom system prompt. Scoped to this specific agent and edited
  // from Settings → System Prompt with that agent selected.
  if (config.agentId) {
    const agent = getAgent(config.agentId);
    const agentCustomPrompt = agent?.customPrompt?.trim();
    if (agentCustomPrompt) {
      sections.push(
        '## System-Level Custom Prompt',
        agentCustomPrompt
      );
    }
  }

  // Area-level prompt (per-area instructions for agents assigned to this area)
  if (config.agentId) {
    const areas = loadAreas();
    const agentArea = areas.find(a => a.assignedAgentIds.includes(config.agentId!));
    const areaPrompt = agentArea?.prompt?.trim();
    if (areaPrompt) {
      sections.push(
        `## Area-Level Prompt (${agentArea!.name})`,
        areaPrompt
      );
    }
  }

  // Per-agent persistent memory — the agent's own notes/lessons accumulated
  // over time. Injected between the global system prompt and class instructions
  // so the agent's self-curated context is visible before class-level rules.
  if (config.agentId) {
    const agent = getAgent(config.agentId);
    const agentMemory = agent?.memory?.trim();
    if (agentMemory) {
      sections.push(
        '## Agent Memory (Your Notes To Yourself)',
        'The following are notes you have saved to your own persistent memory across conversations — past lessons, user preferences, project context, and references you have chosen to retain. Use them as authoritative context but verify before acting on stale-sounding facts. Update them via the `agent-memory` skill when you learn something worth keeping.',
        agentMemory
      );
    }
  }

  const customPrompt = config.customAgent?.definition?.prompt?.trim();
  if (customPrompt) {
    sections.push(
      '## Agent Class Instructions',
      'The following instructions are mandatory unless the user explicitly overrides them.',
      customPrompt
    );
  }

  const runtimeSystemPrompt = config.systemPrompt?.trim();
  if (runtimeSystemPrompt) {
    sections.push(
      '## Runtime System Context',
      runtimeSystemPrompt
    );
  }

  return sections.join('\n\n');
}

/** Per-agent token-stream parsing state (see comment on `streamStates`). */
interface ClaudeStreamState {
  currentStreamMessageId: string | null;
  streamUuids: Map<string, string>; // key = `${kind}:${index}`
  /** After the full assistant text finalizes, ignore late stream deltas for this turn. */
  suppressTextDeltas: boolean;
  /**
   * Model of the last main-loop assistant message (subagent/synthetic excluded).
   * The `result` event's `modelUsage` is keyed by model name and a single turn
   * routinely bills several — the conversation model plus short auxiliary calls
   * (Haiku for web-search summarisation, titles, quota probes). This tells us
   * which of those entries owns the context window. See selectPrimaryModelUsage.
   */
  mainModel: string | null;
  /**
   * Watches the requested model (from the CLI args, then from `system/init`)
   * against the model each main-loop message was actually served by, and
   * reports the edges. See shared/model-fallback.ts.
   */
  fallback: ModelFallbackTracker;
}

function resetClaudeStreamState(state: ClaudeStreamState): void {
  state.currentStreamMessageId = null;
  state.streamUuids.clear();
  // suppressTextDeltas is intentionally NOT cleared here — only message_start
  // opens a new turn. That way late content_block_delta lines after the final
  // assistant event cannot open a second bubble with a new stream uuid.
  // mainModel is likewise kept: parseResultEvent reads it *after* the last
  // assistant event of the turn has already finalized its text.
}

type ClaudeModelUsage = NonNullable<ClaudeRawEvent['modelUsage']>;
type ClaudeModelUsageEntry = ClaudeModelUsage[string];

/**
 * Pick the entry of `result.modelUsage` that owns the agent's context window.
 *
 * `modelUsage` is a per-model breakdown whose key order follows first use in
 * the turn, so an auxiliary Haiku call (web search, title generation) is very
 * often first. Taking `Object.keys()[0]` therefore reported Haiku's 200k window
 * as the agent's contextLimit — which both mis-rendered the meter and made the
 * next turn's usage_snapshot look "over limit", zeroing the tracked tokens.
 *
 * Preference order:
 *  1. the model the main loop actually streamed (`preferredModel`),
 *  2. the model with the largest prompt-side footprint — the conversation model
 *     dominates cache reads by orders of magnitude over any helper call,
 *  3. first key, as a last resort.
 */
function selectPrimaryModelUsage(
  modelUsage: ClaudeModelUsage,
  preferredModel?: string | null
): { name: string; usage: ClaudeModelUsageEntry } | null {
  const entries = Object.entries(modelUsage).filter(
    (entry): entry is [string, ClaudeModelUsageEntry] => !!entry[1]
  );
  if (entries.length === 0) return null;

  if (preferredModel) {
    const exact = entries.find(([name]) => name === preferredModel);
    if (exact) return { name: exact[0], usage: exact[1] };
  }

  let best: { name: string; usage: ClaudeModelUsageEntry } | null = null;
  let bestWeight = -1;
  for (const [name, usage] of entries) {
    const weight = (usage.inputTokens || 0)
      + (usage.cacheReadInputTokens || 0)
      + (usage.cacheCreationInputTokens || 0);
    // Tie-break on the wider window so a zero-usage entry can't win by accident.
    const widerOnTie = weight === bestWeight
      && (usage.contextWindow || 0) > (best?.usage.contextWindow || 0);
    if (weight > bestWeight || widerOnTie) {
      bestWeight = weight;
      best = { name, usage };
    }
  }
  return best ?? { name: entries[0][0], usage: entries[0][1] };
}

export class ClaudeBackend implements CLIBackend {
  readonly name = 'claude';

  // ---------------------------------------------------------------------------
  // Token-stream state (--include-partial-messages)
  //
  // Claude's stream_event lines each carry a *different* outer `uuid`, so the
  // client cannot merge word-by-word deltas by that field (unlike Grok, which
  // emits tiny tokens with no uuid and we mint one). We pin a stable stream id
  // per (message_id, content_block index, kind) so addOutput merges into one
  // terminal row. The final assistant message reuses the same id to finalize.
  //
  // ONE ClaudeBackend instance serves every Claude agent (single runner per
  // provider), so this state is keyed by agentId — otherwise two concurrent
  // agents reset each other's stream uuids mid-turn (dropped deltas, stuck
  // streaming rows, duplicate final bubbles).
  // ---------------------------------------------------------------------------
  private streamStates = new Map<string, ClaudeStreamState>();

  private streamState(agentId?: string): ClaudeStreamState {
    const key = agentId || '__default';
    let state = this.streamStates.get(key);
    if (!state) {
      state = {
        currentStreamMessageId: null,
        streamUuids: new Map(),
        suppressTextDeltas: false,
        mainModel: null,
        // Seeded from the persisted agent record so a server restart mid-fallback
        // doesn't lose the "we are being downgraded" flag — otherwise the first
        // turn back on the right model has nothing to restore from and the
        // agent's fallback badge would stick forever.
        fallback: new ModelFallbackTracker(
          null,
          (agentId && getAgent(agentId)?.modelFallback?.servedModel) || null
        ),
      };
      this.streamStates.set(key, state);
    }
    return state;
  }

  /**
   * Build CLI arguments for Claude Code
   */
  buildArgs(config: BackendConfig): string[] {
    const args: string[] = [];

    log.log(` buildArgs called: sessionId=${config.sessionId ? 'yes' : 'no'}, customAgent=${config.customAgent ? config.customAgent.name : 'no'}, systemPrompt=${config.systemPrompt ? 'yes' : 'no'}`);

    // Core output format for streaming JSON
    args.push('--print');
    args.push('--verbose');
    args.push('--output-format', 'stream-json');
    args.push('--input-format', 'stream-json');
    // Without this flag, stream-json only emits complete assistant messages —
    // no content_block_delta / text_delta tokens — so the UI cannot typewriter
    // the reply the way Grok's streaming-json does by default.
    args.push('--include-partial-messages');

    // Resume existing session if available
    if (config.sessionId) {
      args.push('--resume', config.sessionId);
      // Fork the resumed session into a fresh one (first run of a forked agent):
      // Claude assigns a NEW session id, leaving the source transcript untouched.
      if (config.forkSession) {
        args.push('--fork-session');
      }
    }

    // Permission mode - bypass for autonomous agents, interactive uses hooks
    if (config.permissionMode === 'bypass') {
      args.push('--dangerously-skip-permissions');
      // Route AskUserQuestion / ExitPlanMode through our auto-answer MCP server
      // so the agent doesn't dead-lock on TUI-only dialogs.
      const mcpConfigPath = getPermissionPromptMcpConfigPath();
      args.push('--mcp-config', mcpConfigPath);
      args.push('--permission-prompt-tool', PERMISSION_PROMPT_TOOL);
    } else if (config.permissionMode === 'interactive') {
      // For interactive mode, configure the PreToolUse hook to ask for permission
      // The hook script calls the Tide Commander server which shows UI for approval
      const hookPath = path.join(process.cwd(), 'hooks', 'permission-hook.sh');
      const hookSettings = {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: hookPath,
                  timeout: 300, // 5 minute timeout for user response
                },
              ],
            },
          ],
        },
      };
      // Write settings to a temp file to avoid shell escaping issues
      const tideDataDir = path.join(os.homedir(), '.tide-commander');
      if (!fs.existsSync(tideDataDir)) {
        fs.mkdirSync(tideDataDir, { recursive: true });
      }
      const settingsPath = path.join(tideDataDir, 'hook-settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify(hookSettings, null, 2));
      args.push('--settings', settingsPath);
    }

    // Model selection
    // '[1m]'-suffixed IDs are Tide Commander labels representing an Opus model
    // run with the 1M-token context beta header; translate to the CLI-accepted
    // bare model ID. 'opus[1m]' is the legacy label for Opus 4.7 1M.
    if (config.model) {
      let cliModel: string = config.model;
      if (config.model === 'opus[1m]') cliModel = 'claude-opus-4-7';
      else if (config.model === 'claude-opus-5[1m]') cliModel = 'claude-opus-5';
      else if (config.model === 'claude-opus-4-8[1m]') cliModel = 'claude-opus-4-8';
      else if (config.model === 'claude-fable-5[1m]') cliModel = 'claude-fable-5';
      else if (config.model === 'claude-sonnet-5[1m]') cliModel = 'claude-sonnet-5';
      args.push('--model', cliModel);
      // Baseline for silent-fallback detection, in case this run never emits a
      // `system/init` (resume/tmux reattach paths). `init` overwrites it when
      // it does arrive, since the CLI resolves aliases there.
      this.streamState(config.agentId).fallback.setRequested(cliModel);
    }

    // Reasoning effort level
    if (config.effort) {
      args.push('--effort', config.effort);
    }

    // Chrome browser mode
    if (config.useChrome) {
      args.push('--chrome');
    }

    const projectInstructions = buildAppendedProjectInstructions(config);
    const projectPromptFile = writePromptToFile(projectInstructions, `${config.agentId || 'agent'}-project`);
    log.log(` Adding merged project instructions via file (${projectInstructions.length} chars)`);
    args.push('--append-system-prompt-file', projectPromptFile);

    return args;
  }

  /**
   * Parse Claude CLI raw event into normalized StandardEvent
   */
  parseEvent(rawEvent: unknown, agentId?: string): StandardEvent | StandardEvent[] | null {
    const event = rawEvent as ClaudeRawEvent;

    // Log ALL events to understand what we're receiving
    log.log(`parseEvent: type=${event.type}, subtype=${event.subtype || 'none'}, tool_name=${event.tool_name || 'n/a'}`);

    // Log assistant events with tool_use blocks
    if (event.type === 'assistant' && event.message?.content) {
      const toolUseBlocks = event.message.content.filter((b: any) => b.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        log.log(`parseEvent: assistant message has ${toolUseBlocks.length} tool_use block(s): ${toolUseBlocks.map((b: any) => b.name).join(', ')}`);
      }
    }

    // Capture parent_tool_use_id from the raw event for propagation
    const parentToolUseId = event.parent_tool_use_id;

    let result: StandardEvent | StandardEvent[] | null = null;

    switch (event.type) {
      case 'system':
        result = this.parseSystemEvent(event, agentId);
        break;

      case 'assistant':
        result = this.parseAssistantEvent(event, agentId);
        break;

      case 'tool_use':
        result = this.parseToolUseEvent(event);
        break;

      case 'result':
        result = this.parseResultEvent(event, agentId);
        break;

      case 'stream_event':
        result = this.parseStreamEvent(event, agentId);
        break;

      case 'user':
        result = this.parseUserEvent(event);
        break;

      default:
        log.log(`parseEvent: UNKNOWN event type '${event.type}' - not handled`);
        result = null;
    }

    if (result === null && event.type !== 'assistant') {
      // Log when we're dropping events (assistant events may return null for text-only content)
      log.log(`parseEvent: returned NULL for type=${event.type}, subtype=${event.subtype || 'none'}`);
    }

    // Propagate parent_tool_use_id onto all returned events (links subagent internal events to parent)
    if (result && parentToolUseId) {
      if (Array.isArray(result)) {
        for (const r of result) {
          if (!r.parentToolUseId) r.parentToolUseId = parentToolUseId;
        }
      } else {
        if (!result.parentToolUseId) result.parentToolUseId = parentToolUseId;
      }
    }

    return result;
  }

  private parseUserEvent(event: ClaudeRawEvent): StandardEvent | StandardEvent[] | null {
    const message = event.message as { content?: string | Array<{ type: string; text?: string; content?: string; tool_use_id?: string }> };

    // Handle array content (tool_result blocks)
    if (Array.isArray(message?.content)) {
      const events: StandardEvent[] = [];
      for (const block of message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          // Prefer tool_use_result.stdout (raw output) over block.content (may be truncated)
          let content: string;
          if (event.tool_use_result?.stdout !== undefined) {
            // Combine stdout and stderr if both present
            content = event.tool_use_result.stdout;
            if (event.tool_use_result.stderr) {
              content += (content ? '\n' : '') + '[stderr] ' + event.tool_use_result.stderr;
            }
          } else {
            content = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          }
          // Look up the tool name from the tool_use_id mapping
          const toolName = toolUseIdToName.get(block.tool_use_id) || 'unknown';
          log.log(`parseUserEvent: Found tool_result for tool_use_id=${block.tool_use_id}, toolName=${toolName}, content length=${content?.length || 0}, hasToolUseResult=${!!event.tool_use_result}`);
          // Background Task launch stub: the CLI answers the tool_use immediately with
          // "Async agent launched..." while the subagent keeps running. Reclassify as
          // task_started so downstream doesn't complete the subagent or idle the agent —
          // the real completion arrives later as a <task-notification> user message.
          if ((toolName === 'Task' || toolName === 'Agent') && isBackgroundLaunchStub(content)) {
            log.log(`parseUserEvent: background launch stub for tool_use_id=${block.tool_use_id} — task still running`);
            events.push({ type: 'task_started', toolUseId: block.tool_use_id });
            toolUseIdToName.delete(block.tool_use_id);
            continue;
          }
          const toolResult: StandardEvent = {
            type: 'tool_result',
            toolName,
            toolOutput: content,
            toolUseId: block.tool_use_id, // Preserve for subagent correlation
            // The matching tool_start uses the tool_use id as its live-output
            // uuid. Reuse it for the result so clients can enrich that card in
            // place instead of waiting for a session-history reconstruction.
            uuid: block.tool_use_id,
          };
          // Extract subagent stats from Task/Agent tool completion metadata
          if ((toolName === 'Task' || toolName === 'Agent') && event.tool_use_result) {
            const tur = event.tool_use_result;
            if (tur.totalDurationMs || tur.totalTokens || tur.totalToolUseCount) {
              toolResult.subagentStats = {
                durationMs: tur.totalDurationMs || 0,
                tokensUsed: tur.totalTokens || 0,
                toolUseCount: tur.totalToolUseCount || 0,
              };
              log.log(`parseUserEvent: Task tool stats - duration=${tur.totalDurationMs}ms, tokens=${tur.totalTokens}, tools=${tur.totalToolUseCount}`);
            }
          }
          // Propagate parent_tool_use_id if present
          if (event.parent_tool_use_id) {
            toolResult.parentToolUseId = event.parent_tool_use_id;
          }
          events.push(toolResult);
          // Clean up the mapping after use (tool_use_id is unique per invocation)
          toolUseIdToName.delete(block.tool_use_id);
        }
      }
      // Background task completions: the CLI wakes the model with a user message
      // containing <task-notification> blocks (one per finished background task).
      for (const block of message.content) {
        if (block.type !== 'text' || typeof block.text !== 'string' || !block.text.includes('<task-notification>')) {
          continue;
        }
        for (const chunk of block.text.match(/<task-notification>[\s\S]*?(?:<\/task-notification>|$)/g) ?? []) {
          const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(chunk)?.[1];
          const taskId = /<task-id>([^<]+)<\/task-id>/.exec(chunk)?.[1];
          if (toolUseId) {
            log.log(`parseUserEvent: task_notification for tool_use_id=${toolUseId} (task_id=${taskId || 'unknown'})`);
            events.push({ type: 'task_notification', toolUseId, taskId });
          }
        }
      }
      if (events.length > 0) {
        log.log(`parseUserEvent: Extracted ${events.length} event(s)`);
        return events.length === 1 ? events[0] : events;
      }
    }

    // Check for local-command-stdout (from /context, /cost, /usage etc. commands)
    if (typeof message?.content === 'string' && message.content.includes('<local-command-stdout>')) {
      // Extract content between tags
      const match = message.content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
      if (match) {
        const content = match[1];
        // Check if this is /context output
        if (content.includes('## Context Usage') || content.includes('**Model:**')) {
          log.log(`parseUserEvent: Found /context output`);
          return {
            type: 'context_stats',
            contextStatsRaw: content,
          };
        }
      }
    }
    return null;
  }

  private parseSystemEvent(event: ClaudeRawEvent, agentId?: string): StandardEvent | null {
    if (event.subtype === 'init') {
      console.log(`[Backend] parseSystemEvent init: tools=${JSON.stringify(event.tools)}, agents=${JSON.stringify((event as any).agents)}`);
      // The session's own answer to "which model am I running?" — the baseline
      // every later assistant message is compared against.
      if (event.model) {
        this.streamState(agentId).fallback.setRequested(event.model);
      }
      return {
        type: 'init',
        sessionId: event.session_id,
        model: event.model,
        tools: event.tools,
      };
    }
    if (event.subtype === 'error' && event.error) {
      return {
        type: 'error',
        errorMessage: event.error,
      };
    }
    // Background Task launched (links task_id to the Task tool_use_id). The tool_result
    // that follows immediately is only a launch stub — the task keeps running until a
    // <task-notification> user message arrives.
    if (event.subtype === 'task_started' && event.task_id) {
      log.log(`parseSystemEvent: task_started - task_id=${event.task_id}, tool_use_id=${event.tool_use_id}`);
      if (event.tool_use_id) {
        return {
          type: 'task_started',
          taskId: event.task_id,
          toolUseId: event.tool_use_id,
        };
      }
    }
    // Background task finished (fires for async Task/Agent launches and for slow Bash
    // commands the CLI promotes to tasks) — resolves pending-task tracking.
    if (event.subtype === 'task_notification' && (event.tool_use_id || event.task_id)) {
      log.log(`parseSystemEvent: task_notification - task_id=${event.task_id}, tool_use_id=${event.tool_use_id}`);
      return {
        type: 'task_notification',
        taskId: event.task_id,
        toolUseId: event.tool_use_id,
      };
    }
    // Context compaction status
    if (event.subtype === 'status' && (event as any).status === 'compacting') {
      log.log(`parseSystemEvent: compacting status received, session_id=${event.session_id}`);
      return {
        type: 'compacting',
        sessionId: event.session_id,
        uuid: event.uuid,
      };
    }
    return null;
  }

  private parseAssistantEvent(event: ClaudeRawEvent, agentId?: string): StandardEvent | StandardEvent[] | null {
    // Check for content blocks in assistant message
    // Claude CLI sends both text and tool_use as content blocks within assistant events
    if (event.message?.content && Array.isArray(event.message.content)) {
      const state = this.streamState(agentId);
      const events: StandardEvent[] = [];
      // Use event UUID if available (unique identifier from Claude)
      const uuid = event.uuid;
      const usage = event.message.usage;

      // Capture message id from the assistant payload when stream_event's
      // message_start was missed or arrived without an id.
      const messageId =
        typeof (event.message as { id?: unknown })?.id === 'string'
          ? (event.message as { id: string }).id
          : null;
      if (messageId && !state.currentStreamMessageId) {
        state.currentStreamMessageId = messageId;
      }

      // Remember which model is driving the conversation so the turn's
      // `result.modelUsage` can be attributed correctly. Subagent-bridged
      // messages carry their own (possibly smaller) model, and `<synthetic>`
      // is the CLI's placeholder for locally-generated messages — neither
      // describes the parent agent's context window.
      const messageModel = (event.message as { model?: unknown })?.model;
      if (
        typeof messageModel === 'string'
        && messageModel
        && messageModel !== '<synthetic>'
        && !(event as { parent_tool_use_id?: string }).parent_tool_use_id
      ) {
        state.mainModel = messageModel;
        // Subagents legitimately run their own model and `<synthetic>` is the
        // CLI's own placeholder — both are excluded above, so anything that
        // reaches here and disagrees with the session's model is a real swap.
        const transition = state.fallback.observe(messageModel);
        if (transition) {
          log.log(`model fallback: ${transition.restored ? 'restored' : 'active'} — ${transition.label}`);
          events.push(toModelFallbackEvent(transition));
        }
      }

      // Extract text blocks - emit as non-streaming final text.
      //
      // IMPORTANT: with --include-partial-messages Claude may emit *multiple*
      // assistant events per turn (e.g. thinking-only first, then full text).
      // Stream content_block indexes (thinking=0, text=1) do NOT match the final
      // assistant content array (text-only → index 0). Match stream uuids by the
      // order of text blocks among open text streams, not raw content index.
      //
      // Never wipe stream state on thinking-only assistant events — that used to
      // force the later full-text assistant onto a new uuid → duplicate bubbles.
      const content = event.message.content as Array<{ type: string; text?: string }>;
      const textStreamUuids = [...state.streamUuids.entries()]
        .filter(([key]) => key.startsWith('text:'))
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([, id]) => id);
      let textStreamOrdinal = 0;
      let emittedFinalText = false;
      for (let i = 0; i < content.length; i++) {
        const block = content[i];
        if (block?.type === 'text' && block.text && block.text.trim()) {
          // Prefer ordinal text stream uuid, then index key, then outer uuid.
          const streamUuid =
            textStreamUuids[textStreamOrdinal] ||
            state.streamUuids.get(`text:${i}`) ||
            null;
          textStreamOrdinal += 1;
          events.push({
            type: 'text' as const,
            text: block.text,
            isStreaming: false, // Mark as final, non-streaming text
            uuid: streamUuid || uuid,
          });
          emittedFinalText = true;
        }
      }
      // Only clear stream state after we actually finalized a text row. Intermediate
      // thinking-only assistant events must leave stream uuids intact for later deltas.
      if (emittedFinalText) {
        state.suppressTextDeltas = true;
        resetClaudeStreamState(state);
      }

      // Extract tool_use blocks
      const toolUseBlocks = event.message.content.filter((b: any) => b.type === 'tool_use');
      for (const block of toolUseBlocks) {
        const toolName = block.name || 'unknown';
        // Store tool_use_id to name mapping for later tool_result matching
        if (block.id) {
          toolUseIdToName.set(block.id, toolName);
          log.log(`parseAssistantEvent: Stored mapping ${block.id} -> ${toolName}`);
        }
        const toolEvent: StandardEvent = {
          type: 'tool_start' as const,
          toolName,
          toolInput: block.input,
          toolUseId: block.id,
          uuid: block.id, // tool_use block has unique ID for deduplication
        };
        // Propagate parent_tool_use_id if present (links subagent events to parent Task invocation)
        if ((event as any).parent_tool_use_id) {
          toolEvent.parentToolUseId = (event as any).parent_tool_use_id;
        }
        // Extract subagent metadata from Task/Agent tool inputs
        if ((toolName === 'Task' || toolName === 'Agent') && block.input) {
          const input = block.input as Record<string, unknown>;
          toolEvent.subagentName = (input.name as string) || (input.description as string) || 'Subagent';
          toolEvent.subagentDescription = (input.description as string) || '';
          toolEvent.subagentType = (input.subagent_type as string) || 'general-purpose';
          toolEvent.subagentModel = (input.model as string) || undefined;
          log.log(`parseAssistantEvent: Task tool detected - name="${toolEvent.subagentName}", type="${toolEvent.subagentType}", model="${toolEvent.subagentModel || 'inherit'}"`);
        }
        events.push(toolEvent);
      }

      // Assistant messages include usage snapshots that reflect current context
      // occupancy during the turn. Emit a lightweight event so runtime state can
      // update in near real-time instead of waiting for step_complete or /context.
      if (usage) {
        events.push({
          type: 'usage_snapshot',
          tokens: {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cacheCreation: usage.cache_creation_input_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
          },
          uuid,
        });
      }

      if (events.length > 0) {
        const textCount = events.filter((e) => e.type === 'text').length;
        const toolCount = events.filter((e) => e.type === 'tool_start').length;
        log.log(`parseAssistantEvent: extracted ${textCount} text block(s), ${toolCount} tool_use block(s), usage=${usage ? 'yes' : 'no'}, uuid=${uuid}`);
        return events.length === 1 ? events[0] : events;
      }
    }

    return null;
  }

  private parseToolUseEvent(event: ClaudeRawEvent): StandardEvent | null {
    const toolName = event.tool_name || 'unknown';

    log.log(`parseToolUseEvent: tool=${toolName}, subtype=${event.subtype}, hasInput=${!!event.input}, hasResult=${!!event.result}`);

    if (event.subtype === 'input' && event.input) {
      log.log(`  -> Emitting tool_start for ${toolName}`);
      return {
        type: 'tool_start',
        toolName,
        toolInput: event.input,
      };
    } else if (event.subtype === 'result') {
      const output =
        typeof event.result === 'string'
          ? event.result
          : JSON.stringify(event.result);
      log.log(`  -> Emitting tool_result for ${toolName}, output=${output.slice(0, 100)}`);
      return {
        type: 'tool_result',
        toolName,
        toolOutput: output,
      };
    }
    log.log(`  -> No event emitted (subtype=${event.subtype}, hasInput=${!!event.input})`);
    return null;
  }

  private parseResultEvent(event: ClaudeRawEvent, agentId?: string): StandardEvent {
    log.log(`parseResultEvent: usage=${JSON.stringify(event.usage)}, modelUsage=${JSON.stringify(event.modelUsage)}, cost=${event.total_cost_usd}`);
    // Extract result text if available (used for boss delegation parsing)
    const resultText = typeof event.result === 'string' ? event.result : undefined;

    // Extract permission denials if any
    const permissionDenials = event.permission_denials?.map(denial => ({
      toolName: denial.tool_name,
      toolUseId: denial.tool_use_id,
      toolInput: denial.tool_input,
    }));

    if (permissionDenials && permissionDenials.length > 0) {
      log.log(`parseResultEvent: ${permissionDenials.length} permission denial(s)`);
    }

    // Extract modelUsage if available (contains contextWindow size).
    // A turn can bill several models — pick the one that owns the agent's
    // context window, not whichever happens to be first in key order.
    let modelUsage: StandardEvent['modelUsage'] | undefined;
    if (event.modelUsage) {
      const mainModel = this.streamState(agentId).mainModel;
      const primary = selectPrimaryModelUsage(event.modelUsage, mainModel);
      if (primary) {
        const { name: modelName, usage } = primary;
        modelUsage = {
          contextWindow: usage.contextWindow,
          maxOutputTokens: usage.maxOutputTokens,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
        };
        const billed = Object.keys(event.modelUsage);
        log.log(`parseResultEvent: modelUsage extracted - model=${modelName} (billed: ${billed.join(', ')}; mainModel=${mainModel || 'unknown'}), contextWindow=${usage.contextWindow}, cacheRead=${usage.cacheReadInputTokens}, cacheCreation=${usage.cacheCreationInputTokens}`);
      }
    }

    return {
      type: 'step_complete',
      durationMs: event.duration_ms,
      cost: event.total_cost_usd,
      tokens: event.usage
        ? {
            input: event.usage.input_tokens,
            output: event.usage.output_tokens,
            cacheCreation: event.usage.cache_creation_input_tokens,
            cacheRead: event.usage.cache_read_input_tokens,
          }
        : undefined,
      modelUsage,
      resultText,
      permissionDenials,
    };
  }

  /** Stable uuid so token-sized Claude deltas merge into one terminal row. */
  private ensureStreamUuid(state: ClaudeStreamState, kind: 'text' | 'thinking', index: number): string {
    const key = `${kind}:${index}`;
    let id = state.streamUuids.get(key);
    if (!id) {
      const msg = state.currentStreamMessageId || 'anon';
      id = `claude-stream-${msg}-${kind}-${index}`;
      state.streamUuids.set(key, id);
    }
    return id;
  }

  private parseStreamEvent(event: ClaudeRawEvent, agentId?: string): StandardEvent | null {
    const streamEvent = event.event as {
      type?: string;
      index?: number;
      delta?: { type?: string; text?: string };
      content_block?: { type?: string };
      message?: { id?: string };
    } | undefined;
    if (!streamEvent) return null;

    const state = this.streamState(agentId);

    // Capture Anthropic message id so every delta in this turn shares a stream key.
    if (streamEvent.type === 'message_start') {
      const mid = streamEvent.message?.id;
      // New message — drop any stale stream ids and reopen the stream gate.
      state.suppressTextDeltas = false;
      resetClaudeStreamState(state);
      if (typeof mid === 'string' && mid) {
        state.currentStreamMessageId = mid;
      }
      return null;
    }

    const blockIndex =
      typeof streamEvent.index === 'number' && Number.isFinite(streamEvent.index)
        ? streamEvent.index
        : 0;

    if (streamEvent.type === 'content_block_delta') {
      if (streamEvent.delta?.type === 'text_delta' && streamEvent.delta.text) {
        // Drop late deltas that race after the full assistant text already finalized.
        if (state.suppressTextDeltas) {
          return null;
        }
        return {
          type: 'text',
          text: streamEvent.delta.text,
          isStreaming: true,
          // Stable per-block id (NOT event.uuid — those differ every delta).
          uuid: this.ensureStreamUuid(state, 'text', blockIndex),
        };
      } else if (
        streamEvent.delta?.type === 'thinking_delta' &&
        streamEvent.delta.text
      ) {
        if (state.suppressTextDeltas) {
          return null;
        }
        return {
          type: 'thinking',
          text: streamEvent.delta.text,
          isStreaming: true,
          uuid: this.ensureStreamUuid(state, 'thinking', blockIndex),
        };
      }
    } else if (streamEvent.type === 'content_block_start') {
      const blockType = streamEvent.content_block?.type;
      if (blockType === 'text' || blockType === 'thinking') {
        const streamUuid = this.ensureStreamUuid(state, blockType, blockIndex);
        return {
          type: 'block_start',
          blockType: blockType,
          uuid: streamUuid,
        };
      }
    } else if (streamEvent.type === 'content_block_stop') {
      // Keep stream uuids alive until the assistant final message lands so
      // parseAssistantEvent can reuse them for isStreaming:false finalize.
      return {
        type: 'block_end',
        uuid: event.uuid,
      };
    } else if (streamEvent.type === 'message_stop') {
      // If no assistant event follows (rare), leave state for next message_start.
      return null;
    }
    return null;
  }

  /**
   * Extract session ID from raw event
   */
  extractSessionId(rawEvent: unknown): string | null {
    const event = rawEvent as ClaudeRawEvent;
    if (event.type === 'system' && event.subtype === 'init') {
      return event.session_id || null;
    }
    return null;
  }

  /**
   * Get Claude Code executable path
   */
  getExecutablePath(): string {
    const detected = this.detectInstallation();
    return detected || 'claude';
  }

  /**
   * Detect Claude Code CLI installation locations
   */
  detectInstallation(): string | null {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';

    const possiblePaths = isWindows
      ? [
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(
            homeDir,
            'AppData',
            'Local',
            'Programs',
            'claude',
            'claude.exe'
          ),
          path.join(homeDir, '.bun', 'bin', 'claude.exe'),
        ]
      : [
          path.join(homeDir, '.local', 'bin', 'claude'),
          path.join(homeDir, '.bun', 'bin', 'claude'),
          '/usr/local/bin/claude',
          '/usr/bin/claude',
        ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Claude requires stdin input for prompts
   */
  requiresStdinInput(): boolean {
    return true;
  }

  /**
   * Format prompt as stdin input for Claude CLI (stream-json format)
   */
  formatStdinInput(prompt: string): string {
    // Sanitize prompt to remove invalid Unicode surrogates that break JSON
    let sanitizedPrompt = sanitizeUnicode(prompt);

    // Echo Prompt: duplicate the user message for improved attention coverage.
    // On the second pass every token can attend to every other token.
    // Bare slash commands are exempt: doubling `/compact` into
    // `/compact\n\n---\n\n/compact` stops it being a bare command and the CLI
    // treats it as plain text. Codex/OpenCode already skip echo for these
    // (see buildCodexPrompt / buildOpencodePrompt) — Claude must match.
    if (isEchoPromptEnabled() && !isBareSlashCommand(sanitizedPrompt)) {
      log.log(` Echo prompt enabled - duplicating user message (${sanitizedPrompt.length} chars)`);
      sanitizedPrompt = sanitizedPrompt + '\n\n---\n\n' + sanitizedPrompt;
    }

    return JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: sanitizedPrompt,
      },
    });
  }
}

/**
 * Parse the /context command output from Claude Code
 * Example format:
 * ## Context Usage
 * **Model:** claude-opus-4-5-20251101
 * **Tokens:** 19.6k / 200.0k (10%)
 *
 * ### Categories
 * | Category | Tokens | Percentage |
 * |----------|--------|------------|
 * | System prompt | 3.1k | 1.6% |
 * | System tools | 16.5k | 8.3% |
 * | Messages | 8 | 0.0% |
 * | Free space | 135.4k | 67.7% |
 * | Autocompact buffer | 45.0k | 22.5% |
 */
export function parseContextOutput(content: string): import('../../shared/types.js').ContextStats | null {
  try {
    const parseTokenValue = (raw: string): number => {
      const normalized = raw.trim().replace(/,/g, '');
      const suffix = normalized.slice(-1).toLowerCase();
      const numericPart = suffix === 'k' || suffix === 'm'
        ? normalized.slice(0, -1)
        : normalized;
      const value = parseFloat(numericPart);
      if (!Number.isFinite(value)) return NaN;
      if (suffix === 'k') return value * 1000;
      if (suffix === 'm') return value * 1000000;
      return value;
    };

    // Extract model name
    const modelMatch = content.match(/(?:\*\*)?Model:(?:\*\*)?\s*(.+)/i);
    let model = modelMatch ? modelMatch[1].trim() : 'unknown';

    // Extract total tokens and context window
    // Format examples:
    // **Tokens:** 19.6k / 200.0k (10%)
    // **Tokens:** 46,123 / 200,000 (23.4%)
    // claude-opus-4-6 · 46k/200k tokens (23%)
    const tokensMatch = content.match(/(?:\*\*)?Tokens:(?:\*\*)?\s*([\d.,]+(?:[kKmM])?)\s*\/\s*([\d.,]+(?:[kKmM])?)\s*\(([\d.]+)%\)/i);
    const visualMatch = content.match(/([^\n]+?)\s*[·•]\s*([\d.,]+(?:[kKmM])?)\s*\/\s*([\d.,]+(?:[kKmM])?)\s*tokens?\s*\(([\d.]+)%\)/i);
    if (!tokensMatch && !visualMatch) {
      log.log('parseContextOutput: Could not parse tokens line');
      return null;
    }

    let totalTokenRaw = '';
    let contextWindowRaw = '';
    let usedPercentRaw = '';
    if (visualMatch) {
      model = visualMatch[1].trim();
      totalTokenRaw = visualMatch[2];
      contextWindowRaw = visualMatch[3];
      usedPercentRaw = visualMatch[4];
    } else if (tokensMatch) {
      totalTokenRaw = tokensMatch[1];
      contextWindowRaw = tokensMatch[2];
      usedPercentRaw = tokensMatch[3];
    }

    const totalTokens = parseTokenValue(totalTokenRaw);
    const contextWindow = parseTokenValue(contextWindowRaw);
    const usedPercent = parseFloat(usedPercentRaw);
    if (!Number.isFinite(totalTokens) || !Number.isFinite(contextWindow) || !Number.isFinite(usedPercent)) {
      log.log('parseContextOutput: Parsed non-finite token values');
      return null;
    }

    // Parse category table
    const parseCategory = (name: string): { tokens: number; percent: number } => {
      // Match: | Category Name | 3.1k | 1.6% |
      const regex = new RegExp(`\\|\\s*${name}\\s*\\|\\s*([\\d.,]+(?:[kKmM])?)\\s*\\|\\s*([\\d.]+)%\\s*\\|`, 'i');
      const match = content.match(regex);
      if (match) {
        const tokens = parseTokenValue(match[1]);
        return { tokens, percent: parseFloat(match[2]) };
      }
      return { tokens: 0, percent: 0 };
    };

    const categories = {
      systemPrompt: parseCategory('System prompt'),
      systemTools: parseCategory('System tools'),
      messages: parseCategory('Messages'),
      freeSpace: parseCategory('Free space'),
      autocompactBuffer: parseCategory('Autocompact buffer'),
    };

    return {
      model,
      contextWindow,
      totalTokens,
      usedPercent,
      categories,
      lastUpdated: Date.now(),
    };
  } catch (error) {
    log.error('parseContextOutput error:', error);
    return null;
  }
}
