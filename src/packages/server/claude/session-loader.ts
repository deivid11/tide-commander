/**
 * Claude Session Loader
 * Loads conversation history from Claude Code's session files
 *
 * Claude stores sessions in ~/.claude/projects/<project-path-encoded>/
 * Each session is a JSONL file with user and assistant messages
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import Database from 'better-sqlite3';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Session');

// Claude's project directory
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');
// OpenCode storage. Current versions keep session metadata + messages + parts
// in a SQLite database (opencode.db). Older versions used a filesystem layout
// (session/<project-id>/ses_<id>.json, message/ses_<id>/..., part/msg_<id>/...)
// which we still read as a fallback for legacy sessions.
const OPENCODE_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');
const OPENCODE_DB_PATH = path.join(OPENCODE_DIR, 'opencode.db');
const OPENCODE_STORAGE_DIR = path.join(OPENCODE_DIR, 'storage');
const OPENCODE_SESSION_DIR = path.join(OPENCODE_STORAGE_DIR, 'session');
const OPENCODE_MESSAGE_DIR = path.join(OPENCODE_STORAGE_DIR, 'message');
const OPENCODE_PART_DIR = path.join(OPENCODE_STORAGE_DIR, 'part');

// OpenCode uses lowercase tool names on disk; normalize to the capitalized
// variants the frontend expects. Kept in sync with json-event-parser.ts.
const OPENCODE_TOOL_NAME_MAP: Record<string, string> = {
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

function normalizeOpencodeToolName(raw: string): string {
  return OPENCODE_TOOL_NAME_MAP[raw.toLowerCase()] || raw;
}

// Grok CLI tool names → Tide UI names (keep in sync with grok/session-watcher.ts)
const GROK_TOOL_NAME_MAP: Record<string, string> = {
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
};

function normalizeGrokToolName(raw: string): string {
  return GROK_TOOL_NAME_MAP[raw.toLowerCase()] || raw;
}

const GROK_DIR = path.join(os.homedir(), '.grok');
const GROK_SESSIONS_DIR = path.join(GROK_DIR, 'sessions');

type SessionProvider = 'claude' | 'codex' | 'opencode' | 'grok';

interface ResolvedSessionFile {
  provider: SessionProvider;
  filePath: string;
  // When set, the opencode session lives in the SQLite DB and filePath points
  // at opencode.db (used only for a stat-based fallback mtime).
  opencodeDbSessionId?: string;
  // Grok: path to the session directory (chat_history.jsonl lives inside).
  grokSessionDir?: string;
}

const codexSessionFileById = new Map<string, string>();
const opencodeSessionFileById = new Map<string, string>();

let cachedOpencodeDb: Database.Database | null = null;
let opencodeDbOpenFailed = false;

function getOpencodeDb(): Database.Database | null {
  if (cachedOpencodeDb) {
    return cachedOpencodeDb;
  }
  if (opencodeDbOpenFailed) {
    return null;
  }
  if (!fs.existsSync(OPENCODE_DB_PATH)) {
    return null;
  }
  try {
    // Readonly: opencode owns this DB and may have it open in WAL mode.
    // fileMustExist guards against silent DB creation if the file vanishes.
    cachedOpencodeDb = new Database(OPENCODE_DB_PATH, { readonly: true, fileMustExist: true });
    return cachedOpencodeDb;
  } catch (err) {
    opencodeDbOpenFailed = true;
    log.warn(`Failed to open opencode sqlite DB at ${OPENCODE_DB_PATH}: ${String(err)}`);
    return null;
  }
}

interface OpencodeDbSessionRow {
  id: string;
  directory: string;
  time_updated: number;
}

function findOpencodeDbSession(sessionId: string): OpencodeDbSessionRow | null {
  const db = getOpencodeDb();
  if (!db) return null;
  try {
    const row = db
      .prepare('SELECT id, directory, time_updated FROM session WHERE id = ? LIMIT 1')
      .get(sessionId) as OpencodeDbSessionRow | undefined;
    return row ?? null;
  } catch (err) {
    log.warn(`Opencode DB session lookup failed for ${sessionId}: ${String(err)}`);
    return null;
  }
}
let hasLoggedTurnAbortedHistoryWarning = false;

// Message types from Claude session files
export interface SessionMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  timestamp: string;
  uuid: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string; // For linking tool_use with tool_result
}

export interface SessionInfo {
  sessionId: string;
  projectPath: string;
  lastModified: Date;
  messageCount: number;
}

export interface ConversationHistory {
  sessionId: string;
  messages: SessionMessage[];
  cwd: string;
  totalCount: number;
  hasMore: boolean;
}

export interface ToolExecution {
  agentId: string;
  agentName: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  timestamp: number;
}

export interface FileChange {
  agentId: string;
  agentName: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
  filePath: string;
  timestamp: number;
}

function deduplicateSessionMessages(messages: SessionMessage[]): SessionMessage[] {
  const deduped: SessionMessage[] = [];
  const seen = new Set<string>();
  // Content-based dedup for assistant messages: Codex can emit the same text
  // via multiple event types (event_msg.agent_message, response_item.message,
  // event_msg.task_complete). Keep only the first occurrence per unique content.
  const seenAssistantContent = new Set<string>();

  for (const message of messages) {
    const toolInputSignature = message.toolInput ? JSON.stringify(message.toolInput) : '';
    const key = [
      message.type,
      message.timestamp,
      message.uuid,
      message.content,
      message.toolName ?? '',
      message.toolUseId ?? '',
      toolInputSignature,
    ].join('\u241f');

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (message.type === 'assistant') {
      if (seenAssistantContent.has(message.content)) {
        continue;
      }
      seenAssistantContent.add(message.content);
    }

    deduped.push(message);
  }

  return deduped;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (typeof content === 'object') return JSON.stringify(content, null, 2);
  return String(content);
}

function sanitizeCodexMessageText(text: string): string {
  const hadTurnAborted = /<turn_aborted>[\s\S]*?<\/turn_aborted>/.test(text);
  if (hadTurnAborted) {
    if (!hasLoggedTurnAbortedHistoryWarning) {
      log.warn('Filtered <turn_aborted> markers from Codex session history messages (suppressing repeat logs)');
      hasLoggedTurnAbortedHistoryWarning = true;
    } else {
      log.debug('Filtered <turn_aborted> marker from Codex session history message');
    }
  }
  const withoutTurnAborted = text.replace(/<turn_aborted>[\s\S]*?<\/turn_aborted>/g, '').trim();
  if (withoutTurnAborted === 'You') {
    return '';
  }
  return withoutTurnAborted;
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function parseFunctionCallArguments(raw: unknown): Record<string, unknown> {
  if (isObject(raw)) {
    return raw;
  }
  if (typeof raw !== 'string') {
    return {};
  }
  const parsed = safeParseJson(raw);
  return isObject(parsed) ? parsed : { raw: raw };
}

function normalizeCodexImageReference(rawImageUrl: unknown): string {
  if (typeof rawImageUrl !== 'string') return '[Image attached]';

  const imageUrl = rawImageUrl.trim();
  if (!imageUrl) return '[Image attached]';

  // Avoid dumping inline base64 payloads into terminal history.
  if (imageUrl.startsWith('data:image/')) {
    return '[Image attached]';
  }

  return `[Image: ${imageUrl}]`;
}

function extractCodexContentSegments(content: unknown): string[] {
  if (!Array.isArray(content)) {
    const normalized = sanitizeCodexMessageText(normalizeTextContent(content));
    return normalized ? [normalized] : [];
  }

  const segments: string[] = [];
  let sawUnrecognizedBlock = false;
  for (const block of content) {
    if (!isObject(block)) {
      sawUnrecognizedBlock = true;
      continue;
    }
    const type = block.type;

    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      const maybeText = block.text;
      if (typeof maybeText === 'string' && maybeText.trim().length > 0) {
        segments.push(maybeText);
      }
      continue;
    }

    if (type === 'input_image') {
      segments.push(normalizeCodexImageReference(block.image_url));
      continue;
    }

    // A block shape we don't know how to render cleanly.
    sawUnrecognizedBlock = true;
  }

  if (segments.length > 0) {
    return segments;
  }

  // Only fall back to a raw stringified dump when the array contained block
  // shapes we didn't recognize. An array of recognized-but-empty blocks
  // (e.g. a Codex agent_message with empty output_text) must resolve to nothing
  // rather than rendering raw JSON like [{"type":"output_text","text":""}].
  if (!sawUnrecognizedBlock) {
    return [];
  }

  const fallback = sanitizeCodexMessageText(normalizeTextContent(content));
  return fallback ? [fallback] : [];
}

function extractCodexUserMessageFromString(rawMessage: string): string {
  const parsed = safeParseJson(rawMessage);
  const normalizedFromJson = extractCodexContentSegments(parsed).join('\n');
  if (normalizedFromJson.trim()) {
    return normalizedFromJson;
  }
  return sanitizeCodexMessageText(rawMessage);
}

interface NormalizedCodexToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
}

/** Unwrap a `/bin/zsh -lc "<cmd>"` wrapper to the inner shell command. */
function extractCodexShellCommand(command: string): string {
  const doubleQuoted = command.match(/-lc\s+"([\s\S]*)"$/);
  if (doubleQuoted) {
    return doubleQuoted[1]
      .replace(/\\"/g, '"')
      .replace(/\\`/g, '`')
      .replace(/\\\$/g, '$')
      .replace(/\\\\/g, '\\');
  }
  const singleQuoted = command.match(/-lc\s+'([\s\S]*)'$/);
  if (singleQuoted) return singleQuoted[1];
  return command;
}

/**
 * If a Codex exec_command is a single, side-effect-free file read
 * (`sed -n 'A,Bp' file`, `cat file`, `head -n N file`),
 * return a Read tool input (file_path + optional offset/limit line range) so the
 * reloaded row renders as one Read entry whose modal highlights the read lines —
 * matching the live parser and avoiding a redundant Bash row. Returns null for
 * anything that writes, edits, pipes, or chains commands.
 */
function inferCodexPureRead(command: string | undefined): Record<string, unknown> | null {
  if (!command) return null;
  const shell = extractCodexShellCommand(command).trim();
  if (!shell) return null;
  if (/[;&|]|>>?/.test(shell)) return null;
  if (/\b(?:sed\s+-i|perl\s+-pi|tee|apply_patch)\b/.test(shell)) return null;

  const toRead = (rawFile: string, offset?: number, limit?: number): Record<string, unknown> | null => {
    const file = rawFile.trim().replace(/^['"]|['"]$/g, '');
    if (!file || file === '/' || file.startsWith('-')) return null;
    const input: Record<string, unknown> = { file_path: file };
    if (offset !== undefined) input.offset = offset;
    if (limit !== undefined) input.limit = limit;
    return input;
  };

  let m = shell.match(/^sed\s+-n\s+['"]?(\d+),(\d+)p['"]?\s+(.+)$/);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    if (end < start) return null;
    return toRead(m[3], start, end - start + 1);
  }
  m = shell.match(/^head\s+(?:-n\s*)?(\d+)\s+(\S+)$/);
  if (m) return toRead(m[2], 1, parseInt(m[1], 10));
  // cat FILE → whole file. (tail stays Bash: its range is counted from EOF.)
  m = shell.match(/^cat\s+(\S+)$/);
  if (m) return toRead(m[1]);
  return null;
}

function normalizeCodexFunctionToolCall(
  rawToolName: string,
  rawToolInput: Record<string, unknown>
): NormalizedCodexToolCall {
  // Codex session history stores tool names as function identifiers (e.g. exec_command),
  // while live runtime events use normalized names (e.g. Bash). Align them so reload
  // renders identical rich tool rows in the UI.
  if (rawToolName === 'exec_command') {
    const cmd = typeof rawToolInput.cmd === 'string' ? rawToolInput.cmd : undefined;
    const command = typeof rawToolInput.command === 'string' ? rawToolInput.command : cmd;

    // Pure file reads render as a single Read row (with a highlighted line
    // range) rather than a Bash row — matching the live parser.
    const pureRead = inferCodexPureRead(command);
    if (pureRead) {
      return { toolName: 'Read', toolInput: pureRead };
    }

    return {
      toolName: 'Bash',
      toolInput: {
        ...rawToolInput,
        ...(command ? { command } : {}),
      },
    };
  }

  return {
    toolName: rawToolName,
    toolInput: rawToolInput,
  };
}

function normalizeCodexWebSearchToolInput(payload: Record<string, unknown>): Record<string, unknown> {
  const action = isObject(payload.action) ? payload.action : {};
  const actionQueriesRaw = action.queries;
  const actionQueries = Array.isArray(actionQueriesRaw) && actionQueriesRaw.every((q) => typeof q === 'string')
    ? actionQueriesRaw as string[]
    : undefined;

  return {
    actionType: typeof action.type === 'string' ? action.type : undefined,
    actionQuery: typeof action.query === 'string' ? action.query : undefined,
    actionQueries,
    actionUrl: typeof action.url === 'string' ? action.url : undefined,
    status: typeof payload.status === 'string' ? payload.status : undefined,
  };
}

function normalizeCodexEventFallbackText(eventType: string, payload: unknown): string {
  let serialized = '';
  try {
    serialized = JSON.stringify(payload, null, 2);
  } catch {
    serialized = String(payload);
  }

  const MAX_LEN = 4000;
  if (serialized.length > MAX_LEN) {
    serialized = `${serialized.slice(0, MAX_LEN)}...`;
  }

  return `[codex-event] ${eventType}\n${serialized}`;
}

/**
 * A single file changed by a Codex apply_patch, taken from the matching
 * `event_msg.patch_apply_end` event (which carries a clean unified diff).
 */
interface CodexPatchFileChange {
  path: string;
  unifiedDiff?: string;
  kind?: string; // 'add' | 'update' | 'delete'
}

/**
 * Pre-scan Codex session entries for `patch_apply_end` events and index their
 * per-file unified diffs by call_id. `patch_apply_end` arrives AFTER the
 * matching `apply_patch` custom_tool_call, so we collect it up front and then
 * attach the real diff to the rendered Edit rows — giving the file-viewer modal
 * a clean side-by-side / unified diff instead of the raw patch text.
 */
function collectCodexPatchApplyDiffs(entries: unknown[]): Map<string, CodexPatchFileChange[]> {
  const byCallId = new Map<string, CodexPatchFileChange[]>();
  for (const entry of entries) {
    if (!isObject(entry) || entry.type !== 'event_msg') continue;
    const payload = entry.payload;
    if (!isObject(payload) || payload.type !== 'patch_apply_end') continue;
    const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    if (!callId) continue;
    const changes = payload.changes;
    if (!isObject(changes)) continue;

    const fileChanges: CodexPatchFileChange[] = [];
    for (const [filePath, change] of Object.entries(changes)) {
      if (!isObject(change)) continue;
      fileChanges.push({
        path: filePath,
        unifiedDiff: typeof change.unified_diff === 'string' ? change.unified_diff : undefined,
        kind: typeof change.type === 'string' ? change.type : undefined,
      });
    }
    if (fileChanges.length > 0) {
      byCallId.set(callId, fileChanges);
    }
  }
  return byCallId;
}

function findCodexSessionFile(sessionId: string): string | null {
  const cached = codexSessionFileById.get(sessionId);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }

  if (!fs.existsSync(CODEX_SESSIONS_DIR)) {
    return null;
  }

  const queue = [CODEX_SESSIONS_DIR];

  while (queue.length > 0) {
    const dir = queue.pop();
    if (!dir) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      if (!entry.name.includes(sessionId)) {
        continue;
      }

      codexSessionFileById.set(sessionId, fullPath);
      return fullPath;
    }
  }

  return null;
}

function findOpencodeSessionFile(sessionId: string): string | null {
  const cached = opencodeSessionFileById.get(sessionId);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }

  if (!fs.existsSync(OPENCODE_SESSION_DIR)) {
    return null;
  }

  // Session ids are unique across projects, so scan each project-id directory
  // for ses_<id>.json. Caches the first hit.
  let projectDirs: fs.Dirent[];
  try {
    projectDirs = fs.readdirSync(OPENCODE_SESSION_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const targetFile = `${sessionId}.json`;
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(OPENCODE_SESSION_DIR, entry.name, targetFile);
    if (fs.existsSync(candidate)) {
      opencodeSessionFileById.set(sessionId, candidate);
      return candidate;
    }
  }

  return null;
}

/**
 * Locate a Grok session directory for (cwd, sessionId).
 * Grok keys projects by encodeURIComponent(absolute cwd) under ~/.grok/sessions/.
 */
function findGrokSessionDir(cwd: string, sessionId: string): string | null {
  if (!sessionId) return null;

  const candidates = new Set<string>();
  try {
    candidates.add(path.resolve(cwd));
  } catch {
    // ignore
  }
  candidates.add(cwd.replace(/\/+$/, ''));
  candidates.add(cwd);

  for (const c of candidates) {
    if (!c) continue;
    const dir = path.join(GROK_SESSIONS_DIR, encodeURIComponent(c), sessionId);
    const chatPath = path.join(dir, 'chat_history.jsonl');
    if (fs.existsSync(chatPath)) {
      return dir;
    }
  }

  // Fallback: scan all project keys for this session id (slower, rare)
  if (!fs.existsSync(GROK_SESSIONS_DIR)) return null;
  try {
    for (const entry of fs.readdirSync(GROK_SESSIONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(GROK_SESSIONS_DIR, entry.name, sessionId);
      if (fs.existsSync(path.join(dir, 'chat_history.jsonl'))) {
        return dir;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveSessionFile(cwd: string, sessionId: string): ResolvedSessionFile | null {
  const claudeFile = path.join(getProjectDir(cwd), `${sessionId}.jsonl`);
  if (fs.existsSync(claudeFile)) {
    return { provider: 'claude', filePath: claudeFile };
  }

  const codexFile = findCodexSessionFile(sessionId);
  if (codexFile && fs.existsSync(codexFile)) {
    return { provider: 'codex', filePath: codexFile };
  }

  const opencodeDbRow = findOpencodeDbSession(sessionId);
  if (opencodeDbRow) {
    return {
      provider: 'opencode',
      filePath: OPENCODE_DB_PATH,
      opencodeDbSessionId: opencodeDbRow.id,
    };
  }

  const opencodeFile = findOpencodeSessionFile(sessionId);
  if (opencodeFile && fs.existsSync(opencodeFile)) {
    return { provider: 'opencode', filePath: opencodeFile };
  }

  const grokDir = findGrokSessionDir(cwd, sessionId);
  if (grokDir) {
    return {
      provider: 'grok',
      filePath: path.join(grokDir, 'chat_history.jsonl'),
      grokSessionDir: grokDir,
    };
  }

  return null;
}

/**
 * Encode a path to Claude's project directory format
 * /home/user/project -> -home-user-project
 * /home/user/project/ -> -home-user-project (trailing slash removed)
 * /home/user/my_project -> -home-user-my-project (underscores replaced)
 */
export function encodeProjectPath(cwd: string): string {
  // Normalize: remove trailing slashes, then replace / and _ with -
  // Claude Code encodes both forward slashes and underscores as hyphens
  const normalized = cwd.replace(/\/+$/, '');
  return normalized.replace(/[/_]/g, '-');
}

/**
 * Get the Claude projects directory for a given working directory
 */
export function getProjectDir(cwd: string): string {
  const encoded = encodeProjectPath(cwd);
  return path.join(PROJECTS_DIR, encoded);
}

/**
 * List all sessions for a project directory
 */
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  const projectDir = getProjectDir(cwd);

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const files = fs.readdirSync(projectDir);
  const sessions: SessionInfo[] = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;

    const sessionId = file.replace('.jsonl', '');
    const filePath = path.join(projectDir, file);
    const stats = fs.statSync(filePath);

    // Quick count of messages (approximate)
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const messageCount = lines.filter(l => {
      try {
        const parsed = JSON.parse(l);
        return parsed.type === 'user' || parsed.type === 'assistant';
      } catch {
        return false;
      }
    }).length;

    sessions.push({
      sessionId,
      projectPath: cwd,
      lastModified: stats.mtime,
      messageCount,
    });
  }

  // Sort by last modified, newest first
  sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  return sessions;
}

// ============================================================================
// Global session listing & search (cross-project)
// ============================================================================

/**
 * Lightweight session record used by the global session finder UI.
 *
 * Includes everything needed to render a result row and to attach the session
 * onto an agent (`projectPath` is the original `cwd`, recovered from the JSONL
 * itself rather than from the project dir name — the encoding is lossy because
 * `_` and `/` both map to `-`).
 */
export interface GlobalSessionInfo {
  sessionId: string;
  projectPath: string;          // recovered cwd ("" if file is empty/unreadable)
  projectDir: string;            // encoded dir name under ~/.claude/projects
  lastModified: Date;
  messageCount: number;          // 0 = unknown / skipped for cost reasons
  firstPrompt: string;           // first user prompt content (truncated)
  sizeBytes: number;
}

/**
 * Search hit produced by `searchAllSessions`.
 */
export interface GlobalSessionSearchMatch {
  sessionId: string;
  projectPath: string;
  projectDir: string;
  lastModified: Date;
  totalMatches: number;          // total matching lines in this session
  snippet: string;               // first matching line, trimmed
  firstPrompt: string;           // first user prompt content (truncated) for context
}

const FIRST_PROMPT_MAX_LEN = 240;
const SEARCH_SNIPPET_MAX_LEN = 280;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function extractClaudeMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const m = message as { content?: unknown };
  const content = m.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object' && 'type' in block && (block as { type: string }).type === 'text') {
        const text = (block as { text?: unknown }).text;
        if (typeof text === 'string') parts.push(text);
      }
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Read the first up-to-`maxLines` JSONL records of a session file. Used to
 * cheaply recover `cwd` and the first user prompt without parsing the whole
 * conversation. Falls back to a single readFileSync slice for very small files.
 */
async function readSessionHeader(filePath: string, maxLines = 20): Promise<{ cwd: string; firstPrompt: string }> {
  let cwd = '';
  let firstPrompt = '';
  try {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineCount = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      lineCount += 1;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd as string;
        // queue-operation enqueue rows carry the user's prompt as `content`
        if (!firstPrompt && obj.type === 'queue-operation' && (obj as { operation?: string }).operation === 'enqueue') {
          const content = (obj as { content?: unknown }).content;
          if (typeof content === 'string') firstPrompt = content;
        }
        if (!firstPrompt && obj.type === 'user') {
          const text = extractClaudeMessageText(obj.message);
          if (text) firstPrompt = text;
        }
        if (cwd && firstPrompt) break;
      } catch {
        // ignore malformed lines
      }
      if (lineCount >= maxLines) break;
    }
    rl.close();
    stream.destroy();
  } catch {
    // unreadable file — return empty defaults
  }
  return { cwd, firstPrompt: truncate(firstPrompt, FIRST_PROMPT_MAX_LEN) };
}

/**
 * List every Claude session across every project directory.
 *
 * Cheap: only stats each .jsonl and reads the first few lines for cwd/firstPrompt.
 * Skips message-count computation by default to keep the operation fast even
 * across hundreds of sessions.
 */
export async function listAllSessions(options?: {
  limit?: number;             // cap how many sessions to return (newest first)
  includeMessageCount?: boolean; // when true, count user/assistant turns (slow)
}): Promise<GlobalSessionInfo[]> {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const projectDirs = fs.readdirSync(PROJECTS_DIR);
  const all: GlobalSessionInfo[] = [];

  for (const projectDir of projectDirs) {
    const fullProjectPath = path.join(PROJECTS_DIR, projectDir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(fullProjectPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const sessionId = entry.name.replace(/\.jsonl$/, '');
      const filePath = path.join(fullProjectPath, entry.name);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(filePath);
      } catch {
        continue;
      }
      all.push({
        sessionId,
        projectPath: '',
        projectDir,
        lastModified: stats.mtime,
        messageCount: 0,
        firstPrompt: '',
        sizeBytes: stats.size,
      });
    }
  }

  all.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  const limit = options?.limit ?? all.length;
  const limited = all.slice(0, limit);

  // Enrich with cwd + firstPrompt (and optionally messageCount). Run concurrently
  // but cap concurrency so we don't open hundreds of file handles at once.
  const concurrency = 8;
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (cursor < limited.length) {
        const idx = cursor++;
        const item = limited[idx];
        const filePath = path.join(PROJECTS_DIR, item.projectDir, `${item.sessionId}.jsonl`);
        const header = await readSessionHeader(filePath);
        item.projectPath = header.cwd;
        item.firstPrompt = header.firstPrompt;
        if (options?.includeMessageCount) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            let count = 0;
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const obj = JSON.parse(line) as { type?: string };
                if (obj.type === 'user' || obj.type === 'assistant') count++;
              } catch { /* ignore */ }
            }
            item.messageCount = count;
          } catch { /* ignore */ }
        }
      }
    })());
  }
  await Promise.all(workers);

  return limited;
}

