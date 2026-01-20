/**
 * Tool Formatting Utilities
 * Shared formatting for tool names and parameters across services and handlers
 */

import { truncateOrEmpty, truncate } from './string.js';

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

/**
 * Format tool usage as a narrative string (e.g., "Reading file to understand its contents")
 * Used in supervisor reports and detailed activity logs
 */
export function formatToolNarrative(
  toolName?: string,
  toolInput?: Record<string, unknown>
): string {
  if (!toolName) return 'Using unknown tool';

  switch (toolName) {
    case 'Read': {
      const readPath = toolInput?.file_path as string;
      return `Reading file "${getFileName(readPath)}" to understand its contents`;
    }
    case 'Write': {
      const writePath = toolInput?.file_path as string;
      return `Writing new content to "${getFileName(writePath)}"`;
    }
    case 'Edit': {
      const editPath = toolInput?.file_path as string;
      return `Making targeted edits to "${getFileName(editPath)}"`;
    }
    case 'Bash': {
      const cmd = toolInput?.command as string;
      return `Running command: ${truncateOrEmpty(cmd, 60)}`;
    }
    case 'Grep': {
      const pattern = toolInput?.pattern as string;
      return `Searching for pattern "${truncateOrEmpty(pattern, 40)}" in codebase`;
    }
    case 'Glob': {
      const globPattern = toolInput?.pattern as string;
      return `Finding files matching "${truncateOrEmpty(globPattern, 40)}"`;
    }
    case 'WebSearch': {
      const query = toolInput?.query as string;
      return `Searching the web for "${truncateOrEmpty(query, 50)}"`;
    }
    case 'WebFetch': {
      const url = toolInput?.url as string;
      return `Fetching content from ${truncateOrEmpty(url, 50)}`;
    }
    case 'Task': {
      const desc = toolInput?.description as string;
      return `Starting sub-task: "${truncateOrEmpty(desc, 60)}"`;
    }
    case 'TodoWrite': {
      const todos = toolInput?.todos as unknown[];
      return `Updating task list with ${todos?.length || 0} items`;
    }
    case 'AskUserQuestion':
      return 'Asking user a question for clarification';
    case 'NotebookEdit': {
      const notebookPath = toolInput?.notebook_path as string;
      return `Editing notebook "${getFileName(notebookPath)}"`;
    }
    default:
      return `Using ${toolName} tool`;
  }
}
