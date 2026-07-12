/**
 * CodexAppServerEventAdapter
 *
 * Translates `codex app-server` JSON-RPC notifications (v2 protocol, camelCase
 * items) into Tide `StandardEvent`s, one adapter instance per agent (it holds
 * per-turn state: the last agent-message text for boss delegation, and the most
 * recent token-usage snapshot).
 *
 * The uuid conventions match the exec parser
 * (src/packages/server/codex/json-event-parser.ts): `codex-text-<itemId>` for
 * assistant text and `codex-thinking-<itemId>` for reasoning, so streaming
 * deltas merge into one terminal row and the final `isStreaming:false` event
 * finalizes it — identical downstream behaviour to the exec path, just with
 * real token-level streaming.
 */

import type { StandardEvent } from '../../claude/types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('CodexAppServerAdapter');

interface TokenSnapshot {
  contextWindow?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
}

interface AppServerItem {
  id?: string;
  type?: string;
  text?: string;
  content?: string[];
  summary?: string[];
  command?: string;
  aggregatedOutput?: string;
  exitCode?: number;
  status?: string;
  query?: string;
  changes?: Array<{ path?: string; kind?: { type?: string }; diff?: string }>;
  action?: { type?: string; query?: string; queries?: string[]; url?: string };
  // collab
  tool?: string;
  prompt?: string | null;
  receiverThreadIds?: string[];
  // error
  message?: string;
  error?: string;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

export class CodexAppServerEventAdapter {
  private lastAgentMessageText: string | undefined;
  private lastErrorText: string | undefined;
  private tokenSnapshot: TokenSnapshot | undefined;

  /** Map one app-server notification to zero or more Tide events. */
  handle(method: string, params: Record<string, unknown>): StandardEvent[] {
    switch (method) {
      // ---- Streaming deltas (the whole point) --------------------------------
      case 'item/agentMessage/delta': {
        const delta = asString(params.delta);
        const itemId = asString(params.itemId) || 'anon';
        if (!delta) return [];
        return [{ type: 'text', text: delta, isStreaming: true, uuid: `codex-text-${itemId}` }];
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const delta = asString(params.delta);
        const itemId = asString(params.itemId) || 'anon';
        if (!delta) return [];
        return [{ type: 'thinking', text: delta, isStreaming: true, uuid: `codex-thinking-${itemId}` }];
      }

      // ---- Item lifecycle ----------------------------------------------------
      case 'item/started':
        return this.handleItemStarted((params.item as AppServerItem) || {});
      case 'item/completed':
        return this.handleItemCompleted((params.item as AppServerItem) || {});

      // ---- Turn + usage ------------------------------------------------------
      case 'thread/tokenUsage/updated':
        this.captureTokenUsage(params.tokenUsage);
        return [];
      case 'turn/completed':
        return this.handleTurnCompleted(params.turn as Record<string, unknown> | undefined);

      // ---- Errors ------------------------------------------------------------
      case 'error': {
        const errorMessage = asString(params.message) || 'Codex app-server error';
        this.lastErrorText = errorMessage;
        return [{ type: 'error', errorMessage }];
      }

      // Informational / handled elsewhere — stay silent (no raw dumps).
      case 'thread/started':
      case 'turn/started':
      case 'thread/status/changed':
      case 'thread/tokenUsage':
      case 'item/plan/delta':
      case 'turn/plan/updated':
      case 'turn/diff/updated':
      case 'item/reasoning/summaryPartAdded':
      case 'item/commandExecution/outputDelta':
      case 'account/rateLimits/updated':
      case 'remoteControl/status/changed':
        return [];

      default:
        // Unknown notification: swallow it (the exec parser dumps unknowns to the
        // terminal, but at the notification layer that would be far too noisy).
        log.debug(`Unhandled app-server notification: ${method}`);
        return [];
    }
  }

  private handleItemStarted(item: AppServerItem): StandardEvent[] {
    switch (item.type) {
      case 'commandExecution': {
        const command = item.command || '';
        return [{ type: 'tool_start', toolName: 'Bash', toolInput: { command, status: item.status } }];
      }
      case 'webSearch':
        return [{ type: 'tool_start', toolName: 'web_search', toolInput: this.webSearchInput(item) }];
      // agentMessage / reasoning: deltas carry the content; fileChange diff lands
      // on completion. Everything else stays silent on start.
      default:
        return [];
    }
  }

