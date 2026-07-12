/**
 * OpencodeServerEventAdapter
 *
 * Translates `opencode serve` SSE events into Tide StandardEvents, one adapter
 * per agent. Text/reasoning streaming and turn-end finalization are delegated to
 * the existing OpencodeJsonEventParser (its `message.part.delta` /
 * `message.part.updated` handling already matches the server's `properties`
 * shape exactly), so the streaming behaviour is identical to the exec path.
 *
 * The adapter only adds what the server surfaces differently from `opencode run`:
 *  - tool parts (`part.type === 'tool'`) → tool_start (once) + tool_result (on
 *    completion), since the server streams them as message.part.updated rather
 *    than the `tool_use` events the parser expects;
 *  - `session.idle` → a synthetic `step_finish` fed through the parser so its
 *    stream-finalization + step_complete/resultText logic is reused verbatim;
 *  - assistant token/cost capture from `message.updated`, injected into that
 *    synthetic step_finish for context tracking.
 */

import type { StandardEvent } from '../../claude/types.js';
import { OpencodeJsonEventParser } from '../json-event-parser.js';

const TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', glob: 'Glob', grep: 'Grep',
  task: 'Task', agent: 'Agent', skill: 'Skill', webfetch: 'WebFetch', websearch: 'WebSearch',
  todowrite: 'TodoWrite', notebookedit: 'NotebookEdit', askuserquestion: 'AskUserQuestion',
};

function normalizeToolName(raw: string): string {
  return TOOL_NAME_MAP[raw.toLowerCase()] || raw;
}

interface OpencodePartLike {
  id?: string;
  messageID?: string;
  type?: string;
  tool?: string;
  callID?: string;
  state?: { status?: string; input?: Record<string, unknown>; output?: string };
}

interface CapturedTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

export class OpencodeServerEventAdapter {
  private readonly parser = new OpencodeJsonEventParser();
  private readonly toolStarted = new Set<string>();
  private readonly toolInputSent = new Set<string>();
  private readonly toolDone = new Set<string>();
  /** messageID → role, so we can drop the user message's own echoed parts. */
  private readonly messageRole = new Map<string, string>();
  /** partID → part.type (from message.part.updated), to classify deltas by the
   *  part's REAL kind — the server sends reasoning deltas with field:'text'. */
  private readonly partType = new Map<string, string>();
  private lastTokens: CapturedTokens | undefined;
  private lastCost: number | undefined;

  handle(event: Record<string, unknown>): StandardEvent[] {
    const type = event.type as string | undefined;
    if (!type) return [];
    const props = (event.properties as Record<string, unknown> | undefined) || {};

    switch (type) {
      case 'message.part.delta': {
        // OpenCode streams a part for the USER message too (the prompt itself);
        // rendering it would echo the user's prompt as an assistant message.
        const msgId = props.messageID as string | undefined;
        if (msgId && this.messageRole.get(msgId) === 'user') return [];
        // The server tags reasoning-part deltas with field:'text', but the part
        // was announced (message.part.updated, which arrives first) as
        // type:'reasoning'. Align the field to the real part type so the parser
        // classifies these as thinking — otherwise reasoning renders TWICE: once
        // as a streamed text row (from these deltas) and once as a thinking row
        // (from the reasoning message.part.updated).
        const partID = props.partID as string | undefined;
        const kind = partID ? this.partType.get(partID) : undefined;
        if (kind === 'reasoning' || kind === 'thinking') {
          const aligned = { ...event, properties: { ...props, field: 'reasoning' } };
          return this.parser.parseEvent(aligned);
        }
        return this.parser.parseEvent(event);
      }

      case 'message.part.updated': {
        const part = (props.part as OpencodePartLike | undefined) || undefined;
        if (part?.id && part.type) this.partType.set(part.id, part.type);
        const msgId = part?.messageID;
        if (msgId && this.messageRole.get(msgId) === 'user') return [];
        const out: StandardEvent[] = [];
        // Text/reasoning parts stream through the shared parser (tool parts have
        // no `text`, so the parser safely ignores them).
        out.push(...this.parser.parseEvent(event));
        if (part?.type === 'tool') out.push(...this.handleToolPart(part));
        return out;
      }

      case 'message.updated': {
        const info = props.info as { id?: string; role?: string; tokens?: CapturedTokens; cost?: number } | undefined;
        if (info?.id && info.role) this.messageRole.set(info.id, info.role);
        if (info?.role === 'assistant') {
          if (info.tokens) this.lastTokens = info.tokens;
          if (typeof info.cost === 'number') this.lastCost = info.cost;
        }
        return [];
      }

      case 'session.idle':
        return this.finalizeTurn();

      case 'session.error': {
        const err = props.error as { message?: string; data?: { message?: string } } | undefined;
        const errorMessage = err?.message || err?.data?.message || 'OpenCode session error';
        return [{ type: 'error', errorMessage }];
      }

      default:
        return [];
    }
  }

  private handleToolPart(part: OpencodePartLike): StandardEvent[] {
    const callId = part.callID || part.id;
    if (!callId) return [];
    const toolName = normalizeToolName(part.tool || 'unknown');
    const status = part.state?.status;
    const input = part.state?.input;
    const hasInput = !!input && Object.keys(input).length > 0;
    const events: StandardEvent[] = [];

    if (!this.toolStarted.has(callId)) {
      this.toolStarted.add(callId);
      if (hasInput) this.toolInputSent.add(callId);
      events.push({ type: 'tool_start', toolName, toolInput: input, uuid: callId, toolUseId: callId });
    } else if (!this.toolInputSent.has(callId) && hasInput) {
      // Input arrived after the first (pending) update — refresh the same row.
      this.toolInputSent.add(callId);
      events.push({ type: 'tool_start', toolName, toolInput: input, uuid: callId, toolUseId: callId });
    }

    if ((status === 'completed' || status === 'error') && !this.toolDone.has(callId)) {
      this.toolDone.add(callId);
      events.push({ type: 'tool_result', toolName, toolOutput: part.state?.output || '', uuid: callId, toolUseId: callId });
    }
    return events;
  }

  private finalizeTurn(): StandardEvent[] {
    // Feed a synthetic step_finish so the parser finalizes any open streaming
    // rows and emits usage_snapshot + step_complete (with resultText from the
    // assistant text it accumulated). Reset per-turn tool tracking after.
    const syntheticStepFinish = {
      type: 'step_finish',
      part: {
        reason: 'stop',
        cost: this.lastCost,
        tokens: this.lastTokens
          ? {
            input: this.lastTokens.input || 0,
            output: this.lastTokens.output || 0,
            reasoning: this.lastTokens.reasoning || 0,
            cache: { read: this.lastTokens.cache?.read || 0, write: this.lastTokens.cache?.write || 0 },
          }
          : undefined,
      },
    };
    const events = this.parser.parseEvent(syntheticStepFinish);
    this.toolStarted.clear();
    this.toolInputSent.clear();
    this.toolDone.clear();
    this.lastTokens = undefined;
    this.lastCost = undefined;
    return events;
  }
}
