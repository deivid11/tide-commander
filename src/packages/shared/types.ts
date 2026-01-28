// Agent Classes - built-in types
export type BuiltInAgentClass = 'scout' | 'builder' | 'debugger' | 'architect' | 'warrior' | 'support' | 'boss';

// AgentClass can be a built-in class or a custom class slug
export type AgentClass = BuiltInAgentClass | string;

export const BUILT_IN_AGENT_CLASSES: Record<BuiltInAgentClass, { icon: string; color: string; description: string }> = {
  scout: { icon: '🔍', color: '#4a9eff', description: 'Codebase exploration, file discovery' },
  builder: { icon: '🔨', color: '#ff9e4a', description: 'Feature implementation, writing code' },
  debugger: { icon: '🐛', color: '#ff4a4a', description: 'Bug hunting, fixing issues' },
  architect: { icon: '📐', color: '#9e4aff', description: 'Planning, design decisions' },
  warrior: { icon: '⚔️', color: '#ff4a9e', description: 'Aggressive refactoring, migrations' },
  support: { icon: '💚', color: '#4aff9e', description: 'Documentation, tests, cleanup' },
  boss: { icon: '👑', color: '#ffd700', description: 'Team leader, delegates tasks to subordinates' },
};

// For backwards compatibility
export const AGENT_CLASSES = BUILT_IN_AGENT_CLASSES;

// Animation mapping for custom models - maps our animation states to model's animation names
export interface AnimationMapping {
  idle?: string;      // Animation name for idle state
  walk?: string;      // Animation name for walking
  working?: string;   // Animation name for working/busy state
}

// Custom Agent Class - user-defined agent types with associated skills
export interface CustomAgentClass {
  id: string;           // Unique identifier (slug)
  name: string;         // Display name
  icon: string;         // Emoji or icon
  color: string;        // Hex color
  description: string;  // What this class does
  defaultSkillIds: string[];  // Skills automatically assigned to agents of this class
  model?: string;       // Built-in character model file (e.g., 'character-male-a.glb')
  customModelPath?: string;  // Path to custom uploaded model (stored in ~/.tide-commander/custom-models/)
  modelScale?: number;       // Scale multiplier for the model (default: 1.0)
  modelOffset?: { x: number; y: number; z: number };  // Position offset for centering the model (x: horizontal, y: depth, z: vertical)
  animationMapping?: AnimationMapping;  // Maps our states to model's animation names
  availableAnimations?: string[];  // List of animations detected in the custom model
  instructions?: string; // Markdown instructions injected as system prompt (like CLAUDE.md)
  createdAt: number;
  updatedAt: number;
}

// Agent Status
// 'orphaned' = Claude process is running but agent state is out of sync (e.g., shows idle when actually working)
export type AgentStatus = 'idle' | 'working' | 'waiting' | 'waiting_permission' | 'error' | 'offline' | 'orphaned';

// Permission Mode - controls how Claude asks for permissions
export type PermissionMode = 'bypass' | 'interactive';

export const PERMISSION_MODES: Record<PermissionMode, { label: string; description: string }> = {
  bypass: { label: 'Permissionless', description: 'Skip all permission prompts (less safe, faster)' },
  interactive: { label: 'Interactive', description: 'Ask for approval before sensitive operations' },
};

// Claude Model - which AI model to use
export type ClaudeModel = 'sonnet' | 'opus' | 'haiku';

export const CLAUDE_MODELS: Record<ClaudeModel, { label: string; description: string; icon: string }> = {
  sonnet: { label: 'Sonnet', description: 'Balanced performance and cost (recommended)', icon: '⚡' },
  opus: { label: 'Opus', description: 'Most capable, higher cost', icon: '🧠' },
  haiku: { label: 'Haiku', description: 'Fast and economical', icon: '🚀' },
};

// Detailed context statistics from Claude's /context command
export interface ContextStats {
  // Model info
  model: string;                 // Model name
  contextWindow: number;         // Model's context window size (e.g., 200000)

  // Total usage
  totalTokens: number;           // Total tokens used
  usedPercent: number;           // Percentage of context used

  // Category breakdown (from /context command)
  categories: {
    systemPrompt: { tokens: number; percent: number };
    systemTools: { tokens: number; percent: number };
    messages: { tokens: number; percent: number };
    freeSpace: { tokens: number; percent: number };
    autocompactBuffer: { tokens: number; percent: number };
  };

  // Timestamp
  lastUpdated: number;
}

// Global Claude API Usage Stats (from /usage command)
export interface UsageCategory {
  percentUsed: number;      // Percentage of limit used (e.g., 45.2)
  resetTime: string;        // When the limit resets (e.g., "Jan 25 at 5:00 PM")
}

export interface GlobalUsageStats {
  // Current session usage
  session: UsageCategory;

  // Weekly usage - all models combined
  weeklyAllModels: UsageCategory;

  // Weekly usage - Sonnet only
  weeklySonnet: UsageCategory;

  // Source agent that provided this data
  sourceAgentId: string;
  sourceAgentName: string;

  // Timestamp
  lastUpdated: number;
}

// Agent State
export interface Agent {
  id: string;
  name: string;
  class: AgentClass;
  status: AgentStatus;

  // Position on battlefield (3D coordinates)
  position: { x: number; y: number; z: number };

  // Claude Code session
  sessionId?: string;
  cwd: string;
  useChrome?: boolean; // Start with --chrome flag
  permissionMode: PermissionMode; // How permissions are handled
  model?: ClaudeModel; // Claude model to use (sonnet, opus, haiku)

  // Resources
  tokensUsed: number;
  contextUsed: number;      // Current context window usage
  contextLimit: number;     // Model's context limit (default 200k)

  // Detailed context stats (from Claude's stream-json modelUsage)
  contextStats?: ContextStats;

