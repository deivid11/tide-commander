import type { AgentClass } from './agent-types';

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

// Skill summary for UI lists
interface _SkillSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  assignedCount: number;           // Number of agents using this skill
}

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

// ============================================================================
// Snapshot Types (Conversation Snapshots)
// ============================================================================

/**
 * File captured as part of a snapshot
 * Tracks files that were created or modified during a conversation
 */
export interface SnapshotFile {
  path: string;              // Absolute file path
  relativePath?: string;     // Path relative to agent's cwd
  content: string;           // File content at time of snapshot
  type: 'created' | 'modified'; // Whether file was created or modified
  timestamp: number;         // When the file change was detected
  size: number;              // File size in bytes
}

/**
 * Conversation output - a message from the conversation
 * Simplified version of SessionMessage for snapshot storage
 */
export interface SnapshotOutput {
  /** Unique ID for this output */
  id: string;
  /** Output text content */
  text: string;
  /** Timestamp when output was generated */
  timestamp: number;
  /** Whether this was streaming or complete */
  isStreaming?: boolean;
}

/**
 * Full conversation snapshot
 * Captures the complete state of a conversation including files
 */
export interface ConversationSnapshot {
  id: string;
  agentId: string;
  agentName: string;
  agentClass: AgentClass;

  // User-provided metadata
  title: string;
  description?: string;

  // Conversation content
  outputs: SnapshotOutput[];    // All conversation messages
  sessionId?: string;           // Claude session ID if available

  // Captured files
  files: SnapshotFile[];        // Files created/modified during conversation

  // Context info
  cwd: string;                  // Working directory

  // Timestamps
  createdAt: number;            // When snapshot was created
  conversationStartedAt?: number; // When conversation started (if known)

  // Metadata
  tokensUsed?: number;          // Tokens used at time of snapshot
  contextUsed?: number;         // Context usage at time of snapshot
}

/**
 * Lightweight snapshot item for listing
 * Used in the snapshot manager UI
 */
export interface SnapshotListItem {
  id: string;
  title: string;
  description?: string;
  agentId: string;
  agentName: string;
  agentClass: AgentClass;
  cwd: string;
  createdAt: number;
  fileCount: number;           // Number of files in snapshot
  outputCount: number;         // Number of messages in snapshot
}

/**
 * Request to create a new snapshot
 */
export interface CreateSnapshotRequest {
  agentId: string;
  title: string;
  description?: string;
}

/**
 * Response when snapshot is created
 */
export interface CreateSnapshotResponse {
  success: boolean;
  snapshot?: ConversationSnapshot;
  error?: string;
}

/**
 * Request to restore files from a snapshot
 */
export interface RestoreSnapshotRequest {
  snapshotId: string;
  overwrite?: boolean;         // Whether to overwrite existing files (default: false)
  targetDir?: string;          // Alternative directory to restore to
}

/**
 * Response when files are restored from snapshot
 */
export interface RestoreSnapshotResponse {
  success: boolean;
  restoredFiles: string[];     // Paths of files that were restored
  skippedFiles: string[];      // Paths of files skipped (already exist and overwrite=false)
  error?: string;
}
