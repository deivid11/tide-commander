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
  run(request: RuntimeCommandRequest): Promise<void>;
  stop(agentId: string): Promise<void>;
  stopAll(killProcesses?: boolean): Promise<void>;
  isRunning(agentId: string): boolean;
  sendMessage(agentId: string, message: string): boolean;
  hasRecentActivity(agentId: string, withinMs: number): boolean;
  onNextActivity(agentId: string, callback: () => void): void;
  /** Whether this runner's backend supports stdin-based follow-up messages */
  supportsStdin(): boolean;
}

export interface RuntimeProvider {
  readonly name: string;
  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner;
}