  // Current task
  currentTask?: string;
  currentTool?: string;

  // Last assigned task - the original user prompt/task (persists even when idle)
  lastAssignedTask?: string;
  lastAssignedTaskTime?: number;

  // Task counter - number of user messages/commands sent to this agent
  taskCount: number;

  // Timestamps
  createdAt: number;
  lastActivity: number;

  // Boss-specific fields
  isBoss?: boolean;                    // True if this agent can manage subordinates
  subordinateIds?: string[];           // IDs of agents under this boss
  bossId?: string;                     // ID of the boss this agent reports to (if any)

  // Custom instructions appended to the agent's class system prompt
  customInstructions?: string;
}

// Drawing tool types
export type DrawingTool = 'rectangle' | 'circle' | 'select' | null;

// ============================================================================
// Boss Agent Types
// ============================================================================

// Delegation decision record - tracks how boss routed a command
export interface DelegationDecision {
  id: string;
  timestamp: number;
  bossId: string;
  userCommand: string;              // Original command from user
  selectedAgentId: string;
  selectedAgentName: string;
  reasoning: string;                // LLM's explanation for the choice
  alternativeAgents: string[];      // Other agents that were considered
  confidence: 'high' | 'medium' | 'low';
  status: 'pending' | 'sent' | 'completed' | 'failed';
}

// Context about a subordinate for delegation decision
export interface SubordinateContext {
  id: string;
  name: string;
  class: AgentClass;
  status: AgentStatus;
  currentTask?: string;
  lastAssignedTask?: string;
  recentSupervisorSummary?: string;  // Latest supervisor analysis
  contextPercent: number;            // Context usage percentage
  tokensUsed: number;
}

// Boss context delimiters - used to inject subordinate context at the beginning of user messages
// The frontend detects these to collapse/hide the context section in the UI
export const BOSS_CONTEXT_START = '<<<BOSS_CONTEXT_START>>>';
export const BOSS_CONTEXT_END = '<<<BOSS_CONTEXT_END>>>';

// ============================================================================
// Work Plan Types (Boss Agent Planning)
// ============================================================================

// Task priority levels
export type TaskPriority = 'high' | 'medium' | 'low';

// Task status in a work plan
export type WorkPlanTaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

// Phase execution mode
export type PhaseExecutionMode = 'sequential' | 'parallel';

// Individual task within a work plan phase
export interface WorkPlanTask {
  id: string;
  description: string;
  suggestedClass: AgentClass;           // Recommended agent class for this task
  assignedAgentId: string | null;       // Assigned agent (null = auto-assign)
  assignedAgentName?: string;           // Name of assigned agent (for display)
  priority: TaskPriority;
  blockedBy: string[];                  // Task IDs that must complete first
  status: WorkPlanTaskStatus;
  result?: string;                      // Summary of task outcome when completed
  startedAt?: number;
  completedAt?: number;
}

// Phase within a work plan (groups related tasks)
export interface WorkPlanPhase {
  id: string;
  name: string;
  description?: string;
  execution: PhaseExecutionMode;        // How tasks in this phase run
  dependsOn: string[];                  // Phase IDs that must complete first
  tasks: WorkPlanTask[];
  status: WorkPlanTaskStatus;
  startedAt?: number;
  completedAt?: number;
}

// Complete work plan created by Boss agent
export interface WorkPlan {
  id: string;
  name: string;
  description: string;
  phases: WorkPlanPhase[];
  createdBy: string;                    // Boss agent ID
  createdAt: number;
  updatedAt: number;
  status: 'draft' | 'approved' | 'executing' | 'paused' | 'completed' | 'cancelled';
  // Summary fields for quick overview
  totalTasks: number;
  completedTasks: number;
  parallelizableTasks: string[];        // Task IDs that can run in parallel
}

// Analysis request - Boss asks scouts to explore codebase
export interface AnalysisRequest {
  id: string;
  targetAgentId: string;                // Scout agent to perform analysis
  targetAgentName?: string;
  query: string;                        // What to analyze
  focus?: string[];                     // Specific areas to focus on
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;                      // Analysis results when completed
  requestedAt: number;
  completedAt?: number;
}

// Work plan created from Boss response (parsed from ```work-plan block)
export interface WorkPlanDraft {
  name: string;
  description: string;
  phases: {
    id: string;
    name: string;
    execution: PhaseExecutionMode;
    dependsOn: string[];
    tasks: {
      id: string;
      description: string;
      suggestedClass: string;
      assignToAgent: string | null;     // Agent ID or null for auto-assign
      priority: TaskPriority;
      blockedBy: string[];
    }[];
  }[];
}

// Analysis request from Boss response (parsed from ```analysis-request block)
export interface AnalysisRequestDraft {
  targetAgent: string;                  // Agent ID
  query: string;
  focus?: string[];
}

// ============================================================================
// Building Types
// ============================================================================

// Building types - different kinds of buildings
export type BuildingType = 'server' | 'link' | 'database' | 'docker' | 'monitor' | 'folder' | 'boss';

export const BUILDING_TYPES: Record<BuildingType, { icon: string; color: string; description: string }> = {
  server: { icon: '🖥️', color: '#4aff9e', description: 'Service with start/stop commands and logs' },
  link: { icon: '🔗', color: '#4a9eff', description: 'Quick links to URLs' },
  database: { icon: '🗄️', color: '#ff9e4a', description: 'Database connection and queries' },
  docker: { icon: '🐳', color: '#4ac1ff', description: 'Docker container management' },
  monitor: { icon: '📊', color: '#ff4a9e', description: 'System metrics and monitoring' },
  folder: { icon: '📁', color: '#ffd700', description: 'Folder shortcut - opens file explorer on click' },
  boss: { icon: '👑', color: '#ffd700', description: 'Boss building - manages multiple buildings with unified controls' },
};

