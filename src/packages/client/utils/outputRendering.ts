/**
 * Shared output rendering utilities for ClaudeOutputPanel (Guake) and CommanderView
 * This file contains common functions for displaying Claude output, tool calls, etc.
 */

// Tool icons mapping - used in both Guake terminal and Commander view.
// Emoji variants are kept here because they are rendered inside <canvas> 2D scenes
// (AgentRenderer, EffectsManager) where JSX isn't an option. For React render sites
// prefer `TOOL_ICON_NAMES` + `<Icon name={...} />` below.
export const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '📝',
  Bash: '💻',
  Glob: '🔍',
  Grep: '🔎',
  Task: '📋',
  TaskCreate: '✅',
  TaskUpdate: '✅',
  Agent: '🤖',
  WebFetch: '🌐',
  WebSearch: '🌍',
  TodoWrite: '✅',
  NotebookEdit: '📓',
  AskFollowupQuestion: '❓',
  AskUserQuestion: '❓',
  AttemptCompletion: '✨',
  ListFiles: '📂',
  SearchFiles: '🔎',
  ExecuteCommand: '⚙️',
  exec: '🧩',
  // Codex subagent collab tools
  spawn_agent: '🧬',
  send_input: '📨',
  wait: '⏳',
  default: '⚡',
};

// Semantic Icon name per tool for React-rendered surfaces. Keep in sync with TOOL_ICONS.
import type { IconName } from '../components/Icon';
export const TOOL_ICON_NAMES: Record<string, IconName> = {
  Read: 'eye',
  Write: 'edit',
  Edit: 'edit',
  Bash: 'terminal',
  Glob: 'search',
  Grep: 'search',
  Task: 'list-checks',
  TaskCreate: 'list-checks',
  TaskUpdate: 'list-checks',
  Agent: 'robot',
  WebFetch: 'globe',
  WebSearch: 'globe-hemisphere',
  TodoWrite: 'list-checks',
  NotebookEdit: 'edit',
  AskFollowupQuestion: 'question',
  AskUserQuestion: 'question',
  AttemptCompletion: 'sparkle',
  ListFiles: 'folder-open',
  list_dir: 'folder-open',
  SearchFiles: 'search',
  ExecuteCommand: 'gear',
  exec: 'bolt',
  // Grok / agent runtime tools
  get_command_or_subagent_output: 'terminal',
  get_task_output: 'terminal',
  spawn_subagent: 'dna',
  spawn_agent: 'dna',
  send_input: 'send',
  send_message_to_agent: 'send',
  wait: 'hourglass',
  web_search: 'globe-hemisphere',
  open_page: 'globe',
  open_page_with_find: 'globe',
  default: 'bolt',
};

/**
 * Get the emoji icon for a tool (for canvas/text renderers).
 */
export function getToolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] || TOOL_ICONS.default;
}

/**
 * Get a semantic Icon name for a tool (for JSX render sites).
 */
export function getToolIconName(toolName: string): IconName {
  return TOOL_ICON_NAMES[toolName] || TOOL_ICON_NAMES.default;
}

const TOOL_NAME_TRANSLATION_KEYS: Record<string, string> = {
  Read: 'tools:display.toolNames.read',
  Write: 'tools:display.toolNames.write',
  Edit: 'tools:display.toolNames.edit',
  Bash: 'tools:display.toolNames.bash',
  Glob: 'tools:display.toolNames.glob',
  Grep: 'tools:display.toolNames.grep',
  Task: 'tools:display.toolNames.task',
  Agent: 'tools:display.toolNames.agent',
  WebFetch: 'tools:display.toolNames.webFetch',
  WebSearch: 'tools:display.toolNames.webSearch',
  TodoWrite: 'tools:display.toolNames.todoWrite',
  NotebookEdit: 'tools:display.toolNames.notebookEdit',
  AskFollowupQuestion: 'tools:display.toolNames.askFollowupQuestion',
  AskUserQuestion: 'tools:display.toolNames.askUserQuestion',
  AttemptCompletion: 'tools:display.toolNames.attemptCompletion',
  ListFiles: 'tools:display.toolNames.listFiles',
  list_dir: 'tools:display.toolNames.listFiles',
  SearchFiles: 'tools:display.toolNames.searchFiles',
  ExecuteCommand: 'tools:display.toolNames.executeCommand',
  // Codex subagent collab tools
  spawn_agent: 'tools:display.toolNames.spawnAgent',
  send_input: 'tools:display.toolNames.sendInput',
  wait: 'tools:display.toolNames.wait',
  // Grok / Tide runtime tools (friendly labels)
  get_command_or_subagent_output: 'tools:display.toolNames.taskOutput',
  get_task_output: 'tools:display.toolNames.taskOutput',
  spawn_subagent: 'tools:display.toolNames.spawnAgent',
  send_message_to_agent: 'tools:display.toolNames.sendMessage',
  web_search: 'tools:display.toolNames.webSearch',
  open_page: 'tools:display.toolNames.webFetch',
  open_page_with_find: 'tools:display.toolNames.webFetch',
};

