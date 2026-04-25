import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { RuntimeEvent } from '../runtime/types.js';
import { createLogger } from '../utils/logger.js';

type JsonObject = Record<string, unknown>;

interface CodexItemAction {
  type?: string;
  query?: string;
  queries?: string[];
  url?: string;
}

interface CodexItemChange {
  path?: string;
  kind?: string; // 'Add' | 'Delete' | 'Update'
}

interface CodexCollabAgentState {
  status?: string;
  message?: string | null;
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  query?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  action?: CodexItemAction;
  changes?: CodexItemChange[];
  // collab_tool_call fields (subagent orchestration)
  tool?: string;                 // 'spawn_agent' | 'send_input' | 'wait'
  sender_thread_id?: string;
  receiver_thread_ids?: string[];
  prompt?: string | null;
  agents_states?: Record<string, CodexCollabAgentState>;
  // error item fields — Codex emits these on tool/network/model failures
  message?: string;
  error?: string;
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

interface CodexTokenCountInfo {
  model_context_window?: number;
  last_token_usage?: CodexUsage;
}

interface CodexEventEnvelope {
  type?: string;
  item?: CodexItem;
  usage?: CodexUsage;
  payload?: CodexResponsePayload;
}

interface CodexResponsePayload {
  type?: string;
  status?: string;
  text?: string;
  action?: CodexItemAction;
  item?: CodexItem;
  usage?: CodexUsage;
  info?: CodexTokenCountInfo;
  model_context_window?: number;
  // For custom_tool_call / custom_tool_call_output
  call_id?: string;
  name?: string;       // Tool name (e.g. "apply_patch")
  input?: string;      // Tool input string (e.g. patch content)
  output?: string;     // Tool output string (JSON-encoded)
  // For reasoning events
  summary?: Array<{ type?: string; text?: string }>;
}

interface InferredToolCall {
  toolName: 'Read' | 'Write' | 'Edit';
  toolInput: Record<string, unknown>;
  toolOutput?: string;
}

interface CodexJsonEventParserOptions {
  enableFileDiffEnrichment?: boolean;
  workingDirectory?: string;
}

interface FileSnapshot {
  oldContent: string;
  newContent: string;
}

const log = createLogger('CodexParser');
let hasLoggedTurnAbortedLiveWarning = false;
const MAX_DIFF_FILE_BYTES = 256 * 1024;
const MAX_FALLBACK_EVENT_TEXT = 4000;

function sanitizeCodexMessageText(text: string): { text: string; hadTurnAborted: boolean } {
  const hadTurnAborted = /<turn_aborted>[\s\S]*?<\/turn_aborted>/.test(text);
  const withoutTurnAborted = text.replace(/<turn_aborted>[\s\S]*?<\/turn_aborted>/g, '').trim();
  // Codex sometimes prefixes the marker with "You". If that's all that remains,
  // treat it as synthetic noise and drop it.
  if (withoutTurnAborted === 'You') {
    return { text: '', hadTurnAborted };
  }
  return { text: withoutTurnAborted, hadTurnAborted };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allStrings = value.every((entry) => typeof entry === 'string');
  return allStrings ? (value as string[]) : undefined;
}

function parseAction(action: unknown): CodexItemAction | undefined {
  if (!isObject(action)) return undefined;
  return {
    type: asString(action.type),
    query: asString(action.query),
    queries: asStringArray(action.queries),
    url: asString(action.url),
  };
}

function parseChanges(changes: unknown): CodexItemChange[] | undefined {
  if (!Array.isArray(changes)) return undefined;
  return changes
    .filter(isObject)
    .map((entry) => ({
      path: asString(entry.path),
      kind: asString(entry.kind),
    }));
}

function parseCollabAgentStates(value: unknown): Record<string, CodexCollabAgentState> | undefined {
  if (!isObject(value)) return undefined;
  const result: Record<string, CodexCollabAgentState> = {};
  for (const [key, val] of Object.entries(value)) {
    if (isObject(val)) {
      result[key] = {
        status: asString(val.status),
        message: val.message === null ? null : asString(val.message),
      };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseItem(item: unknown): CodexItem | undefined {
  if (!isObject(item)) return undefined;
  return {
    id: asString(item.id),
    type: asString(item.type),
    text: asString(item.text),
    query: asString(item.query),
    command: asString(item.command),
    aggregated_output: asString(item.aggregated_output),
    exit_code: asNumber(item.exit_code),
    status: asString(item.status),
    action: parseAction(item.action),
    changes: parseChanges(item.changes),
    // collab_tool_call fields
    tool: asString(item.tool),
    sender_thread_id: asString(item.sender_thread_id),
    receiver_thread_ids: asStringArray(item.receiver_thread_ids),
    prompt: item.prompt === null ? null : asString(item.prompt),
    agents_states: parseCollabAgentStates(item.agents_states),
    message: asString(item.message),
    error: asString(item.error),
  };
}

function parseUsage(usage: unknown): CodexUsage | undefined {
  if (!isObject(usage)) return undefined;
  return {
    input_tokens: asNumber(usage.input_tokens),
    cached_input_tokens: asNumber(usage.cached_input_tokens),
    output_tokens: asNumber(usage.output_tokens),
  };
}

function parseEnvelope(value: unknown): CodexEventEnvelope | undefined {
  if (!isObject(value)) return undefined;
  return {
    type: asString(value.type),
    item: parseItem(value.item),
    usage: parseUsage(value.usage),
    payload: parseResponsePayload(value.payload),
  };
}

function parseSummaryArray(value: unknown): Array<{ type?: string; text?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(isObject)
    .map((entry) => ({
      type: asString(entry.type),
      text: asString(entry.text),
    }));
}

function parseResponsePayload(payload: unknown): CodexResponsePayload | undefined {
  if (!isObject(payload)) return undefined;
  return {
    type: asString(payload.type),
    status: asString(payload.status),
    text: asString(payload.text),
    action: parseAction(payload.action),
    item: parseItem(payload.item),
    usage: parseUsage(payload.usage),
    info: isObject(payload.info)
      ? {
        model_context_window: asNumber(payload.info.model_context_window),
        last_token_usage: parseUsage(payload.info.last_token_usage),
      }
      : undefined,
    model_context_window: asNumber(payload.model_context_window),
    call_id: asString(payload.call_id),
    name: asString(payload.name),
    input: asString(payload.input),
    output: asString(payload.output),
    summary: parseSummaryArray(payload.summary),
  };
}

/**
 * Parses line-delimited JSON events from `codex exec --experimental-json` and maps them to
 * Tide runtime events.
 */
export class CodexJsonEventParser {
  private activeToolByItemId = new Map<string, string>();
  private lastAgentMessageText: string | undefined;
  private lastErrorText: string | undefined;
  private lastModelUsageSnapshot: {
    contextWindow?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
  } | undefined;
  private enableFileDiffEnrichment: boolean;
  private workingDirectory: string;
  private gitRootCache = new Map<string, string | null>();
  constructor(options: CodexJsonEventParserOptions = {}) {
    this.enableFileDiffEnrichment = options.enableFileDiffEnrichment === true;
    this.workingDirectory = options.workingDirectory || process.cwd();
  }

  setWorkingDirectory(workingDirectory: string): void {
    if (!workingDirectory) return;
    this.workingDirectory = workingDirectory;
  }

  parseLine(line: string): RuntimeEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      return this.parseEvent(parsed);
    } catch {
      return [];
    }
  }

  parseEvent(rawEvent: unknown): RuntimeEvent[] {
    const event = parseEnvelope(rawEvent);
    if (!event?.type) return [];

    if (event.type === 'event_msg') {
      return this.parseEventMsg(event.payload);
    }

    if (event.type === 'response_item') {
      return this.parseResponseItem(event.payload);
    }

    if (event.type === 'item.started') {
      return this.parseItemStarted(event.item);
    }
    if (event.type === 'item.completed') {
      // Capture agent message text for later use in step_complete
      if (event.item?.type === 'agent_message' && event.item?.text) {
        this.lastAgentMessageText = event.item.text;
      }
      return this.parseItemCompleted(event.item);
    }
    if (event.type === 'turn.completed') {
      return this.parseTurnCompleted(event.usage);
    }

    // Informational envelope events that don't need terminal display
    if (event.type === 'turn.started' || event.type === 'thread.started') {
      return [];
    }

    return [this.buildUnknownEventFallback(`Unhandled Codex event type: ${event.type}`, rawEvent)];
  }

  private parseEventMsg(payload: CodexResponsePayload | undefined): RuntimeEvent[] {
    if (!payload) return [];
    const payloadType = asString(payload.type);

    // token_count: Silent. Token accounting is handled by turn.completed.
    if (payloadType === 'token_count') {
      const usage = payload.info?.last_token_usage;
      this.lastModelUsageSnapshot = {
        contextWindow: payload.info?.model_context_window ?? this.lastModelUsageSnapshot?.contextWindow,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        cacheReadInputTokens: usage?.cached_input_tokens,
      };
      return [];
    }

    // agent_reasoning: Map to thinking event
    if (payloadType === 'agent_reasoning') {
      const text = asString(payload.text);
      if (!text) return [];
      return [{ type: 'thinking', text, isStreaming: false }];
    }

    // turn_aborted: Silent. The interruption is already visible from the agent stopping.
    if (payloadType === 'turn_aborted') {
      return [];
    }

    // task_started: Silent. Envelope event with no user-facing content.
    if (payloadType === 'task_started') {
      if (payload.model_context_window) {
        this.lastModelUsageSnapshot = {
          ...this.lastModelUsageSnapshot,
          contextWindow: payload.model_context_window,
        };
      }
      return [];
    }

    // user_message / agent_message are handled via item.completed, skip if seen here
    if (payloadType === 'user_message' || payloadType === 'agent_message') {
      return [];
    }

    // task_complete: Silent. Final agent message is already displayed
    // via item.completed with type=agent_message.
    if (payloadType === 'task_complete') {
      return [];
    }

    return [this.buildUnknownEventFallback(`Unhandled Codex event_msg type: ${payloadType}`, payload)];
  }

  private parseResponseItem(payload?: CodexResponsePayload): RuntimeEvent[] {
    if (!payload?.type) return [];

    // Codex can emit web search activity wrapped in response_item payloads.
    // Emit synthetic start/result so terminal streaming and history stay consistent.
    if (payload.type === 'web_search_call') {
      const toolName = 'web_search';
      const toolInput: Record<string, unknown> = {
        actionType: payload.action?.type,
        actionQuery: payload.action?.query,
        actionQueries: payload.action?.queries,
        actionUrl: payload.action?.url,
        status: payload.status,
      };

      if (payload.status === 'completed') {
        return [
          { type: 'tool_start', toolName, toolInput },
          { type: 'tool_result', toolName, toolOutput: JSON.stringify(toolInput) },
        ];
      }

      if (payload.status === 'in_progress' || payload.status === 'started') {
        return [{ type: 'tool_start', toolName, toolInput }];
      }

      return [{ type: 'tool_result', toolName, toolOutput: JSON.stringify(toolInput) }];
    }

    // reasoning: Map summary text to thinking event
    if (payload.type === 'reasoning') {
      const text = this.extractReasoningSummaryText(payload);
      if (!text) return [];
      return [{ type: 'thinking', text, isStreaming: false }];
    }

    // custom_tool_call: Map to tool_start (with special handling for apply_patch)
    if (payload.type === 'custom_tool_call') {
      return this.parseCustomToolCall(payload);
    }

    // custom_tool_call_output: Map to tool_result
    if (payload.type === 'custom_tool_call_output') {
      return this.parseCustomToolCallOutput(payload);
    }

    return [this.buildUnknownEventFallback(`Unhandled Codex response_item payload type: ${payload.type}`, payload)];
  }

  private extractReasoningSummaryText(payload: CodexResponsePayload): string | undefined {
    if (!payload.summary || !Array.isArray(payload.summary)) return undefined;
    const texts = payload.summary
      .map((s) => s.text)
      .filter((t): t is string => Boolean(t));
    return texts.length > 0 ? texts.join('\n') : undefined;
  }

  private parseCustomToolCall(payload: CodexResponsePayload): RuntimeEvent[] {
    const toolName = payload.name || 'unknown_tool';
    const callId = payload.call_id;
    const input = payload.input || '';

    // Track tool name by call_id for correlating with custom_tool_call_output
    if (callId) {
      this.activeToolByItemId.set(callId, toolName);
    }

    // Special handling for apply_patch: generate synthetic Edit/Write events
    if (toolName === 'apply_patch' && input) {
      const inferredCalls = this.extractApplyPatchOperations(input);
      if (inferredCalls.length > 0) {
        const events: RuntimeEvent[] = [];
        for (const call of inferredCalls) {
          const filePath = this.stringField(call.toolInput.file_path);
          if (filePath) {
            const uiPath = this.normalizePathForUi(filePath);
            if (uiPath) {
              call.toolInput.file_path = uiPath;
            }
          }
          events.push({
            type: 'tool_start',
            toolName: call.toolName,
            toolInput: call.toolInput,
          });
          if (call.toolOutput) {
            events.push({
              type: 'tool_result',
              toolName: call.toolName,
              toolOutput: call.toolOutput,
            });
          }
        }
        return events;
      }
    }

    // Generic tool_start for non-apply_patch or when patch parsing yields nothing
    return [{
      type: 'tool_start',
      toolName,
      toolInput: { input, call_id: callId },
    }];
  }

  private parseCustomToolCallOutput(payload: CodexResponsePayload): RuntimeEvent[] {
    const callId = payload.call_id;
    const toolName = callId
      ? (this.activeToolByItemId.get(callId) ?? 'unknown_tool')
      : 'unknown_tool';

    if (callId) {
      this.activeToolByItemId.delete(callId);
    }

    let toolOutput = payload.output || '';

    // For apply_patch, extract the meaningful output from the JSON wrapper
    if (toolName === 'apply_patch' && toolOutput) {
      try {
        const parsed = JSON.parse(toolOutput);
        if (isObject(parsed)) {
          const outputText = asString(parsed.output);
          if (outputText) {
            toolOutput = outputText;
          }
        }
      } catch {
        // Use raw output string as-is
      }
    }

    return [{
      type: 'tool_result',
      toolName: toolName === 'apply_patch' ? 'Edit' : toolName,
      toolOutput,
    }];
  }

  private parseItemStarted(item?: CodexItem): RuntimeEvent[] {
    if (!item?.type) return [];

    if (item.type === 'web_search') {
      const toolName = 'web_search';
      if (item.id) {
        this.activeToolByItemId.set(item.id, toolName);
      }
      return [
        {
          type: 'tool_start',
          toolName,
          toolInput: this.buildWebSearchToolInput(item),
        },
      ];
    }

    if (item.type === 'command_execution') {
      const toolName = 'Bash';
      if (item.id) {
        this.activeToolByItemId.set(item.id, toolName);
      }
      return [
        {
          type: 'tool_start',
          toolName,
          toolInput: this.buildCommandExecutionToolInput(item),
        },
      ];
    }

    if (item.type === 'collab_tool_call') {
      return this.parseCollabToolStarted(item);
    }

    return [this.buildUnknownEventFallback(`Unhandled Codex item.started type: ${item.type}`, item)];
  }

  private parseItemCompleted(item?: CodexItem): RuntimeEvent[] {
    if (!item?.type) return [];

    if (item.type === 'error') {
      const errorMessage = item.message || item.text || item.error || 'Codex emitted an error';
      this.lastErrorText = errorMessage;
      return [{ type: 'error', errorMessage }];
    }

    if (item.type === 'reasoning' && item.text) {
      return [{ type: 'thinking', text: item.text, isStreaming: false }];
    }

    if (item.type === 'agent_message' && item.text) {
      const sanitized = sanitizeCodexMessageText(item.text);
      if (sanitized.hadTurnAborted) {
        if (!hasLoggedTurnAbortedLiveWarning) {
          log.warn('Filtered <turn_aborted> markers from Codex agent messages (suppressing repeat logs)');
          hasLoggedTurnAbortedLiveWarning = true;
        } else {
          log.debug(`Filtered <turn_aborted> marker from Codex agent_message${item.id ? ` (itemId=${item.id})` : ''}`);
        }
      }
      if (!sanitized.text) return [];
      return [{ type: 'text', text: sanitized.text, isStreaming: false }];
    }

    if (item.type === 'web_search') {
      const toolName = item.id ? (this.activeToolByItemId.get(item.id) ?? 'web_search') : 'web_search';
      if (item.id) {
        this.activeToolByItemId.delete(item.id);
      }
      return [
        {
          type: 'tool_result',
          toolName,
          toolOutput: JSON.stringify(this.buildWebSearchToolInput(item)),
        },
      ];
    }

    if (item.type === 'command_execution') {
      const toolName = item.id ? (this.activeToolByItemId.get(item.id) ?? 'Bash') : 'Bash';
      if (item.id) {
        this.activeToolByItemId.delete(item.id);
      }
      const inferredToolEvents = this.buildInferredToolEvents(item);
      return [
        ...inferredToolEvents,
        {
          type: 'tool_result',
          toolName,
          toolOutput: this.buildCommandExecutionToolOutput(item),
        },
      ];
    }

    if (item.type === 'file_change') {
      return this.parseFileChange(item);
    }

    if (item.type === 'collab_tool_call') {
      return this.parseCollabToolCompleted(item);
    }

    return [this.buildUnknownEventFallback(`Unhandled Codex item.completed type: ${item.type}`, item)];
  }

  private parseCollabToolStarted(item: CodexItem): RuntimeEvent[] {
    const toolName = item.tool || 'collab_tool';
    if (item.id) {
      this.activeToolByItemId.set(item.id, toolName);
    }
    return [{
      type: 'tool_start',
      toolName,
      toolInput: this.buildCollabToolInput(item),
    }];
  }

  private parseCollabToolCompleted(item: CodexItem): RuntimeEvent[] {
    const toolName = item.tool || (item.id ? (this.activeToolByItemId.get(item.id) ?? 'collab_tool') : 'collab_tool');
    if (item.id) {
      this.activeToolByItemId.delete(item.id);
    }
    return [{
      type: 'tool_result',
      toolName,
      toolOutput: this.buildCollabToolOutput(item),
    }];
  }

  private buildCollabToolInput(item: CodexItem): Record<string, unknown> {
    const input: Record<string, unknown> = {
      tool: item.tool,
      status: item.status,
    };
    if (item.prompt) {
      input.prompt = item.prompt;
    }
    if (item.receiver_thread_ids && item.receiver_thread_ids.length > 0) {
      input.receiver_thread_ids = item.receiver_thread_ids;
    }
    if (item.sender_thread_id) {
      input.sender_thread_id = item.sender_thread_id;
    }
    return input;
  }

  private buildCollabToolOutput(item: CodexItem): string {
    const parts: string[] = [];
    if (item.status) {
      parts.push(`Status: ${item.status}`);
    }
    if (item.receiver_thread_ids && item.receiver_thread_ids.length > 0) {
      const shortIds = item.receiver_thread_ids.map(id => id.slice(-8));
      parts.push(`Threads: ${shortIds.join(', ')}`);
    }
    if (item.agents_states) {
      for (const [threadId, state] of Object.entries(item.agents_states)) {
        const shortId = threadId.slice(-8);
        const stateStr = state.status || 'unknown';
        if (state.message) {
          const preview = state.message.length > 200 ? state.message.slice(0, 197) + '...' : state.message;
          parts.push(`[${shortId}] ${stateStr}: ${preview}`);
        } else {
          parts.push(`[${shortId}] ${stateStr}`);
        }
      }
    }
    return parts.join('\n');
  }

  private parseTurnCompleted(usage?: CodexUsage): RuntimeEvent[] {
    if (!usage) return [];

    const event: any = {
      type: 'step_complete',
      tokens: {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheRead: usage.cached_input_tokens,
      },
    };

    // Include the last agent message as resultText for boss delegation processing.
    // If an error item arrived in the same turn, append it so the boss/UI sees the failure.
    if (this.lastAgentMessageText || this.lastErrorText) {
      const parts: string[] = [];
      if (this.lastAgentMessageText) parts.push(this.lastAgentMessageText);
      if (this.lastErrorText) parts.push(`[Error] ${this.lastErrorText}`);
      event.resultText = parts.join('\n\n');
      this.lastAgentMessageText = undefined;
      this.lastErrorText = undefined;
    }

    if (this.lastModelUsageSnapshot && (
      this.lastModelUsageSnapshot.contextWindow
      || this.lastModelUsageSnapshot.inputTokens !== undefined
      || this.lastModelUsageSnapshot.outputTokens !== undefined
      || this.lastModelUsageSnapshot.cacheReadInputTokens !== undefined
    )) {
      event.modelUsage = {
        contextWindow: this.lastModelUsageSnapshot.contextWindow,
        inputTokens: this.lastModelUsageSnapshot.inputTokens ?? 0,
        outputTokens: this.lastModelUsageSnapshot.outputTokens ?? 0,
        cacheReadInputTokens: this.lastModelUsageSnapshot.cacheReadInputTokens ?? 0,
      };
      this.lastModelUsageSnapshot = undefined;
    }
    return [event];
  }

  private parseFileChange(item: CodexItem): RuntimeEvent[] {
    if (!item.changes || item.changes.length === 0) return [];
    if (item.status !== 'completed') return [];

    const events: RuntimeEvent[] = [];
    for (const change of item.changes) {
      if (!change.path) continue;
      const filePath = change.path;
      const unifiedDiff = this.getGitUnifiedDiff(filePath);
      if (!unifiedDiff) continue;

      const toolInput: Record<string, unknown> = {
        file_path: filePath,
        unified_diff: unifiedDiff,
      };

      // Also grab old/new content for fallback rendering
      if (this.enableFileDiffEnrichment) {
        const snapshot = this.getFileSnapshot(filePath);
        if (snapshot && snapshot.oldContent !== snapshot.newContent) {
          toolInput.old_string = snapshot.oldContent;
          toolInput.new_string = snapshot.newContent;
        }
      }

      events.push(
        {
          type: 'tool_start',
          toolName: 'Edit',
          toolInput,
        },
        {
          type: 'tool_result',
          toolName: 'Edit',
          toolOutput: `File ${change.kind?.toLowerCase() || 'changed'}: ${filePath}`,
        },
      );
    }
    return events;
  }

  private getGitUnifiedDiff(filePath: string): string | null {
    const absolutePath = this.resolveAbsolutePath(filePath);
    if (!absolutePath) return null;

    const gitRoot = this.findGitRoot(path.dirname(absolutePath));
    if (!gitRoot) return null;

    const relativePath = path.relative(gitRoot, absolutePath);
    if (!relativePath || relativePath.startsWith('..')) return null;

    const gitPath = relativePath.split(path.sep).join(path.posix.sep);
    try {
      const diff = execFileSync(
        'git',
        ['diff', 'HEAD', '-U3', '--no-color', '--', gitPath],
        {
          cwd: gitRoot,
          encoding: 'utf8',
          maxBuffer: MAX_DIFF_FILE_BYTES + 4096,
        },
      );
      if (!diff.trim()) {
        // Try staged diff for newly added files
        const stagedDiff = execFileSync(
          'git',
          ['diff', '--cached', '-U3', '--no-color', '--', gitPath],
          {
            cwd: gitRoot,
            encoding: 'utf8',
            maxBuffer: MAX_DIFF_FILE_BYTES + 4096,
          },
        );
        return stagedDiff.trim() || null;
      }
      return diff;
    } catch {
      return null;
    }
  }

  private buildUnknownEventFallback(prefix: string, payload: unknown): RuntimeEvent {
    let serialized = '';
    try {
      serialized = JSON.stringify(payload);
    } catch {
      serialized = String(payload);
    }
    if (serialized.length > MAX_FALLBACK_EVENT_TEXT) {
      serialized = `${serialized.slice(0, MAX_FALLBACK_EVENT_TEXT)}...`;
    }
    return {
      type: 'text',
      text: `[codex-event] ${prefix}\n${serialized}`,
      isStreaming: false,
    };
  }

  private buildWebSearchToolInput(item: CodexItem): Record<string, unknown> {
    return {
      query: item.query,
      actionType: item.action?.type,
      actionQuery: item.action?.query,
      actionQueries: item.action?.queries,
      actionUrl: item.action?.url,
    };
  }

  private buildCommandExecutionToolInput(item: CodexItem): Record<string, unknown> {
    return {
      command: item.command,
      status: item.status,
    };
  }

  private buildCommandExecutionToolOutput(item: CodexItem): string {
    if (item.aggregated_output) {
      return item.aggregated_output;
    }
    if (item.exit_code !== undefined) {
      return `[exit ${item.exit_code}]`;
    }
    if (item.status) {
      return `Command status: ${item.status}`;
    }
    return '';
  }

  private buildInferredToolEvents(item: CodexItem): RuntimeEvent[] {
    const inferredCalls = this.inferToolCalls(item.command, item.aggregated_output);
    if (inferredCalls.length === 0) return [];

    const events: RuntimeEvent[] = [];
    for (const call of inferredCalls) {
      events.push({
        type: 'tool_start',
        toolName: call.toolName,
        toolInput: call.toolInput,
      });
      if (call.toolOutput) {
        events.push({
          type: 'tool_result',
          toolName: call.toolName,
          toolOutput: call.toolOutput,
        });
      }
    }
    return events;
  }

  private inferToolCalls(command?: string, aggregatedOutput?: string): InferredToolCall[] {
    if (!command) return [];

    const calls: InferredToolCall[] = [];
    const seen = new Set<string>();
    const shell = this.extractShellCommand(command);

    const add = (call: InferredToolCall): void => {
      const filePath = this.stringField(call.toolInput.file_path);
      if (!filePath) return;
      const uiPath = this.normalizePathForUi(filePath);
      if (!uiPath) return;
      call.toolInput.file_path = uiPath;
      const key = `${call.toolName}:${uiPath}:${this.stringField(call.toolInput.operation) || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      calls.push(call);
    };

    // 1) apply_patch blocks -> high-fidelity file operations
    for (const op of this.extractApplyPatchOperations(shell)) {
      add(op);
    }

    // 2) Common shell writes/appends
    for (const appendEdit of this.extractAppendEdits(shell)) {
      add(appendEdit);
    }
    for (const path of this.extractRedirectTargets(shell, '>>')) {
      add({
        toolName: 'Edit',
        toolInput: {
          file_path: path,
          operation: 'append',
          old_string: '',
          new_string: '',
        },
      });
    }
    for (const path of this.extractRedirectTargets(shell, '>')) {
      if (path === '/dev/null') continue;
      add({
        toolName: 'Write',
        toolInput: { file_path: path },
      });
    }

    // 3) In-place edit commands
    for (const edit of this.extractInPlaceEdits(shell)) {
      add(edit);
    }

    // 4) Read commands
    for (const path of this.extractReadTargets(shell)) {
      add({
        toolName: 'Read',
        toolInput: { file_path: path },
      });
    }

    // 5) If command output indicates apply_patch success but command parsing missed details
    if (calls.length === 0 && aggregatedOutput?.includes('Success. Updated the following files:')) {
      const outputPaths = this.extractUpdatedPathsFromOutput(aggregatedOutput);
      for (const path of outputPaths) {
        add({
          toolName: 'Edit',
          toolInput: { file_path: path },
        });
      }
    }

    if (this.enableFileDiffEnrichment) {
      for (const call of calls) {
        this.enrichWithFileSnapshot(call);
      }
    }

    return calls;
  }

  private extractShellCommand(command: string): string {
    // Typical form from codex exec JSON:
    // /bin/zsh -lc "actual command"
    const doubleQuoted = command.match(/-lc\s+"([\s\S]*)"$/);
    if (doubleQuoted) {
      return this.unescapeShellDoubleQuotes(doubleQuoted[1]);
    }
    const singleQuoted = command.match(/-lc\s+'([\s\S]*)'$/);
    if (singleQuoted) {
      return singleQuoted[1];
    }
    return command;
  }

  private unescapeShellDoubleQuotes(text: string): string {
    return text
      .replace(/\\"/g, '"')
      .replace(/\\`/g, '`')
      .replace(/\\\$/g, '$')
      .replace(/\\\\/g, '\\');
  }

  private extractApplyPatchOperations(shell: string): InferredToolCall[] {
    const patchBlockMatch = shell.match(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/);
    if (!patchBlockMatch) return [];

    const patch = patchBlockMatch[0];
    const lines = patch.split('\n');
    const calls: InferredToolCall[] = [];

    let currentPath: string | undefined;
    let currentMode: 'add' | 'update' | 'delete' | undefined;
    let oldLines: string[] = [];
    let newLines: string[] = [];

    const flush = (): void => {
      if (!currentPath || !currentMode) return;

      if (currentMode === 'add') {
        calls.push({
          toolName: 'Write',
          toolInput: {
            file_path: currentPath,
            content: newLines.join('\n'),
          },
          toolOutput: 'Created file',
        });
      } else if (currentMode === 'update') {
        const toolInput: Record<string, unknown> = { file_path: currentPath };
        if (oldLines.length > 0 || newLines.length > 0) {
          toolInput.old_string = oldLines.join('\n');
          toolInput.new_string = newLines.join('\n');
        }
        calls.push({
          toolName: 'Edit',
          toolInput,
          toolOutput: 'Updated file',
        });
      } else if (currentMode === 'delete') {
        calls.push({
          toolName: 'Edit',
          toolInput: {
            file_path: currentPath,
            operation: 'delete',
            old_string: oldLines.join('\n'),
            new_string: '',
          },
          toolOutput: 'Deleted file',
        });
      }

      currentPath = undefined;
      currentMode = undefined;
      oldLines = [];
      newLines = [];
    };

    for (const line of lines) {
      const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
      if (addMatch) {
        flush();
        currentPath = addMatch[1].trim();
        currentMode = 'add';
        continue;
      }

      const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
      if (updateMatch) {
        flush();
        currentPath = updateMatch[1].trim();
        currentMode = 'update';
        continue;
      }

      const deleteMatch = line.match(/^\*\*\* Delete File: (.+)$/);
      if (deleteMatch) {
        flush();
        currentPath = deleteMatch[1].trim();
        currentMode = 'delete';
        continue;
      }

      if (!currentPath || !currentMode) continue;
      if (line.startsWith('*** ')) continue;
      if (line.startsWith('@@')) continue;
      if (line.startsWith('+')) {
        newLines.push(line.slice(1));
        continue;
      }
      if (line.startsWith('-')) {
        oldLines.push(line.slice(1));
      }
    }

    flush();
    return calls;
  }

  private extractRedirectTargets(shell: string, operator: '>' | '>>'): string[] {
    const targets = new Set<string>();
    const escaped = operator === '>>' ? '>>' : '(?<![0-9>])>(?!>)';
    const quoted = new RegExp(`${escaped}\\s*['"]([^'"]+)['"]`, 'g');
    const unquoted = new RegExp(`${escaped}\\s*([^\\s;|&]+)`, 'g');

    for (const regex of [quoted, unquoted]) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(shell)) !== null) {
        const candidate = this.normalizeCandidatePath(match[1]);
        if (!candidate) continue;
        targets.add(candidate);
      }
    }

