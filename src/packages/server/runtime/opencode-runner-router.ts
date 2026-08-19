/**
 * OpencodeRunnerRouter
 *
 * OpenCode agents can run two ways: the default per-turn `opencode run` runner
 * (ClaudeRunner driving an OpencodeBackend), or the experimental persistent
 * `opencode serve` runner that streams word-by-word `message.part.delta` tokens
 * over SSE and survives commander restarts. A NEW launch's mode is decided
 * per-run from the LIVE setting (isOpencodeServerModeEnabled) — no restart to
 * switch — mirroring ClaudeRunnerRouter and CodexRunnerRouter.
 */

import type {
  RuntimeRunner,
  RuntimeRunnerCallbacks,
  RuntimeCommandRequest,
} from './types.js';
import { ClaudeRunner } from '../claude/runner.js';
import { OpencodeBackend } from '../opencode/backend.js';
import {
  OpencodeServerRunner,
  type OpencodeModelCatalogReloadResult,
} from '../opencode/server/opencode-server-runner.js';
import { isOpencodeServerModeEnabled } from '../services/system-prompt-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OpencodeRouter');

type Mode = 'run' | 'server';

export class OpencodeRunnerRouter implements RuntimeRunner {
  private readonly run_: ClaudeRunner;
  private readonly server: OpencodeServerRunner;
  private readonly owner = new Map<string, Mode>();

  constructor(callbacks: RuntimeRunnerCallbacks) {
    this.run_ = new ClaudeRunner(callbacks, new OpencodeBackend());
    this.server = new OpencodeServerRunner(callbacks);
  }

  private currentMode(): Mode {
    return isOpencodeServerModeEnabled() ? 'server' : 'run';
  }

  private runnerFor(mode: Mode): RuntimeRunner {
    return mode === 'server' ? this.server : this.run_;
  }

  private ownerOf(agentId: string): Mode | undefined {
    if (this.server.isRunning(agentId)) return 'server';
    if (this.run_.isRunning(agentId)) return 'run';
    return this.owner.get(agentId);
  }

  private ownerRunner(agentId: string): RuntimeRunner {
    return this.runnerFor(this.ownerOf(agentId) ?? this.currentMode());
  }

  start(): void {
    this.run_.start?.();
    this.server.start?.();
  }

  requestModelCatalogReload(): OpencodeModelCatalogReloadResult {
    return this.server.requestModelCatalogReload();
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
    // Only the server runner can interrupt a turn in place; `opencode run`
    // falls back to the caller's stop+respawn path.
    return owner.interruptTurn ? owner.interruptTurn(agentId, clearQueue) : false;
  }

  getQueuedMessages(agentId: string): string[] {
    return this.ownerRunner(agentId).getQueuedMessages?.(agentId) ?? [];
  }

  removeQueuedMessage(agentId: string, index: number, expectedText: string): boolean {
    return this.ownerRunner(agentId).removeQueuedMessage?.(agentId, index, expectedText) ?? false;
  }

  async stop(agentId: string, clearQueue?: boolean): Promise<void> {
    await this.run_.stop(agentId, clearQueue);
    await this.server.stop(agentId, clearQueue);
    this.owner.delete(agentId);
  }

  async stopAll(killProcesses?: boolean, clearQueue?: boolean): Promise<void> {
    await this.run_.stopAll(killProcesses, clearQueue);
    await this.server.stopAll(killProcesses, clearQueue);
    this.owner.clear();
  }

  isRunning(agentId: string): boolean {
    return this.run_.isRunning(agentId) || this.server.isRunning(agentId);
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
    // Mode-dependent: `opencode run` closes stdin per turn, the server keeps the
    // session open. Report per the current setting so the delivery path matches.
    return this.currentMode() === 'run';
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    return this.ownerRunner(agentId).getTurnState?.(agentId);
  }

  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    const runState = this.run_.getActiveProcessesState().map((p) => ({ agentId: p.agentId, pid: p.pid }));
    const serverState = this.server.getActiveProcessesState();
    return [...runState, ...serverState];
  }
}
