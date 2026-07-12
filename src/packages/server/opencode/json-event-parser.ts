/**
 * OpenCode JSON Event Parser
 * Maps OpenCode NDJSON events to StandardEvent format.
 *
 * Streaming model (mirrors Claude/Grok):
 *  - `message.part.delta` → append delta with isStreaming:true + stable partID uuid
 *  - progressive `text` / `reasoning` snapshots (same part.id, growing text) →
 *    emit only the new suffix as a streaming chunk
 *  - final text (part.time.end set, or step_finish) → isStreaming:false same uuid
 *
 * Note: current `opencode run --format json` often emits a single complete `text`
 * event per turn (no token deltas). This parser still assigns stable uuids and is
 * ready for delta / progressive events when the CLI surfaces them.
 */

import type { StandardEvent } from '../claude/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OpencodeParser');

interface OpencodePart {
  id?: string;
  messageID?: string;
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  title?: string;
  reason?: string;
  field?: string;
  delta?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    output?: string;
  };
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: {
      write?: number;
      read?: number;
    };
  };
  cost?: number;
  time?: {
    start?: number;
    end?: number;
  };
}

interface OpencodeRawEvent {
  type?: string;
  timestamp?: number;
  sessionID?: string;
  part?: OpencodePart;
  // Server-style envelope used by some OpenCode event streams
  properties?: {
    sessionID?: string;
    messageID?: string;
    partID?: string;
    field?: string;
    delta?: string;
    part?: OpencodePart;
  };
}

// OpenCode uses lowercase tool names; normalize to match Claude's capitalized format
// so the frontend rendering (TOOL_ICONS, recognizedTools, etc.) works correctly.
const TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Task',
  agent: 'Agent',
  skill: 'Skill',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  todowrite: 'TodoWrite',
  notebookedit: 'NotebookEdit',
  askuserquestion: 'AskUserQuestion',
  askfollowupquestion: 'AskFollowupQuestion',
  toolsearch: 'ToolSearch',
  enterplanmode: 'EnterPlanMode',
  exitplanmode: 'ExitPlanMode',
};

function normalizeToolName(raw: string): string {
  return TOOL_NAME_MAP[raw.toLowerCase()] || raw;
}

export class OpencodeJsonEventParser {
  private lastTextContent: string | undefined;
  private textEventEmittedInTurn = false;
  private lastThinkingContent: string | undefined;
  private thinkingEventEmittedInTurn = false;

  /** Full text seen so far per part id — used to derive deltas from snapshots. */
  private streamedTextByPart = new Map<string, string>();
  private streamedThinkingByPart = new Map<string, string>();
  /** Open text/thinking stream uuids awaiting isStreaming:false finalize. */
  private openTextStreamUuids = new Set<string>();
  private openThinkingStreamUuids = new Set<string>();

  parseEvent(rawEvent: unknown): StandardEvent[] {
    const event = rawEvent as OpencodeRawEvent;
    if (!event || typeof event !== 'object' || !event.type) {
      return [];
    }

    // debug-level: in `opencode serve` mode this fires once per token delta, so
    // keep it out of the default log stream to avoid per-token log spam.
    log.debug(`parseEvent: type=${event.type}, sessionID=${event.sessionID || 'none'}`);

    switch (event.type) {
      case 'step_start':
        return this.parseStepStart(event);
      case 'text':
        return this.parseText(event);
      case 'reasoning':
        return this.parseReasoning(event);
      case 'tool_use':
        return this.parseToolUse(event);
      case 'step_finish':
        return this.parseStepFinish(event);
      // Server/SDK event names — surface token deltas when present.
      case 'message.part.delta':
        return this.parseMessagePartDelta(event);
      case 'message.part.updated':
        return this.parseMessagePartUpdated(event);
      default:
        log.log(`parseEvent: unknown event type '${event.type}' - skipping`);
        return [];
    }
  }

  private parseStepStart(event: OpencodeRawEvent): StandardEvent[] {
    // New step — allow streams again.
    this.openTextStreamUuids.clear();
    this.openThinkingStreamUuids.clear();
    this.streamedTextByPart.clear();
    this.streamedThinkingByPart.clear();
    return [{
      type: 'init',
      sessionId: event.sessionID,
    }];
  }

  private streamUuid(kind: 'text' | 'thinking', partId: string | undefined, messageId: string | undefined): string {
    if (partId) return `opencode-${kind}-${partId}`;
    if (messageId) return `opencode-${kind}-msg-${messageId}`;
    return `opencode-${kind}-anon`;
  }

