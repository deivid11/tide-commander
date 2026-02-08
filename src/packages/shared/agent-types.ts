// ============================================================================
// Agent Classes - built-in types
// ============================================================================

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

// ============================================================================
// Agent Status & Configuration
// ============================================================================

// Agent Status
// 'orphaned' = Claude process is running but agent state is out of sync (e.g., shows idle when actually working)
export type AgentStatus = 'idle' | 'working' | 'waiting' | 'waiting_permission' | 'error' | 'offline' | 'orphaned';

// Permission Mode - controls how Claude asks for permissions
export type PermissionMode = 'bypass' | 'interactive';

export const PERMISSION_MODES: Record<PermissionMode, { label: string; description: string }> = {
  bypass: { label: 'Permissionless', description: 'Skip all permission prompts (less safe, faster)' },
  interactive: { label: 'Interactive', description: 'Ask for approval before sensitive operations' },
};

// Agent runtime provider
export type AgentProvider = 'claude' | 'codex';

// Codex CLI execution controls
export type CodexApprovalMode = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexModel =
  | 'gpt-5.3-codex'
  | 'gpt-5.2-codex'
  | 'gpt-5.1-codex-max'
  | 'gpt-5.1-codex-mini'
  | 'gpt-5.2';

export interface CodexConfig {
  fullAuto?: boolean; // maps to --full-auto
  approvalMode?: CodexApprovalMode; // maps to --ask-for-approval
  sandbox?: CodexSandboxMode; // maps to --sandbox
  search?: boolean; // maps to --search
  profile?: string; // maps to --profile
}

export const CODEX_MODELS: Record<CodexModel, { label: string; description: string; icon: string }> = {
  'gpt-5.3-codex': {
    label: 'GPT-5.3 Codex',
    description: 'Latest frontier agentic coding model',
    icon: '⚙️',
  },
  'gpt-5.2-codex': {
    label: 'GPT-5.2 Codex',
    description: 'Frontier agentic coding model',
    icon: '🧠',
  },
  'gpt-5.1-codex-max': {
    label: 'GPT-5.1 Codex Max',
    description: 'Codex-optimized flagship for deep and fast reasoning',
    icon: '🚀',
  },
  'gpt-5.1-codex-mini': {
    label: 'GPT-5.1 Codex Mini',
    description: 'Optimized for codex, cheaper and faster',
    icon: '⚡',
  },
  'gpt-5.2': {
    label: 'GPT-5.2',
    description: 'General frontier model with strong reasoning and coding',
    icon: '🧩',
  },
};

// Claude Model - which AI model to use
export type ClaudeModel = 'sonnet' | 'opus' | 'haiku';

export const CLAUDE_MODELS: Record<ClaudeModel, { label: string; description: string; icon: string }> = {
  sonnet: { label: 'Sonnet', description: 'Balanced performance and cost (recommended)', icon: '⚡' },
  opus: { label: 'Opus', description: 'Most capable, higher cost', icon: '🧠' },
  haiku: { label: 'Haiku', description: 'Fast and economical', icon: '🚀' },
};

// ============================================================================
// Context & Usage Stats
// ============================================================================

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

// ============================================================================
// Agent State
// ============================================================================

export interface Agent {
  id: string;
  name: string;
  class: AgentClass;
  status: AgentStatus;
  provider: AgentProvider;

  // Position on battlefield (3D coordinates)
  position: { x: number; y: number; z: number };

  // Claude Code session
  sessionId?: string;
  cwd: string;
  useChrome?: boolean; // Start with --chrome flag
  permissionMode: PermissionMode; // How permissions are handled
  model?: ClaudeModel; // Claude model to use (sonnet, opus, haiku)
  codexModel?: CodexModel; // Codex model to use (for provider='codex')
  codexConfig?: CodexConfig; // Codex CLI config (only for provider='codex')

  // Resources
  tokensUsed: number;
  contextUsed: number;      // Current context window usage
  contextLimit: number;     // Model's context limit (default 200k)

  // Detailed context stats (from Claude's stream-json modelUsage)
  contextStats?: ContextStats;

  // Current task
  currentTask?: string;
  currentTool?: string;

  // Detached mode - true when the Claude process is running but not attached to Tide Commander
  // (e.g., after server restart while agent was working)
  isDetached?: boolean;

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

// ============================================================================
// Subagent Types (Claude Code Task tool spawned agents)
// ============================================================================

// Virtual subagent status
export type SubagentStatus = 'spawning' | 'working' | 'completed' | 'failed';

// Virtual subagent - represents a Task tool subagent spawned by Claude Code
export interface Subagent {
  id: string;                        // Generated ID for this virtual subagent
  parentAgentId: string;             // The TC agent that spawned this subagent
  toolUseId: string;                 // The tool_use_id that created this subagent
  name: string;                      // Name from Task input (e.g., "UX Analyst")
  description: string;               // Description from Task input
  subagentType: string;              // e.g., "general-purpose", "Explore", "Bash"
  model?: string;                    // Model used (e.g., "opus", "sonnet")
  status: SubagentStatus;
  startedAt: number;
  completedAt?: number;
  // Position near parent agent
  position?: { x: number; y: number; z: number };
}

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
