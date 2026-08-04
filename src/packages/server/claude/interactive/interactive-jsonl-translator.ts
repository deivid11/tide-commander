/**
 * Translate Claude Code session-transcript JSONL records into StandardEvents.
 *
 * The interactive TUI has no JSON stdout stream, so the transcript file
 * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` is the only output
 * channel. Each appended record is parsed here into the same StandardEvent
 * shape the stdout pipeline emits, so the entire downstream path (websocket
 * broadcast, client store, boss-delegation parsing) is reused unchanged.
 *
 * Record shapes were verified against real transcripts:
 *  - assistant: { uuid, sessionId, message: { model, content[], stop_reason, usage } }
 *      content blocks: {type:'text',text} | {type:'thinking',thinking} | {type:'tool_use',id,name,input}
 *      stop_reason 'tool_use'|null → mid-turn; 'end_turn'|'stop_sequence' → turn done
 *  - user (tool result): { uuid, message:{ content:[{type:'tool_result',tool_use_id,content,is_error}] }, toolUseResult }
 *  - user (typed prompt): { message:{ content:'<string>' } } → skipped (client already shows it)
 *  - system: { subtype:'compact_boundary'|'api_error'|'turn_duration'|'stop_hook_summary' }
 */

import type { StandardEvent } from '../types.js';
import { toModelFallbackEvent } from '../types.js';
import { ModelFallbackTracker } from '../../../shared/model-fallback.js';
import { serializeToolResultContent } from '../tool-result-content.js';

interface RawBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface RawRecord {
  type?: string;
  subtype?: string;
  uuid?: string;
  sessionId?: string;
  error?: unknown;
  /** Task-subagent record — runs its own model, not the session's. */
  isSidechain?: boolean;
  message?: {
    model?: string;
    content?: string | RawBlock[];
    stop_reason?: string | null;
    usage?: RawUsage;
  };
  toolUseResult?: { stdout?: string; stderr?: string } | unknown;
}

function toTokens(usage?: RawUsage): StandardEvent['tokens'] | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheCreation: usage.cache_creation_input_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
  };
}

export class InteractiveJsonlTranslator {
  private sawInit = false;
  private readonly toolUseIdToName = new Map<string, string>();
  private readonly fallback: ModelFallbackTracker;

  /**
   * @param requestedModel model the agent is configured with. Interactive
   *   transcripts carry no `system/init`, so unlike the stdout pipeline there
   *   is no session-reported baseline to fall back on — without this, a session
   *   served by a substituted model from its very first record would look
   *   perfectly normal.
   */
  constructor(requestedModel?: string | null, servedModel?: string | null) {
    this.fallback = new ModelFallbackTracker(requestedModel, servedModel);
  }

  /** Translate one parsed JSONL record into zero or more StandardEvents. */
  translate(record: unknown): StandardEvent[] {
    const r = record as RawRecord;
    if (!r || typeof r !== 'object') return [];

    switch (r.type) {
      case 'assistant':
        return this.translateAssistant(r);
      case 'user':
        return this.translateUser(r);
      case 'system':
        return this.translateSystem(r);
      default:
        // attachment, last-prompt, queue-operation, mode, permission-mode,
        // ai-title, file-history-snapshot → no agent-visible event.
        return [];
    }
  }

  private translateAssistant(r: RawRecord): StandardEvent[] {
    const events: StandardEvent[] = [];
    const msg = r.message || {};
    const blocks: RawBlock[] = Array.isArray(msg.content) ? msg.content : [];
    const uuid = r.uuid;

    // Interactive transcripts have no system/init record — synthesize one from
    // the first assistant record (guaranteed to carry sessionId + model).
    if (!this.sawInit) {
      this.sawInit = true;
      events.push({ type: 'init', sessionId: r.sessionId, model: msg.model });
    }

    // Did the API answer with the model this agent is configured for? Sidechain
    // records are Task subagents, which run their own model by design.
    if (msg.model && msg.model !== '<synthetic>' && !r.isSidechain) {
      const transition = this.fallback.observe(msg.model);
      if (transition) events.push(toModelFallbackEvent(transition));
    }

    for (const block of blocks) {
      if (block.type === 'thinking') {
        const text = block.thinking ?? block.text;
        if (text && String(text).trim()) {
          events.push({ type: 'thinking', text: String(text), isStreaming: false, uuid });
        }
      } else if (block.type === 'text') {
        if (block.text && block.text.trim()) {
          events.push({ type: 'text', text: block.text, isStreaming: false, uuid });
        }
      } else if (block.type === 'tool_use') {
        const toolName = block.name || 'unknown';
        if (block.id) {
          this.toolUseIdToName.set(block.id, toolName);
        }
        const toolEvent: StandardEvent = {
          type: 'tool_start',
          toolName,
          toolInput: block.input,
          toolUseId: block.id,
          uuid: block.id, // tool_use block id is unique → dedup key
        };
        if ((toolName === 'Task' || toolName === 'Agent') && block.input) {
          const input = block.input;
          toolEvent.subagentName =
            (input.name as string) || (input.description as string) || 'Subagent';
          toolEvent.subagentDescription = (input.description as string) || '';
          toolEvent.subagentType = (input.subagent_type as string) || 'general-purpose';
          toolEvent.subagentModel = (input.model as string) || undefined;
        }
        events.push(toolEvent);
      }
    }

    // Real-time context tracking (every assistant record carries a usage block).
    const usage = msg.usage;
    if (usage) {
      events.push({ type: 'usage_snapshot', tokens: toTokens(usage), uuid });
    }

    // Turn terminator. There is no `result` record in interactive transcripts;
    // the authoritative end-of-turn marker is stop_reason end_turn/stop_sequence.
    // step_complete intentionally carries NO uuid so its token/result output
    // lines don't merge into the assistant text output (which shares r.uuid).
    const stopReason = msg.stop_reason;
    if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
      const resultText =
        blocks
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text)
          .join('')
          .trim() || undefined;
      events.push({ type: 'step_complete', resultText, tokens: toTokens(usage) });
    }

    return events;
  }

  private translateUser(r: RawRecord): StandardEvent[] {
    const events: StandardEvent[] = [];
    const content = r.message?.content;
    // String content = the user's own typed prompt echo → skip (already shown).
    if (!Array.isArray(content)) return events;

    const tur = r.toolUseResult as { stdout?: string; stderr?: string } | undefined;
    for (const block of content) {
      if (block?.type !== 'tool_result' || !block.tool_use_id) continue;
      let output: string;
      if (tur && typeof tur === 'object' && typeof tur.stdout === 'string') {
        output = tur.stdout;
        if (tur.stderr) output += (output ? '\n' : '') + '[stderr] ' + tur.stderr;
      } else {
        output = serializeToolResultContent(block.content);
      }
      const toolName = this.toolUseIdToName.get(block.tool_use_id) || 'unknown';
      events.push({
        type: 'tool_result',
        toolName,
        toolOutput: output,
        toolUseId: block.tool_use_id,
        uuid: r.uuid,
      });
      this.toolUseIdToName.delete(block.tool_use_id);
    }
    return events;
  }

  private translateSystem(r: RawRecord): StandardEvent[] {
    if (r.subtype === 'compact_boundary') {
      return [{ type: 'compacting', sessionId: r.sessionId, uuid: r.uuid }];
    }
    if (r.subtype === 'api_error') {
      return [{ type: 'error', errorMessage: typeof r.error === 'string' ? r.error : 'API error' }];
    }
    // turn_duration / stop_hook_summary → end_turn already produced step_complete.
    return [];
  }
}