  /**
   * Emit streaming text from a full snapshot: only the new suffix is sent as a
   * delta so the client can append. Returns [] when the snapshot is unchanged.
   */
  private emitProgressive(
    kind: 'text' | 'thinking',
    fullText: string,
    partId: string | undefined,
    messageId: string | undefined,
    isFinal: boolean,
  ): StandardEvent[] {
    const map = kind === 'text' ? this.streamedTextByPart : this.streamedThinkingByPart;
    const openSet = kind === 'text' ? this.openTextStreamUuids : this.openThinkingStreamUuids;
    const key = partId || messageId || 'anon';
    const prev = map.get(key) || '';
    const uuid = this.streamUuid(kind, partId, messageId);

    if (kind === 'text') {
      this.lastTextContent = fullText;
      this.textEventEmittedInTurn = true;
    } else {
      this.lastThinkingContent = fullText;
      this.thinkingEventEmittedInTurn = true;
    }

    // Unchanged snapshot (common re-broadcast) — only finalize if needed.
    if (fullText === prev) {
      if (isFinal && openSet.has(uuid)) {
        openSet.delete(uuid);
        return [{
          type: kind === 'text' ? 'text' : 'thinking',
          text: fullText,
          isStreaming: false,
          uuid,
        }];
      }
      return [];
    }

    map.set(key, fullText);

    // Growing prefix → emit suffix as streaming chunk.
    if (fullText.startsWith(prev) && !isFinal) {
      const delta = fullText.slice(prev.length);
      if (!delta) return [];
      openSet.add(uuid);
      return [{
        type: kind === 'text' ? 'text' : 'thinking',
        text: delta,
        isStreaming: true,
        uuid,
      }];
    }

    // Non-prefix rewrite or final: replace with full text.
    if (isFinal) {
      openSet.delete(uuid);
      return [{
        type: kind === 'text' ? 'text' : 'thinking',
        text: fullText,
        isStreaming: false,
        uuid,
      }];
    }

    openSet.add(uuid);
    // Client merge appends when isStreaming; for rewrites send full text with
    // isStreaming:false then... no, that finalizes early. Prefer replace path:
    // emit as streaming full text only if prev empty; else finalize+restart.
    if (!prev) {
      return [{
        type: kind === 'text' ? 'text' : 'thinking',
        text: fullText,
        isStreaming: true,
        uuid,
      }];
    }
    // Rare rewrite: finalize with new full content.
    openSet.delete(uuid);
    return [{
      type: kind === 'text' ? 'text' : 'thinking',
      text: fullText,
      isStreaming: false,
      uuid,
    }];
  }

  private parseText(event: OpencodeRawEvent): StandardEvent[] {
    const part = event.part;
    const text = part?.text;
    if (!text) return [];

    // CLI format marks completion with time.end; absence → treat as progressive.
    const isFinal = typeof part?.time?.end === 'number';
    return this.emitProgressive('text', text, part?.id, part?.messageID, isFinal);
  }

  private parseReasoning(event: OpencodeRawEvent): StandardEvent[] {
    const part = event.part;
    const text = part?.text;
    if (!text) return [];
    const isFinal = typeof part?.time?.end === 'number';
    return this.emitProgressive('thinking', text, part?.id, part?.messageID, isFinal);
  }

  private parseMessagePartDelta(event: OpencodeRawEvent): StandardEvent[] {
    const props = event.properties || {};
    const delta = props.delta ?? event.part?.delta;
    const field = props.field || event.part?.field || 'text';
    const partId = props.partID || event.part?.id;
    const messageId = props.messageID || event.part?.messageID;
    if (typeof delta !== 'string' || !delta) return [];

    const kind: 'text' | 'thinking' =
      field === 'reasoning' || field === 'thinking' ? 'thinking' : 'text';
    const map = kind === 'text' ? this.streamedTextByPart : this.streamedThinkingByPart;
    const openSet = kind === 'text' ? this.openTextStreamUuids : this.openThinkingStreamUuids;
    const key = partId || messageId || 'anon';
    const next = (map.get(key) || '') + delta;
    map.set(key, next);

    if (kind === 'text') {
      this.lastTextContent = next;
      this.textEventEmittedInTurn = true;
    } else {
      this.lastThinkingContent = next;
      this.thinkingEventEmittedInTurn = true;
    }

    const uuid = this.streamUuid(kind, partId, messageId);
    openSet.add(uuid);
    return [{
      type: kind === 'text' ? 'text' : 'thinking',
      text: delta,
      isStreaming: true,
      uuid,
    }];
  }

