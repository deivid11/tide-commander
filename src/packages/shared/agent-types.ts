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
  iconPath?: string;    // Filename of uploaded PNG icon (e.g., 'my-class-id.png')
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
export type AgentTrackingStatus = 'thinking' | 'working' | 'waiting-subordinates' | 'need-review' | 'blocked' | 'can-clear-context';

// Permission Mode - controls how Claude asks for permissions
export type PermissionMode = 'bypass' | 'interactive';

export const PERMISSION_MODES: Record<PermissionMode, { label: string; description: string }> = {
  bypass: { label: 'Permissionless', description: 'Skip all permission prompts (less safe, faster)' },
  interactive: { label: 'Interactive', description: 'Ask for approval before sensitive operations' },
};

// Agent runtime provider
export type AgentProvider = 'claude' | 'codex' | 'opencode' | 'grok' | 'pi';

/**
 * Providers whose CLI takes the prompt via argv/file and closes stdin after
 * launch. Mid-run follow-ups cannot be written to stdin — they must be queued
 * until the process exits (or force-interrupted and respawned with --resume).
 */
export function providerClosesStdinAfterPrompt(
  provider?: AgentProvider | string | null,
): boolean {
  return provider === 'codex' || provider === 'opencode' || provider === 'grok' || provider === 'pi';
}

export function providerDisplayName(
  provider?: AgentProvider | string | null,
): string {
  switch (provider) {
    case 'codex':
      return 'Codex';
    case 'opencode':
      return 'OpenCode';
    case 'grok':
      return 'Grok';
    case 'pi':
      return 'Pi';
    case 'claude':
      return 'Claude';
    default:
      return provider ? String(provider) : 'agent';
  }
}

// OpenCode model - uses provider/model format (e.g. 'minimax/MiniMax-M1-80k')
export type OpencodeModel = string;

// Grok CLI model id (e.g. 'grok-4.6')
export type GrokModel = string;

// Reasoning-effort values the Grok CLI accepts for --reasoning-effort.
// Grok has no 'max' tier — 'xhigh' is its ceiling (and only on 4.6+).
export type GrokReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export const GROK_MODELS: Record<string, { label: string; description: string; icon: string; contextWindow: number; efforts: GrokReasoningEffort[] }> = {
  'grok-4.6': {
    label: 'Grok 4.6',
    description: "SpaceXAI's latest frontier model — adds the xhigh reasoning tier",
    icon: '⚡',
    // Authoritative window from live Grok Build signals.json (contextWindowTokens).
    contextWindow: 500000,
    efforts: ['low', 'medium', 'high', 'xhigh'],
  },
  'grok-4.5': {
    label: 'Grok 4.5',
    description: 'Previous Grok Build generation (still supported)',
    icon: '🌊',
    contextWindow: 500000,
    // 4.5 has no xhigh tier — the model catalog only lists low/medium/high.
    efforts: ['low', 'medium', 'high'],
  },
};

export const DEFAULT_GROK_MODEL = 'grok-4.6';

/** Effort tiers a Grok model accepts; unknown models get the full modern set. */
export function grokEffortsFor(model?: string | null): GrokReasoningEffort[] {
  return GROK_MODELS[model || '']?.efforts || ['low', 'medium', 'high', 'xhigh'];
}

// Tide effort labels → Grok CLI values. Grok tops out at 'xhigh', so 'max'
// clamps down instead of being passed through as an unknown value.
const GROK_EFFORT_VALUES: Record<ClaudeEffort, GrokReasoningEffort> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xHigh: 'xhigh',
  max: 'xhigh',
};

/**
 * Resolve a Tide effort label to the `--reasoning-effort` value for a Grok
 * model, clamping to the highest tier that model actually supports (asking
 * grok-4.5 for 'xhigh' would otherwise be rejected by the CLI).
 */
