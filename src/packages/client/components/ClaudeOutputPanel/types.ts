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
export const MAX_TERMINAL_HEIGHT = 95; // percentage

// Scroll threshold (use local value for ClaudeOutputPanel, different from shared default)
export const SCROLL_THRESHOLD = 200; // px from top to trigger load more

// Bash command truncation length in simple view
export const BASH_TRUNCATE_LENGTH = 300;

// Parsed boss context structure
export interface ParsedBossContent {
  hasContext: boolean;
  context: string | null;
  userMessage: string;
}

// Parsed Codex-injected instruction preamble in a user prompt
export interface ParsedInjectedInstructions {
  hasInstructions: boolean;
  instructions: string | null;
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

// Work plan task structure
export interface WorkPlanTask {
  id: string;
  description: string;
  suggestedClass: string;
  assignToAgent: string | null;
  assignToAgentName: string | null;
  priority: 'high' | 'medium' | 'low';
  blockedBy: string[];
}

// Work plan phase structure
export interface WorkPlanPhase {
  id: string;
  name: string;
  execution: 'sequential' | 'parallel';
  dependsOn: string[];
  tasks: WorkPlanTask[];
}

// Work plan structure
export interface WorkPlan {
  name: string;
  description: string;
  phases: WorkPlanPhase[];
}

// Parsed work plan response
export interface ParsedWorkPlanResponse {
  hasWorkPlan: boolean;
  workPlan: WorkPlan | null;
  contentWithoutBlock: string;
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
  id?: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Edit data for file viewer
export interface EditData {
  oldString: string;
  newString: string;
  operation?: string;
  unifiedDiff?: string;
}

// Enriched history message with linked tool results
export interface EnrichedHistoryMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  timestamp: string;
  uuid?: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  // Enrichment fields
  _bashOutput?: string; // Linked tool_result content for Bash tools
  _bashCommand?: string; // Full bash command for display
  _editData?: EditData; // For Edit tool diffs
  // For AskUserQuestion tool_use: the user's picks resolved from the matching
  // tool_result. Key is the question text, value is the chosen option label
  // (or "label1, label2" for multiSelect).
  _askQuestionAnswers?: Record<string, string>;
  // For TaskUpdate tool_use: the subject of the task referenced by taskId,
  // looked up from the prior TaskCreate result (which has the form
  // "Task #N created successfully: <subject>"). When present, the chip can
  // show the task name instead of just "status: completed".
  _taskSubject?: string;
  // For TaskUpdate tool_use: full snapshot of the harness task list as of this
  // update (built from prior TaskCreate results + TaskUpdate statuses in stream
  // order). When present, the line renders the consolidated Task List card —
  // same look as TodoWrite — instead of a lone status chip.
  _taskSnapshot?: TodoItem[];
  // Running TodoWrite snapshot before this tool_use (Grok merge:true updates
  // only send {id,status} — we resolve content from this prior list).
  _priorTodos?: TodoItem[];
  // For AskUserQuestion / ExitPlanMode tool_use: the matching pending
  // agent-prompt id (= toolUseId). When set, the chip renders an interactive
  // UI inline so the user can answer/approve. Computed in AgentTerminalPane so
  // HistoryLine doesn't have to subscribe to the agentPrompts store itself.
  _pendingPromptId?: string;
}
