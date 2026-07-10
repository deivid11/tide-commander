/**
 * Grok session side-channel watcher.
 *
 * Headless `streaming-json` only emits thought/text/end on stdout. Tool use is
 * recorded under ~/.grok/sessions/<encoded-cwd>/<sessionId>/. This watcher
 * tails those files and emits StandardEvents so Tide can show tool cards live.
 *
 * Sources:
 * - events.jsonl  → early tool_started/tool_completed (name only, fast)
 * - chat_history.jsonl → tool_calls with args + tool_result with full output
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { StandardEvent } from '../claude/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GrokSessionWatcher');

const MAX_TOOL_OUTPUT_CHARS = 50_000;
const DISCOVER_INTERVAL_MS = 250;
const TAIL_INTERVAL_MS = 200;
/** Accept sessions modified up to this long before process start (slow disk / clock skew). */
const DISCOVER_GRACE_MS = 5_000;

/** Grok writes live context fill here (not in streaming-json). */
export interface GrokSignalsUsage {
  contextTokensUsed: number;
  contextWindowTokens: number;
  contextWindowUsage?: number;
}

/**
 * Read context usage from a Grok session's signals.json.
 * Streaming-json only emits thought/text/end — no token counts — so this file
 * is the authoritative live source for the Tide context bar.
 */
export function readGrokSignalsUsage(sessionDir: string): GrokSignalsUsage | null {
  const signalsPath = path.join(sessionDir, 'signals.json');
  if (!fs.existsSync(signalsPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(signalsPath, 'utf8')) as Record<string, unknown>;
    const used = Number(raw.contextTokensUsed);
    const limit = Number(raw.contextWindowTokens);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
    const usagePct = Number(raw.contextWindowUsage);
    return {
      contextTokensUsed: Math.max(0, Math.round(used)),
      contextWindowTokens: Math.max(1, Math.round(limit)),
      contextWindowUsage: Number.isFinite(usagePct) ? usagePct : undefined,
    };
  } catch {
    return null;
  }
}

/** Grok stores sessions under encodeURIComponent(absolute cwd). */
export function encodeGrokProjectKey(cwd: string): string {
  return encodeURIComponent(path.resolve(cwd));
}

export function getGrokSessionsRoot(cwd: string): string {
  return path.join(os.homedir(), '.grok', 'sessions', encodeGrokProjectKey(cwd));
}

export function getGrokSessionDir(cwd: string, sessionId: string): string {
  return path.join(getGrokSessionsRoot(cwd), sessionId);
}

const TOOL_NAME_MAP: Record<string, string> = {
  list_dir: 'ListFiles',
  read_file: 'Read',
  search_replace: 'Edit',
  write: 'Write',
  run_terminal_cmd: 'Bash',
  run_terminal_command: 'Bash',
  grep: 'Grep',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
  open_page: 'WebFetch',
  open_page_with_find: 'WebFetch',
  spawn_subagent: 'Task',
  todo_write: 'TodoWrite',
  image_gen: 'ImageGen',
  image_edit: 'ImageEdit',
};

export function normalizeGrokToolName(raw: string): string {
  if (!raw) return 'unknown';
  return TOOL_NAME_MAP[raw.toLowerCase()] || raw;
}

export interface GrokSessionWatcherOptions {
  agentId: string;
  workingDir: string;
  /** Known session id (resume). When omitted we discover the newest session. */
  sessionId?: string;
  startedAt?: number;
  onEvent: (event: StandardEvent) => void;
  onSessionId?: (sessionId: string) => void;
}

export interface GrokSessionWatcherHandle {
  stop: () => void;
}

interface ChatToolCall {
  id?: string;
  name?: string;
  arguments?: string | Record<string, unknown>;
}

interface ChatHistoryLine {
  type?: string;
  content?: unknown;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

interface EventsLine {
  type?: string;
  tool_name?: string;
  session_id?: string;
  outcome?: string;
}

function parseToolInput(args: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { raw: args };
    } catch {
      return { raw: args };
    }
  }
  return {};
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_TOOL_OUTPUT_CHARS) + `\n… [truncated ${text.length - MAX_TOOL_OUTPUT_CHARS} chars]`;
}

/**
 * Append-only JSONL tailer. Starts at EOF so prior-turn tools are not re-broadcast.
 */
export class JsonlTailer {
  private position = 0;
  private buffer = '';
  private initialized = false;
  private readonly filePath: string;
  private readonly onLine: (obj: unknown) => void;

  constructor(filePath: string, onLine: (obj: unknown) => void) {
    this.filePath = filePath;
    this.onLine = onLine;
  }