/**
 * Full-text search every Claude session for `query`. Streams files line-by-line
 * so memory usage stays bounded even with many large sessions.
 */
export async function searchAllSessions(
  query: string,
  options?: {
    limit?: number;            // cap returned sessions (default 100)
    cwdFilter?: string;        // only search sessions whose recovered cwd contains this substring
  }
): Promise<GlobalSessionSearchMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryLower = trimmed.toLowerCase();
  const limit = options?.limit ?? 100;
  const cwdFilter = options?.cwdFilter?.toLowerCase();

  const sessions = await listAllSessions({ limit: 1000 });

  const out: GlobalSessionSearchMatch[] = [];
  const concurrency = 6;
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (cursor < sessions.length) {
        const idx = cursor++;
        const session = sessions[idx];
        if (cwdFilter && !session.projectPath.toLowerCase().includes(cwdFilter)) continue;
        const filePath = path.join(PROJECTS_DIR, session.projectDir, `${session.sessionId}.jsonl`);
        let totalMatches = 0;
        let snippet = '';
        try {
          const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
          const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
          for await (const line of rl) {
            if (!line) continue;
            // Skip the cheap path: just lowercase the raw line and substring search.
            // This avoids parsing every JSON record but matches inside any field
            // (message text, tool args, etc.) — fine for a UX search.
            if (!line.toLowerCase().includes(queryLower)) continue;
            totalMatches++;
            if (!snippet) {
              // try to extract a clean text snippet from message content
              try {
                const obj = JSON.parse(line) as { type?: string; message?: unknown; content?: unknown };
                if (obj.type === 'user' || obj.type === 'assistant') {
                  const text = extractClaudeMessageText(obj.message);
                  if (text) snippet = text;
                } else if (obj.type === 'queue-operation' && typeof obj.content === 'string') {
                  snippet = obj.content;
                }
              } catch { /* fall through to raw-line snippet */ }
              if (!snippet) snippet = line;
              snippet = truncate(snippet.replace(/\s+/g, ' ').trim(), SEARCH_SNIPPET_MAX_LEN);
            }
          }
          rl.close();
          stream.destroy();
        } catch { /* unreadable — skip */ }

        if (totalMatches > 0) {
          out.push({
            sessionId: session.sessionId,
            projectPath: session.projectPath,
            projectDir: session.projectDir,
            lastModified: session.lastModified,
            totalMatches,
            snippet,
            firstPrompt: session.firstPrompt,
          });
        }
      }
    })());
  }
  await Promise.all(workers);

  out.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  return out.slice(0, limit);
}

