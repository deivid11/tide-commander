/**
 * ClaudeRunnerRouter
 *
 * The Claude provider can run agents two ways: the headless `claude --print`
 * runner, or the experimental interactive-TUI runner. Which one to use is a
 * per-launch decision driven by the live `interactive mode` setting (mirroring
 * how the headless tmux toggle is re-checked at every spawn) — NOT a one-time
 * choice frozen at server startup.
 *
 * This router owns one instance of each runner and delegates the RuntimeRunner
 * surface to the right one:
 *  - run(): pick by the CURRENT setting; if the agent was running under the
 *    other runner, tear that session down first so we never have two processes
 *    for one agent. (The conversation continues — the new runner resumes the
 *    same sessionId.)
 *  - everything else: route to whichever runner currently OWNS the agent.
 */

import type {
  RuntimeRunner,
  RuntimeRunnerCallbacks,
  RuntimeCommandRequest,
} from './types.js';
import { ClaudeRunner } from '../claude/runner.js';
import { InteractiveClaudeRunner } from '../claude/interactive/interactive-runner.js';
import { isInteractiveModeEnabled } from '../services/system-prompt-service.js';
import { isTmuxAvailable } from '../claude/runner/tmux-helper.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ClaudeRouter');

type Mode = 'headless' | 'interactive';

export class ClaudeRunnerRouter implements RuntimeRunner {
  private readonly headless: ClaudeRunner;
  private readonly interactive: InteractiveClaudeRunner;
  private readonly owner = new Map<string, Mode>();

  constructor(callbacks: RuntimeRunnerCallbacks) {
    this.headless = new ClaudeRunner(callbacks);
    this.interactive = new InteractiveClaudeRunner(callbacks);
  }

  /** The mode a NEW launch should use, per the live setting. */
  private currentMode(): Mode {
    return isInteractiveModeEnabled() && isTmuxAvailable() ? 'interactive' : 'headless';
  }

  private runnerFor(mode: Mode): RuntimeRunner {
    return mode === 'interactive' ? this.interactive : this.headless;
  }

  /** Which runner currently owns the agent (live process wins over the map). */
  private ownerOf(agentId: string): Mode | undefined {
    if (this.interactive.isRunning(agentId)) return 'interactive';
    if (this.headless.isRunning(agentId)) return 'headless';
    return this.owner.get(agentId);
  }

  private ownerRunner(agentId: string): RuntimeRunner {
    return this.runnerFor(this.ownerOf(agentId) ?? this.currentMode());
  }

  start(): void {
    // Both always start: each only recovers/manages its own session kind
    // (tc-<id> for headless, tc-int-<id> for interactive), so they never
    // conflict, and an in-flight agent of either kind survives a restart.
    this.headless.start();
    this.interactive.start();
  }

  async run(request: RuntimeCommandRequest): Promise<void> {
    const mode = this.currentMode();
    const prev = this.ownerOf(request.agentId);
    if (prev && prev !== mode) {
      log.log(`Agent ${request.agentId.slice(0, 8)} switching ${prev} → ${mode}; stopping old runner first`);
      await this.runnerFor(prev).stop(request.agentId, false);
    }
    this.owner.set(request.agentId, mode);
    return this.runnerFor(mode).run(request);
  }

  sendMessage(agentId: string, message: string): boolean {
    return this.ownerRunner(agentId).sendMessage(agentId, message);
  }

  queueMessage(agentId: string, message: string): boolean {
    return this.ownerRunner(agentId).queueMessage?.(agentId, message) ?? false;
  }

  async switchModel(agentId: string, model: string, effort?: string): Promise<boolean> {
    return this.ownerRunner(agentId).switchModel?.(agentId, model, effort) ?? false;
  }

  async stop(agentId: string, clearQueue?: boolean): Promise<void> {
    // Stop on whichever runner owns it; calling the other is a cheap no-op.
    await this.headless.stop(agentId, clearQueue);
    await this.interactive.stop(agentId, clearQueue);
    this.owner.delete(agentId);
  }

  async stopAll(killProcesses?: boolean, clearQueue?: boolean): Promise<void> {
    await this.headless.stopAll(killProcesses, clearQueue);
    await this.interactive.stopAll(killProcesses);
    this.owner.clear();
  }

  isRunning(agentId: string): boolean {
    return this.headless.isRunning(agentId) || this.interactive.isRunning(agentId);
  }

  hasRecentActivity(agentId: string, withinMs: number): boolean {
    return this.ownerRunner(agentId).hasRecentActivity(agentId, withinMs);
  }

  onNextActivity(agentId: string, callback: () => void): void {
    this.ownerRunner(agentId).onNextActivity(agentId, callback);
  }

  supportsStdin(): boolean {
    // Both Claude runners accept follow-up messages on a live session.
    return true;
  }

  closesStdinAfterPrompt(): boolean {
    return false;
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    return this.ownerRunner(agentId).getTurnState?.(agentId);
  }

  getQueuedMessages(agentId: string): string[] {
    return this.ownerRunner(agentId).getQueuedMessages?.(agentId) ?? [];
  }

  removeQueuedMessage(agentId: string, index: number, expectedText: string): boolean {
    return this.ownerRunner(agentId).removeQueuedMessage?.(agentId, index, expectedText) ?? false;
  }

  /** PID lookup used by runtime-service.getAgentRuntimeProcessInfo. */
  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    const headlessState = this.headless.getActiveProcessesState().map((p) => ({ agentId: p.agentId, pid: p.pid }));
    const interactiveState = this.interactive.getActiveProcessesState();
    return [...headlessState, ...interactiveState];
  }
}