  initAtEof(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.position = fs.statSync(this.filePath).size;
      } else {
        this.position = 0;
      }
    } catch {
      this.position = 0;
    }
    this.buffer = '';
    this.initialized = true;
  }

  poll(): void {
    if (!this.initialized) this.initAtEof();
    try {
      if (!fs.existsSync(this.filePath)) return;
      const stat = fs.statSync(this.filePath);
      if (stat.size < this.position) {
        this.position = 0;
        this.buffer = '';
      }
      if (stat.size === this.position) return;

      const fd = fs.openSync(this.filePath, 'r');
      try {
        const toRead = stat.size - this.position;
        const buf = Buffer.alloc(toRead);
        fs.readSync(fd, buf, 0, toRead, this.position);
        this.position = stat.size;
        this.buffer += buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }

      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.onLine(JSON.parse(trimmed));
        } catch {
          // skip malformed
        }
      }
    } catch (err) {
      log.log(`tail poll error for ${this.filePath}: ${String(err)}`);
    }
  }
}

export function startGrokSessionWatcher(opts: GrokSessionWatcherOptions): GrokSessionWatcherHandle {
  const startedAt = opts.startedAt ?? Date.now();
  let stopped = false;
  let sessionId = opts.sessionId;
  let sessionDirPath: string | null = null;
  let chatTailer: JsonlTailer | null = null;
  let eventsTailer: JsonlTailer | null = null;
  let discoverTimer: ReturnType<typeof setInterval> | null = null;
  let tailTimer: ReturnType<typeof setInterval> | null = null;
  /** Dedupe key for last-emitted signals usage snapshot. */
  let lastSignalsUsageKey = '';

  const emittedToolStarts = new Set<string>();
  const emittedToolResults = new Set<string>();
  /** raw tool_name → queue of early synthetic ids (events.jsonl, no call id) */
  const pendingEarlyByName = new Map<string, string[]>();
  const earlyToReal = new Map<string, string>();
  const realToEarly = new Map<string, string>();

  const emit = (event: StandardEvent) => {
    if (stopped) return;
    opts.onEvent(event);
  };

  const pollSignalsUsage = () => {
    if (!sessionDirPath) return;
    const usage = readGrokSignalsUsage(sessionDirPath);
    if (!usage) return;
    const key = `${usage.contextTokensUsed}:${usage.contextWindowTokens}`;
    if (key === lastSignalsUsageKey) return;
    lastSignalsUsageKey = key;

    // Encode fill as input tokens so usage_snapshot handlers treat it as
    // current context size (cache fields left 0).
    emit({
      type: 'usage_snapshot',
      tokens: {
        input: usage.contextTokensUsed,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      },
      modelUsage: {
        contextWindow: usage.contextWindowTokens,
        inputTokens: usage.contextTokensUsed,
        outputTokens: 0,
      },
      sessionId: sessionId,
    });
    log.log(
      `📊 Grok signals usage for ${opts.agentId.slice(0, 8)}: ${usage.contextTokensUsed}/${usage.contextWindowTokens}`
      + (usage.contextWindowUsage != null ? ` (${usage.contextWindowUsage}%)` : '')
    );
  };

  const handleEventsLine = (raw: unknown) => {
    const line = raw as EventsLine;
    if (!line || typeof line !== 'object' || !line.type) return;

    if (line.type === 'turn_started' && typeof line.session_id === 'string') {
      if (sessionId !== line.session_id) {
        sessionId = line.session_id;
        opts.onSessionId?.(sessionId);
      }
      return;
    }

    if (line.type === 'tool_started' && line.tool_name) {
      const rawName = line.tool_name;
      const toolName = normalizeGrokToolName(rawName);
      const synthId = `grok-early-${rawName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const queue = pendingEarlyByName.get(rawName) || [];
      queue.push(synthId);
      pendingEarlyByName.set(rawName, queue);
      emittedToolStarts.add(synthId);

      emit({
        type: 'tool_start',
        toolName,
        toolInput: {},
        toolUseId: synthId,
        uuid: synthId,
      });
      return;
    }

    if (line.type === 'tool_completed' && line.tool_name) {
      const rawName = line.tool_name;
      const queue = pendingEarlyByName.get(rawName);
      if (!queue || queue.length === 0) return;
      const synthId = queue.shift()!;
      if (queue.length === 0) pendingEarlyByName.delete(rawName);
      else pendingEarlyByName.set(rawName, queue);

      // If chat_history already completed the real call, skip empty early result.
      if (emittedToolResults.has(synthId)) return;
      // If this early was upgraded to a real call id that already has a result, skip.
      const realId = earlyToReal.get(synthId);
      if (realId && emittedToolResults.has(realId)) {
        emittedToolResults.add(synthId);
        return;
      }

      emittedToolResults.add(synthId);
      emit({
        type: 'tool_result',
        toolName: normalizeGrokToolName(rawName),
        toolUseId: synthId,
        uuid: synthId,
        toolOutput: line.outcome === 'success' ? '(ok)' : `(${line.outcome || 'done'})`,
      });
      // Tools change context fill — re-read signals after completions.
      pollSignalsUsage();
      return;
    }

    // End of model turn is a good moment to refresh context stats.
    if (line.type === 'turn_ended') {
      pollSignalsUsage();
    }
  };

  const handleChatLine = (raw: unknown) => {
    const line = raw as ChatHistoryLine;
    if (!line || typeof line !== 'object') return;

    if (line.type === 'assistant' && Array.isArray(line.tool_calls)) {
      for (const call of line.tool_calls) {
        const callId = call.id || `anon-${call.name}-${Date.now()}`;
        if (emittedToolStarts.has(callId)) continue;

        const rawName = call.name || 'unknown';
        const toolName = normalizeGrokToolName(rawName);
        const toolInput = parseToolInput(call.arguments);

        // Link to a pending early card for this tool name (if any)
        const earlyQueue = pendingEarlyByName.get(rawName);
        if (earlyQueue && earlyQueue.length > 0) {
          const earlyId = earlyQueue.shift()!;
          if (earlyQueue.length === 0) pendingEarlyByName.delete(rawName);
          earlyToReal.set(earlyId, callId);
          realToEarly.set(callId, earlyId);
        }

        emittedToolStarts.add(callId);

        // Prefer upgrading the early card (same uuid) with full args so the UI
        // does not keep an empty "Using tool: Read" plus a second full row.
        // tool_result dual-emits to earlyId + callId for pairing.
        const earlyId = realToEarly.get(callId);
        if (earlyId) {
          emit({
            type: 'tool_start',
            toolName,
            toolInput,
            toolUseId: earlyId,
            uuid: earlyId,
          });
        } else {
          emit({
            type: 'tool_start',
            toolName,
            toolInput,
            toolUseId: callId,
            uuid: callId,
          });
        }
      }
      return;
    }

    if (line.type === 'tool_result' && line.tool_call_id) {
      const callId = line.tool_call_id;
      if (emittedToolResults.has(callId)) return;
      emittedToolResults.add(callId);

      const content = typeof line.content === 'string'
        ? line.content
        : line.content != null
          ? JSON.stringify(line.content)
          : '';
      const out = truncateOutput(content);

      emit({
        type: 'tool_result',
        toolUseId: callId,
        uuid: callId,
        toolOutput: out,
      });

      const earlyId = realToEarly.get(callId);
      if (earlyId && !emittedToolResults.has(earlyId)) {
        emittedToolResults.add(earlyId);
        emit({
          type: 'tool_result',
          toolUseId: earlyId,
          uuid: earlyId,
          toolOutput: out,
        });
      }
    }
  };

  const attachToSession = (id: string) => {
    sessionId = id;
    opts.onSessionId?.(id);
    const sessionDir = getGrokSessionDir(opts.workingDir, id);
    sessionDirPath = sessionDir;
    const chatPath = path.join(sessionDir, 'chat_history.jsonl');
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    log.log(`📎 Watching Grok session ${id.slice(0, 8)}… for agent ${opts.agentId.slice(0, 8)}`);

    chatTailer = new JsonlTailer(chatPath, handleChatLine);
    eventsTailer = new JsonlTailer(eventsPath, handleEventsLine);
    chatTailer.initAtEof();
    eventsTailer.initAtEof();

    // Seed context bar from existing signals (resume / mid-session attach).
    lastSignalsUsageKey = '';
    pollSignalsUsage();

    if (discoverTimer) {
      clearInterval(discoverTimer);
      discoverTimer = null;
    }

    if (!tailTimer) {
      tailTimer = setInterval(() => {
        if (stopped) return;
        eventsTailer?.poll();
        chatTailer?.poll();
        // signals.json is rewritten in place (not append-only) — poll each tick.
        pollSignalsUsage();
      }, TAIL_INTERVAL_MS);
    }
  };

  const tryDiscover = (): boolean => {
    const root = getGrokSessionsRoot(opts.workingDir);
    if (!fs.existsSync(root)) return false;

    let newest: { id: string; mtime: number } | null = null;
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        try {
          const st = fs.statSync(dir);
          if (st.mtimeMs < startedAt - DISCOVER_GRACE_MS) continue;
          if (!newest || st.mtimeMs > newest.mtime) {
            newest = { id: entry.name, mtime: st.mtimeMs };
          }
        } catch {
          // skip
        }
      }
    } catch {
      return false;
    }

    if (!newest) return false;

    const sessionDir = getGrokSessionDir(opts.workingDir, newest.id);
    const hasChat = fs.existsSync(path.join(sessionDir, 'chat_history.jsonl'));
    const hasEvents = fs.existsSync(path.join(sessionDir, 'events.jsonl'));
    if (!hasChat && !hasEvents) return false;

    attachToSession(newest.id);
    return true;
  };

  if (sessionId) {
    attachToSession(sessionId);
  } else if (!tryDiscover()) {
    discoverTimer = setInterval(() => {
      if (stopped) return;
      tryDiscover();
    }, DISCOVER_INTERVAL_MS);
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (discoverTimer) clearInterval(discoverTimer);
      if (tailTimer) clearInterval(tailTimer);
      discoverTimer = null;
      tailTimer = null;
      chatTailer = null;
      eventsTailer = null;
      log.log(`🛑 Stopped Grok session watcher for agent ${opts.agentId.slice(0, 8)}`);
    },
  };
}