/**
 * Wait for file to be stable (not actively being written)
 * Checks if file size remains constant over a small interval
 */
async function waitForFileStable(filePath: string, maxWaitMs: number = 500): Promise<void> {
  const checkInterval = 50;
  let lastSize = -1;
  let elapsed = 0;

  while (elapsed < maxWaitMs) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size === lastSize) {
        // File size hasn't changed, consider stable
        return;
      }
      lastSize = stats.size;
    } catch {
      // File might not exist yet
      return;
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    elapsed += checkInterval;
  }
}

type SessionActivityMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | null;

function parseClaudeEntryMessages(
  entry: any,
  messages: SessionMessage[],
  toolUseIdToName: Map<string, string>
): void {
  // Messages typed while a turn is in flight are persisted as
  // attachment.queued_command rather than a top-level user entry, so emit
  // them as user messages to keep history chronologically intact.
  if (entry.type === 'attachment' && entry.attachment?.type === 'queued_command') {
    const prompt = entry.attachment.prompt;
    if (typeof prompt === 'string' && prompt.trim()) {
      messages.push({
        type: 'user',
        content: prompt,
        timestamp: entry.timestamp,
        uuid: entry.uuid ?? `${entry.timestamp}-queued-user`,
      });
    }
    return;
  }

  if (entry.type === 'user' && entry.message?.content) {
    if (Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block.type === 'tool_result') {
          // Prefer raw tool_use_result stdout/stderr when available so history
          // preserves full command output (block.content can be summarized).
          let content: string;
          if (entry.tool_use_result?.stdout !== undefined) {
            content = String(entry.tool_use_result.stdout ?? '');
            if (entry.tool_use_result?.stderr) {
              content += (content ? '\n' : '') + `[stderr] ${String(entry.tool_use_result.stderr)}`;
            }
          } else {
            content = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          }
          const toolName = toolUseIdToName.get(block.tool_use_id) || 'unknown';
          messages.push({
            type: 'tool_result',
            content,
            timestamp: entry.timestamp,
            uuid: entry.uuid ?? `${entry.timestamp}-tool-result`,
            toolName,
            toolUseId: block.tool_use_id,
          });
        } else if (block.type === 'text' && block.text) {
          messages.push({
            type: 'user',
            content: block.text,
            timestamp: entry.timestamp,
            uuid: entry.uuid ?? `${entry.timestamp}-user`,
          });
        }
      }
      return;
    }

    messages.push({
      type: 'user',
      content: entry.message.content,
      timestamp: entry.timestamp,
      uuid: entry.uuid ?? `${entry.timestamp}-user`,
    });
    return;
  }

  if (entry.type === 'assistant' && entry.message?.content) {
    if (Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block.type === 'text' && block.text) {
          messages.push({
            type: 'assistant',
            content: block.text,
            timestamp: entry.timestamp,
            uuid: entry.uuid ?? `${entry.timestamp}-assistant`,
          });
        } else if (block.type === 'tool_use' && block.name) {
          if (block.id) {
            toolUseIdToName.set(block.id, block.name);
          }
          messages.push({
            type: 'tool_use',
            content: JSON.stringify(block.input || {}, null, 2),
            timestamp: entry.timestamp,
            uuid: entry.uuid ?? `${entry.timestamp}-tool-use`,
            toolName: block.name,
            toolInput: block.input,
            toolUseId: block.id,
          });
        }
      }
      return;
    }

    if (typeof entry.message.content === 'string') {
      messages.push({
        type: 'assistant',
        content: entry.message.content,
        timestamp: entry.timestamp,
        uuid: entry.uuid ?? `${entry.timestamp}-assistant`,
      });
    }
  }
}

