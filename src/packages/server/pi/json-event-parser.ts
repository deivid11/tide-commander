/**
 * Pi coding agent JSON event parser.
 * Maps NDJSON events from `pi --mode json -p …` to StandardEvent.
 *
 * Pi's stream (docs/json.md in @earendil-works/pi-coding-agent):
 *  - {"type":"session", id, cwd, …}                    → session header (id handled by backend.extractSessionId)
 *  - agent_start / turn_start / turn_end / agent_end   → run + LLM-call lifecycle
 *  - message_start/message_update/message_end          → assistant message with assistantMessageEvent deltas
 *      assistantMessageEvent: text_start/text_delta/text_end,
 *      thinking_start/thinking_delta/thinking_end, toolcall_start/toolcall_delta/toolcall_end
 *  - tool_execution_start / tool_execution_update / tool_execution_end
 *
 * One session-level run spans several turn_start/turn_end pairs and may continue
 * through retry/compaction after agent_end. step_complete is emitted only on
 * agent_settled (or manual compaction_end). Deltas stream token-by-token, so we
 * mint a stable uuid per (message, contentIndex) block for client merging.
 */

import type { StandardEvent } from '../claude/types.js';
import { createLogger } from '../utils/logger.js';
import { normalizePiToolInput } from './tool-input.js';
import { extractPiReasoningMetadata } from './reasoning-metadata.js';

const log = createLogger('PiParser');

interface PiContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
}

interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

interface PiMessage {
  role?: string;
  content?: string | PiContentBlock[];
  usage?: PiUsage;
  stopReason?: string;
  errorMessage?: string | null;
  model?: string;
}

interface PiAssistantMessageEvent {
  type?: string;
  contentIndex?: number;
  delta?: string;
  // Current Pi emits the completed block as a string; older releases emitted
  // the typed content object. Accept both for resumable sessions across upgrades.
  content?: PiContentBlock | string;
}

interface PiRawEvent {
  type?: string;
  id?: string;
  message?: PiMessage;
  assistantMessageEvent?: PiAssistantMessageEvent;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: {
    content?: PiContentBlock[];
    details?: { patch?: unknown; firstChangedLine?: unknown };
    tokensBefore?: number;
    estimatedTokensAfter?: number;
    usage?: PiUsage;
  } | string | null;
  isError?: boolean;
  reason?: string;
  aborted?: boolean;
  errorMessage?: string;
}

// Pi uses lowercase tool names; normalize to Claude's capitalized format so
// frontend rendering (TOOL_ICONS, recognizedTools, etc.) works correctly.
const TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  multiedit: 'MultiEdit',
  glob: 'Glob',
  grep: 'Grep',
  ls: 'LS',
  find: 'Find',
  todowrite: 'TodoWrite',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  // pi-web-access extension tools
  web_search: 'WebSearch',
  fetch_content: 'WebFetch',
  get_search_content: 'WebFetch',
};

function normalizeToolName(raw: string): string {
  return TOOL_NAME_MAP[raw.toLowerCase()] || raw;
}