// Building status
export type BuildingStatus = 'running' | 'stopped' | 'error' | 'unknown' | 'starting' | 'stopping';

// Building visual styles
export type BuildingStyle = 'server-rack' | 'tower' | 'dome' | 'pyramid' | 'desktop' | 'filing-cabinet' | 'satellite' | 'crystal' | 'factory' | 'command-center';

export const BUILDING_STYLES: Record<BuildingStyle, { label: string; description: string }> = {
  'server-rack': { label: 'Server Rack', description: 'Classic server rack with blinking LEDs' },
  'tower': { label: 'Control Tower', description: 'Tall tower with rotating antenna' },
  'dome': { label: 'Data Dome', description: 'Futuristic dome with energy ring' },
  'pyramid': { label: 'Power Pyramid', description: 'Egyptian-style pyramid with glowing core' },
  'desktop': { label: 'Desktop PC', description: 'Retro computer with monitor and keyboard' },
  'filing-cabinet': { label: 'Filing Cabinet', description: 'Office cabinet with sliding drawers' },
  'satellite': { label: 'Satellite Dish', description: 'Communication dish with rotating receiver' },
  'crystal': { label: 'Data Crystal', description: 'Floating crystal with energy particles' },
  'factory': { label: 'Mini Factory', description: 'Industrial building with smoking chimney' },
  'command-center': { label: 'Command Center', description: 'Grand central hub for boss buildings with holographic rings' },
};

// PM2 Configuration for buildings
export interface PM2Config {
  enabled: boolean;           // Use PM2 vs custom commands
  name?: string;              // PM2 app name (defaults to sanitized building name + id)
  script: string;             // Script/command to run (e.g., "npm", "java", "./app.js")
  args?: string;              // Arguments (e.g., "run dev", "-jar app.jar")
  interpreter?: PM2Interpreter; // Interpreter to use
  interpreterArgs?: string;   // e.g., "-jar" for java
  env?: Record<string, string>; // Environment variables
  instances?: number;         // Cluster mode (default: 1)
  autorestart?: boolean;      // Auto-restart on crash (default: true)
  maxRestarts?: number;       // Max restart attempts (default: 10)
}

// PM2 interpreter options
export type PM2Interpreter = 'node' | 'bun' | 'python3' | 'python' | 'java' | 'php' | 'bash' | 'none' | '';

export const PM2_INTERPRETERS: Record<PM2Interpreter, { label: string; description: string }> = {
  '': { label: 'Auto-detect', description: 'Let PM2 detect the interpreter' },
  'node': { label: 'Node.js', description: 'JavaScript/TypeScript runtime' },
  'bun': { label: 'Bun', description: 'Bun JavaScript runtime' },
  'python3': { label: 'Python 3', description: 'Python 3 interpreter' },
  'python': { label: 'Python 2', description: 'Python 2 interpreter (legacy)' },
  'java': { label: 'Java', description: 'Java runtime (use with -jar args)' },
  'php': { label: 'PHP', description: 'PHP interpreter' },
  'bash': { label: 'Bash', description: 'Bash shell script' },
  'none': { label: 'None (Binary)', description: 'Direct execution (compiled binaries)' },
};

// PM2 runtime status (not persisted, updated via polling)
export interface PM2Status {
  pm2Id?: number;             // PM2 internal ID
  pid?: number;               // System PID
  cpu?: number;               // CPU usage %
  memory?: number;            // Memory in bytes
  uptime?: number;            // Process start timestamp
  restarts?: number;          // Restart count
  status?: string;            // PM2 status: 'online' | 'stopping' | 'stopped' | 'errored'
  ports?: number[];           // Auto-detected listening ports
}

// Building configuration
export interface Building {
  id: string;
  name: string;
  type: BuildingType;
  style: BuildingStyle;

  // Position on battlefield
  position: { x: number; z: number };

  // Status
  status: BuildingStatus;
  lastHealthCheck?: number;
  lastError?: string;

  // Commands (for server type) - used when PM2 is disabled
  commands?: {
    start?: string;
    stop?: string;
    restart?: string;
    healthCheck?: string;
    logs?: string;
  };

  // Working directory for commands
  cwd?: string;

  // PM2 configuration (optional - when enabled, replaces custom commands)
  pm2?: PM2Config;

  // PM2 runtime status (not persisted, populated at runtime)
  pm2Status?: PM2Status;

  // Folder path (for folder type - opens file explorer when clicked)
  folderPath?: string;

  // Links (for link type, but can be used by any)
  urls?: { label: string; url: string }[];

  // Visual customization
  color?: string;
  scale?: number;  // Size multiplier (default: 1.0)

  // Boss building fields - for managing subordinate buildings
  subordinateBuildingIds?: string[];  // IDs of buildings managed by this boss building

  // Timestamps
  createdAt: number;
  lastActivity?: number;
}

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
  assignedAgentIds: string[];
  directories: string[];  // Associated directory paths
}

// Claude Code Tools
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
export interface SkillSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  assignedCount: number;           // Number of agents using this skill
}

// Events from Claude Code hooks
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

// WebSocket Messages
export interface WSMessage {
  type: string;
  payload?: unknown;
}

// Server -> Client messages
export interface AgentsUpdateMessage extends WSMessage {
  type: 'agents_update';
  payload: Agent[];
}

export interface AgentCreatedMessage extends WSMessage {
  type: 'agent_created';
  payload: Agent;
}

export interface AgentUpdatedMessage extends WSMessage {
  type: 'agent_updated';
  payload: Agent;
}

export interface AgentDeletedMessage extends WSMessage {
  type: 'agent_deleted';
  payload: { id: string };
}

export interface EventMessage extends WSMessage {
  type: 'event';
  payload: ClaudeEvent & { agentId: string };
}