function extractCodexMessageText(content: unknown): string {
  const segments = extractCodexContentSegments(content);
  return sanitizeCodexMessageText(segments.join('\n'));
}

function isImageOnlyCodexMessage(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;
  return /^(?:\[(?:Image attached|Image:\s*[^\]]+)\]\s*)+$/m.test(normalized);
}

function stripCodexInjectedUserMessage(content: string): string {
  let normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return normalized;

  // Some Codex session formats prefix role markers inline (e.g. "You# AGENTS...").
  // Remove this marker only when immediately followed by known wrapper starters.
  normalized = normalized.replace(/^You(?=[<#])/gm, '');

  const userRequestHeader = '## User Request';
  const userRequestHeaderIndex = normalized.lastIndexOf(userRequestHeader);
  const hadUserRequestHeader = userRequestHeaderIndex !== -1;

  if (hadUserRequestHeader) {
    normalized = normalized.slice(userRequestHeaderIndex + userRequestHeader.length).trim();
  }

  const wrapperPatterns = [
    /^# AGENTS\.md instructions[^\n]*\n[\s\S]*?<\/INSTRUCTIONS>\s*/i,
    /^<environment_context>\s*[\s\S]*?<\/environment_context>\s*/i,
    /^Follow all instructions below for this task\.\s*/i,
  ];

  let keepStripping = true;
  let didStripWrapper = false;
  while (keepStripping) {
    keepStripping = false;
    for (const pattern of wrapperPatterns) {
      const match = normalized.match(pattern);
      if (match) {
        normalized = normalized.slice(match[0].length).trimStart();
        keepStripping = true;
        didStripWrapper = true;
        break;
      }
    }
  }

  if ((hadUserRequestHeader || didStripWrapper) && /^You\S/.test(normalized)) {
    normalized = normalized.slice(3).trimStart();
  }

  return normalized.trim();
}

function parseCodexEntryMessages(
  entry: any,
  messages: SessionMessage[],
  toolUseIdToName: Map<string, string>,
  patchDiffsByCallId?: Map<string, CodexPatchFileChange[]>
): void {
  if (entry.type === 'event_msg' && isObject(entry.payload)) {
    const payload = entry.payload as Record<string, unknown>;
    if (payload.type === 'user_message' && typeof payload.message === 'string') {
      const normalizedMessage = stripCodexInjectedUserMessage(
        extractCodexUserMessageFromString(payload.message)
      );
      if (!normalizedMessage) {
        return;
      }
      messages.push({
        type: 'user',
        content: normalizedMessage,
        timestamp: entry.timestamp,
        uuid: `${entry.timestamp}-user`,
      });
      return;
    }
    // agent_message: Skip. Handled by response_item with role=assistant.
    // (Matches live parser behavior in json-event-parser.ts)
    if (payload.type === 'agent_message') {
      return;
    }

    // token_count: Skip in history (token accounting shown via turn.completed)
    if (payload.type === 'token_count') {
      return;
    }

    // agent_reasoning: Skip in history (consistent with Claude thinking behavior)
    if (payload.type === 'agent_reasoning') {
      return;
    }

    // turn_aborted: Skip in history (interruption is visible from agent stopping)
    if (payload.type === 'turn_aborted') {
      return;
    }

    // task_complete: Skip. Final agent message is already present via
    // response_item with role=assistant (or item.completed agent_message).
    if (payload.type === 'task_complete') {
      return;
    }

    // task_started: Skip. Envelope event with no user-facing content.
    if (payload.type === 'task_started') {
      return;
    }

    // patch_apply_begin / patch_apply_end: Skip. Each apply_patch is also stored
    // as a custom_tool_call (+ custom_tool_call_output) with the same call_id,
    // which already renders the Edit/diff row. Rendering these too would
    // duplicate it (or dump raw JSON through the fallback below).
    if (payload.type === 'patch_apply_begin' || payload.type === 'patch_apply_end') {
      return;
    }

    // Unknown event_msg types: keep fallback
    const payloadType = typeof payload.type === 'string' ? payload.type : 'unknown';
    messages.push({
      type: 'assistant',
      content: normalizeCodexEventFallbackText(`event_msg.${payloadType}`, payload),
      timestamp: entry.timestamp,
      uuid: `${entry.timestamp}-assistant-codex-event`,
    });
    return;
  }

  if (entry.type !== 'response_item' || !isObject(entry.payload)) {
    return;
  }

  const payload = entry.payload as Record<string, unknown>;
  const payloadType = payload.type;

  if (payloadType === 'message') {
    const role = payload.role;
    if (role !== 'user' && role !== 'assistant') {
      return;
    }

    const rawContent = extractCodexMessageText(payload.content);
    if (role === 'user' && isImageOnlyCodexMessage(rawContent)) {
      // Codex often emits a second user response_item containing only input_image
      // blocks (data URL content) after the primary event_msg user_message.
      // Skip this synthetic duplicate to keep history clean and clickable.
      return;
    }
    const content = role === 'user' ? stripCodexInjectedUserMessage(rawContent) : rawContent;
    if (!content.trim()) {
      return;
    }

    messages.push({
      type: role,
      content,
      timestamp: entry.timestamp,
      uuid: `${entry.timestamp}-${role}`,
    });
    return;
  }

  if (payloadType === 'function_call') {
    const rawToolName = typeof payload.name === 'string' ? payload.name : 'unknown';
    const toolUseId = typeof payload.call_id === 'string' ? payload.call_id : undefined;

    // write_stdin feeds keystrokes to (or just polls) an interactive exec
    // session — the call itself is noise (chars is usually empty), producing
    // rows of bare "write_stdin". Skip the tool_use row, but attribute its
    // output to Bash so any interactive output still renders as terminal output.
    if (rawToolName === 'write_stdin') {
      if (toolUseId) {
        toolUseIdToName.set(toolUseId, 'Bash');
      }
      return;
    }

    const rawToolInput = parseFunctionCallArguments(payload.arguments);
    const { toolName, toolInput } = normalizeCodexFunctionToolCall(rawToolName, rawToolInput);
    if (toolUseId) {
      toolUseIdToName.set(toolUseId, toolName);
    }
    messages.push({
      type: 'tool_use',
      content: JSON.stringify(toolInput, null, 2),
      timestamp: entry.timestamp,
      uuid: `${entry.timestamp}-tool-use`,
      toolName,
      toolInput,
      toolUseId,
    });
    return;
  }

  if (payloadType === 'web_search_call') {
    const toolName = 'web_search';
    const toolInput = normalizeCodexWebSearchToolInput(payload);
    const status = typeof payload.status === 'string' ? payload.status : undefined;
    const toolUseId = typeof payload.call_id === 'string' ? payload.call_id : `${entry.timestamp}-web-search`;

    messages.push({
      type: 'tool_use',
      content: JSON.stringify(toolInput, null, 2),
      timestamp: entry.timestamp,
      uuid: `${entry.timestamp}-tool-use-web-search`,
      toolName,
      toolInput,
      toolUseId,
    });

    if (status === 'completed') {
      messages.push({
        type: 'tool_result',
        content: JSON.stringify(toolInput, null, 2),
        timestamp: entry.timestamp,
        uuid: `${entry.timestamp}-tool-result-web-search`,
        toolName,
        toolUseId,
      });
    }
    return;
  }

  if (payloadType === 'function_call_output') {
    const toolUseId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    const toolName = toolUseId ? (toolUseIdToName.get(toolUseId) || 'unknown') : 'unknown';
    const content = normalizeTextContent(payload.output);
    messages.push({
      type: 'tool_result',
      content,
      timestamp: entry.timestamp,
      uuid: `${entry.timestamp}-tool-result`,
      toolName,
      toolUseId,
    });
    return;
  }

  // reasoning: Skip in history (consistent with Claude thinking behavior)
  if (payloadType === 'reasoning') {
    return;
  }

  // custom_tool_call: Map to tool_use (normalize apply_patch -> Edit)
  if (payloadType === 'custom_tool_call') {
    const rawToolName = typeof payload.name === 'string' ? payload.name : 'unknown';
    const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    const rawInput = typeof payload.input === 'string' ? payload.input : '';

    // Normalize: apply_patch -> Edit for consistent UI rendering
    const toolName = rawToolName === 'apply_patch' ? 'Edit' : rawToolName;

    // Preferred path: the matching patch_apply_end gave us a clean unified diff
    // per file. Emit one Edit row per changed file so clicking opens the
    // file-viewer modal with a real side-by-side / unified diff.
    const patchFiles = rawToolName === 'apply_patch' && callId
      ? patchDiffsByCallId?.get(callId)
      : undefined;
    if (patchFiles && patchFiles.length > 0) {
      if (callId) {
        toolUseIdToName.set(callId, 'Edit');
      }
      patchFiles.forEach((file, idx) => {
        const toolInput: Record<string, unknown> = { file_path: file.path };
        if (file.unifiedDiff) toolInput.unified_diff = file.unifiedDiff;
        if (file.kind === 'add') toolInput.operation = 'create';
        else if (file.kind === 'delete') toolInput.operation = 'delete';
        messages.push({
          type: 'tool_use',
          content: JSON.stringify(toolInput, null, 2),
          timestamp: entry.timestamp,
          uuid: `${entry.timestamp}-tool-use-custom-${idx}`,
          toolName: 'Edit',
          toolInput,
          toolUseId: callId,
        });
      });
      return;
    }

    // Fallback (older sessions without patch_apply_end): keep the raw patch text
    // so the modal can at least show the change and resolve the file path.
    const toolInput: Record<string, unknown> = {};
    if (rawToolName === 'apply_patch' && rawInput) {
      // Extract file path from patch for clickable display
      const fileMatch = rawInput.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
      if (fileMatch) {
        toolInput.file_path = fileMatch[1].trim();
      }
      toolInput.old_string = '';
      toolInput.new_string = rawInput;
    } else {
      toolInput.input = rawInput;
    }

    if (callId) {
      toolUseIdToName.set(callId, toolName);
    }

    messages.push({
      type: 'tool_use',
      content: JSON.stringify(toolInput, null, 2),
      timestamp: entry.timestamp,
      uuid: `${entry.timestamp}-tool-use-custom`,
      toolName,
      toolInput,
      toolUseId: callId,
    });
    return;
  }

  // custom_tool_call_output: Map to tool_result
  if (payloadType === 'custom_tool_call_output') {
    const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    const toolName = callId ? (toolUseIdToName.get(callId) || 'unknown') : 'unknown';
    let content = normalizeTextContent(payload.output);

    // Parse apply_patch JSON output wrapper to extract meaningful text
    if (content) {
      try {
        const parsed = JSON.parse(content);
        if (isObject(parsed) && typeof parsed.output === 'string') {
          content = parsed.output as string;
        }
      } catch {
        // Use raw content as-is
      }
    }

    messages.push({
      type: 'tool_result',
      content,
      timestamp: entry.timestamp,
      uuid: `${entry.timestamp}-tool-result-custom`,
      toolName,
      toolUseId: callId,
    });
    return;
  }

  const unknownPayloadType = typeof payloadType === 'string' ? payloadType : 'unknown';
  messages.push({
    type: 'assistant',
    content: normalizeCodexEventFallbackText(`response_item.${unknownPayloadType}`, payload),
    timestamp: entry.timestamp,
    uuid: `${entry.timestamp}-assistant-codex-response-item`,
  });
}

function safeReadJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface OpencodeDbMessageRow {
  id: string;
  time_created: number;
  data: string;
}

interface OpencodeDbPartRow {
  id: string;
  message_id: string;
  time_created: number;
  data: string;
}

function parseOpencodePart(
  part: Record<string, unknown>,
  role: 'user' | 'assistant' | null,
  partId: string,
  timestamp: string,
  toolUseIdToName: Map<string, string>,
  messages: SessionMessage[]
): void {
  const partType = part.type;

  if (partType === 'text' && typeof part.text === 'string' && part.text.trim()) {
    if (role === null) return;
    messages.push({
      type: role,
      content: part.text,
      timestamp,
      uuid: partId,
    });
    return;
  }

  if (partType === 'tool') {
    const rawToolName = typeof part.tool === 'string' ? part.tool : 'unknown';
    const toolName = normalizeOpencodeToolName(rawToolName);
    const callId = typeof part.callID === 'string' ? part.callID : undefined;
    const state = isObject(part.state) ? part.state : null;
    const rawInput = state && isObject(state.input) ? state.input : {};

    if (callId) {
      toolUseIdToName.set(callId, toolName);
    }

    messages.push({
      type: 'tool_use',
      content: JSON.stringify(rawInput, null, 2),
      timestamp,
      uuid: partId,
      toolName,
      toolInput: rawInput,
      toolUseId: callId,
    });

    const status = state && typeof state.status === 'string' ? state.status : undefined;
    if (status === 'completed') {
      const output = state && typeof state.output === 'string' ? state.output : '';
      messages.push({
        type: 'tool_result',
        content: output,
        timestamp,
        uuid: `${partId}-result`,
        toolName,
        toolUseId: callId,
      });
    }
    return;
  }

  // Skip: reasoning, step-start, step-finish, patch (mirrors Claude/Codex history behavior).
}

async function parseOpencodeDbSessionMessages(
  sessionId: string
): Promise<{ messages: SessionMessage[]; lastMessageType: SessionActivityMessageType; lastMessageTimestamp: Date | null }> {
  const db = getOpencodeDb();
  if (!db) {
    return { messages: [], lastMessageType: null, lastMessageTimestamp: null };
  }

  const messages: SessionMessage[] = [];
  const toolUseIdToName = new Map<string, string>();

  let messageRows: OpencodeDbMessageRow[];
  let partRows: OpencodeDbPartRow[];
  try {
    messageRows = db
      .prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC')
      .all(sessionId) as OpencodeDbMessageRow[];
    partRows = db
      .prepare('SELECT id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created ASC, id ASC')
      .all(sessionId) as OpencodeDbPartRow[];
  } catch (err) {
    log.warn(`Opencode DB message/part query failed for ${sessionId}: ${String(err)}`);
    return { messages: [], lastMessageType: null, lastMessageTimestamp: null };
  }

  const partsByMessageId = new Map<string, OpencodeDbPartRow[]>();
  for (const part of partRows) {
    const bucket = partsByMessageId.get(part.message_id);
    if (bucket) {
      bucket.push(part);
    } else {
      partsByMessageId.set(part.message_id, [part]);
    }
  }

  for (const msgRow of messageRows) {
    const msgJson = safeParseJson(msgRow.data);
    if (!isObject(msgJson)) continue;

    const role = msgJson.role === 'user' ? 'user' : msgJson.role === 'assistant' ? 'assistant' : null;
    const createdMs = isObject(msgJson.time) && typeof msgJson.time.created === 'number'
      ? msgJson.time.created
      : msgRow.time_created;
    const timestamp = createdMs > 0 ? new Date(createdMs).toISOString() : new Date(0).toISOString();

    const messageParts = partsByMessageId.get(msgRow.id);
    if (!messageParts || messageParts.length === 0) continue;

    for (const partRow of messageParts) {
      const part = safeParseJson(partRow.data);
      if (!isObject(part)) continue;
      const partId = partRow.id;
      parseOpencodePart(part, role, partId, timestamp, toolUseIdToName, messages);
    }
  }

  const dedupedMessages = deduplicateSessionMessages(messages);
  const last = dedupedMessages.length > 0 ? dedupedMessages[dedupedMessages.length - 1] : null;
  return {
    messages: dedupedMessages,
    lastMessageType: last?.type ?? null,
    lastMessageTimestamp: last?.timestamp ? new Date(last.timestamp) : null,
  };
}

async function parseOpencodeSessionMessages(
  sessionFilePath: string
): Promise<{ messages: SessionMessage[]; lastMessageType: SessionActivityMessageType; lastMessageTimestamp: Date | null }> {
  const messages: SessionMessage[] = [];
  const toolUseIdToName = new Map<string, string>();

  const sessionId = path.basename(sessionFilePath, '.json');
  const messagesDir = path.join(OPENCODE_MESSAGE_DIR, sessionId);

  if (!fs.existsSync(messagesDir)) {
    return { messages: [], lastMessageType: null, lastMessageTimestamp: null };
  }

  let messageFiles: string[];
  try {
    messageFiles = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { messages: [], lastMessageType: null, lastMessageTimestamp: null };
  }

  for (const msgFile of messageFiles) {
    const msgJson = safeReadJsonFile(path.join(messagesDir, msgFile));
    if (!isObject(msgJson)) continue;

    const msgId = typeof msgJson.id === 'string' ? msgJson.id : msgFile.replace(/\.json$/, '');
    const role = msgJson.role === 'user' ? 'user' : msgJson.role === 'assistant' ? 'assistant' : null;
    const createdMs = isObject(msgJson.time) && typeof msgJson.time.created === 'number'
      ? msgJson.time.created
      : 0;
    const timestamp = createdMs > 0 ? new Date(createdMs).toISOString() : new Date(0).toISOString();

    const partsDir = path.join(OPENCODE_PART_DIR, msgId);
    if (!fs.existsSync(partsDir)) continue;

    let partFiles: string[];
    try {
      partFiles = fs.readdirSync(partsDir).filter((f) => f.endsWith('.json')).sort();
    } catch {
      continue;
    }

    for (const partFile of partFiles) {
      const part = safeReadJsonFile(path.join(partsDir, partFile));
      if (!isObject(part)) continue;
      const partId = typeof part.id === 'string' ? part.id : `${timestamp}-${partFile}`;
      parseOpencodePart(part, role, partId, timestamp, toolUseIdToName, messages);
    }
  }

  const dedupedMessages = deduplicateSessionMessages(messages);
  const last = dedupedMessages.length > 0 ? dedupedMessages[dedupedMessages.length - 1] : null;
  return {
    messages: dedupedMessages,
    lastMessageType: last?.type ?? null,
    lastMessageTimestamp: last?.timestamp ? new Date(last.timestamp) : null,
  };
}

function extractGrokTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: string };
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text);
    }
  }
  return parts.join('\n');
}