function extractResultText(result: PiRawEvent['result']): string {
  if (typeof result === 'string') return result;
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

export class PiJsonEventParser {
  /** Session id from the stream header — attached to init events. */
  private sessionId: string | undefined;
  /** Increments per assistant message so stream uuids never collide across turns. */
  private messageCounter = 0;
  /** Last assistant text of the run — becomes step_complete.resultText. */
  private lastTextContent = '';
  private lastThinkingContent = '';
  private textEventEmittedInRun = false;
  /** Open streaming uuids (by contentIndex) awaiting their *_end finalize. */
  private openTextStreams = new Map<number, string>();
  private openThinkingStreams = new Map<number, string>();
  /** Completed plaintext thinking held until message_end adds usage/signature metadata. */
  private completedThinking = new Map<number, { text: string; uuid: string }>();
  /** Usage from the last assistant message_end (context accounting + cost). */
  private lastUsage: PiUsage | undefined;
  private lastErrorMessage: string | undefined;
  /** Start args retained until Pi returns the exact edit patch. */
  private toolInputs = new Map<string, { toolName: string; args: Record<string, unknown> }>();

  parseEvent(rawEvent: unknown): StandardEvent[] {
    const event = rawEvent as PiRawEvent;
    if (!event || typeof event !== 'object' || !event.type) {
      return [];
    }

    log.debug(`parseEvent: type=${event.type}`);

    switch (event.type) {
      case 'session':
        // Session header — id is also consumed by backend.extractSessionId.
        if (typeof event.id === 'string' && event.id) {
          this.sessionId = event.id;
        }
        return [];
      case 'agent_start':
        return [{ type: 'init', sessionId: this.sessionId, model: 'pi' }];
      case 'message_start':
        return this.parseMessageStart(event);
      case 'message_update':
        return this.parseMessageUpdate(event);
      case 'message_end':
        return this.parseMessageEnd(event);
      case 'tool_execution_start':
        return this.parseToolStart(event);
      case 'tool_execution_end':
        return this.parseToolEnd(event);
      case 'agent_end':
        // A low-level agent run may still be followed by overflow compaction,
        // retry, or queued continuations. `agent_settled` is the only true
        // session-level idle boundary.
        return [];
      case 'agent_settled':
        return this.parseAgentEnd();
      case 'compaction_start':
        return [{ type: 'compacting' }];
      case 'compaction_end':
        return this.parseCompactionEnd(event);
      case 'auto_retry_start':
        return [{
          type: 'text',
          text: `(Pi auto-retry: ${event.errorMessage || 'transient error'})`,
          isStreaming: false,
          uuid: `pi-retry-${this.messageCounter}-${Date.now()}`,
        }];
      // Lifecycle/no-op events for the UI. `response` is the RPC-mode command
      // acknowledgment envelope (handled by the RPC runner, not the UI stream).
      case 'turn_start':
      case 'turn_end':
      case 'tool_execution_update':
      case 'queue_update':
      case 'auto_retry_end':
      case 'response':
        return [];
      default:
        log.log(`parseEvent: unknown event type '${event.type}' - skipping`);
        return [];
    }
  }

  private streamUuid(kind: 'text' | 'thinking', contentIndex: number): string {
    return `pi-${kind}-${this.messageCounter}-${contentIndex}`;
  }

  private parseMessageStart(event: PiRawEvent): StandardEvent[] {
    if (event.message?.role === 'assistant') {
      this.messageCounter++;
      this.openTextStreams.clear();
      this.openThinkingStreams.clear();
      this.completedThinking.clear();
    }
    return [];
  }

  private parseMessageUpdate(event: PiRawEvent): StandardEvent[] {
    const ame = event.assistantMessageEvent;
    if (!ame?.type) return [];
    const idx = ame.contentIndex ?? 0;

    switch (ame.type) {
      case 'text_delta': {
        if (!ame.delta) return [];
        const uuid = this.streamUuid('text', idx);
        this.openTextStreams.set(idx, uuid);
        this.lastTextContent += ame.delta;
        this.textEventEmittedInRun = true;
        return [{ type: 'text', text: ame.delta, isStreaming: true, uuid }];
      }
      case 'thinking_delta': {
        if (!ame.delta) return [];
        const uuid = this.streamUuid('thinking', idx);
        this.openThinkingStreams.set(idx, uuid);
        return [{ type: 'thinking', text: ame.delta, isStreaming: true, uuid }];
      }
      case 'text_start': {
        // Reset the text accumulator for this block.
        this.lastTextContent = '';
        return [];
      }
      case 'text_end': {
        const uuid = this.openTextStreams.get(idx) ?? this.streamUuid('text', idx);
        this.openTextStreams.delete(idx);
        const full = typeof ame.content === 'string'
          ? ame.content
          : ame.content?.text ?? this.lastTextContent;
        if (!full) return [];
        this.lastTextContent = full;
        this.textEventEmittedInRun = true;
        return [{ type: 'text', text: full, isStreaming: false, uuid }];
      }
      case 'thinking_end': {
        const uuid = this.openThinkingStreams.get(idx) ?? this.streamUuid('thinking', idx);
        this.openThinkingStreams.delete(idx);
        const full = typeof ame.content === 'string'
          ? ame.content
          : ame.content?.thinking ?? '';
        if (!full) return [];
        this.lastThinkingContent = full;
        // message_end carries authoritative usage + thinkingSignature. Defer the
        // final row a few milliseconds so the UI can label summary-only OpenAI
        // reasoning and show how many hidden reasoning tokens were consumed.
        this.completedThinking.set(idx, { text: full, uuid });
        return [];
      }
      // Tool-call arg streaming is covered by tool_execution_start.
      case 'thinking_start':
      case 'toolcall_start':
      case 'toolcall_delta':
      case 'toolcall_end':
        return [];
      default:
        return [];
    }
  }

  private parseMessageEnd(event: PiRawEvent): StandardEvent[] {
    const message = event.message;
    if (message?.role !== 'assistant') return [];

    const events: StandardEvent[] = [];

    // Finalize every thinking block with the metadata unavailable on streamed
    // deltas. For OpenAI/Codex Responses models, Pi persists only plaintext
    // summary titles plus an encrypted detailed-reasoning payload.
    const blocks = Array.isArray(message.content) ? message.content : [];
    const thinkingIndexes = new Set<number>();
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (block?.type !== 'thinking') continue;
      const completed = this.completedThinking.get(index);
      const text = block.thinking || completed?.text || '';
      if (!text) continue;
      thinkingIndexes.add(index);
      this.lastThinkingContent = text;
      events.push({
        type: 'thinking',
        text,
        isStreaming: false,
        uuid: completed?.uuid ?? this.streamUuid('thinking', index),
        ...extractPiReasoningMetadata(block.thinkingSignature, message.usage?.reasoning),
      });
    }
    // Defensive fallback for aborted/legacy messages whose message_end omits
    // content even though a thinking_end event already supplied the text.
    for (const [index, completed] of this.completedThinking) {
      if (thinkingIndexes.has(index)) continue;
      events.push({
        type: 'thinking',
        text: completed.text,
        isStreaming: false,
        uuid: completed.uuid,
        ...extractPiReasoningMetadata(undefined, message.usage?.reasoning),
      });
    }
    this.completedThinking.clear();

    if (message.stopReason === 'error' && message.errorMessage) {
      this.lastErrorMessage = message.errorMessage;
      events.push({ type: 'error', errorMessage: message.errorMessage });
    }

    // Track usage for context accounting; input+cacheRead approximates context.
    if (message.usage && (message.usage.input || message.usage.output || message.usage.totalTokens)) {
      this.lastUsage = message.usage;
      events.push({
        type: 'usage_snapshot',
        model: message.model,
        tokens: {
          input: message.usage.input || 0,
          output: message.usage.output || 0,
          cacheCreation: message.usage.cacheWrite || 0,
          cacheRead: message.usage.cacheRead || 0,
        },
      });
    }

    return events;
  }

  private parseToolStart(event: PiRawEvent): StandardEvent[] {
    const toolName = normalizeToolName(event.toolName || 'unknown');
    const args = event.args || {};
    const toolInput = normalizePiToolInput(toolName, args);
    const toolStart: StandardEvent = {
      type: 'tool_start',
      toolName,
      toolInput,
    };
    if (event.toolCallId) {
      this.toolInputs.set(event.toolCallId, { toolName, args });
      toolStart.toolUseId = event.toolCallId;
      toolStart.uuid = event.toolCallId;
    }
    return [toolStart];
  }

  private parseToolEnd(event: PiRawEvent): StandardEvent[] {
    const toolName = normalizeToolName(event.toolName || 'unknown');
    let output = extractResultText(event.result);
    if (event.isError && output) {
      output = `Error: ${output}`;
    }
    const toolResult: StandardEvent = {
      type: 'tool_result',
      toolName,
      toolOutput: output,
    };
    if (event.toolCallId) {
      const pending = this.toolInputs.get(event.toolCallId);
      this.toolInputs.delete(event.toolCallId);
      toolResult.toolUseId = event.toolCallId;
      toolResult.uuid = event.toolCallId;
      if (toolName === 'Edit' && pending) {
        const details = typeof event.result === 'object' ? event.result?.details : undefined;
        toolResult.toolInput = normalizePiToolInput(pending.toolName, pending.args, details);
      }
    }
    return [toolResult];
  }

  private parseCompactionEnd(event: PiRawEvent): StandardEvent[] {
    if (!event.result || typeof event.result === 'string') {
      return [{
        type: 'text',
        text: event.aborted
          ? '(Pi compaction aborted)'
          : `(Pi compaction failed: ${event.errorMessage || 'unknown error'})`,
        isStreaming: false,
        uuid: `pi-compaction-end-${Date.now()}`,
      }];
    }

    const events: StandardEvent[] = [{
      type: 'text',
      // Reuse the existing compacted-pill renderer in both live and history.
      text: '<local-command-stdout>Compacted</local-command-stdout>',
      isStreaming: false,
      uuid: `pi-compaction-end-${Date.now()}`,
    }];
    const estimatedTokensAfter = event.result.estimatedTokensAfter;
    if (typeof estimatedTokensAfter === 'number' && estimatedTokensAfter > 0) {
      events.push({
        type: 'usage_snapshot',
        tokens: { input: estimatedTokensAfter, output: 0, cacheRead: 0, cacheCreation: 0 },
      });
    }
    if (event.reason === 'manual') {
      // Native RPC compaction has no agent_settled. Finalize the runner and
      // clear RunnerStdoutPipeline's per-turn streaming state here.
      events.push({ type: 'step_complete' });
    }
    return events;
  }

  private parseAgentEnd(): StandardEvent[] {
    const events: StandardEvent[] = [];

    const stepComplete: StandardEvent = {
      type: 'step_complete',
    };

    if (this.lastUsage) {
      stepComplete.tokens = {
        input: this.lastUsage.input || 0,
        output: this.lastUsage.output || 0,
        cacheCreation: this.lastUsage.cacheWrite || 0,
        cacheRead: this.lastUsage.cacheRead || 0,
      };
      stepComplete.cost = this.lastUsage.cost?.total;
    }

    if (this.lastTextContent) {
      stepComplete.resultText = this.lastTextContent;
    } else if (this.lastErrorMessage) {
      stepComplete.resultText = `(Pi error: ${this.lastErrorMessage})`;
    } else if (this.lastThinkingContent && !this.textEventEmittedInRun) {
      // Thinking-only run — surface a marker so the terminal isn't blank.
      stepComplete.resultText = '(Empty response: thinking only)';
    }

    events.push(stepComplete);

    // Reset for the next run (respawn reuses the parser instance).
    this.lastTextContent = '';
    this.lastThinkingContent = '';
    this.textEventEmittedInRun = false;
    this.lastUsage = undefined;
    this.lastErrorMessage = undefined;
    this.openTextStreams.clear();
    this.openThinkingStreams.clear();
    this.completedThinking.clear();
    this.toolInputs.clear();

    return events;
  }
}
