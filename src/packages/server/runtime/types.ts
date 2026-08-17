/**
 * Runtime abstraction types for agent CLI providers.
 * Phase 1 keeps Claude as the only implementation but routes through these
 * contracts so additional providers can be introduced safely.
 */

import type {
  StandardEvent,
  CustomAgentDefinition as ClaudeCustomAgentDefinition,
  RunnerRequest,
  OutputMetadata,
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
    outputMeta?: OutputMetadata
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
  /**
   * Interrupt the in-flight turn WITHOUT tearing down the agent's session
   * (persistent-stream runners: codex app-server, opencode serve). The thread/
   * session stays alive so a follow-up sendMessage() is delivered as soon as
   * the aborted turn finalizes. clearQueue drops previously queued mid-run
   * messages (they are stale once the user says "do this now instead").
   * Returns false when there is nothing to interrupt or the request failed.
   */
  interruptTurn?(agentId: string, clearQueue?: boolean): Promise<boolean>;
  /**
   * Run the provider's native context compaction control operation. Unlike a
   * chat prompt containing `/compact`, this must invoke the harness protocol
   * directly (for example Pi RPC's `{ type: 'compact' }`). Returns false when
   * no live/idle session can accept the operation.
   */
  compactContext?(agentId: string, customInstructions?: string): Promise<boolean>;
  /**
   * Snapshot of mid-run content queued inside this runner awaiting delivery
   * (drained autonomously at turn end). Multiple sends are coalesced into one
   * entry. Positional: entry i is identified to clients as index i of THIS
   * snapshot.
   */
  getQueuedMessages?(agentId: string): string[];
  /**
   * Remove one queued message by position. expectedText guards against the
   * queue having drained/mutated since the caller's snapshot — on mismatch
   * nothing is removed and false is returned.
   */
  removeQueuedMessage?(agentId: string, index: number, expectedText: string): boolean;
}

export interface RuntimeProvider {
  readonly name: string;
  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner;
}
