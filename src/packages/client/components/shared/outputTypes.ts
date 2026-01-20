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
  toolName?: string;
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
export const MESSAGES_PER_PAGE = 30;
export const DEFAULT_SCROLL_THRESHOLD = 100; // px from edge to trigger load more
