/**
 * Claude Backend Types
 * Modular abstraction for CLI backend communication
 */

import type { CodexConfig } from '../../shared/types.js';
import type { ModelFallbackTransition } from '../../shared/model-fallback.js';

export interface OutputMetadata {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  /** Provider-reported reasoning tokens for the assistant message. */
  reasoningTokens?: number;
  /** Number of plaintext reasoning summaries exposed by the provider. */
  reasoningSummaryCount?: number;
  /** Detailed reasoning is present only as an encrypted provider payload. */
  reasoningEncrypted?: boolean;
  /** Visible thinking text is a summary, not the full chain of thought. */
  reasoningSummaryOnly?: boolean;
}

// Standard normalized event format (backend-agnostic)
export interface StandardEvent {
  type:
    | 'init'
    | 'text'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'usage_snapshot'
    | 'step_complete'
    | 'error'
    | 'block_start'
    | 'block_end'
    | 'context_stats'   // Response from /context command
    | 'compacting'      // Context compaction in progress
    | 'model_fallback'  // API served the turn with a different model than requested
    | 'task_started'    // Task/Agent tool launched in background — still running after its stub tool_result
    | 'task_notification'; // Background task finished; the CLI is waking the model with its result
  blockType?: 'text' | 'thinking';
  sessionId?: string;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  tokens?: {
    input: number;
    output: number;
    cacheCreation?: number;  // cache_creation_input_tokens
    cacheRead?: number;      // cache_read_input_tokens
  };
  // Model usage info from result event (contains actual context window size)
  modelUsage?: {
    contextWindow?: number;      // Model's context window size
    maxOutputTokens?: number;    // Model's max output tokens
    inputTokens?: number;        // Total input tokens this turn
    outputTokens?: number;       // Total output tokens this turn
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  cost?: number;
  durationMs?: number;
  isStreaming?: boolean;
  reasoningTokens?: number;
  reasoningSummaryCount?: number;
  reasoningEncrypted?: boolean;
  reasoningSummaryOnly?: boolean;
  model?: string;
  /** Underlying model provider (not the harness), currently reported by Pi. */
  modelProvider?: string;
  // model_fallback: the model the session asked for vs the one that answered.
  // `fallbackRestored` marks the turn where the requested model came back.
  requestedModel?: string;
  servedModel?: string;
  fallbackRestored?: boolean;
  tools?: string[];
  errorMessage?: string;
  resultText?: string;  // Full result text from result event (for boss delegation parsing)
  permissionDenials?: Array<{  // Tools that were denied permission (from result event)
    toolName: string;
    toolUseId: string;
    toolInput: Record<string, unknown>;
  }>;
  contextStatsRaw?: string;  // Raw /context command output for parsing
  // Subagent fields (for Task tool events)
  subagentName?: string;       // Task input.name
  subagentDescription?: string;// Task input.description
  subagentType?: string;       // Task input.subagent_type
  subagentModel?: string;      // Task input.model
  toolUseId?: string;          // tool_use block ID (for correlating subagent results)
  uuid?: string;               // Unique message UUID from Claude session for deduplication
  parentToolUseId?: string;     // Parent Task tool_use_id (for subagent internal events)
  // Subagent completion stats (from tool_use_result)
  subagentStats?: {
    durationMs: number;
    tokensUsed: number;
    toolUseCount: number;
  };
  taskId?: string;              // Short task ID from task_started system event
}

/** Shape a tracker transition as the event the runner pipeline renders. */
export function toModelFallbackEvent(transition: ModelFallbackTransition): StandardEvent {
  return {
    type: 'model_fallback',
    requestedModel: transition.requestedModel,
    servedModel: transition.servedModel,
    text: transition.label,
    ...(transition.restored ? { fallbackRestored: true } : {}),
  };
}

// Custom agent definition for --agents flag
export interface CustomAgentDefinition {
  description: string;
  prompt: string;
}

// Configuration for backend
export interface BackendConfig {
  agentId?: string;  // Used for prompt file naming
  sessionId?: string;
  // Fork the resumed session into a NEW one on this run (Claude --fork-session /
  // Codex thread/fork / OpenCode --fork). Used for the first run of a forked agent. Requires sessionId.
  forkSession?: boolean;
  model?: string;
  effort?: string;  // Reasoning effort level (low, medium, high, xHigh, max)
  workingDir: string;
  permissionMode?: 'bypass' | 'interactive';
  prompt?: string;
  systemPrompt?: string;
  useChrome?: boolean;
  // Custom agent configuration (uses --agents and --agent flags)
  customAgent?: {
    name: string;  // Agent name to use with --agent flag
    definition: CustomAgentDefinition;
  };
  codexConfig?: CodexConfig;
}

// Raw event from Claude CLI (partial typing for flexibility)
export interface ClaudeRawEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  tools?: string[];
  uuid?: string;  // Unique message UUID from Claude
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;  // tool_use block ID for matching with tool_result
      input?: Record<string, unknown>;
    }>;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  tool_name?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  // Model usage stats from result event (per-model breakdown with context window info)
  modelUsage?: {
    [modelName: string]: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      contextWindow?: number;
      maxOutputTokens?: number;
    };
  };
  event?: {
    type: string;
    delta?: {
      type: string;
      text?: string;
    };
    content_block?: {
      type: string;
    };
  };
  error?: string;
  permission_denials?: Array<{
    tool_name: string;
    tool_use_id: string;
    tool_input: Record<string, unknown>;
  }>;
  // Tool execution result (for user events with tool_result content)
  tool_use_result?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
    isImage?: boolean;
    // Task tool completion metadata
    totalDurationMs?: number;
    totalTokens?: number;
    totalToolUseCount?: number;
    status?: string;
    content?: unknown;
    agentId?: string;
  };
  // Links subagent events to parent Task invocation
  parent_tool_use_id?: string;
  // From system/task_started events
  task_id?: string;
  task_type?: string;
  tool_use_id?: string;
}

