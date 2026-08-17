import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  Agent,
  AgentProvider,
  SessionTransferMode,
  SessionTransferSummary,
  SessionTransferTarget,
} from '../../shared/types.js';
import { DEFAULT_GROK_MODEL, providerDisplayName, supportsSessionImport } from '../../shared/types.js';
import {
  detectSessionProvider,
  encodeProjectPath,
  loadSession,
  type ConversationHistory,
  type SessionMessage,
  type SessionProvider,
} from '../claude/session-loader.js';

/** Any runtime whose sessions the shared loader can read is a valid source. */
export type TransferSourceProvider = AgentProvider;
/** Runtimes with a writable native session store (see SESSION_TRANSFER_TARGETS). */
export type TransferTargetProvider = SessionTransferTarget;

interface PortableTurn {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  sourceIndex: number;
  isSummary?: boolean;
}

export interface NormalizedTransfer {
  turns: PortableTurn[];
  changedFiles: string[];
  droppedToolResultBodies: number;
}

export interface CreatedTransfer {
  targetProvider: TransferTargetProvider;
  sessionId: string;
  /** Primary session file (the one the target CLI resumes from). */
  filePath: string;
  /** Inode identity used to avoid deleting a replacement during rollback. */
  fileIdentity: { dev: number; ino: number };
  /** Every file created by the transfer, primary first. */
  createdFiles: string[];
  /** Directory created exclusively for this session (Grok), removed on rollback. */
  ownedDir?: string;
  summary: SessionTransferSummary;
}

/** @deprecated Use CreatedTransfer. Kept for the original Pi-only call sites. */
export type CreatedPiTransfer = CreatedTransfer;

export interface SessionTransferDependencies {
  loadSourceSession(
    cwd: string,
    sessionId: string,
    limit: number,
    offset: number,
  ): Promise<ConversationHistory | null>;
  detectSourceProvider(cwd: string, sessionId: string): SessionProvider | null;
  piHome(): string;
  claudeHome(): string;
  codexHome(): string;
  grokHome(): string;
  now(): Date;
  newSessionId(): string;
  newEntryId(): string;
}

const DEFAULT_DEPS: SessionTransferDependencies = {
  loadSourceSession: loadSession,
  detectSourceProvider: detectSessionProvider,
  piHome: () => {
    const override = process.env.PI_CODING_AGENT_DIR?.trim();
    return override ? path.resolve(override) : path.join(os.homedir(), '.pi', 'agent');
  },
  claudeHome: () => {
    const override = process.env.CLAUDE_CONFIG_DIR?.trim();
    return override ? path.resolve(override) : path.join(os.homedir(), '.claude');
  },
  codexHome: () => {
    const override = process.env.CODEX_HOME?.trim();
    return override ? path.resolve(override) : path.join(os.homedir(), '.codex');
  },
  grokHome: () => {
    const override = process.env.GROK_HOME?.trim();
    return override ? path.resolve(override) : path.join(os.homedir(), '.grok');
  },
  now: () => new Date(),
  newSessionId: () => randomUUID(),
  newEntryId: () => randomUUID().slice(0, 8),
};

const PI_SESSION_VERSION = 3;
const SMART_CONTEXT_RATIO = 0.3;
const FULL_CONTEXT_RATIO = 0.8;
const MAX_CHANGED_FILES_IN_NOTE = 30;
const MAX_PATH_LENGTH = 240;
const MAX_TURN_CHARACTERS = 1_000_000;
const MIN_TURN_TOKENS = 24;

const MUTATING_TOOLS = new Set([
  'write',
  'edit',
  'multiedit',
  'apply_patch',
  'applypatch',
  'patch',
  'notebookedit',
  'delete',
  'remove',
  'move',
  'rename',
  'mkdir',
]);

export class SessionTransferError extends Error {
  readonly code:
    | 'source-not-found'
    | 'source-provider-mismatch'
    | 'target-unsupported'
    | 'empty-source'
    | 'budget-too-small'
    | 'invalid-output';

  constructor(code: SessionTransferError['code'], message: string) {
    super(message);
    this.name = 'SessionTransferError';
    this.code = code;
  }
}

function visibleAssistantText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  // Session loaders deliberately expose provider reasoning summaries for the
  // terminal. They are useful to a human but must not cross the transfer
  // boundary as conversation context.
  if (/^\[thinking\](?:\s|$)/i.test(trimmed)) return '';
  if (/^<local-command-stdout>\s*Compacted\s*<\/local-command-stdout>$/i.test(trimmed)) return '';
  if (/^\[compaction\]\s*/i.test(trimmed)) {
    return `[Earlier-session summary]\n${trimmed.replace(/^\[compaction\]\s*/i, '')}`.trim();
  }
  return trimmed;
}

function sourceTimestamp(message: SessionMessage, fallbackIndex: number): string {
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date(fallbackIndex).toISOString();
}

function stringField(input: Record<string, unknown> | undefined, names: string[]): string | undefined {
  if (!input) return undefined;
  for (const name of names) {
    const value = input[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, MAX_PATH_LENGTH);
    }
  }
  return undefined;
}

