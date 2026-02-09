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
import { createLogger } from '../utils/logger.js';

const log = createLogger('Session');

// Claude's project directory
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');

type SessionProvider = 'claude' | 'codex';

interface ResolvedSessionFile {
  provider: SessionProvider;
  filePath: string;
}

const codexSessionFileById = new Map<string, string>();
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
  for (const block of content) {
    if (!isObject(block)) continue;
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
  }

  if (segments.length > 0) {
    return segments;
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

function resolveSessionFile(cwd: string, sessionId: string): ResolvedSessionFile | null {
  const claudeFile = path.join(getProjectDir(cwd), `${sessionId}.jsonl`);
  if (fs.existsSync(claudeFile)) {
    return { provider: 'claude', filePath: claudeFile };
  }

  const codexFile = findCodexSessionFile(sessionId);
  if (codexFile && fs.existsSync(codexFile)) {
    return { provider: 'codex', filePath: codexFile };
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
  toolUseIdToName: Map<string, string>
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
    if (payload.type === 'agent_message' && typeof payload.message === 'string') {
      messages.push({
        type: 'assistant',
        content: payload.message,
        timestamp: entry.timestamp,
        uuid: `${entry.timestamp}-assistant`,
      });
      return;
    }
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
  }
}

async function parseSessionMessages(
  resolved: ResolvedSessionFile
): Promise<{ messages: SessionMessage[]; lastMessageType: SessionActivityMessageType; lastMessageTimestamp: Date | null }> {
  const messages: SessionMessage[] = [];
  const toolUseIdToName = new Map<string, string>();

  const fileStream = fs.createReadStream(resolved.filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (resolved.provider === 'claude') {
        parseClaudeEntryMessages(entry, messages, toolUseIdToName);
      } else {
        parseCodexEntryMessages(entry, messages, toolUseIdToName);
      }
    } catch {
      // Skip invalid/incomplete lines
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

  await waitForFileStable(resolved.filePath);
  const { messages } = await parseSessionMessages(resolved);

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

  await waitForFileStable(resolved.filePath);
  const { messages } = await parseSessionMessages(resolved);
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
export async function getSessionActivityStatus(
  cwd: string,
  sessionId: string,
  activeThresholdSeconds: number = 60
): Promise<SessionActivityStatus | null> {
  const resolved = resolveSessionFile(cwd, sessionId);
  if (!resolved) {
    return null;
  }

  const stats = fs.statSync(resolved.filePath);
  const lastModified = stats.mtime;
  const now = new Date();
  const secondsSinceModified = (now.getTime() - lastModified.getTime()) / 1000;
  const { lastMessageType, lastMessageTimestamp } = await parseSessionMessages(resolved);

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
};

type ExecSyncFn = typeof import('child_process').execSync;

function providerDisplayName(provider: SessionProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude';
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

  await waitForFileStable(resolved.filePath);
  const { messages } = await parseSessionMessages(resolved);

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
