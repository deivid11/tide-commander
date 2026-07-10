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
    case 'WebSearch': {
      const query = (input.query || input.q || input.search) as string | undefined;
      return query ? `"${truncate(query, 40)}"` : null;
    }
    case 'WebFetch': {
      const url = (input.url || input.target_url || input.targetUrl) as string | undefined;
      return url ? truncate(url, 60) : null;
    }
    case 'Read':
    case 'Write':
    case 'Edit': {
      // Claude: file_path; Grok: target_file
      const filePath = (
        input.file_path
        || input.filePath
        || input.target_file
        || input.targetFile
        || input.path
      ) as string | undefined;
      return getShortPath(filePath);
    }
    case 'ListFiles':
    case 'list_dir': {
      const dir = (
        input.target_directory
        || input.targetDirectory
        || input.path
        || input.directory
      ) as string | undefined;
      return getShortPath(dir);
    }
    case 'Bash':
    case 'ExecuteCommand': {
      const cmd = (input.command || input.cmd) as string | undefined;
      if (cmd) return truncate(cmd, 60);
      const desc = input.description as string | undefined;
      return desc ? truncate(desc, 60) : null;
    }
    case 'Grep':
    case 'SearchFiles': {
      const pattern = (input.pattern || input.query) as string | undefined;
      return pattern ? `"${truncate(pattern, 40)}"` : null;
    }
    case 'Glob':
      return truncate((input.pattern || input.glob) as string, 50);
    case 'Task':
    case 'Agent':
      return truncate(input.description as string, 50);
    case 'TodoWrite': {
      const todos = input.todos as unknown[];
      if (todos?.length) {
        return `${todos.length} item${todos.length > 1 ? 's' : ''}`;
      }
      return null;
    }
    case 'NotebookEdit':
      return getFileName(
        (input.notebook_path || input.notebookPath || input.target_file || input.file_path) as string
      );
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

