/**
 * Types and constants for the ClaudeOutputPanel component family
 */

// Re-export shared types from common location
export type { HistoryMessage, AttachedFile } from '../shared/outputTypes';
export { MESSAGES_PER_PAGE, DEFAULT_SCROLL_THRESHOLD } from '../shared/outputTypes';

// View modes for the terminal: 'simple' shows tools, 'chat' shows only user/final responses, 'advanced' shows everything
export type ViewMode = 'simple' | 'chat' | 'advanced';
export const VIEW_MODES: ViewMode[] = ['simple', 'chat', 'advanced'];

// Constants for terminal height
export const DEFAULT_TERMINAL_HEIGHT = 55; // percentage
export const MIN_TERMINAL_HEIGHT = 20; // percentage
export const MAX_TERMINAL_HEIGHT = 85; // percentage

// Scroll threshold (use local value for ClaudeOutputPanel, different from shared default)
export const SCROLL_THRESHOLD = 100; // px from top to trigger load more

// Bash command truncation length in simple view
export const BASH_TRUNCATE_LENGTH = 300;

// Parsed boss context structure
export interface ParsedBossContent {
  hasContext: boolean;
  context: string | null;
  userMessage: string;
}

// Delegation block structure
export interface ParsedDelegation {
  selectedAgentId: string;
  selectedAgentName: string;
  taskCommand: string;
  reasoning: string;
  alternativeAgents: Array<{ id: string; name: string; reason?: string }>;
  confidence: 'high' | 'medium' | 'low';
}

export interface ParsedBossResponse {
  hasDelegation: boolean;
  delegations: ParsedDelegation[];  // Now supports multiple delegations
  contentWithoutBlock: string;  // Response text with the ```delegation block removed
}

// Edit tool input structure
export interface EditToolInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

// Diff line structure for side-by-side view
export interface DiffLine {
  num: number;
  text: string;
  type: 'unchanged' | 'added' | 'removed';
}

// Todo item structure for TodoWrite tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Edit data for file viewer
export interface EditData {
  oldString: string;
  newString: string;
}
