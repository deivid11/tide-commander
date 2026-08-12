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
 * One agentic run spans several turn_start/turn_end pairs (one per LLM call);
 * step_complete is emitted on agent_end only. Deltas stream token-by-token, so
 * we mint a stable uuid per (message, contentIndex) block for client merging.
 */

import type { StandardEvent } from '../claude/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PiParser');

interface PiContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
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
  content?: PiContentBlock;
}

interface PiRawEvent {
  type?: string;
  id?: string;
  message?: PiMessage;
  assistantMessageEvent?: PiAssistantMessageEvent;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: { content?: PiContentBlock[] } | string;
  isError?: boolean;
  reason?: string;
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
  /** Usage from the last assistant message_end (context accounting + cost). */
  private lastUsage: PiUsage | undefined;
  private lastErrorMessage: string | undefined;

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
        return this.parseAgentEnd();
      case 'compaction_start':
        return [{ type: 'compacting' }];
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
      case 'compaction_end':
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
        const full = ame.content?.text ?? this.lastTextContent;
        if (!full) return [];
        this.lastTextContent = full;
        this.textEventEmittedInRun = true;
        return [{ type: 'text', text: full, isStreaming: false, uuid }];
      }
      case 'thinking_end': {
        const uuid = this.openThinkingStreams.get(idx) ?? this.streamUuid('thinking', idx);
        this.openThinkingStreams.delete(idx);
        const full = ame.content?.thinking ?? '';
        if (!full) return [];
        this.lastThinkingContent = full;
        return [{ type: 'thinking', text: full, isStreaming: false, uuid }];
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
    const toolStart: StandardEvent = {
      type: 'tool_start',
      toolName,
      toolInput: event.args,
    };
    if (event.toolCallId) {
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
      toolResult.toolUseId = event.toolCallId;
      toolResult.uuid = event.toolCallId;
    }
    return [toolResult];
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

    return events;
  }
}
