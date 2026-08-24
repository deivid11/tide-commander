import type { AgentClass } from './agent-types.js';

// ============================================================================
// Drawing Types
// ============================================================================

// Drawing tool types
export type DrawingTool = 'rectangle' | 'circle' | 'select' | null;

// Drawing area on the battlefield
export interface DrawingArea {
  id: string;
  name: string;
  type: 'rectangle' | 'circle';
  center: { x: number; z: number };
  width?: number;   // rectangle only
  height?: number;  // rectangle only
  radius?: number;  // circle only
  color: string;    // hex color
  zIndex: number;   // stacking order (higher = on top)
  assignedAgentIds: string[];
  directories: string[];  // Associated directory paths
  prompt?: string;        // Area-level system prompt for assigned agents
  directoryGitCounts?: number[];  // Git pending changes count per directory (runtime only)
  // Logo/image overlay
  logo?: {
    filename: string;              // Stored in ~/.local/share/tide-commander/area-logos/
    position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    width: number;                 // World units
    height: number;                // World units
    keepAspectRatio: boolean;
    opacity?: number;              // 0-1, default 0.8
  };
  // Archive support
  archived?: boolean;              // True if area is hidden from view
  archivedAt?: number;             // Timestamp when archived
  originalCenter?: { x: number; z: number }; // Position before archive (for restore)
}

// ============================================================================
// Claude Code Tools
// ============================================================================

export type ToolName =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Bash'
  | 'Grep'
  | 'Glob'
  | 'WebFetch'
  | 'WebSearch'
  | 'Task'
  | 'TodoWrite'
  | 'AskUserQuestion'
  | 'NotebookEdit'
  | 'Skill';

// ============================================================================
// Skills Types
// ============================================================================

/** Skills pre-selected when spawning a regular or boss agent. */
export const DEFAULT_AGENT_SKILL_SLUGS = [
  'full-notifications',
  'streaming-exec',
  'execute-slash-commands',
  'task-label',
  'report-task-to-boss',
  'agent-tracking',
  'agent-memory',
  'send-message-to-agent',
] as const;

/**
 * Skill - A reusable capability that can be assigned to agents
 *
 * Skills define specific actions/capabilities that agents can perform.
 * They are stored as markdown content that gets injected into the agent's
 * system prompt when assigned, teaching the agent how to perform specific tasks.
 *
 * Based on Claude Code's skill system (.claude/skills/<name>/SKILL.md)
 */
export interface Skill {
  id: string;
  name: string;                    // Display name (e.g., "Git Push")
  slug: string;                    // URL-safe identifier (e.g., "git-push")
  description: string;             // When to use this skill (for model matching)
  content: string;                 // Markdown content with instructions

  // Tool permissions - tools the skill is allowed to use without prompting
  // Format: "Bash(git:*)", "Read", "Edit", etc.
  allowedTools: string[];

  // Optional settings
  model?: string;                  // Specific model to use (e.g., "claude-sonnet-4-20250514")
  context?: 'fork' | 'inline';     // Fork runs in isolated sub-agent, inline in main context

  // Assignment tracking
  assignedAgentIds: string[];      // Agents this skill is assigned to
  assignedAgentClasses: AgentClass[]; // Agent classes that automatically get this skill

  // Metadata
  enabled: boolean;                // Can be disabled without deleting
  builtin?: boolean;               // True = built-in skill, cannot be modified or deleted
  createdAt: number;
  updatedAt: number;
}

// Stored skill (on disk) - same as Skill but explicitly typed
export interface StoredSkill extends Skill {}


// Skill update data for UI notification
export interface SkillUpdateData {
  skills: Array<{
    name: string;
    description: string;
  }>;
}

// ============================================================================
// Claude Code Events
// ============================================================================

export interface BaseEvent {
  id: string;
  timestamp: number;
  sessionId: string;
}

