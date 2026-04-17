/**
 * Tool Formatting Utilities
 * Shared formatting for tool names and parameters across services and handlers
 */

import { truncate } from './string.js';

/**
 * Get the filename from a path
 */
export function getFileName(path: string | undefined): string {
  if (!path) return 'unknown';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Get a shortened path for display (e.g., ".../parent/file.ts")
 */
export function getShortPath(filePath: string | undefined, maxLen: number = 40): string | null {
  if (!filePath) return null;
  if (filePath.length <= maxLen) return filePath;
  const parts = filePath.split('/');
  return '.../' + parts.slice(-2).join('/');
}

/**
 * Extract the key parameter value from tool input for display
 */
export function getToolKeyParam(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  switch (toolName) {
    case 'WebSearch':
      return truncate(input.query as string, 50);
    case 'WebFetch':
      return truncate(input.url as string, 60);
    case 'Read':
    case 'Write':
    case 'Edit':
      const filePath = (input.file_path || input.path) as string;
      return getShortPath(filePath);
    case 'Bash':
      const cmd = input.command as string;
      return cmd ? truncate(cmd, 60) : null;
    case 'Grep':
      return input.pattern ? `"${truncate(input.pattern as string, 40)}"` : null;
    case 'Glob':
      return truncate(input.pattern as string, 50);
    case 'Task':
      return truncate(input.description as string, 50);
    case 'TodoWrite':
      const todos = input.todos as unknown[];
      if (todos?.length) {
        return `${todos.length} item${todos.length > 1 ? 's' : ''}`;
      }
      return null;
    case 'NotebookEdit':
      return getFileName(input.notebook_path as string);
    case 'AskUserQuestion':
      return 'clarification';
    default:
      // Try to find any meaningful string parameter
      for (const [, value] of Object.entries(input)) {
        if (typeof value === 'string' && value.length > 0 && value.length < 100) {
          return truncate(value, 50);
        }
      }
      return null;
  }
}

/**
 * Format tool usage as a short activity string (e.g., "Read: file.ts")
 * Used in activity feeds and status displays
 */
export function formatToolActivity(
  toolName?: string,
  toolInput?: Record<string, unknown>
): string {
  if (!toolName) return 'Using unknown tool';
  const param = toolInput ? getToolKeyParam(toolName, toolInput) : null;
  if (param) {
    return `${toolName}: ${param}`;
  }
  return `Using ${toolName}`;
}