// Backend interface (allows for multiple CLI backends)
export interface CLIBackend {
  readonly name: string;

  // Build CLI arguments
  buildArgs(config: BackendConfig): string[];

  // Parse raw event to normalized format (may return array for events with multiple tool_use blocks).
  // One backend instance serves ALL agents of a provider — any per-turn parser
  // state (stream uuids, accumulated text) MUST be keyed by agentId or two
  // concurrent agents corrupt each other's streams.
  parseEvent(rawEvent: unknown, agentId?: string): StandardEvent | StandardEvent[] | null;

  /**
   * Grok only: finalize open text/thinking streams (new uuids next) without
   * step_complete. Called when a tool_start arrives mid-turn so intermediate
   * status lines don't concatenate into one bubble across tool rounds.
   */
  breakOpenStreams?(agentId?: string): StandardEvent[];

  // Extract session ID from raw event
  extractSessionId(rawEvent: unknown): string | null;

  // Get executable path
  getExecutablePath(): string;

  // Detect CLI installation
  detectInstallation(): string | null;

  // Extra environment variables for the spawned process (e.g. PATH additions)
  getExtraEnv?(): Record<string, string>;

  // Whether stdin input is required
  requiresStdinInput(): boolean;

  // Format stdin input for the CLI
  formatStdinInput(prompt: string): string;

  // Optional native control request for changing the live session model.
  // Backends without this capability return no formatter and apply the saved
  // model on their next native process/turn instead.
  formatModelSwitchInput?(model: string, effort?: string): string;

  // Whether to close stdin after sending the initial prompt (e.g. opencode reads until EOF)
  shouldCloseStdinAfterPrompt?(): boolean;

  // Whether this backend supports resuming a session after the process dies
  // (used by recovery store to decide if orphaned agents can be auto-resumed)
  supportsSessionResume?(): boolean;
}

// Runner request
export interface RunnerRequest {
  agentId: string;
  prompt: string;
  workingDir: string;
  sessionId?: string;
  model?: string;
  effort?: string;  // Reasoning effort level (low, medium, high, xHigh, max)
  useChrome?: boolean;
  permissionMode?: 'bypass' | 'interactive';
  systemPrompt?: string;
  forceNewSession?: boolean;  // Don't resume existing session (for boss team questions)
  forkSession?: boolean;  // Fork the resumed session into a new one (first run of a forked agent)
  // Custom agent configuration (for custom class instructions)
  customAgent?: {
    name: string;
    definition: CustomAgentDefinition;
  };
  codexConfig?: CodexConfig;
}

// Runner callbacks
export interface RunnerCallbacks {
  onEvent: (agentId: string, event: StandardEvent) => void;
  onOutput: (agentId: string, text: string, isStreaming?: boolean, subagentName?: string, uuid?: string, outputMeta?: OutputMetadata) => void;
  onSessionId: (agentId: string, sessionId: string) => void;
  onComplete: (agentId: string, success: boolean) => void;
  onError: (agentId: string, error: string) => void;
}

// Active process tracking
export interface ActiveProcess {
  agentId: string;
  sessionId?: string;
  startTime: number;
  process: import('child_process').ChildProcess;
  // Store last request for potential auto-restart
  lastRequest?: RunnerRequest;
  // Track restart attempts to prevent infinite loops
  restartCount?: number;
  lastRestartTime?: number;
  // File-based output (for survival across server restarts)
  outputFile?: string;
  stderrFile?: string;
  outputFd?: number;  // File descriptor for output file
  stderrFd?: number;  // File descriptor for stderr file
  fileWatcher?: import('fs').FSWatcher;  // Watching output file for changes
  fileReadPosition?: number;  // Current read position in output file
  // Flag indicating this is a reconnected orphan process
  isReconnected?: boolean;
  // Track last activity time for stdin watchdog (detects stuck processes)
  lastActivityTime?: number;
  // Track errors that occur during the process lifetime
  lastError?: {
    type: string;  // 'stdin_write_error', 'initial_stdin_write_error', etc.
    message: string;
    timestamp: number;
  };
  // Turn state: tracks whether the process is mid-turn or waiting for stdin input
  turnState?: 'processing' | 'waiting_for_input';
  // tmux session name when running in tmux mode (TIDE_USE_TMUX=1)
  tmuxSession?: string;
  // tmux log file path for stdout tailing
  tmuxLogFile?: string;
  // tmux file tailer handle
  tmuxTailer?: import('./runner/tmux-helper.js').TmuxFileTailer;
  // Basename of the CLI executable (e.g. "claude", "codex", "opencode") so the
  // watchdog can tell when the inner CLI died but the wrapping shell pipeline
  // kept the tmux session alive (zombie session).
  tmuxExpectedCommand?: string;
  /**
   * True for backends whose CLI consumes one prompt and is expected to exit
   * (grok, codex, opencode). These have no reusable stdin, so a process still
   * alive after its turn ended is a leak the watchdog must reap — unlike
   * stdin-open backends (claude), which deliberately stay alive between turns.
   */
  closesStdinAfterPrompt?: boolean;
  /** Optional side-channel cleanup (e.g. Grok session file watcher). */
  sideChannelStop?: () => void;
}

// Process death info for diagnostics
export interface ProcessDeathInfo {
  agentId: string;
  pid: number | undefined;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  runtime: number;  // How long the process ran in ms
  wasTracked: boolean;
  timestamp: number;
  stderr?: string;  // Last stderr output if any
}
