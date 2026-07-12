/**
 * CodexRunnerRouter
 *
 * Codex agents can run two ways: the default per-turn `codex exec` runner (the
 * ClaudeRunner shell driving a CodexBackend), or the experimental persistent
 * `codex app-server` runner that streams word-by-word agent-message deltas.
 * Which one a NEW launch uses is decided per-run from the LIVE setting
 * (isCodexAppServerModeEnabled) — no server restart needed to switch, mirroring
 * ClaudeRunnerRouter's headless/interactive split.
 *
 * The router owns one instance of each runner and delegates the RuntimeRunner
 * surface to whichever currently owns the agent (live thread/process wins over
 * the setting), tearing the other down on a mode switch so one agent never has
 * two live backends.
 */

import type {
  RuntimeRunner,
  RuntimeRunnerCallbacks,
  RuntimeCommandRequest,
} from './types.js';
import { ClaudeRunner } from '../claude/runner.js';
import { CodexBackend } from '../codex/backend.js';
import { CodexAppServerRunner } from '../codex/app-server/codex-app-server-runner.js';
import { isCodexAppServerModeEnabled } from '../services/system-prompt-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CodexRouter');

type Mode = 'exec' | 'app-server';

export class CodexRunnerRouter implements RuntimeRunner {
  private readonly exec: ClaudeRunner;
  private readonly appServer: CodexAppServerRunner;
  private readonly owner = new Map<string, Mode>();

  constructor(callbacks: RuntimeRunnerCallbacks) {
    this.exec = new ClaudeRunner(callbacks, new CodexBackend());
    this.appServer = new CodexAppServerRunner(callbacks);
  }

  private currentMode(): Mode {
    return isCodexAppServerModeEnabled() ? 'app-server' : 'exec';
  }

  private runnerFor(mode: Mode): RuntimeRunner {
    return mode === 'app-server' ? this.appServer : this.exec;
  }

  private ownerOf(agentId: string): Mode | undefined {
    if (this.appServer.isRunning(agentId)) return 'app-server';
    if (this.exec.isRunning(agentId)) return 'exec';
    return this.owner.get(agentId);
  }

  private ownerRunner(agentId: string): RuntimeRunner {
    return this.runnerFor(this.ownerOf(agentId) ?? this.currentMode());
  }

  start(): void {
    this.exec.start?.();
    this.appServer.start?.();
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

  async stop(agentId: string, clearQueue?: boolean): Promise<void> {
    await this.exec.stop(agentId, clearQueue);
    await this.appServer.stop(agentId, clearQueue);
    this.owner.delete(agentId);
  }

  async stopAll(killProcesses?: boolean, clearQueue?: boolean): Promise<void> {
    await this.exec.stopAll(killProcesses, clearQueue);
    await this.appServer.stopAll(killProcesses, clearQueue);
    this.owner.clear();
  }

  isRunning(agentId: string): boolean {
    return this.exec.isRunning(agentId) || this.appServer.isRunning(agentId);
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
    // Mode-dependent: exec closes stdin per turn, app-server keeps it open. The
    // caller uses this to decide queue-vs-write; report per current owner so the
    // right delivery path is chosen for the agent that's actually running.
    return this.currentMode() === 'exec';
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    return this.ownerRunner(agentId).getTurnState?.(agentId);
  }

  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    const execState = this.exec.getActiveProcessesState().map((p) => ({ agentId: p.agentId, pid: p.pid }));
    const appState = this.appServer.getActiveProcessesState();
    return [...execState, ...appState];
  }
}