function toolFilePath(message: SessionMessage): string | undefined {
  return stringField(message.toolInput, [
    'file_path',
    'filePath',
    'path',
    'notebook_path',
    'target_path',
  ]);
}

function isMutatingTool(toolName: string | undefined): boolean {
  return MUTATING_TOOLS.has((toolName || '').trim().toLowerCase());
}

function safeToolLine(message: SessionMessage): string {
  const name = message.toolName?.trim() || 'unknown tool';
  const filePath = toolFilePath(message);
  // Arguments and result bodies can contain credentials, stale source text, or
  // huge command output. Keep only the operation and a useful changed/read path.
  return `[Tool activity] ${name}${filePath ? ` — ${filePath}` : ''} — outcome unavailable`;
}

function toolFailed(content: string): boolean {
  return /^\s*(?:error|failed|failure|exception)\b/i.test(content);
}

/**
 * Convert Tide's already-normalized history (any provider the session loader
 * reads: Claude, Codex, Grok, Pi, OpenCode) into portable, non-replayable text
 * turns. This never includes hidden reasoning or tool-result bodies.
 */
export function normalizeSessionForTransfer(messages: readonly SessionMessage[]): NormalizedTransfer {
  const turns: PortableTurn[] = [];
  const changedFiles = new Set<string>();
  const toolTurnById = new Map<string, PortableTurn>();
  let droppedToolResultBodies = 0;

  messages.forEach((message, sourceIndex) => {
    const timestamp = sourceTimestamp(message, sourceIndex);

    if (message.type === 'user') {
      const text = message.content.trim();
      if (!text) return;
      turns.push({
        role: 'user',
        text: text.slice(0, MAX_TURN_CHARACTERS),
        timestamp,
        sourceIndex,
      });
      return;
    }

    if (message.type === 'assistant') {
      const text = visibleAssistantText(message.content);
      if (!text) return;
      turns.push({
        role: 'assistant',
        text: text.slice(0, MAX_TURN_CHARACTERS),
        timestamp,
        sourceIndex,
        isSummary: text.startsWith('[Earlier-session summary]'),
      });
      return;
    }

    if (message.type === 'tool_use') {
      const turn: PortableTurn = {
        role: 'assistant',
        text: safeToolLine(message),
        timestamp,
        sourceIndex,
      };
      turns.push(turn);
      if (message.toolUseId) toolTurnById.set(message.toolUseId, turn);

      const filePath = toolFilePath(message);
      if (filePath && isMutatingTool(message.toolName)) changedFiles.add(filePath);
      return;
    }

    if (message.type === 'tool_result') {
      if (message.content) droppedToolResultBodies += 1;
      const toolTurn = message.toolUseId ? toolTurnById.get(message.toolUseId) : undefined;
      if (toolTurn) {
        toolTurn.text = toolTurn.text.replace(
          'outcome unavailable',
          toolFailed(message.content) ? 'failed' : 'completed',
        );
      }
    }
  });

  return {
    turns,
    changedFiles: Array.from(changedFiles),
    droppedToolResultBodies,
  };
}

/** @deprecated Use normalizeSessionForTransfer. */
export const normalizeSessionForPi = normalizeSessionForTransfer;

/** Conservative deterministic estimate; no tokenizer/model/network call is required. */
export function estimateTransferTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4) + 4);
}

function turnTokens(turn: PortableTurn): number {
  return estimateTransferTokens(turn.text);
}

function truncateTurn(turn: PortableTurn, tokenLimit: number): PortableTurn {
  const characterLimit = Math.max(1, tokenLimit * 4 - 40);
  if (turn.text.length <= characterLimit) return turn;
  return {
    ...turn,
    text: `${turn.text.slice(0, characterLimit)}\n… [truncated during session transfer]`,
  };
}

function sourceLabel(provider: TransferSourceProvider): string {
  if (provider === 'claude') return 'Claude Code';
  return providerDisplayName(provider);
}

function buildTransferNote(params: {
  provider: TransferSourceProvider;
  sourceSessionId: string;
  changedFiles: string[];
  droppedTurns: number;
  droppedToolResultBodies: number;
}): string {
  const lines = [
    '[Session transfer note]',
    `This conversation was imported from ${sourceLabel(params.provider)} session ${params.sourceSessionId}.`,
    'Hidden reasoning, provider state, replayable tool calls, and tool-result bodies were not imported.',
  ];
  if (params.droppedTurns > 0) {
    lines.push(`${params.droppedTurns} older visible turn${params.droppedTurns === 1 ? ' was' : 's were'} omitted to fit the target context window.`);
  }
  if (params.droppedToolResultBodies > 0) {
    lines.push(`${params.droppedToolResultBodies} tool-result bod${params.droppedToolResultBodies === 1 ? 'y was' : 'ies were'} dropped; reread files or rerun commands when current output is needed.`);
  }
  if (params.changedFiles.length > 0) {
    lines.push('Files changed during the source session:');
    for (const filePath of params.changedFiles.slice(0, MAX_CHANGED_FILES_IN_NOTE)) {
      lines.push(`- ${filePath}`);
    }
    if (params.changedFiles.length > MAX_CHANGED_FILES_IN_NOTE) {
      lines.push(`- … and ${params.changedFiles.length - MAX_CHANGED_FILES_IN_NOTE} more`);
    }
  }
  return lines.join('\n');
}