export function resolveGrokReasoningEffort(
  model: string | undefined,
  effort: string | undefined
): GrokReasoningEffort | undefined {
  if (!effort) return undefined;
  const supported = grokEffortsFor(model);
  const requested = GROK_EFFORT_VALUES[effort as ClaudeEffort]
    || (effort.toLowerCase() as GrokReasoningEffort);
  const order: GrokReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
  const requestedRank = order.indexOf(requested);
  if (requestedRank === -1) return undefined;
  for (let rank = requestedRank; rank >= 0; rank -= 1) {
    if (supported.includes(order[rank])) return order[rank];
  }
  return undefined;
}

/**
 * Tide effort labels selectable for a Grok model (drives the effort pickers).
 * 'max' is Claude-only — Grok's ceiling is X-High, so it never shows for Grok.
 */
export function grokSupportsEffort(model: string | undefined, effort: ClaudeEffort): boolean {
  if (effort === 'max') return false;
  return grokEffortsFor(model).includes(GROK_EFFORT_VALUES[effort]);
}

// Pi coding agent model - uses provider/model format (e.g. 'anthropic/claude-sonnet-4-5').
// Empty string means "use pi's own configured default" (~/.pi/agent/settings.json).
export type PiModel = string;

export const DEFAULT_PI_MODEL = '';

// Codex CLI execution controls
export type CodexApprovalMode = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexModel =
  | 'gpt-5.6-luna'
  | 'gpt-5.6-terra'
  | 'gpt-5.6-sol';

// Valid values accepted by the codex CLI's `-c model_reasoning_effort=<value>` override.
// Confirmed from `codex -c model_reasoning_effort=bogus exec …` error message.
export type CodexReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const CODEX_REASONING_EFFORTS: Record<CodexReasoningEffort, { label: string; description: string; icon: string }> = {
  none: { label: 'None', description: 'No reasoning', icon: '⚪' },
  minimal: { label: 'Minimal', description: 'Least reasoning, fastest', icon: '💨' },
  low: { label: 'Low', description: 'Light reasoning', icon: '🏃' },
  medium: { label: 'Medium', description: 'Balanced reasoning', icon: '⚖️' },
  high: { label: 'High', description: 'Deep reasoning', icon: '🔬' },
  xhigh: { label: 'X-High', description: 'Extra-high reasoning, slowest', icon: '🧠' },
};

export interface CodexConfig {
  fullAuto?: boolean; // maps to --full-auto
  approvalMode?: CodexApprovalMode; // maps to --ask-for-approval
  sandbox?: CodexSandboxMode; // maps to --sandbox
  search?: boolean; // maps to --search
  profile?: string; // maps to --profile
  reasoningEffort?: CodexReasoningEffort; // maps to -c model_reasoning_effort=<value>
}

export const CODEX_MODELS: Record<CodexModel, { label: string; description: string; icon: string }> = {
  'gpt-5.6-luna': {
    label: 'GPT-5.6 Luna',
    description: 'GPT-5.6 Luna model',
    icon: '🌙',
  },
  'gpt-5.6-terra': {
    label: 'GPT-5.6 Terra',
    description: 'GPT-5.6 Terra model',
    icon: '🌍',
  },
  'gpt-5.6-sol': {
    label: 'GPT-5.6 Sol',
    description: 'GPT-5.6 Sol model',
    icon: '☀️',
  },
};

// Claude Model - which AI model to use.
// Short names ('sonnet' | 'opus' | 'haiku') are legacy aliases for the CLI's
// latest-of-family resolution. Explicit IDs (e.g. 'claude-opus-4-8') are
// preferred for new agents so we pin a specific version. The '[1m]' suffix
// is a Tide Commander label meaning "run this Opus version with the 1M-token
// context beta header"; it translates to the bare model ID on the CLI side.
export type ClaudeModel =
  | 'sonnet'
  | 'opus'
  | 'haiku'
  | 'claude-fable-5'
  | 'claude-fable-5[1m]'
  | 'claude-sonnet-5'
  | 'claude-sonnet-5[1m]'
  | 'claude-opus-5'
  | 'claude-opus-5[1m]'
  | 'claude-opus-4-8'
  | 'claude-opus-4-7'
  | 'claude-opus-4-6'
  | 'claude-opus-4-8[1m]'
  | 'opus[1m]';