  private handleItemCompleted(item: AppServerItem): StandardEvent[] {
    switch (item.type) {
      case 'agentMessage': {
        const text = (item.text || '').trim();
        if (!text) return [];
        this.lastAgentMessageText = text;
        return [{ type: 'text', text, isStreaming: false, uuid: item.id ? `codex-text-${item.id}` : undefined }];
      }
      case 'reasoning': {
        const text = (item.content && item.content.length ? item.content : item.summary || []).join('\n').trim();
        if (!text) return [];
        return [{ type: 'thinking', text, isStreaming: false, uuid: item.id ? `codex-thinking-${item.id}` : undefined }];
      }
      case 'commandExecution': {
        const output =
          item.aggregatedOutput ??
          (item.exitCode !== undefined ? `[exit ${item.exitCode}]` : item.status ? `Command status: ${item.status}` : '');
        return [{ type: 'tool_result', toolName: 'Bash', toolOutput: output }];
      }
      case 'fileChange':
        return this.handleFileChange(item);
      case 'webSearch':
        return [{ type: 'tool_result', toolName: 'web_search', toolOutput: JSON.stringify(this.webSearchInput(item)) }];
      case 'collabAgentToolCall': {
        const toolName = item.tool || 'collab_tool';
        const toolInput: Record<string, unknown> = { tool: item.tool, status: item.status };
        if (item.prompt) toolInput.prompt = item.prompt;
        if (item.receiverThreadIds?.length) toolInput.receiver_thread_ids = item.receiverThreadIds;
        return [
          { type: 'tool_start', toolName, toolInput },
          { type: 'tool_result', toolName, toolOutput: `Status: ${item.status || 'unknown'}` },
        ];
      }
      case 'error': {
        const errorMessage = item.message || item.text || item.error || 'Codex emitted an error';
        this.lastErrorText = errorMessage;
        return [{ type: 'error', errorMessage }];
      }
      default:
        return [];
    }
  }

  private handleFileChange(item: AppServerItem): StandardEvent[] {
    if (!item.changes || item.changes.length === 0) return [];
    if (item.status && item.status !== 'completed') return [];
    const events: StandardEvent[] = [];
    for (const change of item.changes) {
      if (!change.path) continue;
      const toolInput: Record<string, unknown> = { file_path: change.path };
      // v2 fileChange carries a per-file unified diff inline — no git shell-out
      // needed (the exec path has to reconstruct it via `git diff`).
      if (change.diff) toolInput.unified_diff = change.diff;
      const kind = change.kind?.type || 'update';
      events.push(
        { type: 'tool_start', toolName: 'Edit', toolInput },
        { type: 'tool_result', toolName: 'Edit', toolOutput: `File ${kind}: ${change.path}` },
      );
    }
    return events;
  }

  private webSearchInput(item: AppServerItem): Record<string, unknown> {
    return {
      query: item.query,
      actionType: item.action?.type,
      actionQuery: item.action?.query,
      actionQueries: item.action?.queries,
      actionUrl: item.action?.url,
    };
  }

  private captureTokenUsage(tokenUsage: unknown): void {
    if (typeof tokenUsage !== 'object' || tokenUsage === null) return;
    const tu = tokenUsage as Record<string, unknown>;
    const last = (tu.last as Record<string, unknown>) || {};
    this.tokenSnapshot = {
      contextWindow: asNumber(tu.modelContextWindow) ?? this.tokenSnapshot?.contextWindow,
      inputTokens: asNumber(last.inputTokens),
      outputTokens: asNumber(last.outputTokens),
      cacheReadInputTokens: asNumber(last.cachedInputTokens),
    };
  }

  private handleTurnCompleted(turn: Record<string, unknown> | undefined): StandardEvent[] {
    const events: StandardEvent[] = [];

    // A failed turn carries its error inline — surface it before finalizing.
    if (turn && asString(turn.status) === 'failed') {
      const err = turn.error as Record<string, unknown> | undefined;
      const errorMessage = (err && asString(err.message)) || 'Codex turn failed';
      this.lastErrorText = errorMessage;
      events.push({ type: 'error', errorMessage });
    }

    const snap = this.tokenSnapshot;
    const event: StandardEvent = {
      type: 'step_complete',
      tokens: {
        input: snap?.inputTokens ?? 0,
        output: snap?.outputTokens ?? 0,
        cacheRead: snap?.cacheReadInputTokens,
      },
    };

    if (this.lastAgentMessageText || this.lastErrorText) {
      const parts: string[] = [];
      if (this.lastAgentMessageText) parts.push(this.lastAgentMessageText);
      if (this.lastErrorText) parts.push(`[Error] ${this.lastErrorText}`);
      event.resultText = parts.join('\n\n');
    }

    if (snap && (snap.contextWindow || snap.inputTokens !== undefined || snap.outputTokens !== undefined)) {
      event.modelUsage = {
        contextWindow: snap.contextWindow,
        inputTokens: snap.inputTokens ?? 0,
        outputTokens: snap.outputTokens ?? 0,
        cacheReadInputTokens: snap.cacheReadInputTokens ?? 0,
      };
    }

    this.lastAgentMessageText = undefined;
    this.lastErrorText = undefined;
    events.push(event);
    return events;
  }
}
