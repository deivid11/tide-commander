/**
 * CodexAppServerRunner — experimental runtime that drives Codex agents through a
 * persistent, restart-surviving `codex app-server` (WebSocket transport) instead
 * of one `codex exec` process per turn.
 *
 * Why it exists: `codex exec --experimental-json` emits the whole assistant
 * reply as a single `item.completed`, so Codex replies can never typewriter.
 * app-server streams `item/agentMessage/delta` tokens.
 *
 * Persistence: the app-server is spawned DETACHED on a localhost WebSocket, so
 * it outlives commander restarts and keeps running any in-flight turn. On boot
 * the runner rejoins the live daemon and `thread/resume` re-subscribes to each
 * agent's thread — the server even replays the turn's remaining deltas. State
 * needed to reconnect is persisted in a dedicated recovery file.
 *
 * Downstream reuse: reconstructed StandardEvents are fed into a shared
 * RunnerStdoutPipeline via `emitStandardEvent` (the CodexBackend's
 * `.name === 'codex'` turns on the pipeline's stream-coalescing), so websocket
 * broadcast, client merge-by-uuid, boss delegation and context tracking are all
 * reused unchanged from the exec path.
 */

import * as os from 'os';
import type {
  RunnerCallbacks,
  RunnerRequest,
  StandardEvent,
  BackendConfig,
} from '../../claude/types.js';
import type { RuntimeRunner } from '../../runtime/types.js';
import { CodexBackend, buildCodexPrompt } from '../backend.js';
import { RunnerInternalEventBus } from '../../claude/runner/internal-events.js';
import { RunnerStdoutPipeline } from '../../claude/runner/stdout-pipeline.js';
import { CodexAppServerProcess } from './app-server-process.js';
import { CodexAppServerEventAdapter } from './app-server-event-adapter.js';
import {
  loadAppServerAgents,
  saveAppServerAgents,
  type PersistedAppServerAgent,
} from './app-server-recovery-store.js';
import * as agentService from '../../services/agent-service.js';
import { createLogger } from '../../utils/logger.js';
import { withAgentContext } from '../../utils/log-context.js';

const log = createLogger('CodexAppServerRunner');

/** Defer recovery slightly so the rest of the server is up before we replay. */
const RECOVER_DELAY_MS = 1500;

interface AgentState {
  threadId: string;
  sessionId: string; // identical to threadId
  adapter: CodexAppServerEventAdapter;
  turnState: 'processing' | 'waiting_for_input';
  startTime: number;
  lastActivityTime: number;
  lastRequest: RunnerRequest;
  /** Follow-up prompts sent while a turn was in flight (delivered on turn end). */
  queue: string[];
}