export interface ActivityMessage extends WSMessage {
  type: 'activity';
  payload: {
    agentId: string;
    agentName: string;
    message: string;
    timestamp: number;
  };
}

// Skill update data for UI notification
export interface SkillUpdateData {
  skills: Array<{
    name: string;
    description: string;
  }>;
}

// Streaming output from Claude
export interface OutputMessage extends WSMessage {
  type: 'output';
  payload: {
    agentId: string;
    text: string;
    isStreaming: boolean;
    timestamp: number;
    isDelegation?: boolean; // True if this is a delegation message from a boss agent
    skillUpdate?: SkillUpdateData; // Skill update notification (UI only, not injected into conversation)
  };
}

// Context stats response (detailed breakdown from /context command)
export interface ContextStatsMessage extends WSMessage {
  type: 'context_stats';
  payload: {
    agentId: string;
    stats: ContextStats;
  };
}

// Client -> Server messages
export interface SpawnAgentMessage extends WSMessage {
  type: 'spawn_agent';
  payload: {
    name: string;
    class: AgentClass;
    cwd: string;
    position?: { x: number; y: number; z: number };
    sessionId?: string;
    useChrome?: boolean;
    permissionMode?: PermissionMode; // defaults to 'bypass' for backwards compatibility
    initialSkillIds?: string[]; // Skills to assign on creation
    model?: ClaudeModel; // Claude model to use (defaults to sonnet)
    customInstructions?: string;  // Custom instructions to append to system prompt
  };
}

export interface SendCommandMessage extends WSMessage {
  type: 'send_command';
  payload: {
    agentId: string;
    command: string;
  };
}

export interface MoveAgentMessage extends WSMessage {
  type: 'move_agent';
  payload: {
    agentId: string;
    position: { x: number; y: number; z: number };
  };
}

export interface KillAgentMessage extends WSMessage {
  type: 'kill_agent';
  payload: {
    agentId: string;
  };
}

// Stop current operation (but keep agent alive)
export interface StopAgentMessage extends WSMessage {
  type: 'stop_agent';
  payload: {
    agentId: string;
  };
}

// Clear agent's context/session (force new session on next command)
export interface ClearContextMessage extends WSMessage {
  type: 'clear_context';
  payload: {
    agentId: string;
  };
}

// Collapse context (compact the session to save tokens)
export interface CollapseContextMessage extends WSMessage {
  type: 'collapse_context';
  payload: {
    agentId: string;
  };
}

// Request detailed context stats (triggers /context command)
export interface RequestContextStatsMessage extends WSMessage {
  type: 'request_context_stats';
  payload: {
    agentId: string;
  };
}

export interface CreateDirectoryMessage extends WSMessage {
  type: 'create_directory';
  payload: {
    path: string;
    name: string;
    class: AgentClass;
  };
}

// Remove agent from UI and persistence (keeps Claude session running)
export interface RemoveAgentMessage extends WSMessage {
  type: 'remove_agent';
  payload: {
    agentId: string;
  };
}

// Rename agent
export interface RenameAgentMessage extends WSMessage {
  type: 'rename_agent';
  payload: {
    agentId: string;
    name: string;
  };
}

// Update agent properties (class, permission mode, skills, model)
export interface UpdateAgentPropertiesMessage extends WSMessage {
  type: 'update_agent_properties';
  payload: {
    agentId: string;
    updates: {
      class?: AgentClass;
      permissionMode?: PermissionMode;
      model?: ClaudeModel;
      skillIds?: string[];  // Complete list of skill IDs to assign (replaces existing)
    };
  };
}

export interface ErrorMessage extends WSMessage {
  type: 'error';
  payload: { message: string };
}

// Command started message - sent when a command begins execution
export interface CommandStartedMessage extends WSMessage {
  type: 'command_started';
  payload: {
    agentId: string;
    command: string;
  };
}

// Directory not found error - prompts user to create directory
export interface DirectoryNotFoundMessage extends WSMessage {
  type: 'directory_not_found';
  payload: {
    path: string;
    name: string;
    class: AgentClass;
  };
}

// ============================================================================
// Areas Types
// ============================================================================

// Areas sync message (Server -> Client) - sent on connect and when areas change
export interface AreasUpdateMessage extends WSMessage {
  type: 'areas_update';
  payload: DrawingArea[];
}

// Sync areas message (Client -> Server) - sent when client modifies areas
export interface SyncAreasMessage extends WSMessage {
  type: 'sync_areas';
  payload: DrawingArea[];
}

// ============================================================================
// Supervisor Types
// ============================================================================

// Activity narrative - human-readable description of agent work
export interface ActivityNarrative {
  id: string;
  agentId: string;
  timestamp: number;
  type: 'tool_use' | 'task_start' | 'task_complete' | 'error' | 'thinking' | 'output';
  narrative: string;
  toolName?: string;
}

// Agent status summary for supervisor
export interface AgentStatusSummary {
  id: string;
  name: string;
  class: AgentClass;
  status: AgentStatus;
  currentTask?: string;
  lastAssignedTask?: string;
  lastAssignedTaskTime?: number;
  recentNarratives: ActivityNarrative[];
  tokensUsed: number;
  contextUsed: number;
  lastActivityTime: number;
}

// Agent analysis from Claude
export interface AgentAnalysis {
  agentId: string;
  agentName: string;
  statusDescription: string;
  progress: 'on_track' | 'stalled' | 'blocked' | 'completed' | 'idle';
  recentWorkSummary: string;
  currentFocus?: string;
  blockers?: string[];
  suggestions?: string[];
  filesModified?: string[];
  concerns?: string[];
}

// Supervisor report from Claude
export interface SupervisorReport {
  id: string;
  timestamp: number;
  agentSummaries: AgentAnalysis[];
  overallStatus: 'healthy' | 'attention_needed' | 'critical';
  insights: string[];
  recommendations: string[];
  rawResponse?: string;
}