export const CLAUDE_MODELS: Record<ClaudeModel, { label: string; description: string; icon: string; contextWindow: number; deprecated?: boolean }> = {
  sonnet: { label: 'Sonnet', description: 'Balanced performance and cost', icon: '⚡', contextWindow: 200000 },
  'claude-sonnet-5[1m]': { label: 'Sonnet 5 [1M]', description: 'Latest Sonnet — most agentic Sonnet, near-Opus intelligence at lower cost, 1M token context window (recommended)', icon: '⚡', contextWindow: 1000000 },
  'claude-fable-5[1m]': { label: 'Fable 5 [1M]', description: 'Most powerful, most intelligent Claude model — new tier above Opus, 1M token context window', icon: '🪄', contextWindow: 1000000 },
  'claude-opus-5[1m]': { label: 'Opus 5 [1M]', description: 'Latest Opus with 1M token context window — for complex agentic coding and enterprise work', icon: '🧠', contextWindow: 1000000 },
  'claude-opus-4-8[1m]': { label: 'Opus 4.8 [1M]', description: 'Opus 4.8 with 1M token context window (previous Opus generation, still supported)', icon: '🧠', contextWindow: 1000000 },
  'opus[1m]': { label: 'Opus 4.7 [1M]', description: 'Previous Opus generation with 1M token context window', icon: '🧠', contextWindow: 1000000 },
  haiku: { label: 'Haiku', description: 'Fast and economical', icon: '🚀', contextWindow: 200000 },
  // Plain (200K) Opus IDs are kept as valid model values for existing agents
  // and CLI passthrough, but hidden from the "new agent" picker in favor of
  // the 1M variants above.
  'claude-fable-5': { label: 'Fable 5 (200K)', description: 'Fable 5, 200K context window (1M variant preferred)', icon: '🪄', contextWindow: 200000, deprecated: true },
  'claude-opus-5': { label: 'Opus 5 (200K)', description: 'Latest Opus, 200K context window (1M variant preferred)', icon: '🧠', contextWindow: 200000, deprecated: true },
  'claude-sonnet-5': { label: 'Sonnet 5 (200K)', description: 'Latest Sonnet, 200K context window (1M variant preferred)', icon: '⚡', contextWindow: 200000, deprecated: true },
  'claude-opus-4-8': { label: 'Opus 4.8 (200K)', description: 'Latest Opus, 200K context window (1M variant preferred)', icon: '🧠', contextWindow: 200000, deprecated: true },
  'claude-opus-4-7': { label: 'Opus 4.7 (200K)', description: 'Previous Opus generation, 200K context window (1M variant preferred)', icon: '🧠', contextWindow: 200000, deprecated: true },
  opus: { label: 'Opus (legacy)', description: 'Legacy alias — prefer Opus 4.8 [1M]', icon: '🧠', contextWindow: 200000, deprecated: true },
  'claude-opus-4-6': { label: 'Opus 4.6', description: 'Older Opus generation (retained for existing agents)', icon: '🧠', contextWindow: 200000, deprecated: true },
};

// Claude Effort Level - how much reasoning effort Claude puts into responses.
// 'xHigh' (extra high) sits between 'high' and 'max' and is supported from
// Opus 4.7 onward (including Opus 4.8).
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xHigh' | 'max';

export const CLAUDE_EFFORTS: Record<ClaudeEffort, { label: string; description: string; icon: string }> = {
  low: { label: 'Low', description: 'Minimal reasoning, fastest responses', icon: '🏃' },
  medium: { label: 'Medium', description: 'Balanced reasoning effort', icon: '⚖️' },
  high: { label: 'High', description: 'Deep reasoning for complex tasks (default)', icon: '🔬' },
  xHigh: { label: 'X-High', description: 'Extra-high reasoning (Opus 4.7+)', icon: '🧪' },
  max: { label: 'Max', description: 'Maximum reasoning, most thorough', icon: '🧠' },
};

