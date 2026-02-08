/**
 * Shared output rendering utilities for ClaudeOutputPanel (Guake) and CommanderView
 * This file contains common functions for displaying Claude output, tool calls, etc.
 */

// Tool icons mapping - used in both Guake terminal and Commander view
export const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '📝',
  Bash: '💻',
  Glob: '🔍',
  Grep: '🔎',
  Task: '📋',
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
  default: '⚡',
};

/**
 * Get the icon for a tool, with fallback to default
 */
export function getToolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] || TOOL_ICONS.default;
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

    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'NotebookEdit': {
        const filePath = input.file_path || input.path || input.notebook_path;
        if (filePath) {
          return filePath; // Full path, no truncation
        }
        break;
      }
      case 'Bash': {
        const cmd = input.command;
        if (cmd) {
          // Extract inner command from curl /api/exec payloads
          if (cmd.includes('curl') && cmd.includes('/api/exec')) {
            try {
              // Extract JSON payload from curl command
              // Pattern: -d '{"agentId":"...","command":"...","cwd":"..."}'
              const jsonMatch = cmd.match(/-d\s+'({[^}]+})'/);
              if (jsonMatch) {
                const payload = JSON.parse(jsonMatch[1]);
                if (payload.command) {
                  // Show the actual command being executed
                  return payload.command;
                }
              }
            } catch {
              // If extraction fails, show the full command
              return cmd;
            }
          }
          return cmd; // Full command, no truncation
        }
        break;
      }
      case 'Grep': {
        const pattern = input.pattern;
        const path = input.path;
        if (pattern && path) {
          return `"${pattern}" in ${path}`;
        }
        if (pattern) {
          return `"${pattern}"`;
        }
        break;
      }
      case 'Glob': {
        const pattern = input.pattern;
        const path = input.path;
        if (pattern && path) {
          return `${pattern} in ${path}`;
        }
        if (pattern) {
          return pattern;
        }
        break;
      }
      case 'WebFetch': {
        const url = input.url;
        if (url) {
          return url; // Full URL
        }
        break;
      }
      case 'WebSearch': {
        const query = input.query;
        if (query) {
          return `"${query}"`; // Full query
        }
        break;
      }
      case 'Task': {
        const desc = input.description || input.prompt;
        if (desc) {
          return desc; // Full description
        }
        break;
      }
      case 'TodoWrite': {
        const todos = input.todos;
        if (Array.isArray(todos) && todos.length > 0) {
          // Show ALL task titles with status indicators - no truncation
          const previews = todos.map((t: { content?: string; status?: string }) =>
            `${getTodoStatusIcon(t.status || 'pending')} ${t.content || ''}`
          );
          return previews.join('\n');
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
const FILE_PATH_TOKEN_REGEX = /(^|[\s(>])((?:\.\.?\/|\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)+(?:#L\d+(?:C\d+)?)?(?::\d+(?::\d+)?)?)(?=$|[\s),.;])/g;
const INLINE_CODE_FILE_PATH_REGEX = /`((?:\.\.?\/|\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)+(?:#L\d+(?:C\d+)?)?(?::\d+(?::\d+)?)?)`/g;

function isLikelyFilePathToken(token: string): boolean {
  if (!token) return false;
  if (token.includes('://')) return false;
  if (token.startsWith('www.')) return false;
  if (token.includes('@')) return false;
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

/**
 * Status colors for agent indicators (Dracula theme)
 * @deprecated Use getAgentStatusColor from utils/colors.ts instead
 */
export { getAgentStatusColor as getStatusColor } from './colors';