    return Array.from(targets);
  }

  private extractInPlaceEdits(shell: string): InferredToolCall[] {
    const edits: InferredToolCall[] = [];
    const seen = new Set<string>();
    const segments = shell.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);

    for (const segment of segments) {
      const isInPlaceEdit = /\bsed\s+-i\b/.test(segment) || /\bperl\s+-pi\b/.test(segment);
      if (!isInPlaceEdit) continue;

      const filePath = this.extractLastLikelyFilePath(segment);
      if (!filePath) continue;

      const oldLineHint = this.extractRemovalHint(segment);
      const key = `${filePath}:${oldLineHint || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edits.push({
        toolName: 'Edit',
        toolInput: {
          file_path: filePath,
          operation: 'in_place_edit',
          old_string: oldLineHint || '',
          new_string: '',
        },
      });
    }

    return edits;
  }

  private extractReadTargets(shell: string): string[] {
    const targets = new Set<string>();
    const patterns = [
      /\bcat\s+['"]([^'"]+)['"]/g,
      /\bcat\s+([^\s;|&]+)/g,
      /\b(?:tail|head)\s+(?:-[^\s]+\s+)*['"]([^'"]+)['"]/g,
      /\b(?:tail|head)\s+(?:-[^\s]+\s+)*([^\s;|&]+)/g,
      /\bsed\s+-n\s+['"][^'"]*['"]\s+['"]([^'"]+)['"]/g,
      /\bsed\s+-n\s+['"][^'"]*['"]\s+([^\s;|&]+)/g,
    ];

    for (const regex of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(shell)) !== null) {
        const candidate = this.normalizeCandidatePath(match[1]);
        if (!candidate) continue;
        targets.add(candidate);
      }
    }

    return Array.from(targets);
  }

  private extractUpdatedPathsFromOutput(output: string): string[] {
    const paths = new Set<string>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Success.')) continue;
      if (trimmed.startsWith('- ')) {
        paths.add(trimmed.slice(2).trim());
      }
    }
    return Array.from(paths);
  }

  private stringField(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private normalizeCandidatePath(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;

    const candidate = value.trim().replace(/^['"]|['"]$/g, '');
    if (!candidate) return undefined;
    if (candidate === '/') return undefined;
    if (candidate.startsWith('&') || candidate.startsWith('(')) return undefined;
    if (candidate.startsWith('-')) return undefined;
    if (/^[><|&]+$/.test(candidate)) return undefined;
    if (/^\d+$/.test(candidate)) return undefined;
    if (!/[/.~]/.test(candidate) && !/^[A-Z][A-Za-z0-9_-]*$/.test(candidate)) return undefined;
    if (/^(one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(candidate)) return undefined;

    return candidate;
  }

  private extractLastLikelyFilePath(segment: string): string | undefined {
    const tokens = segment.match(/'[^']*'|"[^"]*"|\S+/g) || [];
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const candidate = this.normalizeCandidatePath(tokens[i]);
      if (candidate) return candidate;
    }
    return undefined;
  }

  private normalizePathForUi(path: string): string | undefined {
    const normalized = this.normalizeCandidatePath(path);
    if (!normalized) return undefined;
    if (normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('~')) {
      return normalized;
    }
    // Make plain relative files clickable by existing UI path detection.
    return `./${normalized}`;
  }

  private extractAppendEdits(shell: string): InferredToolCall[] {
    const edits: InferredToolCall[] = [];
    const patterns = [
      /\bprintf\s+(['"])([\s\S]*?)\1\s*>>\s*([^\s;|&]+)/g,
      /\becho\s+(['"])([\s\S]*?)\1\s*>>\s*([^\s;|&]+)/g,
    ];

    for (const regex of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(shell)) !== null) {
        const rawContent = match[2] || '';
        const filePath = this.normalizeCandidatePath(match[3]);
        if (!filePath) continue;

        const appended = this.unescapePrintfLikeString(rawContent);
        edits.push({
          toolName: 'Edit',
          toolInput: {
            file_path: filePath,
            operation: 'append',
            old_string: '',
            new_string: appended,
          },
        });
      }
    }

    return edits;
  }

  private unescapePrintfLikeString(input: string): string {
    return input
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, '\'')
      .replace(/\\\\/g, '\\');
  }

  private extractRemovalHint(segment: string): string | undefined {
    // Common sed/perl delete pattern hints:
    // sed -i '' '/^Added one more line\.$/d' README.md
    // perl -i -ne 'print unless /^Added one more line\.\s*$/' README.md
    const sedMatch = segment.match(/\/\^?([^/$]+)\$?\/d/);
    if (sedMatch) {
      return this.unescapeRegexLiteral(sedMatch[1]);
    }

    const perlMatch = segment.match(/unless\s+\/\^?([^/$]+)\$?\//);
    if (perlMatch) {
      return this.unescapeRegexLiteral(perlMatch[1]);
    }

    return undefined;
  }

  private unescapeRegexLiteral(value: string): string {
    return value
      .replace(/\\\./g, '.')
      .replace(/\\\$/g, '$')
      .replace(/\\\^/g, '^')
      .replace(/\\\//g, '/')
      .replace(/\\s\*/g, '')
      .replace(/\\n/g, '\n')
      .trim();
  }

  private enrichWithFileSnapshot(call: InferredToolCall): void {
    if (call.toolName !== 'Edit' && call.toolName !== 'Write') return;
    const filePath = this.stringField(call.toolInput.file_path);
    if (!filePath) return;

    const snapshot = this.getFileSnapshot(filePath);
    if (!snapshot) return;
    if (snapshot.oldContent === snapshot.newContent) return;

    // Get a proper unified diff for better rendering
    const unifiedDiff = this.getGitUnifiedDiff(filePath);

    call.toolName = 'Edit';
    call.toolInput = {
      ...call.toolInput,
      file_path: filePath,
      old_string: snapshot.oldContent,
      new_string: snapshot.newContent,
      ...(unifiedDiff ? { unified_diff: unifiedDiff } : {}),
    };
  }

  private getFileSnapshot(filePath: string): FileSnapshot | null {
    const absolutePath = this.resolveAbsolutePath(filePath);
    if (!absolutePath) return null;

    const newContent = this.readTextFileIfSmall(absolutePath);
    if (newContent === null) return null;

    const gitRoot = this.findGitRoot(path.dirname(absolutePath));
    if (!gitRoot) {
      return { oldContent: '', newContent };
    }

    const relativePath = path.relative(gitRoot, absolutePath);
    if (!relativePath || relativePath.startsWith('..')) {
      return null;
    }

    const oldContent = this.readHeadFileIfSmall(gitRoot, relativePath);
    if (oldContent === null) return null;

    return { oldContent, newContent };
  }

  private resolveAbsolutePath(filePath: string): string | null {
    if (!filePath) return null;
    if (filePath.startsWith('~')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      if (!homeDir) return null;
      return path.resolve(homeDir, filePath.slice(1));
    }
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.workingDirectory, filePath);
  }

  private readTextFileIfSmall(absolutePath: string): string | null {
    if (!fs.existsSync(absolutePath)) return '';

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    if (stat.size > MAX_DIFF_FILE_BYTES) return null;

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(absolutePath);
    } catch {
      return null;
    }
    if (buffer.includes(0x00)) return null;
    return buffer.toString('utf8');
  }

  private readHeadFileIfSmall(gitRoot: string, relativePath: string): string | null {
    const gitPath = relativePath.split(path.sep).join(path.posix.sep);

    try {
      const output = execFileSync('git', ['show', `HEAD:${gitPath}`], {
        cwd: gitRoot,
        encoding: 'utf8',
        maxBuffer: MAX_DIFF_FILE_BYTES + 4096,
      });
      if (Buffer.byteLength(output, 'utf8') > MAX_DIFF_FILE_BYTES) {
        return null;
      }
      return output;
    } catch {
      // File may not exist at HEAD (new file) or command failed; treat as empty base.
      return '';
    }
  }

  private findGitRoot(startDir: string): string | null {
    const cached = this.gitRootCache.get(startDir);
    if (cached !== undefined) return cached;

    try {
      const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: startDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      this.gitRootCache.set(startDir, gitRoot);
      return gitRoot;
    } catch {
      this.gitRootCache.set(startDir, null);
      return null;
    }
  }
}