// Supervisor configuration
export interface SupervisorConfig {
  enabled: boolean;
  intervalMs: number;
  maxNarrativesPerAgent: number;
  customPrompt?: string;
  autoReportOnComplete?: boolean; // Generate report when agent completes task (default: false)
}

// Agent supervisor history entry - a snapshot of supervisor's analysis for a specific agent
export interface AgentSupervisorHistoryEntry {
  id: string;
  timestamp: number;
  reportId: string;  // ID of the full SupervisorReport this came from
  analysis: AgentAnalysis;
}

// Agent supervisor history - all supervisor analyses for a specific agent
export interface AgentSupervisorHistory {
  agentId: string;
  entries: AgentSupervisorHistoryEntry[];
}

// Supervisor WebSocket messages (Server -> Client)
export interface SupervisorReportMessage extends WSMessage {
  type: 'supervisor_report';
  payload: SupervisorReport;
}

export interface SupervisorStatusMessage extends WSMessage {
  type: 'supervisor_status';
  payload: {
    enabled: boolean;
    lastReportTime: number | null;
    nextReportTime: number | null;
  };
}

export interface NarrativeUpdateMessage extends WSMessage {
  type: 'narrative_update';
  payload: {
    agentId: string;
    narrative: ActivityNarrative;
  };
}

export interface AgentSupervisorHistoryMessage extends WSMessage {
  type: 'agent_supervisor_history';
  payload: AgentSupervisorHistory;
}

export interface AgentAnalysisMessage extends WSMessage {
  type: 'agent_analysis';
  payload: {
    agentId: string;
    analysis: AgentAnalysis;
  };
}

// Global Usage WebSocket messages
export interface GlobalUsageMessage extends WSMessage {
  type: 'global_usage';
  payload: GlobalUsageStats | null;
}

export interface RequestGlobalUsageMessage extends WSMessage {
  type: 'request_global_usage';
  payload: Record<string, never>;
}

// Supervisor WebSocket messages (Client -> Server)
export interface SetSupervisorConfigMessage extends WSMessage {
  type: 'set_supervisor_config';
  payload: Partial<SupervisorConfig>;
}

export interface RequestSupervisorReportMessage extends WSMessage {
  type: 'request_supervisor_report';
  payload: Record<string, never>;
}

export interface RequestAgentSupervisorHistoryMessage extends WSMessage {
  type: 'request_agent_supervisor_history';
  payload: {
    agentId: string;
  };
}

// ============================================================================
// Building WebSocket Messages
// ============================================================================

// Buildings sync message (Server -> Client)
export interface BuildingsUpdateMessage extends WSMessage {
  type: 'buildings_update';
  payload: Building[];
}

// Building created message (Server -> Client)
export interface BuildingCreatedMessage extends WSMessage {
  type: 'building_created';
  payload: Building;
}

// Building updated message (Server -> Client)
export interface BuildingUpdatedMessage extends WSMessage {
  type: 'building_updated';
  payload: Building;
}

// Building deleted message (Server -> Client)
export interface BuildingDeletedMessage extends WSMessage {
  type: 'building_deleted';
  payload: { id: string };
}

// Building logs message (Server -> Client)
export interface BuildingLogsMessage extends WSMessage {
  type: 'building_logs';
  payload: {
    buildingId: string;
    logs: string;
    timestamp: number;
  };
}

// Sync buildings message (Client -> Server)
export interface SyncBuildingsMessage extends WSMessage {
  type: 'sync_buildings';
  payload: Building[];
}

// Create building message (Client -> Server)
export interface CreateBuildingMessage extends WSMessage {
  type: 'create_building';
  payload: Omit<Building, 'id' | 'createdAt' | 'status'> & { status?: BuildingStatus };
}

// Update building message (Client -> Server)
export interface UpdateBuildingMessage extends WSMessage {
  type: 'update_building';
  payload: { id: string; updates: Partial<Building> };
}

// Delete building message (Client -> Server)
export interface DeleteBuildingMessage extends WSMessage {
  type: 'delete_building';
  payload: { id: string };
}

// Building command message (Client -> Server) - start/stop/restart/logs/delete
export interface BuildingCommandMessage extends WSMessage {
  type: 'building_command';
  payload: {
    buildingId: string;
    command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs' | 'delete';
  };
}

// PM2 Log Streaming Messages
// Start streaming logs (Client -> Server)
export interface PM2LogsStartMessage extends WSMessage {
  type: 'pm2_logs_start';
  payload: {
    buildingId: string;
    lines?: number; // Initial lines to fetch (default 100)
  };
}

// Stop streaming logs (Client -> Server)
export interface PM2LogsStopMessage extends WSMessage {
  type: 'pm2_logs_stop';
  payload: {
    buildingId: string;
  };
}

// Log chunk from streaming (Server -> Client)
export interface PM2LogsChunkMessage extends WSMessage {
  type: 'pm2_logs_chunk';
  payload: {
    buildingId: string;
    chunk: string;
    timestamp: number;
    isError?: boolean; // stderr vs stdout
  };
}

// Streaming started confirmation (Server -> Client)
export interface PM2LogsStreamingMessage extends WSMessage {
  type: 'pm2_logs_streaming';
  payload: {
    buildingId: string;
    streaming: boolean;
  };
}

// ============================================================================
// Boss Building WebSocket Messages
// ============================================================================

// Boss building bulk command message (Client -> Server) - start all/stop all/restart all
export interface BossBuildingCommandMessage extends WSMessage {
  type: 'boss_building_command';
  payload: {
    buildingId: string;  // The boss building ID
    command: 'start_all' | 'stop_all' | 'restart_all';
  };
}