export interface PreToolUseEvent extends BaseEvent {
  type: 'pre_tool_use';
  tool: ToolName;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export interface PostToolUseEvent extends BaseEvent {
  type: 'post_tool_use';
  tool: ToolName;
  toolUseId: string;
  duration?: number;
}

export interface StopEvent extends BaseEvent {
  type: 'stop';
}

export interface UserPromptEvent extends BaseEvent {
  type: 'user_prompt';
  prompt: string;
}

export type ClaudeEvent = PreToolUseEvent | PostToolUseEvent | StopEvent | UserPromptEvent;

// ============================================================================
// Permission Types
// ============================================================================

// Permission request from Claude (via hook)
export interface PermissionRequest {
  id: string;
  agentId: string;
  sessionId: string;
  timestamp: number;
  tool: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  status: 'pending' | 'approved' | 'denied';
  // Human-readable description of what the tool wants to do
  description?: string;
}

// Permission response from user
export interface PermissionResponse {
  requestId: string;
  approved: boolean;
  reason?: string; // Optional reason for denial
  remember?: boolean; // Remember this pattern for future requests
}

// ============================================================================
// Agent Prompt Types
// ============================================================================
// Mirrors the `--permission-prompt-tool` MCP flow: when a bypass-mode agent
// calls AskUserQuestion or ExitPlanMode, the prompt is routed through the UI
// for a real human response instead of being silently auto-answered.

export type AgentPromptTool = 'AskUserQuestion' | 'ExitPlanMode';

export interface AgentPrompt {
  id: string;
  agentId: string;
  tool: AgentPromptTool;
  input: Record<string, unknown>; // questions[] for AskUserQuestion, { plan, planFilePath } for ExitPlanMode
  status: 'pending' | 'answered' | 'cancelled';
  timestamp: number;
}

export interface AgentPromptResponse {
  requestId: string;
  approved: boolean;
  // AskUserQuestion only: keyed by question text, value is the chosen option label
  // (or array of labels for multiSelect, or free-text string).
  answers?: Record<string, string | string[]>;
  reason?: string;
}

// ============================================================================
// Agent Notification Types
// ============================================================================

// Agent notification - sent by agents to notify users
export interface AgentNotification {
  id: string;
  agentId: string;
  agentName: string;
  agentClass: AgentClass;
  title: string;
  message: string;
  timestamp: number;
  // Optional PNG URL shown as the round/large icon on Android (and avatar in-app).
  iconUrl?: string;
  // Optional PNG URL shown as the expanded big-picture on Android.
  imageUrl?: string;
}

// ============================================================================
// Exec Task Types (Streaming Command Execution)
// ============================================================================

// Running exec task state
export interface ExecTask {
  taskId: string;
  agentId: string;
  agentName: string;
  command: string;
  cwd: string;
  status: 'running' | 'completed' | 'failed';
  output: string[];
  startedAt: number;
  completedAt?: number;
  exitCode?: number | null;
  // Command runs under a pseudo-terminal: output chunks are a raw PTY stream
  // (in-place redraws, ANSI) that the client replays through TerminalRenderer.
  pty?: boolean;
  /** tool_use id of the Bash call that issued the /api/exec curl (server-paired);
   * the terminal attaches the live card to that row by identity. */
  toolUseId?: string;
}

// ============================================================================
// Secrets Types
// ============================================================================

/**
 * Secret - A key-value pair for storing sensitive data
 *
 * Secrets are stored securely on disk and can be referenced in agent prompts
 * using placeholders like {{SECRET_NAME}}. The server replaces placeholders
 * with actual values before sending to Claude.
 */
export interface Secret {
  id: string;
  name: string;           // Human-readable name (e.g., "GitHub Token")
  key: string;            // Placeholder key (e.g., "GITHUB_TOKEN") - used as {{GITHUB_TOKEN}}
  value: string;          // The actual secret value
  description?: string;   // Optional description of what this secret is for
  createdAt: number;
  updatedAt: number;
}

// Stored secret (on disk) - same as Secret but explicitly typed
export interface StoredSecret extends Secret {}

