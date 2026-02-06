/**
 * Claude Backend Types
 * Modular abstraction for CLI backend communication
 */

// Standard normalized event format (backend-agnostic)
export interface StandardEvent {
  type:
    | 'init'
    | 'text'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'step_complete'
    | 'error'
    | 'block_start'
    | 'block_end'
    | 'context_stats'   // Response from /context command
    | 'usage_stats';    // Response from /usage command
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
  model?: string;
  tools?: string[];
  errorMessage?: string;
  resultText?: string;  // Full result text from result event (for boss delegation parsing)
  permissionDenials?: Array<{  // Tools that were denied permission (from result event)
    toolName: string;
    toolUseId: string;
    toolInput: Record<string, unknown>;
  }>;
  contextStatsRaw?: string;  // Raw /context command output for parsing
  usageStatsRaw?: string;    // Raw /usage command output for parsing
  // Subagent fields (for Task tool events)
  subagentName?: string;       // Task input.name
  subagentDescription?: string;// Task input.description
  subagentType?: string;       // Task input.subagent_type
  subagentModel?: string;      // Task input.model
  toolUseId?: string;          // tool_use block ID (for correlating subagent results)
  uuid?: string;               // Unique message UUID from Claude session for deduplication
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
  model?: string;
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
  };
}

// Backend interface (allows for multiple CLI backends)
export interface CLIBackend {
  readonly name: string;

  // Build CLI arguments
  buildArgs(config: BackendConfig): string[];

  // Parse raw event to normalized format (may return array for events with multiple tool_use blocks)
  parseEvent(rawEvent: unknown): StandardEvent | StandardEvent[] | null;

  // Extract session ID from raw event
  extractSessionId(rawEvent: unknown): string | null;

  // Get executable path
  getExecutablePath(): string;

  // Detect CLI installation
  detectInstallation(): string | null;

  // Whether stdin input is required
  requiresStdinInput(): boolean;

  // Format stdin input for the CLI
  formatStdinInput(prompt: string): string;
}

// Runner request
export interface RunnerRequest {
  agentId: string;
  prompt: string;
  workingDir: string;
  sessionId?: string;
  model?: string;
  useChrome?: boolean;
  permissionMode?: 'bypass' | 'interactive';
  systemPrompt?: string;
  forceNewSession?: boolean;  // Don't resume existing session (for boss team questions)
  // Custom agent configuration (for custom class instructions)
  customAgent?: {
    name: string;
    definition: CustomAgentDefinition;
  };
}

// Runner callbacks
export interface RunnerCallbacks {
  onEvent: (agentId: string, event: StandardEvent) => void;
  onOutput: (agentId: string, text: string, isStreaming?: boolean, subagentName?: string, uuid?: string, toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }) => void;
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