/** Prefer the Tide-injected <user_query> body when present. */
function extractGrokUserDisplayText(content: unknown): string {
  const raw = extractGrokTextContent(content).trim();
  if (!raw) return '';
  const queryMatch = raw.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (queryMatch?.[1]) {
    return queryMatch[1].trim();
  }
  return raw;
}

function parseGrokToolArguments(args: unknown): Record<string, unknown> {
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

/**
 * Parse Grok chat_history.jsonl into Tide SessionMessages.
 * chat_history has no per-line timestamps — we synthesize monotonic ISO times
 * so the client sort order matches file order.
 */
function parseGrokSessionMessages(
  chatHistoryPath: string
): { messages: SessionMessage[]; lastMessageType: SessionActivityMessageType; lastMessageTimestamp: Date | null } {
  const messages: SessionMessage[] = [];
  if (!fs.existsSync(chatHistoryPath)) {
    return { messages: [], lastMessageType: null, lastMessageTimestamp: null };
  }

  // Timestamps: assign AFTER parse so the LAST message is file mtime and each
  // prior message is 1s earlier. Using (mtime - 1h + lineIndex) put the whole
  // history page ~50min behind wall-clock live events, so the merged
  // history+live list buried all tools ABOVE the live stream (user pin-to-
  // bottom only saw thinking + final text).
  let fileMtimeMs = Date.now();
  try {
    fileMtimeMs = fs.statSync(chatHistoryPath).mtimeMs;
  } catch {
    // ignore
  }

  const content = fs.readFileSync(chatHistoryPath, 'utf-8');
  const lines = content.split('\n');
  let lineIndex = 0;
  const toolUseIdToName = new Map<string, string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    lineIndex += 1;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof entry.type === 'string' ? entry.type : '';
    // Placeholder — rewritten below from file mtime once we know message count.
    const ts = new Date(fileMtimeMs).toISOString();

    // Skip system prompt and synthetic MCP/system-reminder injections
    if (type === 'system') continue;
    if (type === 'user' && entry.synthetic_reason === 'system_reminder') continue;

    if (type === 'user') {
      const text = extractGrokUserDisplayText(entry.content);
      if (!text) continue;
      // Skip pure scaffolding (user_info / system-reminder without user_query)
      if (
        text.startsWith('<user_info>') ||
        text.startsWith('<system-reminder>') ||
        (text.includes('<system-reminder>') && !text.includes('<user_query>'))
      ) {
        continue;
      }
      messages.push({
        type: 'user',
        content: text,
        timestamp: ts,
        uuid: `grok-user-${lineIndex}`,
      });
      continue;
    }

    if (type === 'reasoning') {
      // Optional thinking summaries — surface as assistant thinking lines
      const summary = entry.summary;
      let thinking = '';
      if (Array.isArray(summary)) {
        thinking = summary
          .map((s) => {
            if (s && typeof s === 'object' && typeof (s as { text?: string }).text === 'string') {
              return (s as { text: string }).text;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
      if (thinking) {
        messages.push({
          type: 'assistant',
          content: `[thinking] ${thinking}`,
          timestamp: ts,
          uuid: typeof entry.id === 'string' ? entry.id : `grok-reasoning-${lineIndex}`,
        });
      }
      continue;
    }

    if (type === 'assistant') {
      const text = typeof entry.content === 'string' ? entry.content : extractGrokTextContent(entry.content);
      if (text.trim()) {
        messages.push({
          type: 'assistant',
          content: text,
          timestamp: ts,
          uuid: `grok-assistant-${lineIndex}`,
        });
      }

      const toolCalls = entry.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (let ti = 0; ti < toolCalls.length; ti++) {
          const call = toolCalls[ti] as {
            id?: string;
            name?: string;
            arguments?: unknown;
          };
          const callId = call.id || `grok-call-${lineIndex}-${ti}`;
          const toolName = normalizeGrokToolName(call.name || 'unknown');
          toolUseIdToName.set(callId, toolName);
          messages.push({
            type: 'tool_use',
            content: '',
            timestamp: ts,
            uuid: callId,
            toolName,
            toolInput: parseGrokToolArguments(call.arguments),
            toolUseId: callId,
          });
        }
      }
      continue;
    }

    if (type === 'tool_result') {
      const callId = typeof entry.tool_call_id === 'string' ? entry.tool_call_id : `grok-result-${lineIndex}`;
      const content =
        typeof entry.content === 'string'
          ? entry.content
          : entry.content != null
            ? JSON.stringify(entry.content)
            : '';
      messages.push({
        type: 'tool_result',
        content,
        timestamp: ts,
        uuid: `${callId}-result`,
        toolUseId: callId,
        toolName: toolUseIdToName.get(callId) || 'unknown',
      });
    }
  }

  const dedupedMessages = deduplicateSessionMessages(messages);

  // Restamp so last message ≈ file mtime and order is preserved (1s steps).
  const n = dedupedMessages.length;
  if (n > 0) {
    for (let i = 0; i < n; i++) {
      dedupedMessages[i] = {
        ...dedupedMessages[i],
        timestamp: new Date(fileMtimeMs - (n - 1 - i) * 1000).toISOString(),
      };
    }
  }

  const last = n > 0 ? dedupedMessages[n - 1] : null;
  return {
    messages: dedupedMessages,
    lastMessageType: last?.type ?? null,
    lastMessageTimestamp: last?.timestamp ? new Date(last.timestamp) : null,
  };
}

async function parseSessionMessages(
  resolved: ResolvedSessionFile
): Promise<{ messages: SessionMessage[]; lastMessageType: SessionActivityMessageType; lastMessageTimestamp: Date | null }> {
  if (resolved.provider === 'opencode') {
    if (resolved.opencodeDbSessionId) {
      return parseOpencodeDbSessionMessages(resolved.opencodeDbSessionId);
    }
    return parseOpencodeSessionMessages(resolved.filePath);
  }

  if (resolved.provider === 'grok') {
    return parseGrokSessionMessages(resolved.filePath);
  }

  const messages: SessionMessage[] = [];
  const toolUseIdToName = new Map<string, string>();

  const fileStream = fs.createReadStream(resolved.filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  if (resolved.provider === 'claude') {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        parseClaudeEntryMessages(JSON.parse(line), messages, toolUseIdToName);
      } catch {
        // Skip invalid/incomplete lines
      }
    }
  } else {
    // Codex: buffer entries first so we can pre-scan patch_apply_end events
    // (which arrive AFTER the apply_patch call) and attach their real unified
    // diffs to the Edit rows for a clean diff modal.
    const entries: unknown[] = [];
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip invalid/incomplete lines
      }
    }
    const patchDiffsByCallId = collectCodexPatchApplyDiffs(entries);
    for (const entry of entries) {
      parseCodexEntryMessages(entry, messages, toolUseIdToName, patchDiffsByCallId);
    }
  }

  const dedupedMessages = deduplicateSessionMessages(messages);
  const last = dedupedMessages.length > 0 ? dedupedMessages[dedupedMessages.length - 1] : null;
  return {
    messages: dedupedMessages,
    lastMessageType: last?.type ?? null,
    lastMessageTimestamp: last?.timestamp ? new Date(last.timestamp) : null,
  };
}

