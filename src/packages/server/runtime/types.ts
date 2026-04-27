/**
 * Runtime abstraction types for agent CLI providers.
 * Phase 1 keeps Claude as the only implementation but routes through these
 * contracts so additional providers can be introduced safely.
 */

import type {
  StandardEvent,
  CustomAgentDefinition as ClaudeCustomAgentDefinition,
  RunnerRequest,
} from '../claude/types.js';

export type RuntimeEvent = StandardEvent;
export type CustomAgentDefinition = ClaudeCustomAgentDefinition;
export type RuntimeCommandRequest = RunnerRequest;

export interface RuntimeRunnerCallbacks {
  onEvent: (agentId: string, event: RuntimeEvent) => void;
  onOutput: (
    agentId: string,
    text: string,
    isStreaming?: boolean,
    subagentName?: string,
    uuid?: string,
    toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }
  ) => void;
  onSessionId: (agentId: string, sessionId: string) => void;
  onComplete: (agentId: string, success: boolean) => void;
  onError: (agentId: string, error: string) => void;
}

export interface RuntimeRunner {
  /**
   * Start background work (orphan recovery, persist timer, watchdog).
   * Optional so test mocks don't have to implement it. The production entry
   * point (runtime-service.init()) MUST call this; non-canonical contexts
   * (tests, scripts, sidecars) MUST NOT — those share the data dir and
   * recovery cleanup would kill the live server's tmux sessions.
   */
  start?(): void;
  run(request: RuntimeCommandRequest): Promise<void>;
  stop(agentId: string, clearQueue?: boolean): Promise<void>;
  stopAll(killProcesses?: boolean, clearQueue?: boolean): Promise<void>;
  isRunning(agentId: string): boolean;
  sendMessage(agentId: string, message: string): boolean;
  hasRecentActivity(agentId: string, withinMs: number): boolean;
  onNextActivity(agentId: string, callback: () => void): void;
  /** Whether this runner's backend supports stdin-based follow-up messages */
  supportsStdin(): boolean;
  /**
   * Whether this runner's backend closes stdin after the initial prompt
   * (e.g. codex, opencode). When true, mid-session messages cannot be written
   * directly to stdin and must always go through the runner's queue + respawn-
   * on-close path. Callers should skip the stdin watchdog in this case since
   * delivery is handled by the respawn mechanism.
   */
  closesStdinAfterPrompt?(): boolean;
  /** Get the current turn state of a process (processing vs waiting for input) */
  getTurnState?(agentId: string): 'processing' | 'waiting_for_input' | undefined;
}

export interface RuntimeProvider {
  readonly name: string;
  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner;
}
