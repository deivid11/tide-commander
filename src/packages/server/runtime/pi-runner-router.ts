/**
 * PiRunnerRouter
 *
 * Pi agents can run two ways: the default single-shot `pi --mode json -p`
 * runner (ClaudeRunner driving a PiBackend; mid-run messages queue until the
 * process exits), or the `pi --mode rpc` runner that keeps a persistent
 * process per agent and STEERS mid-turn messages into the live run. A NEW
 * launch's mode is decided per-run from the LIVE setting (isPiRpcModeEnabled)
 * — no restart to switch — mirroring OpencodeRunnerRouter/CodexRunnerRouter.
 */

import type {
  RuntimeRunner,
  RuntimeRunnerCallbacks,
  RuntimeCommandRequest,
} from './types.js';
import { ClaudeRunner } from '../claude/runner.js';
import { PiBackend } from '../pi/backend.js';
import { PiRpcRunner } from '../pi/rpc/pi-rpc-runner.js';
import { isPiRpcModeEnabled } from '../services/system-prompt-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PiRouter');

type Mode = 'single' | 'rpc';

export class PiRunnerRouter implements RuntimeRunner {
  private readonly single: ClaudeRunner;
  private readonly rpc: PiRpcRunner;
  private readonly owner = new Map<string, Mode>();

  constructor(callbacks: RuntimeRunnerCallbacks) {
    this.single = new ClaudeRunner(callbacks, new PiBackend());
    this.rpc = new PiRpcRunner(callbacks);
  }

  private currentMode(): Mode {
    return isPiRpcModeEnabled() ? 'rpc' : 'single';
  }

  private runnerFor(mode: Mode): RuntimeRunner {
    return mode === 'rpc' ? this.rpc : this.single;
  }

  private ownerOf(agentId: string): Mode | undefined {
    if (this.rpc.isRunning(agentId)) return 'rpc';
    if (this.single.isRunning(agentId)) return 'single';
    return this.owner.get(agentId);
  }

  private ownerRunner(agentId: string): RuntimeRunner {
    return this.runnerFor(this.ownerOf(agentId) ?? this.currentMode());
  }

  start(): void {
    this.single.start?.();
    this.rpc.start?.();
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

  async interruptTurn(agentId: string, clearQueue?: boolean): Promise<boolean> {
    const owner = this.ownerRunner(agentId);
    // Only the RPC runner can interrupt a turn in place; single-shot mode
    // falls back to the caller's stop+respawn path.
    return owner.interruptTurn ? owner.interruptTurn(agentId, clearQueue) : false;
  }

  async compactContext(agentId: string, customInstructions?: string): Promise<boolean> {
    const owner = this.ownerRunner(agentId);
    // Built-in slash commands are TUI-only when sent as prompts in RPC mode.
    // Delegate to the RPC runner's native `{ type: 'compact' }` operation.
    return owner.compactContext
      ? owner.compactContext(agentId, customInstructions)
      : false;
  }

  async switchModel(agentId: string, model: string, effort?: string): Promise<boolean> {
    const owner = this.ownerRunner(agentId);
    return owner.switchModel ? owner.switchModel(agentId, model, effort) : false;
  }

  getQueuedMessages(agentId: string): string[] {
    return this.ownerRunner(agentId).getQueuedMessages?.(agentId) ?? [];
  }

  removeQueuedMessage(agentId: string, index: number, expectedText: string): boolean {
    return this.ownerRunner(agentId).removeQueuedMessage?.(agentId, index, expectedText) ?? false;
  }

  async stop(agentId: string, clearQueue?: boolean): Promise<void> {
    await this.single.stop(agentId, clearQueue);
    await this.rpc.stop(agentId, clearQueue);
    this.owner.delete(agentId);
  }

  async stopAll(killProcesses?: boolean, clearQueue?: boolean): Promise<void> {
    await this.single.stopAll(killProcesses, clearQueue);
    await this.rpc.stopAll(killProcesses, clearQueue);
    this.owner.clear();
  }

  isRunning(agentId: string): boolean {
    return this.single.isRunning(agentId) || this.rpc.isRunning(agentId);
  }

  hasRecentActivity(agentId: string, withinMs: number): boolean {
    return this.ownerRunner(agentId).hasRecentActivity(agentId, withinMs);
  }

  onNextActivity(agentId: string, callback: () => void): void {
    this.ownerRunner(agentId).onNextActivity(agentId, callback);
  }

  supportsStdin(): boolean {
    return true;
  }

  closesStdinAfterPrompt(): boolean {
    // Mode-dependent: single-shot closes per turn (queue+respawn delivery);
    // the RPC process keeps stdin open and steers mid-turn messages.
    return this.currentMode() === 'single';
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    return this.ownerRunner(agentId).getTurnState?.(agentId);
  }

  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    const singleState = this.single.getActiveProcessesState().map((p) => ({ agentId: p.agentId, pid: p.pid }));
    const rpcState = this.rpc.getActiveProcessesState();
    return [...singleState, ...rpcState];
  }
}