type ParsedSession = Awaited<ReturnType<typeof parseSessionMessages>>;

// Parsed-session cache keyed by file path, invalidated by (mtimeMs, size).
// Every /history request previously re-parsed the full JSONL (and
// getAgentHistory parses the SAME file twice when the page references
// subagents) — with multi-MB sessions that parse dominated request latency.
// Callers MUST treat the returned messages as immutable (all current callers
// only read/slice them). Opencode sessions are excluded: their messages live
// outside the resolved file (sqlite / part dirs), so a stat key on filePath
// cannot see changes — and the sqlite path is cheap anyway.
const parsedSessionCache = new Map<string, { mtimeMs: number; size: number; parsed: ParsedSession }>();
const PARSED_SESSION_CACHE_MAX = 8;
// Only a file modified this recently may still be mid-write and warrant the
// stability wait. The old unconditional waitForFileStable slept >=50ms on
// EVERY request by construction (lastSize starts at -1, so the first check
// can never match).
const RECENT_WRITE_WINDOW_MS = 300;

async function parseSessionMessagesCached(resolved: ResolvedSessionFile): Promise<ParsedSession> {
  if (resolved.provider === 'opencode') {
    return parseSessionMessages(resolved);
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolved.filePath);
  } catch {
    return parseSessionMessages(resolved);
  }

  const cached = parsedSessionCache.get(resolved.filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    // LRU touch: most recently used moves to the end of iteration order.
    parsedSessionCache.delete(resolved.filePath);
    parsedSessionCache.set(resolved.filePath, cached);
    return cached.parsed;
  }

  if (Date.now() - stats.mtimeMs < RECENT_WRITE_WINDOW_MS) {
    await waitForFileStable(resolved.filePath);
    try {
      stats = fs.statSync(resolved.filePath);
    } catch {
      return parseSessionMessages(resolved);
    }
  }

  const parsed = await parseSessionMessages(resolved);
  parsedSessionCache.set(resolved.filePath, { mtimeMs: stats.mtimeMs, size: stats.size, parsed });
  while (parsedSessionCache.size > PARSED_SESSION_CACHE_MAX) {
    const oldest = parsedSessionCache.keys().next().value;
    if (oldest === undefined) break;
    parsedSessionCache.delete(oldest);
  }
  return parsed;
}