// Model IDs that should be hidden from the "new agent" model picker.
// They remain valid ClaudeModel values so existing agents keep working.
export function isDeprecatedClaudeModel(model: ClaudeModel): boolean {
  return CLAUDE_MODELS[model]?.deprecated === true;
}

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

// ============================================================================
// Agent Todo List (latest TodoWrite snapshot)
// ============================================================================

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface AgentTodoItem {
  /** Stable id when the provider supports merge updates (e.g. Grok todo_write). */
  id?: string;
  content: string;
  status: AgentTodoStatus;
  activeForm?: string;
}

// ============================================================================
// Agent State
// ============================================================================

/**
 * A live model swap the API performed without asking: `requestedModel` is what
 * the session was started with, `servedModel` is what actually answered.
 * Labels are precomputed so every surface (terminal chip, agent card, mobile)
 * renders the same wording.
 */
export interface ModelFallbackInfo {
  requestedModel: string;
  servedModel: string;
  requestedLabel: string;
  servedLabel: string;
  /** True when the swap crossed model families (e.g. Fable → Opus). */
  tierChanged: boolean;
  /** When the swap was first observed. */
  detectedAt: number;
}

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
  // Set on a forked agent until its first run: the SOURCE session id to resume +
  // fork from (Claude --fork-session / Codex thread/fork / OpenCode --fork). Cleared once the fork's
  // own new session id is captured. See handleForkAgent.
  forkSourceSessionId?: string;
  cwd: string;
  useChrome?: boolean; // Start with --chrome flag
  permissionMode: PermissionMode; // How permissions are handled
  model?: ClaudeModel; // Claude model to use (sonnet, opus, haiku)
  effort?: ClaudeEffort; // Reasoning effort level (low, medium, high, max)
  codexModel?: CodexModel; // Codex model to use (for provider='codex')
  codexConfig?: CodexConfig; // Codex CLI config (only for provider='codex')
  opencodeModel?: OpencodeModel; // OpenCode model to use (for provider='opencode')
  grokModel?: GrokModel; // Grok model to use (for provider='grok')
  piModel?: PiModel; // Pi model to use (for provider='pi', 'provider/model' pattern)

  // Resources
  tokensUsed: number;
  contextUsed: number;      // Current context window usage
  contextLimit: number;     // Model's context limit (default 200k)

  // Detailed context stats (from Claude's stream-json modelUsage)
  contextStats?: ContextStats;

  // Current task
  currentTask?: string;
  currentTool?: string;

  // Last runtime error message (set alongside status='error'; shown on hover
  // over the status badge). Cleared automatically when the agent recovers to
  // any non-error status. See runtime-events handleError / agent-service updateAgent.
  lastError?: string;

  // Set while the API is serving this agent a DIFFERENT model than the one it
  // was configured with (silent Anthropic fallback — see shared/model-fallback.ts).
  // Cleared as soon as a turn comes back on the requested model again.
  modelFallback?: ModelFallbackInfo;

  // Model id the CLI reported in its session init (e.g. 'claude-opus-5').
  // When `model` is unset the CLI resolves its own default, and this is the
  // only truthful source for the UI — refreshed at every turn init.
  detectedModel?: string;

  // Latest TodoWrite snapshot for this agent (most recent task list)
  latestTodos?: AgentTodoItem[];

  // Detached mode - true when the Claude process is running but not attached to Tide Commander
  // (e.g., after server restart while agent was working)
  isDetached?: boolean;

  // Last assigned task - the original user prompt/task (persists even when idle)
  lastAssignedTask?: string;
  lastAssignedTaskTime?: number;

  // Brief task label (max 5 words) for display in 2D/3D scenes
  taskLabel?: string;
  trackingStatus?: AgentTrackingStatus | null;
  trackingStatusDetail?: string;
  trackingStatusTimestamp?: number;

  // Task counter - number of user messages/commands sent to this agent
  taskCount: number;

  // Timestamps
  createdAt: number;
  lastActivity: number;
  // Last time the agent actually transitioned into/out of active work
  // (working/waiting/waiting_permission). Unlike lastActivity — which every
  // updateAgent restamps, clicks included — this only moves with real work,
  // so clients can trust it for "recently active" ordering and stay in sync
  // across browsers/APK that never observed the work live.
  lastWorkedAt?: number;

  // Boss-specific fields
  isBoss?: boolean;                    // True if this agent can manage subordinates
  subordinateIds?: string[];           // IDs of agents under this boss
  bossId?: string;                     // ID of the boss this agent reports to (if any)

  // Custom instructions appended to the agent's class system prompt
  customInstructions?: string;

  // Per-agent custom system prompt. Edited from Settings → System Prompt with a
  // specific agent selected, and injected by buildAppendedProjectInstructions()
  // under "System-Level Custom Prompt". Coexists with the global prompt (the
  // "All Agents (Global)" picker entry, stored via system-prompt-service), which
  // is injected before it for every agent.
  customPrompt?: string;

  // Per-agent persistent memory — agent's own notes/lessons/preferences.
  // Maintained by the agent itself via /api/agents/:id/memory and injected
  // into the system prompt by buildAppendedProjectInstructions().
  memory?: string;

  // Global keyboard shortcut to open guake terminal for this agent (e.g. 'ctrl+1', 'alt+a')
  shortcut?: string;

  // Silence this agent's audio only: no notification chime, no completion cue,
  // and its questions never start the repeating alert. Everything visual stays
  // exactly as before — toasts, phone notifications and the board are
  // untouched. Intended for chatty agents you still want to watch.
  soundsMuted?: boolean;

  // Auto-collapse: when enabled, the agent's context is collapsed (/compact runs,
  // waiting for idle if busy) on a recurring cron schedule. Intended for unattended
  // agents (slack channels, log-supervising cronjobs) whose context grows indefinitely.
  autoCollapse?: boolean;          // Master enable/disable flag
  autoCollapseCron?: string;       // 5-field cron expression, e.g. '0 3 * * *' (3am daily)
  autoCollapseTz?: string;         // IANA timezone for the cron, e.g. 'America/Mexico_City'
  autoCollapsePrompt?: string;     // Optional prompt sent to the agent after each scheduled collapse completes
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
  // Real-time activity tracking
  activities?: SubagentActivity[];
  // Streaming content from JSONL file
  streamEntries?: SubagentStreamEntry[];
  // Completion stats
  stats?: {
    durationMs: number;
    tokensUsed: number;
    toolUseCount: number;
  };
}

export interface SubagentActivity {
  toolName: string;
  description: string;
  timestamp: number;
}

// Streaming entry from subagent JSONL file
export interface SubagentStreamEntry {
  type: 'text' | 'tool_use' | 'tool_result';
  timestamp: string;
  text?: string;                    // For text entries (assistant messages)
  toolName?: string;                // For tool_use entries
  toolKeyParam?: string;            // Key param (e.g., file path, command, query)
  toolUseId?: string;               // Claude's tool_use_id
  resultPreview?: string;           // For tool_result entries (truncated output)
  isError?: boolean;                // For tool_result error status
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
// Session History
// ============================================================================

/** A single past session entry for an agent. */
export interface SessionHistoryEntry {
  sessionId: string;
  summary: string;        // Brief description (from taskLabel, falls back to lastAssignedTask)
  startedAt: number;      // Timestamp when session was first used
  endedAt: number;        // Timestamp when session was cleared/replaced
  messageCount?: number;  // Approximate message count at time of archival
  fileExists?: boolean;   // Computed at request time - true if the .jsonl file still exists on disk
}