interface FittedTransfer {
  turns: PortableTurn[];
  estimatedTokens: number;
  droppedTurns: number;
  warnings: string[];
}

function fitTurnsToContext(params: {
  turns: PortableTurn[];
  provider: TransferSourceProvider;
  sourceSessionId: string;
  changedFiles: string[];
  droppedToolResultBodies: number;
  mode: Exclude<SessionTransferMode, 'fresh'>;
  contextLimit: number;
  now: Date;
}): FittedTransfer {
  const ratio = params.mode === 'smart' ? SMART_CONTEXT_RATIO : FULL_CONTEXT_RATIO;
  const budget = Math.floor(params.contextLimit * ratio);
  const maximumNote = buildTransferNote({
    provider: params.provider,
    sourceSessionId: params.sourceSessionId,
    changedFiles: params.changedFiles,
    droppedTurns: params.turns.length,
    droppedToolResultBodies: params.droppedToolResultBodies,
  });
  const noteReserve = estimateTransferTokens(maximumNote) + 16;
  let remaining = budget - noteReserve;
  if (remaining < MIN_TURN_TOKENS) {
    throw new SessionTransferError(
      'budget-too-small',
      `The target context window (${params.contextLimit} tokens) is too small for a safe import.`,
    );
  }

  const totalTurnTokens = params.turns.reduce((sum, turn) => sum + turnTokens(turn), 0);
  const selected = new Map<number, PortableTurn>();

  const add = (index: number, maximumTokens = remaining): boolean => {
    if (selected.has(index) || remaining < MIN_TURN_TOKENS) return false;
    const original = params.turns[index];
    if (!original) return false;
    const allowed = Math.min(remaining, maximumTokens);
    if (allowed < MIN_TURN_TOKENS) return false;
    const candidate = turnTokens(original) <= allowed ? original : truncateTurn(original, allowed);
    const cost = turnTokens(candidate);
    if (cost > remaining) return false;
    selected.set(index, candidate);
    remaining -= cost;
    return true;
  };

  if (totalTurnTokens <= remaining) {
    params.turns.forEach((_turn, index) => add(index));
  } else {
    const firstUserIndex = params.turns.findIndex((turn) => turn.role === 'user');
    if (firstUserIndex >= 0) {
      add(firstUserIndex, Math.max(MIN_TURN_TOKENS, Math.floor(remaining * 0.2)));
    }

    if (params.mode === 'smart') {
      let latestSummaryIndex = -1;
      for (let index = params.turns.length - 1; index >= 0; index -= 1) {
        if (params.turns[index].isSummary) {
          latestSummaryIndex = index;
          break;
        }
      }
      if (latestSummaryIndex >= 0) {
        add(latestSummaryIndex, Math.max(MIN_TURN_TOKENS, Math.floor(remaining * 0.25)));
      }
    }

    for (let index = params.turns.length - 1; index >= 0; index -= 1) {
      if (selected.has(index)) continue;
      const cost = turnTokens(params.turns[index]);
      if (cost <= remaining) {
        add(index);
        continue;
      }
      // Preserve at least the most recent oversized visible turn, truncated.
      const hasRecentTurn = Array.from(selected.keys()).some((selectedIndex) => selectedIndex > firstUserIndex);
      if (!hasRecentTurn && remaining >= MIN_TURN_TOKENS) add(index);
    }
  }

  const selectedTurns = Array.from(selected.entries())
    .sort(([left], [right]) => left - right)
    .map(([, turn]) => turn);
  if (selectedTurns.length === 0 || !selectedTurns.some((turn) => turn.role === 'user')) {
    throw new SessionTransferError(
      'empty-source',
      'The source session has no transferable user conversation. Choose Fresh Start instead.',
    );
  }

  const droppedTurns = Math.max(0, params.turns.length - selectedTurns.length);
  let noteText = buildTransferNote({
    provider: params.provider,
    sourceSessionId: params.sourceSessionId,
    changedFiles: params.changedFiles,
    droppedTurns,
    droppedToolResultBodies: params.droppedToolResultBodies,
  });
  if (estimateTransferTokens(noteText) > noteReserve) {
    noteText = truncateTurn({
      role: 'assistant',
      text: noteText,
      timestamp: params.now.toISOString(),
      sourceIndex: Number.MAX_SAFE_INTEGER,
    }, noteReserve).text;
  }

  const note: PortableTurn = {
    role: 'assistant',
    text: noteText,
    timestamp: params.now.toISOString(),
    sourceIndex: Number.MAX_SAFE_INTEGER,
  };
  const turns = [...selectedTurns, note];
  const estimatedTokens = turns.reduce((sum, turn) => sum + turnTokens(turn), 0);
  const warnings: string[] = [];
  if (droppedTurns > 0) warnings.push(`${droppedTurns} older visible turns were omitted to fit context.`);
  if (params.droppedToolResultBodies > 0) warnings.push('Tool-result bodies were dropped as stale or sensitive data.');
  if (params.changedFiles.length > MAX_CHANGED_FILES_IN_NOTE) warnings.push('The changed-file list was shortened.');

  return { turns, estimatedTokens, droppedTurns, warnings };
}