// Assign buildings to boss (Client -> Server)
export interface AssignBuildingsMessage extends WSMessage {
  type: 'assign_buildings';
  payload: {
    bossBuildingId: string;
    subordinateBuildingIds: string[];
  };
}

// Request unified logs from boss building (Client -> Server)
export interface BossBuildingLogsStartMessage extends WSMessage {
  type: 'boss_building_logs_start';
  payload: {
    buildingId: string;  // The boss building ID
    lines?: number;      // Initial lines to fetch per subordinate (default 50)
  };
}

// Stop streaming unified logs (Client -> Server)
export interface BossBuildingLogsStopMessage extends WSMessage {
  type: 'boss_building_logs_stop';
  payload: {
    buildingId: string;
  };
}

// Unified log chunk from boss building (Server -> Client)
export interface BossBuildingLogsChunkMessage extends WSMessage {
  type: 'boss_building_logs_chunk';
  payload: {
    bossBuildingId: string;
    subordinateBuildingId: string;
    subordinateBuildingName: string;
    chunk: string;
    timestamp: number;
    isError?: boolean;
  };
}

// Boss building subordinates updated (Server -> Client)
export interface BossBuildingSubordinatesUpdatedMessage extends WSMessage {
  type: 'boss_building_subordinates_updated';
  payload: {
    bossBuildingId: string;
    subordinateBuildingIds: string[];
  };
}

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

// Permission WebSocket messages (Server -> Client)
export interface PermissionRequestMessage extends WSMessage {
  type: 'permission_request';
  payload: PermissionRequest;
}

export interface PermissionResolvedMessage extends WSMessage {
  type: 'permission_resolved';
  payload: {
    requestId: string;
    approved: boolean;
  };
}

