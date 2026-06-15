/**
 * InteractiveClaudeRunner — experimental runtime that drives the real
 * interactive `claude` TUI inside a tmux session and reconstructs the
 * conversation from the session-transcript JSONL.
 *
 * It implements the same surface the runtime layer calls (RuntimeRunner) and
 * feeds reconstructed StandardEvents into a shared RunnerStdoutPipeline via
 * `emitStandardEvent`, so everything downstream (websocket broadcast, client
 * store, boss-delegation parsing, status transitions) is reused unchanged from
 * the headless path. It deliberately does NOT reuse ClaudeRunner: that class is
 * built around a stdin pipe + stdout JSON stream, neither of which exists here.
 */

import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  RunnerCallbacks,
  RunnerRequest,
  StandardEvent,
  BackendConfig,
} from '../types.js';
import type { RuntimeRunner } from '../../runtime/types.js';
import { ClaudeBackend } from '../backend.js';
import { RunnerInternalEventBus } from '../runner/internal-events.js';
import { RunnerStdoutPipeline } from '../runner/stdout-pipeline.js';
import {
  spawnInTmuxInteractive,
  sendPromptToTmuxInteractive,
  hasInteractiveTmuxSession,
  killInteractiveTmuxSession,
  interruptInteractiveTmuxSession,
  interactiveTmuxSessionName,
  listInteractiveTmuxSessions,
  getInteractiveTmuxPanePid,
} from '../runner/tmux-helper.js';
import { getProjectDir } from '../session-loader.js';
import { buildInteractiveClaudeArgs } from './interactive-backend-args.js';
import { InteractiveJsonlWatcher } from './interactive-jsonl-watcher.js';
import {
  loadInteractiveProcesses,
  saveInteractiveProcesses,
  clearInteractiveProcesses,
  type InteractivePersistedProcess,
} from './interactive-recovery-store.js';
import * as agentService from '../../services/agent-service.js';
import { createLogger } from '../../utils/logger.js';
import { withAgentContext } from '../../utils/log-context.js';

const log = createLogger('Interactive');

// Delay before delivering the first prompt, giving the TUI time to mount.
const TUI_READY_DELAY_MS = 1200;
// Liveness watchdog cadence: detect a TUI/tmux session that died so the agent
// doesn't stay stuck as 'working'.
const LIVENESS_INTERVAL_MS = 10000;
// How often to persist transcript offsets for crash recovery.
const PERSIST_INTERVAL_MS = 10000;
// Delay recovery slightly so the rest of the server (websocket, agents) is up
// before we replay catch-up events / broadcast completions.
const RECOVER_DELAY_MS = 1500;

interface InteractiveProcess {
  agentId: string;
  sessionId: string;
  startTime: number;
  turnState: 'processing' | 'waiting_for_input';
  tmuxSession: string;
  jsonlPath: string;
  lastActivityTime: number;
  watcher: InteractiveJsonlWatcher;
  lastRequest: RunnerRequest;
}

export class InteractiveClaudeRunner implements RuntimeRunner {
  private readonly callbacks: RunnerCallbacks;
  private readonly backend = new ClaudeBackend();
  private readonly bus = new RunnerInternalEventBus();
  private readonly pipeline: RunnerStdoutPipeline;
  private readonly processes = new Map<string, InteractiveProcess>();
  private readonly activityCallbacks = new Map<string, Array<() => void>>();
  private livenessTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private started = false;
  // Guard so a run/stop arriving during the startup recovery window can't
  // overwrite the on-disk recovery file before recoverProcesses() has read it.
  private recovered = false;

