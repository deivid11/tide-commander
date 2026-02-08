/**
 * Shared types for output/history display components
 * Used by both ClaudeOutputPanel and CommanderView
 */

/**
 * A message from the conversation history (persisted)
 */
export interface HistoryMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  timestamp: string;
  uuid?: string;
  toolName?: string;
  toolUseId?: string; // For linking tool_use with tool_result
  toolInput?: Record<string, unknown>; // Parsed tool input
}

/**
 * An attached file for sending with a command
 */
export interface AttachedFile {
  id: number;
  name: string;
  path: string;
  isImage: boolean;
  size: number;
}

/**
 * Common pagination constants
 */
export const MESSAGES_PER_PAGE = 90;
export const DEFAULT_SCROLL_THRESHOLD = 100; // px from edge to trigger load more