// ============================================================================
// Target writers — one per runtime with a writable native session store.
// Every writer produces text-only user/assistant turns; nothing replayable.
// ============================================================================

interface SerializeParams {
  cwd: string;
  sessionId: string;
  sourceProvider: TransferSourceProvider;
  sourceSessionId: string;
  /** Model the agent will use on the target runtime (some stores record it). */
  targetModel?: string;
  turns: PortableTurn[];
  createdAt: Date;
  deps: SessionTransferDependencies;
}

interface SessionArtifact {
  /** File name relative to the session directory. */
  name: string;
  content: string;
}

interface SessionWriter {
  readonly provider: TransferTargetProvider;
  /** Directory that receives the artifacts. */
  sessionDir(cwd: string, sessionId: string, createdAt: Date, deps: SessionTransferDependencies): string;
  /**
   * When true the session directory itself belongs to the session (Grok keeps
   * one directory per session). It is created exclusively and removed on rollback.
   */
  readonly ownsSessionDir: boolean;
  /** Artifacts to write; the first one is the primary (resumable) file. */
  serialize(params: SerializeParams): SessionArtifact[];
  /** Throws SessionTransferError('invalid-output') when the primary file is unusable. */
  validatePrimary(content: string, sessionId: string): void;
}

function turnTimestamp(turn: PortableTurn, fallback: string): string {
  const parsed = Date.parse(turn.timestamp);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function parseJsonLines(serialized: string, label: string): Record<string, unknown>[] {
  const lines = serialized.split('\n').filter((line) => line.trim());
  if (lines.length < 2) {
    throw new SessionTransferError('invalid-output', `The generated ${label} session is empty.`);
  }
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new SessionTransferError('invalid-output', `${label} session entry ${index} is not JSON.`);
    }
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Pi — ~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl (v3 entry chain)
// ---------------------------------------------------------------------------

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function encodePiCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  return `--${resolved.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

function assertValidPiSession(serialized: string, sessionId: string): void {
  const entries = parseJsonLines(serialized, 'Pi');
  const header = entries[0];
  if (header.type !== 'session' || header.id !== sessionId || header.version !== PI_SESSION_VERSION) {
    throw new SessionTransferError('invalid-output', 'The generated Pi session header is invalid.');
  }

  let expectedParent: string | null = null;
  const ids = new Set<string>();
  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
      throw new SessionTransferError('invalid-output', `Pi session entry ${index} has an invalid id.`);
    }
    if (entry.parentId !== expectedParent) {
      throw new SessionTransferError('invalid-output', `Pi session entry ${index} breaks the parent chain.`);
    }
    if (typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) {
      throw new SessionTransferError('invalid-output', `Pi session entry ${index} has an invalid timestamp.`);
    }
    ids.add(entry.id);
    expectedParent = entry.id;

    if (entry.type !== 'message') continue;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
      throw new SessionTransferError('invalid-output', `Pi session entry ${index} has an invalid message.`);
    }
    if (message.role === 'assistant') {
      const usage = message.usage as ReturnType<typeof emptyUsage> | undefined;
      if (!usage || !Number.isFinite(usage.input) || !Number.isFinite(usage.output)
          || !Number.isFinite(usage.cacheRead) || !Number.isFinite(usage.cacheWrite)
          || !Number.isFinite(usage.totalTokens) || !Number.isFinite(usage.cost?.total)) {
        throw new SessionTransferError('invalid-output', `Pi assistant entry ${index} has invalid usage.`);
      }
    }
  }
}

function serializePiSession(params: SerializeParams): string {
  const createdAt = params.createdAt.toISOString();
  const header = {
    type: 'session',
    version: PI_SESSION_VERSION,
    id: params.sessionId,
    timestamp: createdAt,
    cwd: path.resolve(params.cwd),
  };
  const entries: Record<string, unknown>[] = [];
  let parentId: string | null = null;
  const append = (entry: Record<string, unknown>, timestamp: string) => {
    const id = params.deps.newEntryId();
    entries.push({ ...entry, id, parentId, timestamp });
    parentId = id;
  };

  append({
    type: 'custom',
    customType: 'tide-session-transfer',
    data: {
      sourceProvider: params.sourceProvider,
      sourceSessionId: params.sourceSessionId,
      importedAt: createdAt,
      sourcePreserved: true,
    },
  }, createdAt);

  for (const turn of params.turns) {
    const timestamp = turnTimestamp(turn, createdAt);
    const messageTimestamp = Date.parse(timestamp);
    if (turn.role === 'user') {
      append({
        type: 'message',
        message: {
          role: 'user',
          content: [{ type: 'text', text: turn.text }],
          timestamp: messageTimestamp,
        },
      }, timestamp);
    } else {
      append({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: turn.text }],
          api: 'tide-session-transfer',
          provider: 'tide-commander',
          model: 'imported-session',
          usage: emptyUsage(),
          stopReason: 'stop',
          timestamp: messageTimestamp,
        },
      }, timestamp);
    }
  }

  const serialized = [header, ...entries].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  assertValidPiSession(serialized, params.sessionId);
  return serialized;
}

const PI_WRITER: SessionWriter = {
  provider: 'pi',
  ownsSessionDir: false,
  sessionDir: (cwd, _sessionId, _createdAt, deps) => path.join(deps.piHome(), 'sessions', encodePiCwd(cwd)),
  serialize: (params) => [{
    name: `${params.createdAt.toISOString().replace(/[:.]/g, '-')}_${params.sessionId}.jsonl`,
    content: serializePiSession(params),
  }],
  validatePrimary: assertValidPiSession,
};

// ---------------------------------------------------------------------------
// Claude Code — ~/.claude/projects/<encoded cwd>/<uuid>.jsonl (uuid/parentUuid chain)
// ---------------------------------------------------------------------------

function assertValidClaudeSession(serialized: string, sessionId: string): void {
  const entries = parseJsonLines(serialized, 'Claude');
  let expectedParent: string | null = null;
  const uuids = new Set<string>();
  let sawUser = false;
  entries.forEach((entry, index) => {
    if (entry.type !== 'user' && entry.type !== 'assistant') {
      throw new SessionTransferError('invalid-output', `Claude session entry ${index} has an unsupported type.`);
    }
    if (typeof entry.uuid !== 'string' || !entry.uuid || uuids.has(entry.uuid)) {
      throw new SessionTransferError('invalid-output', `Claude session entry ${index} has an invalid uuid.`);
    }
    if (entry.parentUuid !== expectedParent) {
      throw new SessionTransferError('invalid-output', `Claude session entry ${index} breaks the parent chain.`);
    }
    if (entry.sessionId !== sessionId) {
      throw new SessionTransferError('invalid-output', `Claude session entry ${index} has a foreign session id.`);
    }
    if (typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) {
      throw new SessionTransferError('invalid-output', `Claude session entry ${index} has an invalid timestamp.`);
    }
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || message.role !== entry.type) {
      throw new SessionTransferError('invalid-output', `Claude session entry ${index} has an invalid message.`);
    }
    if (entry.type === 'user') {
      if (typeof message.content !== 'string' || !message.content) {
        throw new SessionTransferError('invalid-output', `Claude user entry ${index} has no text.`);
      }
      sawUser = true;
    } else {
      const content = message.content as unknown;
      if (!Array.isArray(content) || content.length === 0
          || content.some((block) => !block || block.type !== 'text' || typeof block.text !== 'string')) {
        throw new SessionTransferError('invalid-output', `Claude assistant entry ${index} has invalid content blocks.`);
      }
    }
    uuids.add(entry.uuid);
    expectedParent = entry.uuid;
  });
  if (!sawUser) {
    throw new SessionTransferError('invalid-output', 'The generated Claude session has no user turn.');
  }
}

function serializeClaudeSession(params: SerializeParams): string {
  const createdAt = params.createdAt.toISOString();
  const cwd = path.resolve(params.cwd);
  const entries: Record<string, unknown>[] = [];
  let parentUuid: string | null = null;
  let assistantCounter = 0;

  for (const turn of params.turns) {
    const uuid = params.deps.newSessionId();
    const timestamp = turnTimestamp(turn, createdAt);
    const base = {
      parentUuid,
      isSidechain: false,
      userType: 'external',
      cwd,
      sessionId: params.sessionId,
      gitBranch: '',
      timestamp,
      uuid,
    };
    if (turn.role === 'user') {
      entries.push({
        ...base,
        type: 'user',
        message: { role: 'user', content: turn.text },
      });
    } else {
      assistantCounter += 1;
      entries.push({
        ...base,
        type: 'assistant',
        message: {
          id: `msg_tide_transfer_${assistantCounter}`,
          type: 'message',
          role: 'assistant',
          model: 'imported-session',
          content: [{ type: 'text', text: turn.text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
          },
        },
      });
    }
    parentUuid = uuid;
  }

  const serialized = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  assertValidClaudeSession(serialized, params.sessionId);
  return serialized;
}

const CLAUDE_WRITER: SessionWriter = {
  provider: 'claude',
  ownsSessionDir: false,
  sessionDir: (cwd, _sessionId, _createdAt, deps) => path.join(deps.claudeHome(), 'projects', encodeProjectPath(path.resolve(cwd))),
  serialize: (params) => [{ name: `${params.sessionId}.jsonl`, content: serializeClaudeSession(params) }],
  validatePrimary: assertValidClaudeSession,
};

// ---------------------------------------------------------------------------
// Codex — ~/.codex/sessions/YYYY/MM/DD/rollout-<local ts>-<uuid>.jsonl
// (session_meta line followed by response_item message lines)
// ---------------------------------------------------------------------------

function assertValidCodexSession(serialized: string, sessionId: string): void {
  const entries = parseJsonLines(serialized, 'Codex');
  const meta = entries[0];
  const payload = meta.payload as Record<string, unknown> | undefined;
  if (meta.type !== 'session_meta' || !payload || payload.id !== sessionId
      || typeof payload.cwd !== 'string' || !payload.cwd
      || typeof payload.timestamp !== 'string' || !Number.isFinite(Date.parse(payload.timestamp))) {
    throw new SessionTransferError('invalid-output', 'The generated Codex session_meta line is invalid.');
  }
  let sawUser = false;
  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index];
    const item = entry.payload as Record<string, unknown> | undefined;
    if (entry.type !== 'response_item' || !item || item.type !== 'message'
        || (item.role !== 'user' && item.role !== 'assistant')) {
      throw new SessionTransferError('invalid-output', `Codex session entry ${index} is not a message response_item.`);
    }
    if (typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) {
      throw new SessionTransferError('invalid-output', `Codex session entry ${index} has an invalid timestamp.`);
    }
    const content = item.content as unknown;
    const expectedBlock = item.role === 'user' ? 'input_text' : 'output_text';
    if (!Array.isArray(content) || content.length === 0
        || content.some((block) => !block || block.type !== expectedBlock || typeof block.text !== 'string')) {
      throw new SessionTransferError('invalid-output', `Codex session entry ${index} has invalid content blocks.`);
    }
    if (item.role === 'user') sawUser = true;
  }
  if (!sawUser) {
    throw new SessionTransferError('invalid-output', 'The generated Codex session has no user turn.');
  }
}

function serializeCodexSession(params: SerializeParams): string {
  const createdAt = params.createdAt.toISOString();
  const lines: Record<string, unknown>[] = [{
    timestamp: createdAt,
    type: 'session_meta',
    payload: {
      id: params.sessionId,
      timestamp: createdAt,
      cwd: path.resolve(params.cwd),
      originator: 'tide-commander',
      cli_version: 'tide-session-transfer',
      instructions: null,
      source: 'exec',
      model_provider: 'openai',
    },
  }];
  for (const turn of params.turns) {
    const timestamp = turnTimestamp(turn, createdAt);
    lines.push({
      timestamp,
      type: 'response_item',
      payload: {
        type: 'message',
        role: turn.role,
        content: [{ type: turn.role === 'user' ? 'input_text' : 'output_text', text: turn.text }],
      },
    });
  }
  const serialized = lines.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  assertValidCodexSession(serialized, params.sessionId);
  return serialized;
}

/** Codex names rollout paths with the LOCAL wall clock (dir date + file stamp). */
function codexLocalStamp(date: Date): { dir: string; file: string } {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return {
    dir: path.join(String(y), m, d),
    file: `${y}-${m}-${d}T${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`,
  };
}

const CODEX_WRITER: SessionWriter = {
  provider: 'codex',
  ownsSessionDir: false,
  sessionDir: (_cwd, _sessionId, createdAt, deps) => path.join(deps.codexHome(), 'sessions', codexLocalStamp(createdAt).dir),
  serialize: (params) => [{
    name: `rollout-${codexLocalStamp(params.createdAt).file}-${params.sessionId}.jsonl`,
    content: serializeCodexSession(params),
  }],
  validatePrimary: assertValidCodexSession,
};

// ---------------------------------------------------------------------------
// Grok — ~/.grok/sessions/<encodeURIComponent(cwd)>/<uuid>/{chat_history.jsonl,summary.json}
// Grok prepends its own system prompt on resume, so the history holds only turns.
// ---------------------------------------------------------------------------

function assertValidGrokSession(serialized: string, _sessionId: string): void {
  const entries = parseJsonLines(serialized, 'Grok');
  let sawUser = false;
  entries.forEach((entry, index) => {
    if (entry.type === 'user') {
      const content = entry.content as unknown;
      if (!Array.isArray(content) || content.length === 0
          || content.some((block) => !block || block.type !== 'text' || typeof block.text !== 'string')) {
        throw new SessionTransferError('invalid-output', `Grok user entry ${index} has invalid content blocks.`);
      }
      sawUser = true;
      return;
    }
    if (entry.type === 'assistant') {
      if (typeof entry.content !== 'string' || !entry.content) {
        throw new SessionTransferError('invalid-output', `Grok assistant entry ${index} has no text.`);
      }
      return;
    }
    throw new SessionTransferError('invalid-output', `Grok session entry ${index} has an unsupported type.`);
  });
  if (!sawUser) {
    throw new SessionTransferError('invalid-output', 'The generated Grok session has no user turn.');
  }
}

function serializeGrokChatHistory(params: SerializeParams): string {
  const entries: Record<string, unknown>[] = [];
  let promptIndex = 0;
  for (const turn of params.turns) {
    if (turn.role === 'user') {
      entries.push({
        type: 'user',
        content: [{ type: 'text', text: `<user_query>\n${turn.text}\n</user_query>` }],
        prompt_index: promptIndex,
      });
      promptIndex += 1;
    } else {
      entries.push({ type: 'assistant', content: turn.text });
    }
  }
  const serialized = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  assertValidGrokSession(serialized, params.sessionId);
  return serialized;
}

function serializeGrokSummary(params: SerializeParams, chatHistory: string): string {
  const createdAt = params.createdAt.toISOString();
  const messageCount = chatHistory.split('\n').filter((line) => line.trim()).length;
  return JSON.stringify({
    info: { id: params.sessionId, cwd: path.resolve(params.cwd) },
    session_summary: '',
    created_at: createdAt,
    updated_at: createdAt,
    num_messages: messageCount,
    num_chat_messages: messageCount,
    // Required by Grok's summary parser: without it `--resume` reports
    // "Session does not exist" even though the directory is present.
    current_model_id: params.targetModel?.trim() || DEFAULT_GROK_MODEL,
    next_trace_turn: 1,
    chat_format_version: 1,
    grok_home: params.deps.grokHome(),
    last_active_at: createdAt,
    tide_session_transfer: {
      sourceProvider: params.sourceProvider,
      sourceSessionId: params.sourceSessionId,
      importedAt: createdAt,
      sourcePreserved: true,
    },
  }, null, 2) + '\n';
}

const GROK_WRITER: SessionWriter = {
  provider: 'grok',
  ownsSessionDir: true,
  sessionDir: (cwd, sessionId, _createdAt, deps) => path.join(deps.grokHome(), 'sessions', encodeURIComponent(path.resolve(cwd)), sessionId),
  serialize: (params) => {
    const chatHistory = serializeGrokChatHistory(params);
    return [
      { name: 'chat_history.jsonl', content: chatHistory },
      { name: 'summary.json', content: serializeGrokSummary(params, chatHistory) },
    ];
  },
  validatePrimary: assertValidGrokSession,
};

const SESSION_WRITERS: Record<TransferTargetProvider, SessionWriter> = {
  pi: PI_WRITER,
  claude: CLAUDE_WRITER,
  codex: CODEX_WRITER,
  grok: GROK_WRITER,
};

/** Runtimes that can receive an imported conversation (not just a fresh start). */
export function isSessionTransferTarget(provider: unknown): provider is TransferTargetProvider {
  return supportsSessionImport(typeof provider === 'string' ? provider : undefined);
}

// ============================================================================
// Create / rollback
// ============================================================================

/**
 * Build, validate, atomically place, and read back a new native session for
 * `targetProvider`. The source session is read only and its id is never reused.
 */
export async function createTransferredSession(
  agent: Agent,
  options: {
    targetProvider: TransferTargetProvider;
    mode: Exclude<SessionTransferMode, 'fresh'>;
    contextLimit: number;
    /** Model the agent will run on the target (recorded where the store expects it). */
    targetModel?: string;
  },
  overrides: Partial<SessionTransferDependencies> = {},
): Promise<CreatedTransfer> {
  const deps: SessionTransferDependencies = { ...DEFAULT_DEPS, ...overrides };
  const writer = SESSION_WRITERS[options.targetProvider];
  if (!writer) {
    throw new SessionTransferError(
      'target-unsupported',
      `${providerDisplayName(options.targetProvider)} sessions cannot be written by Commander yet. Choose Fresh Start.`,
    );
  }
  const sourceProvider = (agent.provider ?? 'claude') as TransferSourceProvider;
  if (sourceProvider === options.targetProvider) {
    throw new SessionTransferError('source-provider-mismatch', `Agent already runs on ${providerDisplayName(sourceProvider)}.`);
  }
  if (!agent.sessionId) {
    throw new SessionTransferError('source-not-found', 'This agent has no saved session to transfer.');
  }

  const detectedProvider = deps.detectSourceProvider(agent.cwd, agent.sessionId);
  if (detectedProvider === null) {
    throw new SessionTransferError('source-not-found', `Source session ${agent.sessionId} was not found on disk.`);
  }
  if (detectedProvider !== sourceProvider) {
    throw new SessionTransferError(
      'source-provider-mismatch',
      `Session ${agent.sessionId} belongs to ${detectedProvider}, not ${sourceProvider}.`,
    );
  }

  const history = await deps.loadSourceSession(agent.cwd, agent.sessionId, Number.MAX_SAFE_INTEGER, 0);
  if (!history) {
    throw new SessionTransferError('source-not-found', `Source session ${agent.sessionId} could not be loaded.`);
  }
  const normalized = normalizeSessionForTransfer(history.messages);
  if (normalized.turns.length === 0) {
    throw new SessionTransferError('empty-source', 'The source session has no transferable visible conversation.');
  }

  const createdAt = deps.now();
  const fitted = fitTurnsToContext({
    turns: normalized.turns,
    provider: sourceProvider,
    sourceSessionId: agent.sessionId,
    changedFiles: normalized.changedFiles,
    droppedToolResultBodies: normalized.droppedToolResultBodies,
    mode: options.mode,
    contextLimit: options.contextLimit,
    now: createdAt,
  });
  const sessionId = deps.newSessionId();
  if (!sessionId || sessionId === agent.sessionId) {
    throw new SessionTransferError('invalid-output', 'A transfer must create a new session id.');
  }

  const artifacts = writer.serialize({
    cwd: agent.cwd,
    sessionId,
    sourceProvider,
    sourceSessionId: agent.sessionId,
    targetModel: options.targetModel,
    turns: fitted.turns,
    createdAt,
    deps,
  });
  if (artifacts.length === 0) {
    throw new SessionTransferError('invalid-output', 'The target writer produced no session files.');
  }
  const sessionDir = writer.sessionDir(agent.cwd, sessionId, createdAt, deps);
  const primaryPath = path.join(sessionDir, artifacts[0].name);

  const createdFiles: string[] = [];
  let ownedDir: string | undefined;
  let fileIdentity: CreatedTransfer['fileIdentity'] | undefined;
  const cleanup = () => {
    for (const filePath of createdFiles.reverse()) {
      try { fs.unlinkSync(filePath); } catch { /* best effort */ }
    }
    if (ownedDir) {
      try { fs.rmdirSync(ownedDir); } catch { /* best effort */ }
    }
  };

  try {
    if (writer.ownsSessionDir) {
      fs.mkdirSync(path.dirname(sessionDir), { recursive: true });
      // Exclusive create: an existing directory means the id is already taken.
      fs.mkdirSync(sessionDir, { mode: 0o700 });
      ownedDir = sessionDir;
    } else {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    for (const artifact of artifacts) {
      const finalPath = path.join(sessionDir, artifact.name);
      const tempPath = `${finalPath}.tmp-${randomUUID()}`;
      fs.writeFileSync(tempPath, artifact.content, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
      try {
        // link is an atomic, no-replace placement because temp and final live
        // in the same directory. Unlike rename, it fails on EEXIST instead of
        // ever overwriting an existing session.
        fs.linkSync(tempPath, finalPath);
      } finally {
        try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
      }
      createdFiles.push(finalPath);
    }

    const placedStat = fs.statSync(primaryPath);
    fileIdentity = { dev: placedStat.dev, ino: placedStat.ino };
    const readBack = fs.readFileSync(primaryPath, 'utf-8');
    writer.validatePrimary(readBack, sessionId);
  } catch (error) {
    cleanup();
    throw error;
  }

  if (!fileIdentity) {
    cleanup();
    throw new SessionTransferError('invalid-output', 'The target session was not placed atomically.');
  }
  return {
    targetProvider: options.targetProvider,
    sessionId,
    filePath: primaryPath,
    fileIdentity,
    createdFiles: [...createdFiles],
    ownedDir,
    summary: {
      sourceProvider,
      targetProvider: options.targetProvider,
      sourceSessionId: agent.sessionId,
      targetSessionId: sessionId,
      mode: options.mode,
      sourceMessageCount: history.totalCount,
      importedTurnCount: fitted.turns.length,
      droppedTurnCount: fitted.droppedTurns,
      droppedToolResultBodies: normalized.droppedToolResultBodies,
      estimatedTokens: fitted.estimatedTokens,
      contextLimit: options.contextLimit,
      warnings: fitted.warnings,
    },
  };
}

/** Pi-only convenience wrapper kept for the original call sites and tests. */
export async function createTransferredPiSession(
  agent: Agent,
  options: { mode: Exclude<SessionTransferMode, 'fresh'>; contextLimit: number },
  overrides: Partial<SessionTransferDependencies> = {},
): Promise<CreatedTransfer> {
  return createTransferredSession(agent, { ...options, targetProvider: 'pi' }, overrides);
}

/**
 * Remove only what createTransferredSession created: the exact primary inode,
 * its sibling artifacts, and (for Grok) the session directory when empty.
 */
export function removeTransferredSession(created: CreatedTransfer): void {
  try {
    const current = fs.statSync(created.filePath);
    if (current.dev !== created.fileIdentity.dev || current.ino !== created.fileIdentity.ino) {
      // Something replaced our file; leave the replacement (and its siblings) alone.
      return;
    }
    for (const filePath of [...created.createdFiles].reverse()) {
      try { fs.unlinkSync(filePath); } catch { /* best effort */ }
    }
    if (created.ownedDir) {
      try { fs.rmdirSync(created.ownedDir); } catch { /* not empty or already gone */ }
    }
  } catch {
    // The caller's primary failure is more useful; an orphan is safe and can be
    // discovered in the target CLI's session picker, while the source remains intact.
  }
}

/** @deprecated Use removeTransferredSession. */
export const removeTransferredPiSession = removeTransferredSession;