  constructor(callbacks: RunnerCallbacks) {
    this.callbacks = callbacks;
    this.pipeline = new RunnerStdoutPipeline({
      backend: this.backend,
      callbacks: this.callbacks,
      bus: this.bus,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Reconnect to sessions that survived a prior commander instance, slightly
    // deferred so the rest of the server is up before we replay catch-up events.
    setTimeout(() => {
      this.recoverProcesses();
      // Persist the reconnected set immediately so an instant re-crash can still
      // recover, then keep it fresh on an interval.
      this.persistAll();
      this.persistTimer = setInterval(() => this.persistAll(), PERSIST_INTERVAL_MS);
    }, RECOVER_DELAY_MS);

    this.livenessTimer = setInterval(() => this.checkLiveness(), LIVENESS_INTERVAL_MS);
    log.log('🛡️ Interactive runner started (TUI mode)');
  }

  /**
   * Reconnect to interactive tmux sessions that survived a prior commander
   * instance: resume tailing each transcript from the persisted byte offset
   * (replaying only the lines written while we were down — deduped downstream by
   * uuid, so no visible duplicates). Sessions whose agent was deleted, or live
   * sessions with no persistence entry, are killed.
   */
  private recoverProcesses(): void {
    const saved = loadInteractiveProcesses();
    for (const entry of saved) {
      if (this.processes.has(entry.agentId)) continue;
      const agent = agentService.getAgent(entry.agentId);
      if (!agent) {
        if (hasInteractiveTmuxSession(entry.agentId)) {
          log.log(`Killing interactive session for deleted agent ${entry.agentId.slice(0, 8)}`);
          killInteractiveTmuxSession(entry.agentId);
        }
        continue;
      }
      if (!entry.lastRequest) {
        log.log(`Skipping reconnect for ${entry.agentId.slice(0, 8)} — no saved request`);
        continue;
      }
      this.reconnect(entry);
    }

    // Sweep any live interactive session we did NOT reconnect (orphan from an
    // older instance with no/stale persistence entry).
    for (const agentId of listInteractiveTmuxSessions()) {
      if (this.processes.has(agentId)) continue;
      log.log(`Sweeping orphaned interactive tmux session for agent ${agentId.slice(0, 8)}`);
      killInteractiveTmuxSession(agentId);
    }

    this.recovered = true;
  }

  private reconnect(entry: InteractivePersistedProcess): void {
    const watcher = new InteractiveJsonlWatcher({
      agentId: entry.agentId,
      jsonlPath: entry.jsonlPath,
      startAtEnd: false,
      startOffset: entry.jsonlOffset,
      onEvent: (event) => this.onTranslatedEvent(entry.agentId, event),
      onActivity: () => this.onActivity(entry.agentId),
    });
    const proc: InteractiveProcess = {
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      startTime: entry.startTime,
      turnState: entry.turnState,
      tmuxSession: entry.tmuxSession,
      jsonlPath: entry.jsonlPath,
      lastActivityTime: Date.now(),
      watcher,
      lastRequest: entry.lastRequest!,
    };
    this.processes.set(entry.agentId, proc);
    // start() synchronously reads from the saved offset to EOF, emitting any
    // events that landed while we were down (incl. a trailing end_turn →
    // step_complete → idle), then continues live-tailing.
    watcher.start();

    if (hasInteractiveTmuxSession(entry.agentId)) {
      log.log(`🔄 [INTERACTIVE] Reconnected agent ${entry.agentId.slice(0, 8)} (${entry.tmuxSession}, offset ${entry.jsonlOffset}) — resumed live tail`);
      return;
    }
    // The TUI exited while we were down. We've replayed the final transcript
    // bytes above; finalize so the agent leaves 'working'.
    log.log(`🔄 [INTERACTIVE] Agent ${entry.agentId.slice(0, 8)} session ended during downtime — finalized from transcript`);
    watcher.drain();
    watcher.stop();
    this.processes.delete(entry.agentId);
    this.callbacks.onComplete(entry.agentId, true);
  }

  private persistAll(): void {
    // Don't clobber the recovery file before we've consumed it on startup.
    if (!this.recovered) return;
    const list: InteractivePersistedProcess[] = [];
    for (const [agentId, proc] of this.processes) {
      const agent = agentService.getAgent(agentId);
      list.push({
        agentId,
        sessionId: proc.sessionId,
        workingDir: proc.lastRequest.workingDir,
        jsonlPath: proc.jsonlPath,
        jsonlOffset: proc.watcher.getOffset(),
        tmuxSession: proc.tmuxSession,
        startTime: proc.startTime,
        turnState: proc.turnState,
        agentStatus: agent?.status,
        lastRequest: proc.lastRequest,
      });
    }
    saveInteractiveProcesses(list);
  }

  async run(request: RunnerRequest): Promise<void> {
    await withAgentContext(request.agentId, () => this.runImpl(request));
  }

  private async runImpl(request: RunnerRequest): Promise<void> {
    const { agentId, prompt, workingDir } = request;

    // Clean up any existing session/watcher for this agent first.
    await this.stopImpl(agentId);

    const isNew = request.forceNewSession || !request.sessionId;
    const sessionId = isNew ? randomUUID() : request.sessionId!;
    const resume = !isNew;

    // Persist the (possibly self-assigned) session id immediately so the
    // transcript path is resolvable and survives a server restart.
    agentService.updateAgent(agentId, { sessionId });
    this.callbacks.onSessionId(agentId, sessionId);

    const jsonlPath = path.join(getProjectDir(workingDir), `${sessionId}.jsonl`);

    const config: BackendConfig = {
      agentId,
      sessionId,
      model: request.model,
      effort: request.effort,
      workingDir,
      permissionMode: 'bypass',
      useChrome: request.useChrome,
      systemPrompt: request.systemPrompt,
      customAgent: request.customAgent,
    };
    const args = buildInteractiveClaudeArgs(config, { sessionId, resume });
    const executable = this.backend.getExecutablePath();

    const env = {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TIDE_SERVER: `http://localhost:${process.env.TIDE_PORT || process.env.PORT || 5174}`,
      TIDE_AGENT_ID: agentId,
    };

    log.log(`🚀 [INTERACTIVE] Spawning ${executable} ${args.join(' ')} (resume=${resume})`);
    const { sessionName } = spawnInTmuxInteractive(executable, args, {
      agentId,
      cwd: workingDir,
      env,
    });

    const watcher = new InteractiveJsonlWatcher({
      agentId,
      jsonlPath,
      startAtEnd: resume,
      onEvent: (event) => this.onTranslatedEvent(agentId, event),
      onActivity: () => this.onActivity(agentId),
    });

    const proc: InteractiveProcess = {
      agentId,
      sessionId,
      startTime: Date.now(),
      turnState: 'processing',
      tmuxSession: sessionName,
      jsonlPath,
      lastActivityTime: Date.now(),
      watcher,
      lastRequest: request,
    };
    this.processes.set(agentId, proc);
    watcher.start();
    // Capture the freshly-spawned session for crash recovery right away.
    this.persistAll();

    // Deliver the first prompt after the TUI has had a moment to mount. Uniform
    // input path — the same send used for follow-ups.
    setTimeout(() => {
      if (!this.processes.has(agentId)) return; // stopped before ready
      log.log(`📤 [INTERACTIVE] Delivering initial prompt (${prompt.length} chars) to ${agentId.slice(0, 8)}`);
      const ok = sendPromptToTmuxInteractive(agentId, prompt);
      if (!ok) {
        this.callbacks.onError(agentId, 'Failed to deliver initial prompt to interactive session');
      }
    }, TUI_READY_DELAY_MS);
  }

  private onTranslatedEvent(agentId: string, event: StandardEvent): void {
    const proc = this.processes.get(agentId);
    if (!proc) return;

    if (
      event.type === 'init' ||
      event.type === 'text' ||
      event.type === 'tool_start' ||
      event.type === 'thinking'
    ) {
      proc.turnState = 'processing';
    } else if (event.type === 'step_complete') {
      proc.turnState = 'waiting_for_input';
    }

    this.pipeline.emitStandardEvent(agentId, event);
  }

  private onActivity(agentId: string): void {
    const proc = this.processes.get(agentId);
    if (proc) {
      proc.lastActivityTime = Date.now();
    }
    const callbacks = this.activityCallbacks.get(agentId);
    if (!callbacks || callbacks.length === 0) return;
    for (const cb of callbacks) {
      try {
        cb();
      } catch (err) {
        log.error(`Activity callback error for ${agentId}:`, err);
      }
    }
    this.activityCallbacks.delete(agentId);
  }

  private checkLiveness(): void {
    let changed = false;
    for (const [agentId, proc] of [...this.processes.entries()]) {
      if (hasInteractiveTmuxSession(agentId)) continue;
      // The TUI/tmux session died (user /exit, crash, or kill). Catch any
      // trailing transcript bytes, then finalize so the agent leaves 'working'.
      log.log(`💀 [INTERACTIVE] Session ${proc.tmuxSession} gone — finalizing agent ${agentId.slice(0, 8)}`);
      try {
        proc.watcher.drain();
      } catch { /* ignore */ }
      proc.watcher.stop();
      this.processes.delete(agentId);
      this.callbacks.onComplete(agentId, true);
      changed = true;
    }
    if (changed) this.persistAll();
  }

  sendMessage(agentId: string, message: string): boolean {
    return withAgentContext(agentId, () => {
      const proc = this.processes.get(agentId);
      if (!proc) {
        log.error(`❌ [INTERACTIVE] No active session for agent ${agentId}`);
        return false;
      }
      const ok = sendPromptToTmuxInteractive(agentId, message);
      if (ok) {
        proc.turnState = 'processing';
        proc.lastActivityTime = Date.now();
      }
      return ok;
    });
  }

  async stop(agentId: string, _clearQueue: boolean = true): Promise<void> {
    await withAgentContext(agentId, () => this.stopImpl(agentId));
  }

  private async stopImpl(agentId: string): Promise<void> {
    const proc = this.processes.get(agentId);
    if (proc) {
      try {
        proc.watcher.drain();
      } catch { /* ignore */ }
      proc.watcher.stop();
      this.processes.delete(agentId);
    }
    // Always attempt to kill the session even if we weren't tracking it
    // (e.g. a stale session from before a restart).
    if (hasInteractiveTmuxSession(agentId)) {
      killInteractiveTmuxSession(agentId);
    }
    this.activityCallbacks.delete(agentId);
    // Drop the explicitly-stopped agent from the recovery file.
    this.persistAll();
  }

  async stopAll(killProcesses: boolean = true): Promise<void> {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    // Graceful restart (killProcesses=false): capture fresh transcript offsets
    // so we reconnect and resume the live tail after restart, and leave the
    // detached tmux sessions running.
    if (!killProcesses) {
      this.persistAll();
    }

    for (const agentId of [...this.processes.keys()]) {
      const proc = this.processes.get(agentId);
      proc?.watcher.stop();
      this.processes.delete(agentId);
      if (killProcesses) {
        killInteractiveTmuxSession(agentId);
      }
    }

    // Clean shutdown that killed everything → nothing to recover.
    if (killProcesses) {
      clearInteractiveProcesses();
    }
  }

  isRunning(agentId: string): boolean {
    const proc = this.processes.get(agentId);
    if (!proc) return false;
    if (hasInteractiveTmuxSession(agentId)) return true;
    // Session died — clean up lazily.
    proc.watcher.stop();
    this.processes.delete(agentId);
    return false;
  }

  interrupt(agentId: string): boolean {
    return withAgentContext(agentId, () => {
      if (!this.processes.has(agentId)) return false;
      return interruptInteractiveTmuxSession(agentId);
    });
  }

  supportsStdin(): boolean {
    // Follow-up messages are delivered via tmux send-keys, so the runtime layer
    // should reuse the live session (sendMessage) rather than respawn.
    return true;
  }

  closesStdinAfterPrompt(): boolean {
    return false;
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    return this.processes.get(agentId)?.turnState;
  }

  hasRecentActivity(agentId: string, withinMs: number): boolean {
    const proc = this.processes.get(agentId);
    if (!proc) return false;
    const last = proc.lastActivityTime || proc.startTime;
    return Date.now() - last < withinMs;
  }

  onNextActivity(agentId: string, callback: () => void): void {
    if (!this.activityCallbacks.has(agentId)) {
      this.activityCallbacks.set(agentId, []);
    }
    this.activityCallbacks.get(agentId)!.push(callback);
  }

  getActiveProcessCount(): number {
    return this.processes.size;
  }

  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    return [...this.processes.keys()].map((agentId) => ({
      agentId,
      pid: getInteractiveTmuxPanePid(agentId),
    }));
  }

  /** Diagnostic helper mirroring tmuxSessionName usage in the headless runner. */
  getSessionName(agentId: string): string {
    return interactiveTmuxSessionName(agentId);
  }
}