  private parseMessagePartUpdated(event: OpencodeRawEvent): StandardEvent[] {
    const part = event.properties?.part || event.part;
    if (!part?.text) return [];
    const kind: 'text' | 'thinking' =
      part.type === 'reasoning' || part.type === 'thinking' ? 'thinking' : 'text';
    const isFinal = typeof part.time?.end === 'number';
    return this.emitProgressive(kind, part.text, part.id, part.messageID, isFinal);
  }

  private parseToolUse(event: OpencodeRawEvent): StandardEvent[] {
    const part = event.part;
    if (!part) return [];

    const toolName = normalizeToolName(part.tool || 'unknown');
    const callId = part.callID;
    const state = part.state;
    const events: StandardEvent[] = [];

    // Emit tool_start
    const toolStart: StandardEvent = {
      type: 'tool_start',
      toolName,
      toolInput: state?.input,
    };
    if (callId) {
      toolStart.toolUseId = callId;
      toolStart.uuid = callId;
    }
    events.push(toolStart);

    // Emit tool_result if state is present (completed tool)
    if (state) {
      const toolResult: StandardEvent = {
        type: 'tool_result',
        toolName,
        toolOutput: state.output || '',
      };
      if (callId) {
        toolResult.toolUseId = callId;
        toolResult.uuid = callId;
      }
      events.push(toolResult);
    }

    return events;
  }

  private parseStepFinish(event: OpencodeRawEvent): StandardEvent[] {
    const part = event.part;
    if (!part) return [];

    const events: StandardEvent[] = [];
    const tokens = part.tokens;

    // Finalize any open streaming rows so the UI stops the "live" cursor.
    for (const uuid of this.openTextStreamUuids) {
      const text = this.lastTextContent || '';
      if (text) {
        events.push({
          type: 'text',
          text,
          isStreaming: false,
          uuid,
        });
      }
    }
    this.openTextStreamUuids.clear();

    for (const uuid of this.openThinkingStreamUuids) {
      const text = this.lastThinkingContent || '';
      if (text) {
        events.push({
          type: 'thinking',
          text,
          isStreaming: false,
          uuid,
        });
      }
    }
    this.openThinkingStreamUuids.clear();

    // Emit usage_snapshot if token info is available
    if (tokens) {
      events.push({
        type: 'usage_snapshot',
        tokens: {
          input: tokens.input || 0,
          output: tokens.output || 0,
          cacheCreation: tokens.cache?.write || 0,
          cacheRead: tokens.cache?.read || 0,
        },
      });
    }

    // Emit step_complete
    const stepComplete: StandardEvent = {
      type: 'step_complete',
      cost: part.cost,
      tokens: tokens ? {
        input: tokens.input || 0,
        output: tokens.output || 0,
        cacheCreation: tokens.cache?.write || 0,
        cacheRead: tokens.cache?.read || 0,
      } : undefined,
    };

    // Include resultText for boss delegation parsing when the step ends normally.
    // Always set it so delegation parsing works, but the stdout-pipeline's
    // textEmittedInTurn guard will prevent duplicate output display.
    if (part.reason === 'stop' && this.lastTextContent) {
      stepComplete.resultText = this.lastTextContent;
    }

    // When the model returns only thinking/reasoning with no text, emit an
    // "Empty response" indicator so the Guake terminal shows something instead
    // of appearing to hang or skip the turn.
    if (!this.lastTextContent && this.lastThinkingContent) {
      const emptyResponse = {
        content: [{ type: 'thinking', thinking: this.lastThinkingContent }],
        stop_reason: part.reason || 'end_turn',
        usage: {
          input_tokens: tokens?.input || 0,
          output_tokens: tokens?.output || 0,
        },
      };
      stepComplete.resultText = `(Empty response: ${JSON.stringify(emptyResponse)})`;
    }

    events.push(stepComplete);

    // Reset tracking for next turn
    this.lastTextContent = undefined;
    this.textEventEmittedInTurn = false;
    this.lastThinkingContent = undefined;
    this.thinkingEventEmittedInTurn = false;
    this.streamedTextByPart.clear();
    this.streamedThinkingByPart.clear();

    return events;
  }
}