export class CodexAppServerRunner implements RuntimeRunner {
  private readonly callbacks: RunnerCallbacks;
  private readonly backend = new CodexBackend();
  private readonly bus = new RunnerInternalEventBus();
  private readonly pipeline: RunnerStdoutPipeline;
  private readonly agents = new Map<string, AgentState>();
  private readonly threadToAgent = new Map<string, string>();
  private readonly activityCallbacks = new Map<string, Array<() => void>>();
  private process: CodexAppServerProcess | null = null;
  private started = false;
  /** Guard so run/stop during the recovery window can't clobber the file first. */
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
    setTimeout(() => { void this.recover(); }, RECOVER_DELAY_MS);
    log.log('🛡️ Codex app-server runner started (streaming, restart-surviving)');
  }

  private ensureProcess(spawnCwd: string): CodexAppServerProcess {
    if (this.process && this.process.isAlive()) return this.process;
    this.process = new CodexAppServerProcess({
      executablePath: this.backend.getExecutablePath(),
      cwd: spawnCwd || os.homedir(),
      extraEnv: this.backend.getExtraEnv(),
      onNotification: (method, params) => this.routeNotification(method, params),
      onExit: () => this.handleProcessExit(),
    });
    return this.process;
  }

  /**
   * On boot, rejoin the surviving daemon and re-subscribe each persisted agent's
   * thread so an in-flight turn keeps streaming and finalizes correctly.
   */
  private async recover(): Promise<void> {
    const persisted = loadAppServerAgents();
    this.recovered = true;
    if (persisted.length === 0) {
      this.persistAgents();
      return;
    }
    const spawnCwd = persisted[0].workingDir || os.homedir();
    const proc = this.ensureProcess(spawnCwd);
    try {
      await proc.ensureStarted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Recovery: could not reach app-server (${msg}); agents will lazy-resume on next message`);
      this.finalizeStale(persisted);
      return;
    }

    if (!proc.didReconnect()) {
      // A fresh daemon was spawned — the old in-flight turns are gone with the
      // old daemon. sessionId is persisted on each agent, so the next message
      // resumes the conversation; just finalize any that were mid-turn.
      log.log('Recovery: fresh daemon (old turns gone); finalizing mid-turn agents');
      this.finalizeStale(persisted);
      return;
    }

    log.log(`🔗 Recovery: rejoined daemon; re-subscribing ${persisted.length} thread(s)`);
    for (const p of persisted) {
      await this.resubscribe(proc, p);
    }
    this.persistAgents();
  }

  private finalizeStale(persisted: PersistedAppServerAgent[]): void {
    for (const p of persisted) {
      if (p.agentStatus === 'working' || p.turnState === 'processing') {
        this.callbacks.onComplete(p.agentId, true);
      }
    }
    saveAppServerAgents([]);
  }

  private async resubscribe(proc: CodexAppServerProcess, p: PersistedAppServerAgent): Promise<void> {
    const state: AgentState = {
      threadId: p.threadId,
      sessionId: p.threadId,
      adapter: new CodexAppServerEventAdapter(),
      turnState: p.turnState,
      startTime: Date.now(),
      lastActivityTime: Date.now(),
      lastRequest: p.lastRequest,
      queue: [],
    };
    this.agents.set(p.agentId, state);
    this.threadToAgent.set(p.threadId, p.agentId);

    if (p.agentStatus === 'working' && agentService.getAgent(p.agentId)) {
      agentService.updateAgent(p.agentId, { status: 'working' });
    }

    // thread/resume re-attaches this connection to the thread's live stream (the
    // server replays an in-flight turn's remaining deltas). thread/read tells us
    // whether the turn already ended while we were down.
    proc.request('thread/resume', { threadId: p.threadId }).catch(() => { /* best-effort */ });
    let read: unknown = null;
    try {
      read = await proc.request('thread/read', { threadId: p.threadId, includeTurns: true });
    } catch { /* ignore */ }

    const turns = (read as { thread?: { turns?: Array<{ status?: string }> }; turns?: Array<{ status?: string }> })?.thread?.turns
      ?? (read as { turns?: Array<{ status?: string }> })?.turns;
    const latest = Array.isArray(turns) && turns.length > 0 ? turns[turns.length - 1] : undefined;
    if (latest && latest.status && latest.status !== 'inProgress') {
      // The turn finished during the downtime — we won't get a fresh
      // turn/completed, so finalize now.
      state.turnState = 'waiting_for_input';
      this.callbacks.onComplete(p.agentId, latest.status !== 'failed');
    }
    // Otherwise it's still inProgress: thread/resume subscribed us, and the
    // replayed deltas + turn/completed will finalize it via applyEvent().
  }

  private handleProcessExit(): void {
    // The WebSocket to the daemon dropped. Finalize live agents so none stays
    // stuck 'working'; the daemon itself likely survives, so the next message
    // reconnects and resumes.
    const agentIds = [...this.agents.keys()];
    log.warn(`app-server connection lost — finalizing ${agentIds.length} agent(s)`);
    this.agents.clear();
    this.threadToAgent.clear();
    this.process = null;
    for (const agentId of agentIds) this.callbacks.onComplete(agentId, false);
  }

  private routeNotification(method: string, params: Record<string, unknown>): void {
    const threadId = typeof params.threadId === 'string' ? params.threadId : undefined;
    if (!threadId) return;
    const agentId = this.threadToAgent.get(threadId);
    if (!agentId) return;
    const state = this.agents.get(agentId);
    if (!state) return;

    state.lastActivityTime = Date.now();
    this.fireActivity(agentId);

    for (const event of state.adapter.handle(method, params)) {
      this.applyEvent(agentId, state, event);
    }
  }

  private applyEvent(agentId: string, state: AgentState, event: StandardEvent): void {
    if (event.type === 'text' || event.type === 'tool_start' || event.type === 'thinking' || event.type === 'init') {
      state.turnState = 'processing';
    }

    this.pipeline.emitStandardEvent(agentId, event);

    if (event.type === 'step_complete') {
      state.turnState = 'waiting_for_input';
      this.persistAgents();
      // The daemon stays alive across turns, so there's no process 'close' to
      // flip the agent idle. runtime-events skips the idle transition for codex
      // on step_complete (it expects it on process exit), so drive it here.
      this.callbacks.onComplete(agentId, true);
      this.drainQueue(agentId, state);
    }
  }

  async run(request: RunnerRequest): Promise<void> {
    await withAgentContext(request.agentId, () => this.runImpl(request));
  }

  private async runImpl(request: RunnerRequest): Promise<void> {
    const { agentId, workingDir } = request;
    const proc = this.ensureProcess(workingDir);
    try {
      await proc.ensureStarted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to start app-server for ${agentId.slice(0, 8)}: ${msg}`);
      this.callbacks.onError(agentId, `Codex app-server failed to start: ${msg}`);
      return;
    }

    const wantNew = request.forceNewSession || !request.sessionId;
    let state = this.agents.get(agentId);

    if (state && wantNew) {
      this.threadToAgent.delete(state.threadId);
      this.agents.delete(agentId);
      state = undefined;
    }

    if (!state) {
      const threadId = await this.openThread(agentId, request, proc, wantNew);
      if (!threadId) return;
      state = {
        threadId,
        sessionId: threadId,
        adapter: new CodexAppServerEventAdapter(),
        turnState: 'processing',
        startTime: Date.now(),
        lastActivityTime: Date.now(),
        lastRequest: request,
        queue: [],
      };
      this.agents.set(agentId, state);
      this.threadToAgent.set(threadId, agentId);
      agentService.updateAgent(agentId, { sessionId: threadId });
      this.callbacks.onSessionId(agentId, threadId);
      this.pipeline.emitStandardEvent(agentId, {
        type: 'init',
        sessionId: threadId,
        model: this.threadModel(request) || 'codex',
      });
    } else {
      state.lastRequest = request;
    }

    await this.startTurn(agentId, state, request.prompt, proc);
    this.persistAgents();
  }

  private async openThread(
    agentId: string,
    request: RunnerRequest,
    proc: CodexAppServerProcess,
    wantNew: boolean,
  ): Promise<string | null> {
    const baseParams: Record<string, unknown> = {
      cwd: request.workingDir,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    };
    const model = this.threadModel(request);
    if (model) baseParams.model = model;
    const effort = request.codexConfig?.reasoningEffort;
    if (effort) baseParams.config = { model_reasoning_effort: effort };

    try {
      if (!wantNew && request.sessionId) {
        const result = (await proc.request('thread/resume', {
          ...baseParams,
          threadId: request.sessionId,
        })) as { thread?: { id?: string } };
        const id = result?.thread?.id || request.sessionId;
        log.log(`🔄 Resumed thread ${id.slice(0, 8)} for agent ${agentId.slice(0, 8)}`);
        return id;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`thread/resume failed for ${agentId.slice(0, 8)} (${msg}) — starting a fresh thread`);
    }

    try {
      const result = (await proc.request('thread/start', baseParams)) as { thread?: { id?: string } };
      const id = result?.thread?.id;
      if (!id) throw new Error('thread/start returned no thread id');
      log.log(`🆕 Started thread ${id.slice(0, 8)} for agent ${agentId.slice(0, 8)}`);
      return id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`thread/start failed for ${agentId.slice(0, 8)}: ${msg}`);
      this.callbacks.onError(agentId, `Codex app-server thread failed: ${msg}`);
      return null;
    }
  }

  private threadModel(request: RunnerRequest): string | undefined {
    const model = request.model;
    if (!model) return undefined;
    if (model === 'codex' || model === 'sonnet' || model === 'opus' || model === 'haiku' || model.startsWith('claude-')) {
      return undefined;
    }
    return model;
  }

  private async startTurn(
    agentId: string,
    state: AgentState,
    prompt: string,
    proc: CodexAppServerProcess,
  ): Promise<void> {
    const config: BackendConfig = {
      agentId,
      sessionId: state.threadId,
      model: state.lastRequest.model,
      workingDir: state.lastRequest.workingDir,
      systemPrompt: state.lastRequest.systemPrompt,
      customAgent: state.lastRequest.customAgent,
      codexConfig: state.lastRequest.codexConfig,
      prompt,
    };
    const promptText = buildCodexPrompt(config);

    state.turnState = 'processing';
    state.lastActivityTime = Date.now();

    try {
      await proc.request('turn/start', {
        threadId: state.threadId,
        input: [{ type: 'text', text: promptText }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`turn/start failed for ${agentId.slice(0, 8)}: ${msg}`);
      this.callbacks.onError(agentId, `Codex turn failed: ${msg}`);
    }
  }

  private drainQueue(agentId: string, state: AgentState): void {
    if (state.queue.length === 0) return;
    const next = state.queue.shift()!;
    const proc = this.process;
    if (!proc || !proc.isAlive()) {
      state.queue.unshift(next);
      return;
    }
    log.log(`📤 Delivering queued follow-up to ${agentId.slice(0, 8)} (${state.queue.length} remaining)`);
    agentService.updateAgent(agentId, { status: 'working', currentTask: next.substring(0, 100) });
    void this.startTurn(agentId, state, next, proc);
  }

  sendMessage(agentId: string, message: string): boolean {
    return withAgentContext(agentId, () => {
      const state = this.agents.get(agentId);
      if (!state) {
        log.warn(`sendMessage: no live thread for ${agentId.slice(0, 8)}`);
        return false;
      }
      const proc = this.process;
      if (!proc || !proc.isAlive()) return false;

      if (state.turnState === 'processing') {
        state.queue.push(message);
        log.log(`📋 Queued mid-turn message for ${agentId.slice(0, 8)} (queue=${state.queue.length})`);
        return true;
      }

      void this.startTurn(agentId, state, message, proc);
      return true;
    });
  }

  async stop(agentId: string, _clearQueue: boolean = true): Promise<void> {
    await withAgentContext(agentId, async () => {
      const state = this.agents.get(agentId);
      if (!state) return;
      const proc = this.process;
      if (proc && proc.isAlive() && state.turnState === 'processing') {
        try {
          await proc.request('turn/interrupt', { threadId: state.threadId });
        } catch { /* best-effort */ }
      }
      this.threadToAgent.delete(state.threadId);
      this.agents.delete(agentId);
      this.activityCallbacks.delete(agentId);
      this.persistAgents();
    });
  }

  async stopAll(killProcesses: boolean = true, _clearQueue?: boolean): Promise<void> {
    this.agents.clear();
    this.threadToAgent.clear();
    this.activityCallbacks.clear();
    if (this.process) {
      if (killProcesses) {
        // Explicit full shutdown → kill the daemon and drop recovery state.
        this.process.killDaemon();
        saveAppServerAgents([]);
      } else {
        // Graceful restart → leave the daemon running so we rejoin it on boot.
        this.persistAgents();
        this.process.disconnect();
      }
      this.process = null;
    }
  }

  isRunning(agentId: string): boolean {
    return this.agents.has(agentId) && this.process !== null && this.process.isAlive();
  }

  supportsStdin(): boolean {
    return true;
  }

  closesStdinAfterPrompt(): boolean {
    return false;
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    return this.agents.get(agentId)?.turnState;
  }

  hasRecentActivity(agentId: string, withinMs: number): boolean {
    const state = this.agents.get(agentId);
    if (!state) return false;
    const last = state.lastActivityTime || state.startTime;
    return Date.now() - last < withinMs;
  }

  onNextActivity(agentId: string, callback: () => void): void {
    if (!this.activityCallbacks.has(agentId)) this.activityCallbacks.set(agentId, []);
    this.activityCallbacks.get(agentId)!.push(callback);
  }

  private fireActivity(agentId: string): void {
    const cbs = this.activityCallbacks.get(agentId);
    if (!cbs || cbs.length === 0) return;
    this.activityCallbacks.delete(agentId);
    for (const cb of cbs) {
      try {
        cb();
      } catch (err) {
        log.error(`Activity callback error for ${agentId}:`, err);
      }
    }
  }

  private persistAgents(): void {
    if (!this.recovered) return; // don't clobber the recovery file before reading it
    const list: PersistedAppServerAgent[] = [];
    for (const [agentId, state] of this.agents) {
      const agent = agentService.getAgent(agentId);
      list.push({
        agentId,
        threadId: state.threadId,
        workingDir: state.lastRequest.workingDir,
        turnState: state.turnState,
        agentStatus: agent?.status,
        lastRequest: state.lastRequest,
      });
    }
    saveAppServerAgents(list);
  }

  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    return [...this.agents.keys()].map((agentId) => ({ agentId, pid: undefined }));
  }
}
