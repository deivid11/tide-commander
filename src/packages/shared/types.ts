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

// Custom Agent Class - user-defined agent types with associated skills
export interface CustomAgentClass {
  id: string;           // Unique identifier (slug)
  name: string;         // Display name
  icon: string;         // Emoji or icon
  color: string;        // Hex color
  description: string;  // What this class does
  defaultSkillIds: string[];  // Skills automatically assigned to agents of this class
  model?: string;       // Character model file (e.g., 'character-male-a.glb') - defaults to 'character-male-a.glb'
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
// Building Types
// ============================================================================

// Building types - different kinds of buildings
export type BuildingType = 'server' | 'link' | 'database' | 'docker' | 'monitor';

export const BUILDING_TYPES: Record<BuildingType, { icon: string; color: string; description: string }> = {
  server: { icon: '🖥️', color: '#4aff9e', description: 'Service with start/stop commands and logs' },
  link: { icon: '🔗', color: '#4a9eff', description: 'Quick links to URLs' },
  database: { icon: '🗄️', color: '#ff9e4a', description: 'Database connection and queries' },
  docker: { icon: '🐳', color: '#4ac1ff', description: 'Docker container management' },
  monitor: { icon: '📊', color: '#ff4a9e', description: 'System metrics and monitoring' },
};

// Building status
export type BuildingStatus = 'running' | 'stopped' | 'error' | 'unknown' | 'starting' | 'stopping';

// Building visual styles
export type BuildingStyle = 'server-rack' | 'tower' | 'dome' | 'pyramid' | 'desktop' | 'filing-cabinet' | 'satellite' | 'crystal' | 'factory';

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
};

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

  // Commands (for server type)
  commands?: {
    start?: string;
    stop?: string;
    restart?: string;
    healthCheck?: string;
    logs?: string;
  };

  // Working directory for commands
  cwd?: string;

  // Links (for link type, but can be used by any)
  urls?: { label: string; url: string }[];

  // Visual customization
  color?: string;

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

// Streaming output from Claude
export interface OutputMessage extends WSMessage {
  type: 'output';
  payload: {
    agentId: string;
    text: string;
    isStreaming: boolean;
    timestamp: number;
    isDelegation?: boolean; // True if this is a delegation message from a boss agent
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

// Building command message (Client -> Server) - start/stop/restart/logs
export interface BuildingCommandMessage extends WSMessage {
  type: 'building_command';
  payload: {
    buildingId: string;
    command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs';
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
  | SkillsUpdateMessage
  | SkillCreatedMessage
  | SkillUpdatedMessage
  | SkillDeletedMessage
  | AgentSkillsMessage
  | CustomAgentClassesUpdateMessage
  | CustomAgentClassCreatedMessage
  | CustomAgentClassUpdatedMessage
  | CustomAgentClassDeletedMessage
  | ContextStatsMessage;

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
  | RequestContextStatsMessage;