/**
 * Load conversation history from a session file
 * @param cwd - Working directory
 * @param sessionId - Session ID
 * @param limit - Max messages to return
 * @param offset - Offset from the end (0 = most recent)
 */
export async function loadSession(
  cwd: string,
  sessionId: string,
  limit: number = 50,
  offset: number = 0
): Promise<ConversationHistory | null> {
  const resolved = resolveSessionFile(cwd, sessionId);
  if (!resolved) {
    log.log(` Session file not found for session ${sessionId}`);
    return null;
  }

  const { messages } = await parseSessionMessagesCached(resolved);

  const totalCount = messages.length;

  // Calculate slice indices from the end
  // offset 0, limit 50 -> slice(-50) = last 50 messages
  // offset 50, limit 50 -> slice(-100, -50) = messages 50-100 from end
  const endIndex = totalCount - offset;
  const startIndex = Math.max(0, endIndex - limit);
  const limitedMessages = messages.slice(startIndex, endIndex > 0 ? endIndex : undefined);

  return {
    sessionId,
    messages: limitedMessages,
    cwd,
    totalCount,
    hasMore: startIndex > 0,
  };
}

/**
 * Search conversation history for matching messages
 * @param cwd - Working directory
 * @param sessionId - Session ID
 * @param query - Search query string
 * @param limit - Max results to return
 */
export async function searchSession(
  cwd: string,
  sessionId: string,
  query: string,
  limit: number = 50
): Promise<{ matches: SessionMessage[]; totalMatches: number } | null> {
  const resolved = resolveSessionFile(cwd, sessionId);
  if (!resolved) {
    return null;
  }

  const { messages } = await parseSessionMessagesCached(resolved);
  const queryLower = query.toLowerCase();
  const matches: SessionMessage[] = [];

  for (const message of messages) {
    const contentLower = message.content.toLowerCase();
    const toolNameLower = message.toolName?.toLowerCase() || '';
    const matched = contentLower.includes(queryLower) || toolNameLower.includes(queryLower);
    if (!matched) continue;
    matches.push(message);
  }

  const totalMatches = matches.length;

  return {
    matches: matches.slice(-limit), // Return most recent matches
    totalMatches,
  };
}

/**
 * Extract text content from Claude's message content blocks
 */
function _extractTextFromContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      }
    }

    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  return null;
}

/**
 * Find the most recent session for a project
 */
export async function findLatestSession(cwd: string): Promise<string | null> {
  const sessions = await listSessions(cwd);

  if (sessions.length === 0) {
    return null;
  }

  // Return the most recently modified session
  return sessions[0].sessionId;
}

/**
 * Load history from a session, returning formatted messages for display
 */
export async function loadSessionHistory(
  cwd: string,
  sessionId: string,
  limit: number = 20
): Promise<{ role: 'user' | 'assistant' | 'tool_use' | 'tool_result'; content: string; timestamp: string; toolName?: string }[]> {
  const history = await loadSession(cwd, sessionId, limit);

  if (!history) {
    return [];
  }

  return history.messages.map(msg => ({
    role: msg.type,
    content: msg.content,
    timestamp: msg.timestamp,
    toolName: msg.toolName,
  }));
}

/**
 * Get session info summary
 */
export function getSessionSummary(sessions: SessionInfo[]): string {
  if (sessions.length === 0) {
    return 'No previous sessions found';
  }

  const latest = sessions[0];
  const age = Date.now() - latest.lastModified.getTime();
  const ageStr = age < 60000 ? 'just now'
    : age < 3600000 ? `${Math.floor(age / 60000)}m ago`
    : age < 86400000 ? `${Math.floor(age / 3600000)}h ago`
    : `${Math.floor(age / 86400000)}d ago`;

  return `${sessions.length} session(s), latest: ${ageStr} (${latest.messageCount} messages)`;
}

/**
 * Load tool history from a session file
 * Returns tool executions and file changes
 */
/**
 * Session activity status for determining if an agent is working
 */
export interface SessionActivityStatus {
  isActive: boolean;           // Recently modified AND waiting for response
  hasPendingWork: boolean;     // Last message indicates Claude should respond (regardless of time)
  lastModified: Date;
  lastMessageType: 'user' | 'assistant' | 'tool_use' | 'tool_result' | null;
  lastMessageTimestamp: Date | null;
  secondsSinceLastActivity: number;
}

/**
 * Check if a session is currently active (being worked on)
 * This checks the session file modification time and last message
 * to determine if Claude is actively processing
 *
 * @param cwd - Working directory
 * @param sessionId - Session ID
 * @param activeThresholdSeconds - Consider active if modified within this many seconds (default 60)
 */
async function getResolvedSessionLastModified(resolved: ResolvedSessionFile): Promise<Date> {
  // DB-backed opencode sessions: use the latest part/message/session timestamp
  // in the SQLite DB. File mtime on opencode.db shifts with any write from any
  // project, so it's too noisy to gate per-session activity on.
  if (resolved.provider === 'opencode' && resolved.opencodeDbSessionId) {
    const db = getOpencodeDb();
    if (db) {
      try {
        const row = db
          .prepare(
            `SELECT MAX(latest) AS latest FROM (
               SELECT time_updated AS latest FROM session WHERE id = ?
               UNION ALL
               SELECT MAX(time_created) AS latest FROM message WHERE session_id = ?
               UNION ALL
               SELECT MAX(time_created) AS latest FROM part WHERE session_id = ?
             )`
          )
          .get(
            resolved.opencodeDbSessionId,
            resolved.opencodeDbSessionId,
            resolved.opencodeDbSessionId
          ) as { latest: number | null } | undefined;
        if (row && typeof row.latest === 'number' && row.latest > 0) {
          return new Date(row.latest);
        }
      } catch (err) {
        log.warn(`Opencode DB activity timestamp query failed: ${String(err)}`);
      }
    }
    // Fall through to a mtime-based fallback if the DB query fails.
  }

  const sessionStats = await fs.promises.stat(resolved.filePath);
  let mtime = sessionStats.mtime;

  // Legacy opencode filesystem layout: fold message dir mtime in since the
  // session JSON isn't rewritten on every turn.
  if (resolved.provider === 'opencode' && !resolved.opencodeDbSessionId) {
    const sessionId = path.basename(resolved.filePath, '.json');
    const messagesDir = path.join(OPENCODE_MESSAGE_DIR, sessionId);
    try {
      const msgStats = await fs.promises.stat(messagesDir);
      if (msgStats.mtime > mtime) {
        mtime = msgStats.mtime;
      }
    } catch {
      // Message dir may not exist yet on a brand-new session; ignore.
    }
  }

  return mtime;
}

export async function getSessionActivityStatus(
  cwd: string,
  sessionId: string,
  activeThresholdSeconds: number = 60
): Promise<SessionActivityStatus | null> {
  const resolved = resolveSessionFile(cwd, sessionId);
  if (!resolved) {
    return null;
  }

  const lastModified = await getResolvedSessionLastModified(resolved);
  const now = new Date();
  const secondsSinceModified = (now.getTime() - lastModified.getTime()) / 1000;
  const { lastMessageType, lastMessageTimestamp } = await parseSessionMessagesCached(resolved);

  // Determine if work is pending based on last message type:
  // - Last message was from user (Claude should be processing) OR
  // - Last message was tool_use (Claude is waiting for tool result) OR
  // - Last message was tool_result (Claude should be processing the result)
  const waitingForResponse = lastMessageType === 'user' ||
                             lastMessageType === 'tool_use' ||
                             lastMessageType === 'tool_result';

  // isActive = recently modified AND waiting (for real-time status)
  // hasPendingWork = just waiting for response (for server restart detection)
  const recentlyModified = secondsSinceModified < activeThresholdSeconds;
  const isActive = recentlyModified && waitingForResponse;

  return {
    isActive,
    hasPendingWork: waitingForResponse,
    lastModified,
    lastMessageType,
    lastMessageTimestamp,
    secondsSinceLastActivity: secondsSinceModified,
  };
}