// Permission WebSocket messages (Client -> Server)
export interface PermissionResponseMessage extends WSMessage {
  type: 'permission_response';
  payload: PermissionResponse;
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

// Agent notification message (Server -> Client)
export interface AgentNotificationMessage extends WSMessage {
  type: 'agent_notification';
  payload: AgentNotification;
}

// Send notification request (Client -> Server, from agent via skill)
export interface SendNotificationMessage extends WSMessage {
  type: 'send_notification';
  payload: {
    agentId: string;
    title: string;
    message: string;
  };
}

// ============================================================================
// Boss Agent WebSocket Messages
// ============================================================================

// Spawn a boss agent (Client -> Server)
export interface SpawnBossAgentMessage extends WSMessage {
  type: 'spawn_boss_agent';
  payload: {
    name: string;
    class?: AgentClass;  // Boss class (default: 'boss')
    cwd: string;
    position?: { x: number; y: number; z: number };
    subordinateIds?: string[];  // Initial subordinates (optional)
    useChrome?: boolean;
    permissionMode?: PermissionMode;
    model?: ClaudeModel; // Claude model to use (defaults to sonnet)
    customInstructions?: string;  // Custom instructions to append to system prompt
    initialSkillIds?: string[];  // Initial skills to assign to the boss
  };
}

// Assign subordinates to a boss (Client -> Server)
export interface AssignSubordinatesMessage extends WSMessage {
  type: 'assign_subordinates';
  payload: {
    bossId: string;
    subordinateIds: string[];
  };
}

// Remove subordinate from boss (Client -> Server)
export interface RemoveSubordinateMessage extends WSMessage {
  type: 'remove_subordinate';
  payload: {
    bossId: string;
    subordinateId: string;
  };
}

// Send command to boss for delegation (Client -> Server)
export interface SendBossCommandMessage extends WSMessage {
  type: 'send_boss_command';
  payload: {
    bossId: string;
    command: string;
  };
}

// Request delegation history (Client -> Server)
export interface RequestDelegationHistoryMessage extends WSMessage {
  type: 'request_delegation_history';
  payload: {
    bossId: string;
  };
}

// Delegation decision notification (Server -> Client)
export interface DelegationDecisionMessage extends WSMessage {
  type: 'delegation_decision';
  payload: DelegationDecision;
}

// Boss subordinates updated (Server -> Client)
export interface BossSubordinatesUpdatedMessage extends WSMessage {
  type: 'boss_subordinates_updated';
  payload: {
    bossId: string;
    subordinateIds: string[];
  };
}

// Delegation history response (Server -> Client)
export interface DelegationHistoryMessage extends WSMessage {
  type: 'delegation_history';
  payload: {
    bossId: string;
    decisions: DelegationDecision[];
  };
}

// Boss spawned agent notification (Server -> Client)
// Used when a boss spawns a subordinate - client should NOT auto-select and should walk to boss
export interface BossSpawnedAgentMessage extends WSMessage {
  type: 'boss_spawned_agent';
  payload: {
    agent: Agent;
    bossId: string;
    bossPosition: { x: number; y: number; z: number };
  };
}

// Agent task started notification (Server -> Client)
// Sent when a subordinate starts working on a delegated task
export interface AgentTaskStartedMessage extends WSMessage {
  type: 'agent_task_started';
  payload: {
    bossId: string;
    subordinateId: string;
    subordinateName: string;
    taskDescription: string;
  };
}

// Agent task output notification (Server -> Client)
// Streaming output from a subordinate working on a delegated task
export interface AgentTaskOutputMessage extends WSMessage {
  type: 'agent_task_output';
  payload: {
    bossId: string;
    subordinateId: string;
    output: string;
  };
}

// Agent task completed notification (Server -> Client)
// Sent when a subordinate completes a delegated task
export interface AgentTaskCompletedMessage extends WSMessage {
  type: 'agent_task_completed';
  payload: {
    bossId: string;
    subordinateId: string;
    success: boolean;
  };
}

// ============================================================================
// Work Plan WebSocket Messages
// ============================================================================

// Work plan created (Server -> Client)
export interface WorkPlanCreatedMessage extends WSMessage {
  type: 'work_plan_created';
  payload: WorkPlan;
}

// Work plan updated (Server -> Client)
export interface WorkPlanUpdatedMessage extends WSMessage {
  type: 'work_plan_updated';
  payload: WorkPlan;
}

// Work plan deleted (Server -> Client)
export interface WorkPlanDeletedMessage extends WSMessage {
  type: 'work_plan_deleted';
  payload: { id: string };
}

// Work plans sync (Server -> Client) - sent on connect
export interface WorkPlansUpdateMessage extends WSMessage {
  type: 'work_plans_update';
  payload: WorkPlan[];
}

// Analysis request created (Server -> Client)
export interface AnalysisRequestCreatedMessage extends WSMessage {
  type: 'analysis_request_created';
  payload: AnalysisRequest;
}

// Analysis request completed (Server -> Client)
export interface AnalysisRequestCompletedMessage extends WSMessage {
  type: 'analysis_request_completed';
  payload: AnalysisRequest;
}

// Approve work plan (Client -> Server)
export interface ApproveWorkPlanMessage extends WSMessage {
  type: 'approve_work_plan';
  payload: {
    planId: string;
    autoExecute?: boolean;  // Start execution immediately after approval
  };
}

// Execute work plan (Client -> Server)
export interface ExecuteWorkPlanMessage extends WSMessage {
  type: 'execute_work_plan';
  payload: {
    planId: string;
  };
}

// Pause work plan (Client -> Server)
export interface PauseWorkPlanMessage extends WSMessage {
  type: 'pause_work_plan';
  payload: {
    planId: string;
  };
}

// Cancel work plan (Client -> Server)
export interface CancelWorkPlanMessage extends WSMessage {
  type: 'cancel_work_plan';
  payload: {
    planId: string;
  };
}

// Request work plans for a boss (Client -> Server)
export interface RequestWorkPlansMessage extends WSMessage {
  type: 'request_work_plans';
  payload: {
    bossId: string;
  };
}

// ============================================================================
// Skill WebSocket Messages
// ============================================================================

// Skills sync message (Server -> Client) - sent on connect and when skills change
export interface SkillsUpdateMessage extends WSMessage {
  type: 'skills_update';
  payload: Skill[];
}

// Skill created message (Server -> Client)
export interface SkillCreatedMessage extends WSMessage {
  type: 'skill_created';
  payload: Skill;
}

// Skill updated message (Server -> Client)
export interface SkillUpdatedMessage extends WSMessage {
  type: 'skill_updated';
  payload: Skill;
}

// Skill deleted message (Server -> Client)
export interface SkillDeletedMessage extends WSMessage {
  type: 'skill_deleted';
  payload: { id: string };
}

// Create skill message (Client -> Server)
export interface CreateSkillMessage extends WSMessage {
  type: 'create_skill';
  payload: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>;
}

// Update skill message (Client -> Server)
export interface UpdateSkillMessage extends WSMessage {
  type: 'update_skill';
  payload: { id: string; updates: Partial<Skill> };
}

// Delete skill message (Client -> Server)
export interface DeleteSkillMessage extends WSMessage {
  type: 'delete_skill';
  payload: { id: string };
}

// Assign skill to agent (Client -> Server)
export interface AssignSkillMessage extends WSMessage {
  type: 'assign_skill';
  payload: {
    skillId: string;
    agentId: string;
  };
}

// Unassign skill from agent (Client -> Server)
export interface UnassignSkillMessage extends WSMessage {
  type: 'unassign_skill';
  payload: {
    skillId: string;
    agentId: string;
  };
}

// Request skills for an agent (Client -> Server)
export interface RequestAgentSkillsMessage extends WSMessage {
  type: 'request_agent_skills';
  payload: {
    agentId: string;
  };
}

// Agent skills response (Server -> Client)
export interface AgentSkillsMessage extends WSMessage {
  type: 'agent_skills';
  payload: {
    agentId: string;
    skills: Skill[];
  };
}

// ============================================================================
// Custom Agent Class WebSocket Messages
// ============================================================================

// Custom agent classes sync message (Server -> Client)
export interface CustomAgentClassesUpdateMessage extends WSMessage {
  type: 'custom_agent_classes_update';
  payload: CustomAgentClass[];
}

// Custom agent class created message (Server -> Client)
export interface CustomAgentClassCreatedMessage extends WSMessage {
  type: 'custom_agent_class_created';
  payload: CustomAgentClass;
}

// Custom agent class updated message (Server -> Client)
export interface CustomAgentClassUpdatedMessage extends WSMessage {
  type: 'custom_agent_class_updated';
  payload: CustomAgentClass;
}

// Custom agent class deleted message (Server -> Client)
export interface CustomAgentClassDeletedMessage extends WSMessage {
  type: 'custom_agent_class_deleted';
  payload: { id: string };
}

// Create custom agent class message (Client -> Server)
export interface CreateCustomAgentClassMessage extends WSMessage {
  type: 'create_custom_agent_class';
  payload: Omit<CustomAgentClass, 'id' | 'createdAt' | 'updatedAt'>;
}

// Update custom agent class message (Client -> Server)
export interface UpdateCustomAgentClassMessage extends WSMessage {
  type: 'update_custom_agent_class';
  payload: { id: string; updates: Partial<CustomAgentClass> };
}

// Delete custom agent class message (Client -> Server)
export interface DeleteCustomAgentClassMessage extends WSMessage {
  type: 'delete_custom_agent_class';
  payload: { id: string };
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

// Exec task started message (Server -> Client)
export interface ExecTaskStartedMessage extends WSMessage {
  type: 'exec_task_started';
  payload: {
    taskId: string;
    agentId: string;
    agentName: string;
    command: string;
    cwd: string;
  };
}

// Exec task output message (Server -> Client) - streaming output
export interface ExecTaskOutputMessage extends WSMessage {
  type: 'exec_task_output';
  payload: {
    taskId: string;
    agentId: string;
    output: string;
    isError?: boolean;
  };
}

// Exec task completed message (Server -> Client)
export interface ExecTaskCompletedMessage extends WSMessage {
  type: 'exec_task_completed';
  payload: {
    taskId: string;
    agentId: string;
    exitCode: number | null;
    success: boolean;
  };
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
// Secrets WebSocket Messages
// ============================================================================

// Secrets sync message (Server -> Client) - sent on connect and when secrets change
export interface SecretsUpdateMessage extends WSMessage {
  type: 'secrets_update';
  payload: Secret[];
}

// Secret created message (Server -> Client)
export interface SecretCreatedMessage extends WSMessage {
  type: 'secret_created';
  payload: Secret;
}

// Secret updated message (Server -> Client)
export interface SecretUpdatedMessage extends WSMessage {
  type: 'secret_updated';
  payload: Secret;
}

// Secret deleted message (Server -> Client)
export interface SecretDeletedMessage extends WSMessage {
  type: 'secret_deleted';
  payload: { id: string };
}

// Create secret message (Client -> Server)
export interface CreateSecretMessage extends WSMessage {
  type: 'create_secret';
  payload: Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>;
}

// Update secret message (Client -> Server)
export interface UpdateSecretMessage extends WSMessage {
  type: 'update_secret';
  payload: { id: string; updates: Partial<Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>> };
}

// Delete secret message (Client -> Server)
export interface DeleteSecretMessage extends WSMessage {
  type: 'delete_secret';
  payload: { id: string };
}

export type ServerMessage =
  | AgentsUpdateMessage
  | AgentCreatedMessage
  | AgentUpdatedMessage
  | AgentDeletedMessage
  | EventMessage
  | ActivityMessage
  | OutputMessage
  | ErrorMessage
  | DirectoryNotFoundMessage
  | CommandStartedMessage
  | SupervisorReportMessage
  | SupervisorStatusMessage
  | NarrativeUpdateMessage
  | AgentSupervisorHistoryMessage
  | AgentAnalysisMessage
  | AreasUpdateMessage
  | BuildingsUpdateMessage
  | BuildingCreatedMessage
  | BuildingUpdatedMessage
  | BuildingDeletedMessage
  | BuildingLogsMessage
  | PermissionRequestMessage
  | PermissionResolvedMessage
  | DelegationDecisionMessage
  | BossSubordinatesUpdatedMessage
  | DelegationHistoryMessage
  | BossSpawnedAgentMessage
  | AgentTaskStartedMessage
  | AgentTaskOutputMessage
  | AgentTaskCompletedMessage
  | SkillsUpdateMessage
  | SkillCreatedMessage
  | SkillUpdatedMessage
  | SkillDeletedMessage
  | AgentSkillsMessage
  | CustomAgentClassesUpdateMessage
  | CustomAgentClassCreatedMessage
  | CustomAgentClassUpdatedMessage
  | CustomAgentClassDeletedMessage
  | ContextStatsMessage
  | WorkPlanCreatedMessage
  | WorkPlanUpdatedMessage
  | WorkPlanDeletedMessage
  | WorkPlansUpdateMessage
  | AnalysisRequestCreatedMessage
  | AnalysisRequestCompletedMessage
  | GlobalUsageMessage
  | AgentNotificationMessage
  | ExecTaskStartedMessage
  | ExecTaskOutputMessage
  | ExecTaskCompletedMessage
  | SecretsUpdateMessage
  | SecretCreatedMessage
  | SecretUpdatedMessage
  | SecretDeletedMessage
  | PM2LogsChunkMessage
  | PM2LogsStreamingMessage
  | BossBuildingLogsChunkMessage
  | BossBuildingSubordinatesUpdatedMessage;

export type ClientMessage =
  | SpawnAgentMessage
  | SendCommandMessage
  | MoveAgentMessage
  | KillAgentMessage
  | StopAgentMessage
  | ClearContextMessage
  | CollapseContextMessage
  | CreateDirectoryMessage
  | RemoveAgentMessage
  | RenameAgentMessage
  | UpdateAgentPropertiesMessage
  | SetSupervisorConfigMessage
  | RequestSupervisorReportMessage
  | RequestAgentSupervisorHistoryMessage
  | SyncAreasMessage
  | SyncBuildingsMessage
  | CreateBuildingMessage
  | UpdateBuildingMessage
  | DeleteBuildingMessage
  | BuildingCommandMessage
  | PM2LogsStartMessage
  | PM2LogsStopMessage
  | PermissionResponseMessage
  | SpawnBossAgentMessage
  | AssignSubordinatesMessage
  | RemoveSubordinateMessage
  | SendBossCommandMessage
  | RequestDelegationHistoryMessage
  | CreateSkillMessage
  | UpdateSkillMessage
  | DeleteSkillMessage
  | AssignSkillMessage
  | UnassignSkillMessage
  | RequestAgentSkillsMessage
  | CreateCustomAgentClassMessage
  | UpdateCustomAgentClassMessage
  | DeleteCustomAgentClassMessage
  | RequestContextStatsMessage
  | ApproveWorkPlanMessage
  | ExecuteWorkPlanMessage
  | PauseWorkPlanMessage
  | CancelWorkPlanMessage
  | RequestWorkPlansMessage
  | RequestGlobalUsageMessage
  | SendNotificationMessage
  | CreateSecretMessage
  | UpdateSecretMessage
  | DeleteSecretMessage
  | BossBuildingCommandMessage
  | AssignBuildingsMessage
  | BossBuildingLogsStartMessage
  | BossBuildingLogsStopMessage;