/** Prettify snake_case / camelCase tool ids when no i18n key exists. */
export function prettifyToolName(toolName: string): string {
  if (!toolName) return toolName;
  if (toolName.startsWith('mcp__')) {
    const [, server = 'MCP', ...toolParts] = toolName.split('__');
    const tool = toolParts.join('__');
    return `MCP · ${prettifyToolName(server)} · ${prettifyToolName(tool)}`;
  }
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve a localized tool label with fallback to a prettified raw tool name.
 */
export function getLocalizedToolName(
  toolName: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const key = TOOL_NAME_TRANSLATION_KEYS[toolName];
  if (!key) return prettifyToolName(toolName);
  return t(key, { defaultValue: prettifyToolName(toolName) }) || prettifyToolName(toolName);
}

/** Shorten long ids like call-d2f2a9b9-…-290 for chip display. */
export function shortenId(id: string, head = 8, tail = 4): string {
  if (!id || id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/**
 * Status icons for todo items
 */
export function getTodoStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return '✓';
    case 'in_progress': return '►';
    default: return '○';
  }
}

/**
 * Format timestamp for display (HH:MM:SS in 24h format)
 * Accepts either a number (epoch ms) or ISO string
 */
export function formatTimestamp(timestamp: number | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Truncate a string with ellipsis if it exceeds maxLength
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Truncate a file path, showing only the last N segments if too long
 */
export function truncateFilePath(filePath: string, maxLength: number = 50): string {
  if (filePath.length <= maxLength) return filePath;
  const parts = filePath.split('/');
  return '.../' + parts.slice(-2).join('/');
}

/**
 * Extract key parameter from tool input JSON for display
 * Returns a human-readable summary of what the tool is operating on
 * NO TRUNCATION - shows full content for readability
 */
export function extractToolKeyParam(toolName: string, inputJson: string): string | null {
  try {
    const input = JSON.parse(inputJson);

    if (toolName.startsWith('mcp__')) {
      const server = typeof input.server === 'string' ? input.server : undefined;
      const primary = input.query || input.url || input.path || input.file_path || input.documentId || input.script;
      if (typeof primary === 'string' && primary) {
        const value = primary.length > 140 ? `${primary.slice(0, 137)}...` : primary;
        return server ? `${server} · ${value}` : value;
      }
      return server || null;
    }

    switch (toolName) {
      case 'exec': {
        const script = typeof input === 'string'
          ? input
          : (input.input || input.code || input.script);
        if (typeof script === 'string' && script.trim()) {
          return summarizeCodexExecScript(script);
        }
        break;
      }
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'NotebookEdit': {
        // Claude uses file_path; Grok/OpenCode-style tools use target_file / path.
        const filePath =
          input.file_path
          || input.filePath
          || input.target_file
          || input.targetFile
          || input.path
          || input.notebook_path
          || input.notebookPath;
        if (typeof filePath === 'string' && filePath) {
          return filePath; // Full path, no truncation
        }
        break;
      }
      case 'ListFiles':
      case 'list_dir': {
        const dir =
          input.target_directory
          || input.targetDirectory
          || input.path
          || input.directory;
        if (typeof dir === 'string' && dir) {
          return dir;
        }
        break;
      }
      case 'get_command_or_subagent_output':
      case 'get_task_output': {
        const ids = input.task_ids ?? input.taskIds ?? input.task_id ?? input.taskId;
        const timeout = input.timeout_ms ?? input.timeoutMs ?? input.timeout;
        const idList = Array.isArray(ids)
          ? ids.map((x) => String(x))
          : typeof ids === 'string'
            ? [ids]
            : [];
        const parts: string[] = [];
        if (idList.length === 1) {
          parts.push(shortenId(idList[0]));
        } else if (idList.length > 1) {
          parts.push(`${idList.length} tasks`);
        }
        if (typeof timeout === 'number' && timeout > 0) {
          parts.push(timeout >= 1000 ? `${Math.round(timeout / 1000)}s` : `${timeout}ms`);
        }
        if (parts.length > 0) return parts.join(' · ');
        break;
      }
      case 'spawn_subagent':
      case 'spawn_agent': {
        const desc = input.description || input.prompt || input.name;
        if (typeof desc === 'string' && desc) {
          return desc.length > 120 ? `${desc.slice(0, 117)}…` : desc;
        }
        break;
      }
      case 'send_message_to_agent':
      case 'send_input': {
        const to = input.agent_id || input.agentId || input.to || input.receiver_thread_ids;
        const msg = input.message || input.prompt || input.text;
        if (typeof to === 'string' && typeof msg === 'string') {
          return `→ ${shortenId(to)}: ${msg.length > 80 ? `${msg.slice(0, 77)}…` : msg}`;
        }
        if (typeof msg === 'string' && msg) {
          return msg.length > 100 ? `${msg.slice(0, 97)}…` : msg;
        }
        break;
      }
      case 'Bash':
      case 'ExecuteCommand': {
        const cmd = input.command || input.cmd;
        if (typeof cmd === 'string' && cmd) {
          return extractExecWrappedCommand(cmd);
        }
        if (typeof input.description === 'string' && input.description) {
          return input.description;
        }
        break;
      }
      case 'Grep':
      case 'SearchFiles': {
        const pattern = input.pattern || input.query;
        const path = input.path || input.target_directory || input.targetDirectory;
        if (pattern && path) {
          return `"${pattern}" in ${path}`;
        }
        if (typeof pattern === 'string' && pattern) {
          return `"${pattern}"`;
        }
        break;
      }
      case 'Glob': {
        const pattern = input.pattern || input.glob;
        const path = input.path || input.target_directory || input.targetDirectory;
        if (pattern && path) {
          return `${pattern} in ${path}`;
        }
        if (typeof pattern === 'string' && pattern) {
          return pattern;
        }
        break;
      }
      case 'WebFetch': {
        const url = input.url || input.target_url || input.targetUrl;
        if (typeof url === 'string' && url) {
          return url; // Full URL
        }
        break;
      }
      case 'WebSearch': {
        const query = input.query || input.q || input.search;
        if (typeof query === 'string' && query) {
          return `"${query}"`; // Full query
        }
        break;
      }
      case 'Task':
      case 'Agent': {
        const desc = input.description;
        const agentType = input.subagent_type || input.subagentType;
        if (desc) {
          return agentType ? `[${agentType}] ${desc}` : desc;
        }
        if (input.prompt) {
          return input.prompt;
        }
        break;
      }
      case 'ExitPlanMode':
      case 'EnterPlanMode': {
        const prompts = input.allowedPrompts;
        if (Array.isArray(prompts) && prompts.length > 0) {
          return prompts.map((p: { tool?: string; prompt?: string }) => p.prompt || p.tool || '').filter(Boolean).join(', ');
        }
        if (toolName === 'ExitPlanMode' && typeof input.plan === 'string' && input.plan.trim().length > 0) {
          return input.plan.trim();
        }
        return toolName === 'ExitPlanMode' ? 'Plan ready' : 'Entering plan mode';
      }
      case 'TodoWrite': {
        const todos = input.todos;
        if (Array.isArray(todos) && todos.length > 0) {
          // Return summary for text fallback (component rendering preferred)
          const done = todos.filter((t: { status?: string }) => t.status === 'completed').length;
          const active = todos.filter((t: { status?: string }) => t.status === 'in_progress').length;
          const pending = todos.filter((t: { status?: string }) => t.status === 'pending').length;
          const parts: string[] = [];
          if (done > 0) parts.push(`${done} done`);
          if (active > 0) parts.push(`${active} active`);
          if (pending > 0) parts.push(`${pending} pending`);
          return `${todos.length} items (${parts.join(', ')})`;
        }
        break;
      }
      case 'AskUserQuestion':
      case 'AskFollowupQuestion': {
        const questions = input.questions || input.question;
        if (questions) {
          const q = Array.isArray(questions) ? questions[0]?.question : questions;
          if (q) {
            return q; // Full question
          }
        }
        break;
      }
      default: {
        // Try to find any meaningful string parameter
        for (const [, value] of Object.entries(input)) {
          if (typeof value === 'string' && value.length > 0) {
            return value; // Full value, no truncation
          }
        }
        break;
      }
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Turn Codex's JavaScript orchestration wrapper into an activity a human can
 * scan. The complete script remains in the tool payload/metadata; this is only
 * the compact Guake/history label.
 */
export function summarizeCodexExecScript(script: string): string {
  const presentation = getCodexExecPresentation(script);
  return presentation.detail;
}

export interface CodexExecPresentation {
  toolName: 'Read' | 'Edit' | 'Grep' | 'Glob' | 'Bash' | 'WebSearch' | 'AskUserQuestion' | 'TodoWrite' | 'ExecuteCommand';
  detail: string;
  filePaths?: string[];
}

function codexExecScript(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const direct = record.input || record.code || record.script;
  if (typeof direct === 'string') return direct;
  // Some persisted sessions normalize the outer Codex `exec` call to Bash and
  // place its JavaScript wrapper in the command field.
  if (typeof record.command === 'string' && /\btools\.[A-Za-z0-9_]+\s*\(/.test(record.command)) return record.command;
  return '';
}

export function isCodexExecWrapper(input: unknown): boolean {
  return /\btools\.[A-Za-z0-9_]+\s*\(/.test(codexExecScript(input));
}

/** File paths touched by a Codex apply_patch payload, in patch order. */
export function getCodexExecEditPaths(input: unknown): string[] {
  const script = codexExecScript(input);
  // Persisted exec input is JavaScript source, so patch newlines commonly
  // appear as the two characters `\n` rather than real line breaks.
  const normalized = script.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  const paths: string[] = [];
  for (const match of normalized.matchAll(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/gm)) {
    const path = match[1].trim();
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/** Extract one file's section from a Codex `*** Begin Patch` payload. */
export function getCodexExecPatchForFile(input: unknown, filePath: string): string | null {
  const script = codexExecScript(input);
  const normalized = script.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`^\\*\\*\\* (?:Update|Add|Delete) File:\\s*${escaped}\\s*$([\\s\\S]*?)(?=^\\*\\*\\* (?:Update|Add|Delete|End Patch)|(?![\\s\\S]))`, 'm'));
  if (!match) return null;
  const header = normalized.match(new RegExp(`^\\*\\*\\* (?:Update|Add|Delete) File:\\s*${escaped}\\s*$`, 'm'))?.[0];
  return header ? `${header}${match[1]}`.trim() : null;
}

export interface CodexExecFileTarget {
  path: string;
  highlightRange?: { offset: number; limit: number };
}

export interface CodexGrepMatch { path: string; line: number; text: string }
export interface CodexGrepResults { query: string; matches: CodexGrepMatch[] }

const GREP_OPTIONS_WITH_VALUE = new Set([
  '-A', '-B', '-C', '-f', '-g', '-m', '-T', '-t',
  '--after-context', '--before-context', '--context', '--file', '--glob',
  '--iglob', '--max-count', '--type', '--type-not',
]);

// Enough shell tokenization for generated rg/grep commands: preserve quoted
// phrases and escaped spaces without attempting to execute or fully parse
// shell syntax.
function tokenizeGrepCommand(command: string): string[] {
  const tokens: string[] = [];
  const tokenPattern = /(?:^|\s)(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+))/g;
  let tokenMatch: RegExpExecArray | null;
  while ((tokenMatch = tokenPattern.exec(command)) !== null) {
    const token = tokenMatch[1] ?? tokenMatch[2] ?? tokenMatch[3] ?? '';
    tokens.push(token.replace(/\\([\\"'\s])/g, '$1'));
  }
  return tokens;
}

function extractGrepQuery(command: string): string {
  const tokens = tokenizeGrepCommand(command);
  const commandIndex = tokens.findIndex((token) => /(?:^|\/)(?:rg|grep)$/.test(token));
  if (commandIndex < 0) return '';

  for (let index = commandIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') return tokens[index + 1] || '';
    if (token === '-e' || token === '--regexp') return tokens[index + 1] || '';
    if (token.startsWith('--regexp=')) return token.slice('--regexp='.length);
    if (GREP_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    return token;
  }
  return '';
}

// rg/grep drop the path prefix from output lines (`line:text`) when given
// exactly one explicit file target — recover that target from the command so
// those lines can still be attributed to a clickable file. Returns '' when
// there are zero or several targets (their output keeps the path prefix).
function extractGrepSingleFileTarget(command: string): string {
  const tokens = tokenizeGrepCommand(command);
  const commandIndex = tokens.findIndex((token) => /(?:^|\/)(?:rg|grep)$/.test(token));
  if (commandIndex < 0) return '';

  const targets: string[] = [];
  let sawQuery = false;
  for (let index = commandIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    // A shell operator ends this command's argument list (`| head`,
    // `2>/dev/null`, `&& …`, `; …`).
    if (/^(?:\||&|;|[012]?>)/.test(token)) break;
    if (token === '--') continue;
    if (token === '-e' || token === '--regexp') {
      index += 1;
      sawQuery = true;
      continue;
    }
    if (token.startsWith('--regexp=')) {
      sawQuery = true;
      continue;
    }
    if (GREP_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-') && token.length > 1) continue;
    // First positional argument is the pattern; the rest are search targets.
    if (!sawQuery) {
      sawQuery = true;
      continue;
    }
    targets.push(token);
  }
  if (targets.length !== 1 || targets[0] === '.' || targets[0].endsWith('/')) return '';
  return targets[0];
}

/** Parse an rg/grep exec command and its captured output for the results modal. */
export function parseCodexGrepResults(input: unknown, output?: string): CodexGrepResults | null {
  const inputRecord = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : null;
  const directCommand = input && typeof input === 'object' && typeof (input as Record<string, unknown>).command === 'string'
    ? String((input as Record<string, unknown>).command)
    : '';
  const command = getCodexExecCommand(input) || directCommand;
  const normalized = normalizeShellWrapper(command);
  // Claude's native Grep tool sends `{ pattern, path, output_mode, ... }`
  // rather than a shell command. Prefer that explicit pattern when present.
  const nativePattern = typeof inputRecord?.pattern === 'string' ? inputRecord.pattern : '';
  const query = (nativePattern || extractGrepQuery(normalized)).trim();
  if (!query) return null;

  let searchable = output || '';
  try {
    const parsed = JSON.parse(searchable) as unknown;
    const strings: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === 'string') strings.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(collect);
    };
    collect(parsed);
    searchable = strings.join('\n');
  } catch { /* plain tool output */ }
  searchable = searchable
    .replace(/\\n/g, '\n')
    // ANSI color flags occasionally leak into captured rg output and break
    // the path/line matcher.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

  const matches: CodexGrepMatch[] = [];
  const nativePath = typeof inputRecord?.path === 'string' ? inputRecord.path : '';
  // Searches against a single file return line:text with no path prefix — the
  // missing filename comes from the native Grep input path or, for shell
  // commands, the command's lone file argument.
  const scopedPath = nativePath || extractGrepSingleFileTarget(normalized);
  for (const line of searchable.split('\n')) {
    // Normal rg format: path:line:text. With context flags, rg uses `-` as
    // the separator. Try the scoped line:text form first so separators inside
    // the matched text cannot be misread as a path split.
    const scopedMatch = scopedPath ? line.match(/^(\d+):(.*)$/) : null;
    const match = scopedMatch ? null : line.match(/^(.+?)(?::|-)(\d+)(?::|-)(.*)$/);
    if (!match && !scopedMatch) continue;
    const path = match ? match[1].trim() : scopedPath;
    const lineNumber = Number(match ? match[2] : scopedMatch![1]);
    if (!path || !lineNumber) continue;
    matches.push({
      path,
      line: lineNumber,
      text: (match ? match[3] : scopedMatch![2]).trim(),
    });
  }

  // Files-only output (`rg -l`, `grep -l`, native Grep files_with_matches or
  // count modes) carries no line numbers, so the pass above finds nothing.
  // Surface each file as a whole-file entry (line 0 = no specific line).
  if (matches.length === 0) {
    const lines = searchable
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line
        && !/^Found \d+ files?$/i.test(line)
        && !/^No (?:files|matches) found/i.test(line));
    const looksLikeFile = (line: string): boolean =>
      /^\S+$/.test(line) && (line.includes('/') || /\.[A-Za-z0-9]{1,8}(?::\d+)?$/.test(line));
    if (lines.length > 0 && lines.every(looksLikeFile)) {
      for (const line of lines) {
        // Count mode appends `:N` to the path — strip it.
        matches.push({ path: line.replace(/:\d+$/, ''), line: 0, text: '' });
      }
    }
  }
  return { query, matches };
}

/** The actual shell command inside a Codex JavaScript exec wrapper. */
export function getCodexExecCommand(input: unknown): string | null {
  const script = codexExecScript(input);
  return extractJavaScriptStringField(script, 'cmd') || extractJavaScriptStringField(script, 'command');
}

/** Locate the file/lines represented by a Codex READ or GREP exec card. */
export function getCodexExecFileTarget(input: unknown, output?: string): CodexExecFileTarget | null {
  const script = codexExecScript(input);
  const rawCommand = extractJavaScriptStringField(script, 'cmd') || extractJavaScriptStringField(script, 'command') || '';
  const readTarget = getShellReadTarget(rawCommand);
  if (readTarget) return readTarget;

  // rg --line-number output normally starts `path:line:text` (or path-line-text
  // when context mode is enabled). Open the first concrete match.
  if (output) {
    const match = output.match(/(?:^|\n)([^\n:]+?):(\d+):/);
    if (match) return { path: match[1].trim(), highlightRange: { offset: Number(match[2]), limit: 1 } };
  }
  return null;
}

/** Resolve a direct shell file-read command to the file and exact line range. */
export function getShellReadTarget(rawCommand: string): CodexExecFileTarget | null {
  return getShellReadTargets(rawCommand)[0] || null;
}

/** All sed/head/cat read targets in a possibly chained shell command. */
export function getShellReadTargets(rawCommand: string): CodexExecFileTarget[] {
  const command = normalizeShellWrapper(rawCommand);
  const targets: CodexExecFileTarget[] = [];
  for (const sed of command.matchAll(/\bsed\s+-n\s+["']?(\d+)\s*,\s*(\d+)p["']?\s+(?:--\s+)?["']?([^"';&|]+?)["']?(?=\s*(?:;|&&|\||$))/g)) {
    const start = Number(sed[1]);
    const end = Number(sed[2]);
    targets.push({ path: sed[3].trim(), highlightRange: { offset: start, limit: Math.max(1, end - start + 1) } });
  }
  if (targets.length > 0) return targets;

  const simpleRead = command.match(/^\s*(?:cat|head|tail)\b[^;&|]*?\s+(?:--\s+)?["']?([^"'\s;&|]+)["']?\s*$/);
  if (simpleRead) return [{ path: simpleRead[1] }];
  return [];
}

/** Resolve an opaque Codex `exec` wrapper to the activity it represents. */
export function getCodexExecPresentation(input: unknown): CodexExecPresentation {
  const script = codexExecScript(input);
  // Patch bodies may themselves contain strings such as `tools.exec_command(`.
  // Detect the outer apply_patch operation first so those contents do not turn
  // an EDIT card into a misleading mixed EXECUTECOMMAND card.
  const patchPaths = getCodexExecEditPaths(script);
  if (/\btools\.apply_patch\s*\(/.test(script) && patchPaths.length > 0) {
    return {
      toolName: 'Edit',
      detail: patchPaths.length > 1 ? `${patchPaths.length} files` : 'modified',
      filePaths: patchPaths,
    };
  }
  const toolCalls = [...script.matchAll(/\btools\.([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]);
  if (toolCalls.length === 0) return { toolName: 'ExecuteCommand', detail: 'Run orchestration step' };

  const counts = new Map<string, number>();
  for (const name of toolCalls) counts.set(name, (counts.get(name) || 0) + 1);
  const total = toolCalls.length;
  const parallel = /Promise\.all\s*\(/.test(script);
  const plural = (noun: string, count = total) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  // Surface the inner operation as a familiar Claude-style activity.
  if (counts.size === 1) {
    const name = toolCalls[0];
    switch (name) {
      case 'exec_command': {
        if (total > 1) return { toolName: 'Bash', detail: `Run ${plural('command')}${parallel ? ' in parallel' : ''}` };
        const command = extractJavaScriptStringField(script, 'cmd') || extractJavaScriptStringField(script, 'command') || '';
        return classifyTerminalCommand(command);
      }
      case 'write_stdin':
        return { toolName: 'Bash', detail: total > 1 ? `Send input to ${plural('terminal')}` : 'Continue terminal command' };
      case 'view_image': {
        const path = extractJavaScriptStringField(script, 'path');
        return { toolName: 'Read', detail: path ? 'image' : 'Inspect image', filePaths: path ? [path] : undefined };
      }
      case 'apply_patch': {
        const paths = getCodexExecEditPaths(script);
        return {
          toolName: 'Edit',
          detail: paths.length > 1 ? `${paths.length} files` : paths.length === 1 ? 'modified' : 'Project files',
          filePaths: paths.length > 0 ? paths : undefined,
        };
      }
      case 'web__run': return { toolName: 'WebSearch', detail: 'Search and inspect web sources' };
      case 'request_user_input': return { toolName: 'AskUserQuestion', detail: 'Ask for input' };
      case 'update_plan': return { toolName: 'TodoWrite', detail: 'Update work plan' };
      case 'wait': return { toolName: 'Bash', detail: 'Wait for running command' };
      default: return { toolName: 'ExecuteCommand', detail: `${prettifyToolName(name)}${total > 1 ? ` · ${total} calls` : ''}` };
    }
  }

  const commandCount = counts.get('exec_command') || 0;
  const inputCount = counts.get('write_stdin') || 0;
  if (commandCount + inputCount === total) {
    const parts: string[] = [];
    if (commandCount) parts.push(plural('command', commandCount));
    if (inputCount) parts.push(`${inputCount} terminal input${inputCount === 1 ? '' : 's'}`);
    return { toolName: 'Bash', detail: `Run ${parts.join(' + ')}${parallel ? ' in parallel' : ''}` };
  }

  return { toolName: 'ExecuteCommand', detail: `Run ${plural('tool action')}${parallel ? ' in parallel' : ''}` };
}

function extractJavaScriptStringField(script: string, field: string): string | null {
  // Accept both JS object keys (`cmd: "..."`) and JSON-style quoted keys
  // (`"cmd":"..."`) used by persisted Codex wrappers.
  const match = script.match(new RegExp(`\\b${field}["']?\\s*:\\s*(["'\x60])((?:\\\\[\\s\\S]|(?!\\1)[\\s\\S])*)\\1`));
  return match?.[2]?.replace(/\\n/g, '\n').replace(/\\(["'\x60\\])/g, '$1') || null;
}

/**
 * Steps that only set up or annotate a chain — `cd` into a directory, `echo` a
 * banner, `export` a var. They never describe what a command is *for*, so they
 * don't count when deciding whether a chain has a single semantic purpose.
 */
const SHELL_SETUP_STEP = /^(?:cd|echo|export|source|\.)\b/;

/**
 * Split on step separators (not pipes — a pipeline is one step) and drop the
 * setup-only steps.
 */
function substantiveShellSteps(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map((step) => step.trim())
    .filter(Boolean)
    .filter((step) => !SHELL_SETUP_STEP.test(step));
}

function classifyTerminalCommand(command: string): CodexExecPresentation {
  const clean = normalizeShellWrapper(command);
  // Reads take precedence: a filename/path may itself contain words such as
  // "grep", which must not turn `sed -n ... GrepPanel.tsx` into GREP.
  if (/^(?:sed\s+-n|cat|head|tail)\b/.test(clean)) {
    const readTargets = getShellReadTargets(clean);
    if (readTargets.length > 1) {
      return { toolName: 'Read', detail: `${readTargets.length} ranges`, filePaths: readTargets.map((target) => target.path) };
    }
    if (readTargets.length === 1) {
      const range = readTargets[0].highlightRange;
      const detail = range ? `lines ${range.offset}–${range.offset + range.limit - 1}` : 'viewed';
      return { toolName: 'Read', detail, filePaths: [readTargets[0].path] };
    }
    const sed = clean.match(/\bsed\s+-n\s+["']?(\d+)\s*,\s*(\d+)p["']?\s+(?:--\s+)?["']?([^"';&|]+?)["']?\s*$/);
    if (sed) return { toolName: 'Read', detail: `lines ${sed[1]}–${sed[2]}`, filePaths: [sed[3].trim()] };
    const simple = clean.match(/^\s*(?:cat|head|tail)\b[^;&|]*?\s+(?:--\s+)?["']?([^"'\s;&|]+)["']?\s*$/);
    return simple
      ? { toolName: 'Read', detail: 'viewed', filePaths: [simple[1]] }
      : { toolName: 'Read', detail: clean };
  }
  // The rules below match a keyword anywhere in the string, which is only safe
  // for a command with one job. A build gate like
  // `cd x && tsc && eslint && jest | grep -E "^Tests:" && npm run build`
  // was landing on GREP because of one late pipe stage. Once `cd`/`echo`
  // scaffolding is stripped, more than one remaining step means it's a script:
  // fall through to Bash, whose step summary is more informative anyway.
  const steps = substantiveShellSteps(clean);
  if (steps.length > 1) {
    return { toolName: 'Bash', detail: summarizeShellCommand(clean) };
  }
  // Match against the substantive step so a path like /home/erick/grep-tools
  // in a leading `cd` can't decide the label either.
  const subject = steps.length === 1 ? steps[0] : clean;

  if (/\b(?:rg\s+--files|find|ls)(?:\s|$)/.test(subject)) {
    return { toolName: 'Glob', detail: clean };
  }
  if (/\b(?:rg|grep)\b/.test(subject)) {
    return { toolName: 'Grep', detail: clean };
  }
  if (/\b(?:apply_patch|perl\s+-[pi]|git\s+apply)\b/.test(subject)) {
    return { toolName: 'Edit', detail: clean };
  }
  if (/^git\s+(?:diff|show|status)\b/.test(subject)) {
    const path = clean.match(/\s--\s+["']?([^"']+)["']?\s*$/)?.[1];
    return { toolName: 'Read', detail: 'Git changes', filePaths: path ? [path.trim()] : undefined };
  }
  return { toolName: 'Bash', detail: summarizeShellCommand(clean) };
}

/** Semantic presentation for a direct native Bash command, when applicable. */
export function getShellCommandPresentation(command: string): CodexExecPresentation {
  return classifyTerminalCommand(command);
}

function normalizeShellWrapper(command: string): string {
  let clean = command.replace(/^\s*(?:\/usr\/bin\/|\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+/, '').trim();
  if (clean.length >= 2) {
    const quote = clean[0];
    if ((quote === '"' || quote === "'") && clean.endsWith(quote)) {
      clean = clean.slice(1, -1).trim();
    }
  }
  return clean.replace(/\\"/g, '"').replace(/\\'/g, "'");
}

/** Stable comparison form for wrapped vs direct shell command deduplication. */
export function normalizeShellCommand(command: string): string {
  return normalizeShellWrapper(command).replace(/\s+/g, ' ').trim();
}

function summarizeShellCommand(command: string): string {
  if (!command) return 'Run terminal command';
  const steps = command.split(/\s*(?:&&|;)\s*/).filter(Boolean);
  if (steps.length > 1) {
    const labels = steps.slice(0, 3).map((step) => {
      if (/\bvitest\b/.test(step)) return 'tests';
      if (/\btsc\b/.test(step)) return 'type check';
      if (/\b(?:vite|npm\s+run)\s+build\b/.test(step)) return 'build';
      if (/\beslint\b/.test(step)) return 'lint';
      if (/\bgit\s+diff\s+--check\b/.test(step)) return 'check diff';
      return step.trim().split(/\s+/).slice(0, 2).join(' ');
    });
    return `${steps.length} steps · ${labels.join(' → ')}`;
  }
  if (/\bvitest\b/.test(command)) return `Tests · ${command.replace(/^.*?\bvitest\s+(?:run\s+)?/, '') || 'test suite'}`;
  if (/\btsc\b/.test(command)) return 'Type check';
  if (/\b(?:vite|npm\s+run)\s+build\b/.test(command)) return 'Build project';
  if (/\beslint\b/.test(command)) return 'Lint project';
  return command;
}

export function extractExecPayloadCommand(cmd: string): string | null {
  if (!cmd.includes('curl') || !cmd.includes('/api/exec')) return null;

  const candidates: string[] = [];
  const patterns = [
    /(?:-d|--data|--data-raw)\s+'((?:\\'|[^'])*)'/g,
    /(?:-d|--data|--data-raw)\s+"((?:\\"|[^"])*)"/g,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(cmd)) !== null) {
      if (match[1]) candidates.push(match[1]);
    }
  }

  for (const raw of candidates) {
    const attempts = [
      raw,
      raw.replace(/\\"/g, '"'),
      raw.replace(/\\'/g, '\''),
      raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
    ];
    for (const attempt of attempts) {
      const trimmed = attempt.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
      try {
        const parsed = JSON.parse(trimmed) as { command?: unknown };
        if (typeof parsed.command === 'string' && parsed.command.length > 0) {
          return parsed.command;
        }
      } catch {
        // Keep trying with the next variant.
      }
    }
  }

  return null;
}

/**
 * If this is a curl /api/exec wrapper command, return the wrapped inner command.
 * Otherwise returns the original command.
 */
export function extractExecWrappedCommand(cmd: string): string {
  return extractExecPayloadCommand(cmd) || cmd;
}

/**
 * Determine if output text should be shown in simple/chat view
 * Filters out technical details like tool inputs, tokens, costs
 */
export function isSimpleViewOutput(text: string): boolean {
  // SHOW tool names (will render with nice icons)
  if (text.startsWith('Using tool:')) return true;

  // HIDE technical details
  if (text.startsWith('Tool input:')) return false;
  if (text.startsWith('Tool result:')) return false;
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return true;
  if (text.startsWith('Session started:')) return false;

  // SHOW everything else (actual content)
  return true;
}

export interface CommandTextSegment {
  text: string;
  fileRef?: string;
}

// Path segments allow Unicode letters/marks (not just ASCII) so paths with
// accented folders like "Operación"/"Documentación" linkify fully instead of
// breaking at the first non-ASCII character. Requires the `u` flag.
const COMMAND_FILE_REF_REGEX = /(^|[\s("'`])((?:\.{1,2}\/|~\/|\/)?[\p{L}\p{M}\p{N}._-]+(?:\/[\p{L}\p{M}\p{N}._-]+)*\.[\p{L}\p{M}\p{N}._-]+(?::\d+(?::\d+)?)?)/gu;

function isLikelyCommandFileRef(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('-')) return false;
  if (value.includes('://')) return false;
  if (value.includes('*')) return false;
  // Keep command linking focused on local-ish paths and filenames with extension.
  return value.includes('.') && !value.endsWith('.');
}

/**
 * Split a shell command into text/file segments so file refs can be rendered as clickable links.
 */
export function splitCommandForFileLinks(command: string): CommandTextSegment[] {
  if (!command) return [{ text: '' }];

  const segments: CommandTextSegment[] = [];
  let lastIndex = 0;
  COMMAND_FILE_REF_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = COMMAND_FILE_REF_REGEX.exec(command)) !== null) {
    const full = match[0];
    const prefix = match[1] || '';
    const candidate = match[2] || '';
    const start = match.index;

    if (start > lastIndex) {
      segments.push({ text: command.slice(lastIndex, start) });
    }
    if (prefix) {
      segments.push({ text: prefix });
    }

    if (isLikelyCommandFileRef(candidate)) {
      segments.push({ text: candidate, fileRef: candidate });
    } else {
      segments.push({ text: candidate });
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < command.length) {
    segments.push({ text: command.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: command }];
}

/**
 * Determine if output is human-readable (not tool calls/results/stats)
 * Used by Commander view for filtering
 */
export function isHumanReadableOutput(text: string): boolean {
  if (text.startsWith('Using tool:')) return false;
  if (text.startsWith('Tool result:')) return false;
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return false;
  if (text.startsWith('Session started:')) return false;
  if (text.startsWith('Tool input:')) return false;
  return true;
}

/**
 * Determine if output should be shown in chat view (user messages + final responses only)
 */
export function isChatViewOutput(text: string): boolean {
  // Hide tool-related messages
  if (text.startsWith('Using tool:')) return false;
  if (text.startsWith('Tool input:')) return false;
  if (text.startsWith('Tool result:')) return false;
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return false;
  if (text.startsWith('Session started:')) return false;

  // Show actual content
  return true;
}

/**
 * Check if a tool result indicates an error
 */
export function isErrorResult(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes('error') || lower.includes('failed');
}

/**
 * Format tool input JSON for display
 * Returns formatted JSON string or original content if not valid JSON
 */
export function formatToolInput(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

export interface BashSearchCommandInfo {
  shellPrefix?: string;
  commandBody: string;
  searchTerm: string;
}

export interface BashNotificationCommandInfo {
  shellPrefix?: string;
  commandBody: string;
  title?: string;
  message?: string;
  viaCurl: boolean;
  viaGdbus: boolean;
}

const TIDE_FILE_LINK_SCHEME = 'tide-file://';
// Path segments allow Unicode letters/marks (see COMMAND_FILE_REF_REGEX above)
// so accented absolute paths (e.g. /home/.../Operación/file.pdf) are matched in
// full. The `u` flag is required for the \p{...} escapes.
const FILE_PATH_TOKEN_REGEX = /(^|[\s(>])((?:\.\.?\/|\/)?(?:[\p{L}\p{M}\p{N}._-]+\/)*[\p{L}\p{M}\p{N}._-]+(?:\.[\p{L}\p{M}\p{N}._-]+)+(?:#L\d+(?:C\d+)?)?(?::\d+(?::\d+)?)?)(?=$|[\s),.;])/gu;
const INLINE_CODE_FILE_PATH_REGEX = /`((?:\.\.?\/|\/)?(?:[\p{L}\p{M}\p{N}._-]+\/)*[\p{L}\p{M}\p{N}._-]+(?:\.[\p{L}\p{M}\p{N}._-]+)+(?:#L\d+(?:C\d+)?)?(?::\d+(?::\d+)?)?)`/gu;

// Common TLDs to distinguish URLs from file paths
const URL_TLDS = /\.(com|org|net|io|dev|app|co|me|info|biz|us|uk|de|fr|jp|cn|ru|edu|gov|mil|int|xyz|tech|online|site|store|blog|cloud|ai|gg|tv|cc|sh|fm|to|ly|gl|so|is|it|at|nl|ch|se|no|fi|dk|be|cz|pl|pt|br|mx|ar|cl|in|au|nz|za|sg|hk|tw|kr|id|ph|th|vn|my)(?:[:/\s#?]|$)/i;

function isLikelyFilePathToken(token: string): boolean {
  if (!token) return false;
  if (token.includes('://')) return false;
  if (token.startsWith('www.')) return false;
  if (token.includes('@')) return false;
  // Exclude domain-like tokens (e.g. npmmirror.com, github.io/path)
  const base = token.split('/')[0];
  if (URL_TLDS.test(base)) return false;
  return token.includes('.') && !token.endsWith('.');
}

/**
 * Convert bare file paths in plain output text into markdown links.
 * Uses a custom scheme so markdown renderers can route clicks to the file viewer modal.
 */
export function linkifyFilePathsForMarkdown(text: string): string {
  if (!text || !text.includes('.')) return text;

  const lines = text.split('\n');
  let inFence = false;

  const rendered = lines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    const withInlineCodeLinks = line.replace(INLINE_CODE_FILE_PATH_REGEX, (match, token: string) => {
      if (!isLikelyFilePathToken(token)) {
        return match;
      }
      const encoded = encodeURIComponent(token);
      return `[\`${token}\`](${TIDE_FILE_LINK_SCHEME}${encoded})`;
    });

    return withInlineCodeLinks.replace(FILE_PATH_TOKEN_REGEX, (match, prefix: string, token: string, offset: number) => {
      const tokenStart = offset + prefix.length;
      const prevChar = tokenStart > 0 ? withInlineCodeLinks[tokenStart - 1] : '';
      const nextChar = tokenStart + token.length < withInlineCodeLinks.length ? withInlineCodeLinks[tokenStart + token.length] : '';

      // Avoid rewriting markdown link targets like [label](path/to/file)
      if (prevChar === '(' && tokenStart > 1 && withInlineCodeLinks[tokenStart - 2] === ']') {
        return match;
      }
      if (prevChar === '[' || nextChar === ']') {
        return match;
      }
      if (!isLikelyFilePathToken(token)) {
        return match;
      }

      const encoded = encodeURIComponent(token);
      return `${prefix}[${token}](${TIDE_FILE_LINK_SCHEME}${encoded})`;
    });
  });

  return rendered.join('\n');
}

/**
 * Extract bare file-path tokens from free text (not markdown).
 *
 * Reuses the exact detection heuristics of linkifyFilePathsForMarkdown
 * (FILE_PATH_TOKEN_REGEX + isLikelyFilePathToken) so search indexing and
 * rendering agree on what counts as a file path. Trailing line/column suffixes
 * (:12, :12:3, #L12, #L12C3) are stripped so callers get the bare path, and the
 * result is de-duplicated preserving first-seen order.
 */
export function extractFilePathTokens(text: string): string[] {
  if (!text || !text.includes('.')) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  FILE_PATH_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_TOKEN_REGEX.exec(text)) !== null) {
    const token = match[2];
    if (!isLikelyFilePathToken(token)) continue;
    const bare = token.replace(/(?:#L\d+(?:C\d+)?)?(?::\d+(?::\d+)?)?$/, '');
    if (!bare || seen.has(bare)) continue;
    seen.add(bare);
    out.push(bare);
  }
  return out;
}

/**
 * Decode custom markdown href back into a file reference string.
 */
export function decodeTideFileHref(href?: string | null): string | null {
  if (!href || !href.startsWith(TIDE_FILE_LINK_SCHEME)) return null;
  const encoded = href.slice(TIDE_FILE_LINK_SCHEME.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse Bash commands that search terms via: rg --files | rg <term>
 * Returns null when the command is not a search-term pattern.
 */
export function parseBashSearchCommand(command: string): BashSearchCommandInfo | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  let shellPrefix: string | undefined;
  let commandBody = trimmed;

  const shellWrapped = trimmed.match(/^(\S+)\s+-lc\s+([\s\S]+)$/);
  if (shellWrapped) {
    shellPrefix = `${shellWrapped[1]} -lc`;
    commandBody = stripWrappingQuotes(shellWrapped[2].trim());
  }

  if (!/\brg\s+--files\b/.test(commandBody) || !/\|\s*rg\b/.test(commandBody)) {
    return null;
  }

  const pipeSearchMatch = commandBody.match(/\|\s*rg\b\s+(.+)$/);
  if (!pipeSearchMatch) return null;

  const searchArgs = pipeSearchMatch[1].trim();
  if (!searchArgs) return null;

  const termWithoutFlags = searchArgs.replace(/^(?:-\S+\s+)*/, '').trim();
  const searchTerm = stripWrappingQuotes(termWithoutFlags || searchArgs);
  if (!searchTerm) return null;

  return {
    shellPrefix,
    commandBody,
    searchTerm,
  };
}

/**
 * Parse Bash commands that send Tide notifications via curl api/notify and/or gdbus Notify.
 * Returns null when command does not look like a notification command.
 */
export function parseBashNotificationCommand(command: string): BashNotificationCommandInfo | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  let shellPrefix: string | undefined;
  let commandBody = trimmed;

  const shellWrapped = trimmed.match(/^(\S+)\s+-lc\s+([\s\S]+)$/);
  if (shellWrapped) {
    shellPrefix = `${shellWrapped[1]} -lc`;
    commandBody = stripWrappingQuotes(shellWrapped[2].trim());
  }

  const viaCurl = /\bcurl\b[\s\S]*\/api\/notify\b/.test(commandBody);
  const viaGdbus = /\bgdbus\b[\s\S]*org\.freedesktop\.Notifications\.Notify\b/.test(commandBody);
  if (!viaCurl && !viaGdbus) return null;

  let title: string | undefined;
  let message: string | undefined;

  // Try curl JSON payload first: -d '{"title":"...","message":"..."}'
  const payloadMatch = commandBody.match(/-d\s+((['"])([\s\S]*?)\2)/);
  if (payloadMatch) {
    const rawPayload = stripWrappingQuotes(payloadMatch[1]).replace(/\\"/g, '"');
    const parsedTitle = rawPayload.match(/"title"\s*:\s*"([^"]*)"/);
    const parsedMessage = rawPayload.match(/"message"\s*:\s*"([^"]*)"/);
    if (parsedTitle?.[1]) title = parsedTitle[1];
    if (parsedMessage?.[1]) message = parsedMessage[1];
  }

  // Fallback to gdbus notify args: ... 'ICON' 'TITLE' 'MESSAGE' '[]' '{}' 5000
  if (!title || !message) {
    const gdbusArgs = commandBody.match(/Notifications\.Notify[\s\S]*?\s'[^']*'\s+\d+\s+'[^']*'\s+'([^']*)'\s+'([^']*)'/);
    if (!title && gdbusArgs?.[1]) title = gdbusArgs[1];
    if (!message && gdbusArgs?.[2]) message = gdbusArgs[2];
  }

  return {
    shellPrefix,
    commandBody,
    title,
    message,
    viaCurl,
    viaGdbus,
  };
}

export interface BashTaskLabelCommandInfo {
  shellPrefix?: string;
  commandBody: string;
  taskLabel: string;
}

/**
 * Parse Bash commands that set a task label via curl PATCH /api/agents/...
 * Detects: curl ... -X PATCH .../api/agents/... -d '{"taskLabel":"..."}'
 * Returns null when command does not look like a task label command.
 */
export function parseBashTaskLabelCommand(command: string): BashTaskLabelCommandInfo | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  let shellPrefix: string | undefined;
  let commandBody = trimmed;

  const shellWrapped = trimmed.match(/^(\S+)\s+-lc\s+([\s\S]+)$/);
  if (shellWrapped) {
    shellPrefix = `${shellWrapped[1]} -lc`;
    commandBody = stripWrappingQuotes(shellWrapped[2].trim());
  }

  // Must be a curl PATCH to /api/agents/ with taskLabel in payload
  if (!/\bcurl\b/.test(commandBody)) return null;
  if (!/PATCH/.test(commandBody)) return null;
  if (!/\/api\/agents\//.test(commandBody)) return null;

  // Extract taskLabel from JSON payload
  const payloadMatch = commandBody.match(/-d\s+((['"])([\s\S]*?)\2)/);
  if (!payloadMatch) return null;

  const rawPayload = stripWrappingQuotes(payloadMatch[1]).replace(/\\"/g, '"');
  const labelMatch = rawPayload.match(/"taskLabel"\s*:\s*"([^"]*)"/);
  if (!labelMatch?.[1]) return null;

  return {
    shellPrefix,
    commandBody,
    taskLabel: labelMatch[1],
  };
}

export interface BashReportTaskCommandInfo {
  shellPrefix?: string;
  commandBody: string;
  summary: string;
  status: 'completed' | 'failed';
}

export type TrackingStatusValue =
  | 'need-review'
  | 'blocked'
  | 'can-clear-context'
  | 'waiting-subordinates'
  | 'working'
  | string;

export interface BashTrackingStatusCommandInfo {
  shellPrefix?: string;
  commandBody: string;
  trackingStatus: TrackingStatusValue;
  trackingStatusDetail?: string;
}

/**
 * Parse Bash commands that update agent tracking status via curl PATCH /api/agents/...
 * Detects: curl ... -X PATCH .../api/agents/... -d '{"trackingStatus":"...","trackingStatusDetail":"..."}'
 * Returns null when command does not look like a tracking-status command.
 */
export function parseBashTrackingStatusCommand(command: string): BashTrackingStatusCommandInfo | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  let shellPrefix: string | undefined;
  let commandBody = trimmed;

  const shellWrapped = trimmed.match(/^(\S+)\s+-lc\s+([\s\S]+)$/);
  if (shellWrapped) {
    shellPrefix = `${shellWrapped[1]} -lc`;
    commandBody = stripWrappingQuotes(shellWrapped[2].trim());
  }

  if (!/\bcurl\b/.test(commandBody)) return null;
  if (!/PATCH/.test(commandBody)) return null;
  if (!/\/api\/agents\//.test(commandBody)) return null;

  const payloadMatch = commandBody.match(/-d\s+((['"])([\s\S]*?)\2)/);
  if (!payloadMatch) return null;

  const rawPayload = stripWrappingQuotes(payloadMatch[1]).replace(/\\"/g, '"');
  const statusMatch = rawPayload.match(/"trackingStatus"\s*:\s*"([^"]*)"/);
  if (!statusMatch?.[1]) return null;

  const detailMatch = rawPayload.match(/"trackingStatusDetail"\s*:\s*"([^"]*)"/);

  return {
    shellPrefix,
    commandBody,
    trackingStatus: statusMatch[1],
    trackingStatusDetail: detailMatch?.[1],
  };
}

/**
 * Resolve an emoji icon for a given tracking status value.
 * Falls back to a neutral indicator for unknown statuses.
 */
export function getTrackingStatusIcon(status: string): string {
  switch (status) {
    case 'need-review': return '✅';
    case 'blocked': return '🚫';
    case 'can-clear-context': return '🧹';
    case 'waiting-subordinates': return '⏳';
    case 'working': return '💻';
    case 'thinking': return '✏️';
    default: return '📍';
  }
}

export function getTrackingStatusIconName(status: string): IconName {
  switch (status) {
    case 'need-review': return 'success';
    case 'blocked': return 'warn';
    case 'can-clear-context': return 'clear';
    case 'waiting-subordinates': return 'hourglass';
    case 'working': return 'terminal';
    case 'thinking': return 'edit';
    default: return 'pin';
  }
}

/**
 * Parse Bash commands that report task completion to boss via curl POST /api/agents/.../report-task
 * Returns null when command does not look like a report-task command.
 */
export function parseBashReportTaskCommand(command: string): BashReportTaskCommandInfo | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  let shellPrefix: string | undefined;
  let commandBody = trimmed;

  const shellWrapped = trimmed.match(/^(\S+)\s+-lc\s+([\s\S]+)$/);
  if (shellWrapped) {
    shellPrefix = `${shellWrapped[1]} -lc`;
    commandBody = stripWrappingQuotes(shellWrapped[2].trim());
  }

  if (!/\bcurl\b/.test(commandBody)) return null;
  if (!/\/api\/agents\/.*\/report-task\b/.test(commandBody)) return null;

  // Extract summary and status from JSON payload (supports both -d inline and heredoc)
  let summary = '';
  let status: 'completed' | 'failed' = 'completed';

  // Try heredoc format: -d @- <<'EOF'\n{...}\nEOF
  const heredocMatch = commandBody.match(/<<'?EOF'?\s*\n([\s\S]*?)\nEOF/);
  if (heredocMatch) {
    try {
      const parsed = JSON.parse(heredocMatch[1].trim());
      summary = parsed.summary || '';
      status = parsed.status === 'failed' ? 'failed' : 'completed';
    } catch { /* ignore parse errors */ }
  } else {
    // Try inline -d format
    const payloadMatch = commandBody.match(/-d\s+((['"])([\s\S]*?)\2)/);
    if (payloadMatch) {
      const rawPayload = stripWrappingQuotes(payloadMatch[1]).replace(/\\"/g, '"');
      const summaryMatch = rawPayload.match(/"summary"\s*:\s*"([^"]*)"/);
      const statusMatch = rawPayload.match(/"status"\s*:\s*"([^"]*)"/);
      if (summaryMatch) summary = summaryMatch[1];
      if (statusMatch?.[1] === 'failed') status = 'failed';
    }
  }

  return {
    shellPrefix,
    commandBody,
    summary,
    status,
  };
}

export type BashMemoryKind = 'read' | 'save' | 'clear';

export interface BashMemoryCommandInfo {
  shellPrefix?: string;
  commandBody: string;
  kind: BashMemoryKind;
  agentId: string;
  bodyLength?: number;
}

export interface BashMemoryResponseInfo {
  length?: number;
  failed: boolean;
}

const MEMORY_URL_RE = /\/api\/agents\/([a-zA-Z0-9_-]+)\/memory\b/;

export function parseBashMemoryCommand(command: string): BashMemoryCommandInfo | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  let shellPrefix: string | undefined;
  let commandBody = trimmed;

  const shellWrapped = trimmed.match(/^(\S+)\s+-lc\s+([\s\S]+)$/);
  if (shellWrapped) {
    shellPrefix = `${shellWrapped[1]} -lc`;
    commandBody = stripWrappingQuotes(shellWrapped[2].trim());
  }

  if (!/\bcurl\b/.test(commandBody)) return null;
  const urlMatch = commandBody.match(MEMORY_URL_RE);
  if (!urlMatch) return null;

  const agentId = urlMatch[1];
  const methodMatch = commandBody.match(/(?:-X|--request)\s+(?:["']?)(GET|POST|PATCH|PUT|DELETE)(?:["']?)/i);
  const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';

  let kind: BashMemoryKind;
  if (method === 'PATCH' || method === 'PUT' || method === 'POST') kind = 'save';
  else if (method === 'DELETE') kind = 'clear';
  else kind = 'read';

  let bodyLength: number | undefined;
  if (kind === 'save') {
    bodyLength = extractMemoryBodyLength(commandBody);
  }

  return {
    shellPrefix,
    commandBody,
    kind,
    agentId,
    bodyLength,
  };
}

function extractMemoryBodyLength(commandBody: string): number | undefined {
  const heredocMatch = commandBody.match(/<<\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*?)\r?\n\1\b/);
  const heredocPayload = heredocMatch?.[2];

  let rawPayload: string | undefined;
  if (heredocPayload) {
    rawPayload = heredocPayload.trim();
  } else {
    const inlineMatch = commandBody.match(/-d\s+((['"])([\s\S]*?)\2)/);
    if (inlineMatch) {
      rawPayload = stripWrappingQuotes(inlineMatch[1]).replace(/\\"/g, '"');
    }
  }

  if (!rawPayload) return undefined;

  try {
    const parsed = JSON.parse(rawPayload);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { memory?: unknown }).memory === 'string') {
      return (parsed as { memory: string }).memory.length;
    }
  } catch {
    // Best-effort: extract "memory":"..." with a forgiving regex, count chars after un-escaping JSON sequences.
    const memMatch = rawPayload.match(/"memory"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (memMatch) {
      const escaped = memMatch[1];
      try {
        const decoded = JSON.parse(`"${escaped}"`);
        if (typeof decoded === 'string') return decoded.length;
      } catch {
        return escaped.length;
      }
    }
  }
  return undefined;
}

export function parseMemoryResponseInfo(output: string | undefined | null): BashMemoryResponseInfo {
  if (!output) return { failed: false };
  const trimmed = output.trim();
  if (!trimmed) return { failed: false };

  if (/HTTP\/\d\.\d\s+(4|5)\d\d/.test(trimmed)) {
    return { failed: true };
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    return { failed: /\berror\b/i.test(trimmed) || /"ok"\s*:\s*false/.test(trimmed) };
  }

  const jsonSlice = trimmed.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(jsonSlice);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { ok?: unknown; length?: unknown; error?: unknown };
      const failed = obj.ok === false || typeof obj.error === 'string';
      const length = typeof obj.length === 'number' ? obj.length : undefined;
      return { length, failed };
    }
  } catch {
    const lengthMatch = jsonSlice.match(/"length"\s*:\s*(\d+)/);
    const failed = /"ok"\s*:\s*false/.test(jsonSlice) || /"error"\s*:\s*"/.test(jsonSlice);
    return {
      length: lengthMatch ? Number.parseInt(lengthMatch[1], 10) : undefined,
      failed,
    };
  }
  return { failed: false };
}

/**
 * Parse tool name from "Using tool: ToolName" format
 */
export function parseToolName(text: string): string | null {
  if (!text.startsWith('Using tool:')) return null;
  return text.replace('Using tool:', '').trim();
}

/**
 * Parse tool result content from "Tool result: content" format
 */
export function parseToolResult(text: string): string | null {
  if (!text.startsWith('Tool result:')) return null;
  return text.replace('Tool result:', '').trim();
}

/**
 * Parse tool input content from "Tool input: content" format
 */
export function parseToolInput(text: string): string | null {
  if (!text.startsWith('Tool input:')) return null;
  return text.replace('Tool input:', '').trim();
}