const PROVIDER_PROCESS_PATTERNS: Record<SessionProvider, string> = {
  claude: '(claude$|/claude( |$)|claude\\.cmd|claude\\.exe)',
  codex: '(codex($| )|/codex( |$)|codex\\.cmd|codex\\.exe|codex\\.js|@openai/codex)',
  opencode: '(opencode($| )|/opencode( |$)|opencode\\.cmd|opencode\\.exe)',
  // Match `grok` CLI but not unrelated tools with "grok" in the path/name as a substring of a longer token.
  grok: '(^|/)grok($| )|grok\\.cmd|grok\\.exe',
};

type ExecSyncFn = typeof import('child_process').execSync;

function providerDisplayName(provider: SessionProvider): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'opencode') return 'OpenCode';
  if (provider === 'grok') return 'Grok';
  return 'Claude';
}

function getProviderProcessPids(provider: SessionProvider, execSync: ExecSyncFn): string[] {
  const pattern = PROVIDER_PROCESS_PATTERNS[provider];
  try {
    const psOutput = execSync(`ps aux | grep -E "${pattern}" | grep -v grep | awk '{print $2}'`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (!psOutput) {
      return [];
    }
    return psOutput.split('\n').filter(p => p.trim());
  } catch {
    return [];
  }
}

function getProcessCwd(pid: string, execSync: ExecSyncFn): string | null {
  try {
    if (process.platform === 'darwin') {
      const lsofOutput = execSync(`lsof -a -d cwd -p ${pid} -Fn 2>/dev/null | grep '^n'`, {
        encoding: 'utf-8',
        timeout: 2000,
        shell: '/bin/bash',
      }).trim();
      if (!lsofOutput.startsWith('n')) {
        return null;
      }
      return lsofOutput.substring(1);
    }

    return execSync(`readlink /proc/${pid}/cwd`, {
      encoding: 'utf-8',
      timeout: 1000,
    }).trim();
  } catch {
    return null;
  }
}

async function isProviderProcessRunningInCwd(cwd: string, provider: SessionProvider): Promise<boolean> {
  // Only works on Linux/Unix/macOS
  if (process.platform === 'win32') {
    return false;
  }

  try {
    const { execSync } = await import('child_process');
    const pids = getProviderProcessPids(provider, execSync);
    if (pids.length === 0) {
      return false;
    }

    const normalizedCwd = cwd.replace(/\/+$/, '');

    for (const pid of pids) {
      const processCwd = getProcessCwd(pid, execSync);
      if (!processCwd) {
        continue;
      }
      const normalizedProcessCwd = processCwd.replace(/\/+$/, '');
      if (normalizedProcessCwd === normalizedCwd) {
        log.log(` Found ${providerDisplayName(provider)} process ${pid} running in ${cwd}`);
        return true;
      }
    }

    return false;
  } catch (err) {
    log.error(` Error checking for ${providerDisplayName(provider)} processes:`, err);
    return false;
  }
}

async function findProviderProcessPidInCwd(cwd: string, provider: SessionProvider): Promise<number | undefined> {
  if (process.platform === 'win32') {
    return undefined;
  }

  try {
    const { execSync } = await import('child_process');
    const pids = getProviderProcessPids(provider, execSync);
    if (pids.length === 0) {
      return undefined;
    }

    const normalizedCwd = cwd.replace(/\/+$/, '');

    for (const pid of pids) {
      const processCwd = getProcessCwd(pid, execSync);
      if (!processCwd) {
        continue;
      }
      const normalizedProcessCwd = processCwd.replace(/\/+$/, '');
      if (normalizedProcessCwd === normalizedCwd) {
        const numericPid = Number.parseInt(pid, 10);
        if (Number.isFinite(numericPid) && numericPid > 0) {
          return numericPid;
        }
      }
    }

    return undefined;
  } catch (err) {
    log.error(` Error finding ${providerDisplayName(provider)} PID in ${cwd}:`, err);
    return undefined;
  }
}

async function killProviderProcessInCwd(cwd: string, provider: SessionProvider): Promise<boolean> {
  // Only works on Linux/Unix/macOS
  if (process.platform === 'win32') {
    return false;
  }

  try {
    const { execSync } = await import('child_process');
    const pids = getProviderProcessPids(provider, execSync);
    if (pids.length === 0) {
      return false;
    }

    const normalizedCwd = cwd.replace(/\/+$/, '');

    for (const pid of pids) {
      const processCwd = getProcessCwd(pid, execSync);
      if (!processCwd) {
        continue;
      }

      const normalizedProcessCwd = processCwd.replace(/\/+$/, '');
      if (normalizedProcessCwd !== normalizedCwd) {
        continue;
      }

      const label = providerDisplayName(provider);
      log.log(`🛑 Killing detached ${label} process ${pid} in ${cwd}`);

      try {
        const numericPid = parseInt(pid, 10);
        process.kill(numericPid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(numericPid, 0);
            log.log(`🛑 Force killing ${label} process ${pid}`);
            process.kill(numericPid, 'SIGKILL');
          } catch {
            // Process already dead, good
          }
        }, 1000);
        return true;
      } catch (killErr) {
        log.error(`Failed to kill ${label} process ${pid}:`, killErr);
      }
    }

    return false;
  } catch (err) {
    log.error(`Error killing ${providerDisplayName(provider)} process:`, err);
    return false;
  }
}

/**
 * Check if there's a Claude process running in a specific directory
 * This uses OS-level process inspection to detect Claude processes
 * that survived a server restart
 */
export async function isClaudeProcessRunningInCwd(cwd: string): Promise<boolean> {
  return isProviderProcessRunningInCwd(cwd, 'claude');
}

/**
 * Check if there's a Codex process running in a specific directory.
 */
export async function isCodexProcessRunningInCwd(cwd: string): Promise<boolean> {
  return isProviderProcessRunningInCwd(cwd, 'codex');
}

export async function findClaudeProcessPidInCwd(cwd: string): Promise<number | undefined> {
  return findProviderProcessPidInCwd(cwd, 'claude');
}

export async function findCodexProcessPidInCwd(cwd: string): Promise<number | undefined> {
  return findProviderProcessPidInCwd(cwd, 'codex');
}

/**
 * Kill any Claude process running in the specified directory
 * Returns true if a process was found and killed
 */
export async function killClaudeProcessInCwd(cwd: string): Promise<boolean> {
  return killProviderProcessInCwd(cwd, 'claude');
}

/**
 * Kill any Codex process running in the specified directory.
 * Returns true if a process was found and killed.
 */
export async function killCodexProcessInCwd(cwd: string): Promise<boolean> {
  return killProviderProcessInCwd(cwd, 'codex');
}

/**
 * Check if there's an OpenCode process running in a specific directory.
 */
export async function isOpencodeProcessRunningInCwd(cwd: string): Promise<boolean> {
  return isProviderProcessRunningInCwd(cwd, 'opencode');
}

export async function findOpencodeProcessPidInCwd(cwd: string): Promise<number | undefined> {
  return findProviderProcessPidInCwd(cwd, 'opencode');
}

/**
 * Kill any OpenCode process running in the specified directory.
 * Returns true if a process was found and killed.
 */
export async function killOpencodeProcessInCwd(cwd: string): Promise<boolean> {
  return killProviderProcessInCwd(cwd, 'opencode');
}

/**
 * Check if there's a Grok process running in a specific directory.
 */
export async function isGrokProcessRunningInCwd(cwd: string): Promise<boolean> {
  return isProviderProcessRunningInCwd(cwd, 'grok');
}

export async function findGrokProcessPidInCwd(cwd: string): Promise<number | undefined> {
  return findProviderProcessPidInCwd(cwd, 'grok');
}

/**
 * Kill any Grok process running in the specified directory.
 * Returns true if a process was found and killed.
 */
export async function killGrokProcessInCwd(cwd: string): Promise<boolean> {
  return killProviderProcessInCwd(cwd, 'grok');
}

export async function loadToolHistory(
  cwd: string,
  sessionId: string,
  agentId: string,
  agentName: string,
  limit: number = 100
): Promise<{ toolExecutions: ToolExecution[]; fileChanges: FileChange[] }> {
  const toolExecutions: ToolExecution[] = [];
  const fileChanges: FileChange[] = [];

  const resolved = resolveSessionFile(cwd, sessionId);
  if (!resolved) {
    return { toolExecutions, fileChanges };
  }

  const { messages } = await parseSessionMessagesCached(resolved);

  for (const msg of messages) {
    if (msg.type !== 'tool_use' || !msg.toolName) continue;

    const timestamp = new Date(msg.timestamp).getTime();
    const toolInput = msg.toolInput;

    toolExecutions.push({
      agentId,
      agentName,
      toolName: msg.toolName,
      toolInput,
      timestamp,
    });

    if (!toolInput) continue;

    const filePath = (toolInput.file_path || toolInput.path) as string | undefined;
    if (!filePath) continue;

    let action: FileChange['action'] | null = null;
    if (msg.toolName === 'Write') {
      action = 'created';
    } else if (msg.toolName === 'Edit') {
      action = 'modified';
    } else if (msg.toolName === 'Read') {
      action = 'read';
    }
    if (action) {
      fileChanges.push({
        agentId,
        agentName,
        action,
        filePath,
        timestamp,
      });
    }
  }

  // Return most recent items (reversed so newest first)
  return {
    toolExecutions: toolExecutions.slice(-limit).reverse(),
    fileChanges: fileChanges.slice(-limit).reverse(),
  };
}
