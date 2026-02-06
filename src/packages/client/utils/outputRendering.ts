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
  if (text.startsWith('[thinking]')) return false;
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
