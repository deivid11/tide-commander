/**
 * OpencodeServerRunner — experimental runtime that drives OpenCode agents through
 * a persistent, restart-surviving `opencode serve` HTTP server instead of one
 * `opencode run` process per turn.
 *
 * Why: `opencode run --format json` emits one full assistant message (no token
 * deltas), so replies never typewriter. The server streams `message.part.delta`
 * tokens over SSE. And a detached server survives commander restarts, keeping any
 * in-flight turn running; on boot the runner reconnects the SSE stream and
 * OpenCode's persisted sessions resume seamlessly.
 *
 * Downstream reuse: reconstructed StandardEvents feed a shared
 * RunnerStdoutPipeline via `emitStandardEvent` (the OpencodeBackend's
 * `.name === 'opencode'` turns on stream-coalescing), so websocket broadcast,
 * client merge-by-uuid, boss delegation and context tracking are reused unchanged.
 */

import * as os from 'os';
import type {
  RunnerCallbacks,
  RunnerRequest,
  StandardEvent,
  BackendConfig,
} from '../../claude/types.js';
import type { RuntimeRunner } from '../../runtime/types.js';
import { OpencodeBackend, buildOpencodePrompt } from '../backend.js';
import { RunnerInternalEventBus } from '../../claude/runner/internal-events.js';
import { RunnerStdoutPipeline } from '../../claude/runner/stdout-pipeline.js';
import { OpencodeServerProcess, isOpencodeTransportError } from './opencode-server-process.js';
import { OpencodeServerEventAdapter } from './opencode-server-event-adapter.js';
import {
  loadOpencodeAgents,
  saveOpencodeAgents,
  type PersistedOpencodeAgent,
} from './opencode-server-recovery-store.js';
import * as agentService from '../../services/agent-service.js';
import { createLogger } from '../../utils/logger.js';
import { withAgentContext } from '../../utils/log-context.js';
import { appendQueuedMessage, prependQueuedMessage } from '../../../shared/message-queue.js';

const log = createLogger('OpencodeServerRunner');

/** How long after the turn's message POST resolves (= turn ended server-side)
 *  to wait for the real `session.idle` before force-finalizing the turn. */
const POST_IDLE_GRACE_MS = 3000;

export type OpencodeModelCatalogReloadResult = 'restarted' | 'deferred' | 'not-running';

interface AgentState {
  sessionId: string;
  adapter: OpencodeServerEventAdapter;
  turnState: 'processing' | 'waiting_for_input';
  startTime: number;
  lastActivityTime: number;
  lastRequest: RunnerRequest;
  queue: string[];
  /** Monotonic per-agent turn counter so delayed fallbacks never finalize a
   *  LATER turn than the one they were armed for. */
  turnSeq: number;
  /** Set while a user-requested interrupt is in flight so the expected abort
   *  fallout (session.error "Aborted", empty-response dump) renders quiet. */
  interruptRequested?: boolean;
}

export class OpencodeServerRunner implements RuntimeRunner {
  private readonly callbacks: RunnerCallbacks;
  private readonly backend = new OpencodeBackend();
  private readonly bus = new RunnerInternalEventBus();
  private readonly pipeline: RunnerStdoutPipeline;
  private readonly agents = new Map<string, AgentState>();
  private readonly sessionToAgent = new Map<string, string>();
  private readonly activityCallbacks = new Map<string, Array<() => void>>();
  private process: OpencodeServerProcess | null = null;
  private started = false;
  private recovered = false;
  private recoveryPromise: Promise<void> | null = null;
  private modelCatalogReloadPending = false;

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
    // Agent records are loaded before runtimeService.init(), so recovery can
    // begin immediately. Commands await this promise and can never overwrite
    // the recovery file during the old 1.5s startup gap.
    this.recoveryPromise = this.recover().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`OpenCode recovery failed: ${message}`);
      this.recovered = true;
    });
    log.log('🛡️ OpenCode server runner started (streaming, restart-surviving)');
  }

  private ensureProcess(spawnCwd: string): OpencodeServerProcess {
    if (this.process && this.process.isAlive()) return this.process;
    this.process = new OpencodeServerProcess({
      executablePath: this.backend.getExecutablePath(),
      cwd: spawnCwd || os.homedir(),
      extraEnv: this.backend.getExtraEnv(),
      onEvent: (evt) => this.routeEvent(evt),
      onDisconnect: () => this.handleDisconnect(),
    });
    return this.process;
  }

  /**
   * Invalidate the persistent daemon after `opencode models --refresh`.
   * Active turns are never interrupted: their reload is applied after the last
   * turn (and any queued follow-up) finishes.
   */
  requestModelCatalogReload(): OpencodeModelCatalogReloadResult {
    if ([...this.agents.values()].some((state) => state.turnState === 'processing')) {
      this.modelCatalogReloadPending = true;
      log.log('OpenCode model catalog reload deferred until active turns finish');
      return 'deferred';
    }
    return this.restartDaemonForModelCatalog();
  }

  private restartDaemonForModelCatalog(): OpencodeModelCatalogReloadResult {
    this.modelCatalogReloadPending = false;
    const attached = this.process;
    this.process = null;
    let invalidated = false;
    if (attached) {
      attached.killDaemon();
      invalidated = true;
    } else {
      invalidated = OpencodeServerProcess.terminatePersistedDaemon();
    }
    if (invalidated) {
      log.log('♻️ Invalidated OpenCode server so its model catalog reloads on next prompt');
      return 'restarted';
    }
    return 'not-running';
  }

  private applyPendingModelCatalogReload(): void {
    if (!this.modelCatalogReloadPending) return;
    if ([...this.agents.values()].some((state) => state.turnState === 'processing')) return;
    this.restartDaemonForModelCatalog();
  }

  private invalidateFailedProcess(proc: OpencodeServerProcess, err: unknown): void {
    if (this.process !== proc || !isOpencodeTransportError(err)) return;
    log.warn('OpenCode daemon transport failed; invalidating it for automatic recovery');
    proc.killDaemon();
    this.process = null;
  }

  private async processWithRequestedModel(
    agentId: string,
    workingDir: string,
    model: string | undefined,
    proc: OpencodeServerProcess,
  ): Promise<OpencodeServerProcess | null> {
    const modelRef = this.modelRef(model);
    if (!modelRef) return proc;
    const available = await proc.hasModel(modelRef.providerID, modelRef.modelID, workingDir);
    if (available !== false) return proc;

    log.warn(`OpenCode daemon catalog does not contain ${model}; restarting before prompt`);
    const reload = this.requestModelCatalogReload();
    if (reload === 'deferred') {
      this.callbacks.onError(
        agentId,
        `OpenCode model catalog refresh for ${model} is waiting for active turns to finish. Retry shortly.`,
      );
      return null;
    }

    const fresh = this.ensureProcess(workingDir);
    try {
      await fresh.ensureStarted();
    } catch (err) {
      this.invalidateFailedProcess(fresh, err);
      const message = err instanceof Error ? err.message : String(err);
      this.callbacks.onError(agentId, `OpenCode server failed to reload model catalog: ${message}`);
      return null;
    }
    return fresh;
  }

  private async recover(): Promise<void> {
    const persisted = loadOpencodeAgents();
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
      log.warn(`Recovery: could not reach opencode server (${msg}); agents will lazy-resume on next message`);
      this.finalizeStale(persisted);
      return;
    }

    if (!proc.didReconnect()) {
      log.log('Recovery: fresh server (old turns gone); finalizing mid-turn agents');
      this.finalizeStale(persisted);
      return;
    }

    log.log(`🔗 Recovery: rejoined server; re-attaching ${persisted.length} session(s)`);
    const activeByDirectory = new Map<string, Set<string>>();
    for (const p of persisted) {
      let active = activeByDirectory.get(p.workingDir);
      if (!active) {
        active = await proc.activeSessionIds(p.workingDir);
        activeByDirectory.set(p.workingDir, active);
      }
      const state: AgentState = {
        sessionId: p.sessionId,
        adapter: new OpencodeServerEventAdapter(),
        turnState: p.turnState,
        startTime: Date.now(),
        lastActivityTime: Date.now(),
        lastRequest: p.lastRequest,
        queue: [...(p.queue ?? [])],
        turnSeq: 0,
      };
      this.agents.set(p.agentId, state);
      this.sessionToAgent.set(p.sessionId, p.agentId);

      if (active.has(p.sessionId)) {
        // Turn still generating — the SSE stream will deliver its remaining
        // deltas + session.idle, which finalizes it via applyEvent().
        if (agentService.getAgent(p.agentId)) agentService.updateAgent(p.agentId, { status: 'working' });
        state.turnState = 'processing';
      } else {
        // Turn ended during downtime — finalize now (no session.idle will replay).
        state.turnState = 'waiting_for_input';
        this.callbacks.onComplete(p.agentId, true);
        this.drainQueue(p.agentId, state);
      }
    }
    this.persistAgents();
  }

  private finalizeStale(persisted: PersistedOpencodeAgent[]): void {
    for (const p of persisted) {
      if (p.agentStatus === 'working' || p.turnState === 'processing') {
        this.callbacks.onComplete(p.agentId, true);
      }
    }
    saveOpencodeAgents([]);
  }

  private handleDisconnect(): void {
    const agentIds = [...this.agents.keys()];
    log.warn(`opencode server connection lost — finalizing ${agentIds.length} agent(s)`);
    this.agents.clear();
    this.sessionToAgent.clear();
    this.process = null;
    for (const agentId of agentIds) this.callbacks.onComplete(agentId, false);
  }

  private routeEvent(evt: Record<string, unknown>): void {
    const props = (evt.properties as Record<string, unknown> | undefined) || {};
    const sessionId = (props.sessionID as string | undefined) || (evt.sessionID as string | undefined);
    if (!sessionId) return;
    const agentId = this.sessionToAgent.get(sessionId);
    if (!agentId) return;
    const state = this.agents.get(agentId);
    if (!state) return;

    state.lastActivityTime = Date.now();
    this.fireActivity(agentId);

    for (const event of state.adapter.handle(evt)) {
      this.applyEvent(agentId, state, event);
    }
  }

  private applyEvent(agentId: string, state: AgentState, event: StandardEvent): void {
    if (event.type === 'text' || event.type === 'tool_start' || event.type === 'thinking' || event.type === 'init') {
      state.turnState = 'processing';
    }

    // A user-requested interrupt ("Send now") makes the abort look like a
    // failure: session.error "Aborted" + an "(Empty response: …)" dump. The
    // 🛑 system line already tells the user what happened — keep the rest quiet.
    if (state.interruptRequested) {
      if (event.type === 'error' && /abort/i.test(event.errorMessage || '')) {
        log.log(`Suppressing expected abort error for ${agentId.slice(0, 8)} (user interrupt)`);
        return;
      }
      if (event.type === 'step_complete') {
        state.interruptRequested = false;
        if (typeof event.resultText === 'string' && event.resultText.startsWith('(Empty response:')) {
          delete event.resultText;
        }
      }
    }

    // A step_complete for a turn that's already finalized (the POST-resolution
    // fallback raced the real session.idle, or the server double-fired idle)
    // must be dropped whole — re-emitting would render a spurious
    // "(Empty response)" row and double-fire onComplete/drainQueue.
    if (event.type === 'step_complete' && state.turnState !== 'processing') return;

    this.pipeline.emitStandardEvent(agentId, event);

    if (event.type === 'step_complete') {
      state.turnState = 'waiting_for_input';
      this.persistAgents();
      // The server stays alive across turns, so there's no process 'close' to
      // flip the agent idle. runtime-events skips the idle transition for
      // opencode on step_complete (it expects it on process exit), so drive it here.
      this.callbacks.onComplete(agentId, true);
      this.drainQueue(agentId, state);
      this.applyPendingModelCatalogReload();
    }
  }

  async run(request: RunnerRequest): Promise<void> {
    if (this.recoveryPromise) await this.recoveryPromise;
    await withAgentContext(request.agentId, () => this.runImpl(request));
  }

  private async runImpl(request: RunnerRequest): Promise<void> {
    const { agentId, workingDir } = request;
    let proc = this.ensureProcess(workingDir);
    try {
      await proc.ensureStarted();
    } catch (err) {
      this.invalidateFailedProcess(proc, err);
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to start opencode server for ${agentId.slice(0, 8)}: ${msg}`);
      this.callbacks.onError(agentId, `OpenCode server failed to start: ${msg}`);
      return;
    }

    const modelReadyProcess = await this.processWithRequestedModel(
      agentId,
      workingDir,
      request.model,
      proc,
    );
    if (!modelReadyProcess) return;
    proc = modelReadyProcess;

    const wantNew = request.forceNewSession || !request.sessionId;
    let state = this.agents.get(agentId);

    if (state && wantNew) {
      this.sessionToAgent.delete(state.sessionId);
      this.agents.delete(agentId);
      state = undefined;
    }

    let injectInstructions = false;
    if (!state) {
      let sessionId: string;
      if (!wantNew && request.sessionId) {
        sessionId = request.sessionId; // resume an existing persisted session
      } else {
        try {
          sessionId = await proc.createSession(workingDir);
        } catch (err) {
          this.invalidateFailedProcess(proc, err);
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`createSession failed for ${agentId.slice(0, 8)}: ${msg}`);
          this.callbacks.onError(agentId, `OpenCode session create failed: ${msg}`);
          return;
        }
        injectInstructions = true;
      }
      state = {
        sessionId,
        adapter: new OpencodeServerEventAdapter(),
        turnState: 'processing',
        startTime: Date.now(),
        lastActivityTime: Date.now(),
        lastRequest: request,
        queue: [],
        turnSeq: 0,
      };
      this.agents.set(agentId, state);
      this.sessionToAgent.set(sessionId, agentId);
      agentService.updateAgent(agentId, { sessionId });
      this.callbacks.onSessionId(agentId, sessionId);
      this.pipeline.emitStandardEvent(agentId, { type: 'init', sessionId, model: request.model || 'opencode' });
    } else {
      state.lastRequest = request;
    }

    await this.startTurn(agentId, state, request.prompt, proc, injectInstructions);
    this.persistAgents();
  }

  private modelRef(model: string | undefined): { providerID: string; modelID: string } | undefined {
    if (!model) return undefined;
    const slash = model.indexOf('/');
    if (slash <= 0) return undefined; // no provider prefix → let the server default
    return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
  }

  private async startTurn(
    agentId: string,
    state: AgentState,
    prompt: string,
    proc: OpencodeServerProcess,
    injectInstructions: boolean,
  ): Promise<void> {
    // Reuse the exec prompt builder. Passing sessionId makes it send only the
    // user prompt on follow-ups (the instruction block is already in the session
    // history); on the very first turn of a new session we omit sessionId so the
    // full block is injected once — same behaviour as the exec resume path.
    const config: BackendConfig = {
      agentId,
      sessionId: injectInstructions ? undefined : state.sessionId,
      model: state.lastRequest.model,
      workingDir: state.lastRequest.workingDir,
      systemPrompt: state.lastRequest.systemPrompt,
      customAgent: state.lastRequest.customAgent,
      prompt,
    };
    const promptText = buildOpencodePrompt(config);

    state.turnState = 'processing';
    state.lastActivityTime = Date.now();
    state.turnSeq += 1;
    const seq = state.turnSeq;

    // Persist BEFORE the turn-length HTTP request. `sendPrompt` resolves only
    // when the whole model turn ends, so saving afterwards leaves no recovery
    // entry during the exact window in which a Commander reset can happen.
    this.persistAgents();

    try {
      await proc.sendPrompt(state.sessionId, promptText, this.modelRef(state.lastRequest.model));
      // opencode holds the message POST open for the ENTIRE turn, so resolving
      // means the turn already ended server-side. `session.idle` over SSE is
      // the normal finalizer — but if it doesn't land shortly after (missed
      // frame, broken/mis-scoped stream), force-finalize so one lost event can
      // never wedge the agent in 'working' with its queue backing up forever.
      setTimeout(() => {
        if (this.agents.get(agentId) !== state) return;
        if (state.turnSeq !== seq || state.turnState !== 'processing') return;
        log.warn(`Turn POST resolved but no session.idle after ${POST_IDLE_GRACE_MS}ms for ${agentId.slice(0, 8)}; force-finalizing turn`);
        for (const event of state.adapter.forceFinalize()) {
          this.applyEvent(agentId, state, event);
        }
      }, POST_IDLE_GRACE_MS);
    } catch (err) {
      this.invalidateFailedProcess(proc, err);
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`sendPrompt failed for ${agentId.slice(0, 8)}: ${msg}`);
      this.callbacks.onError(agentId, `OpenCode prompt failed: ${msg}`);
      // Reset the turn state so a failed send does NOT wedge the runner.
      // Without this, turnState stays 'processing' forever — only a
      // `step_complete` SSE event clears it, and that never comes for a turn
      // that never started — so every later message is queued indefinitely and
      // "never arrives" (the user-visible symptom). Guard it: only recover when
      // THIS state is still the agent's current in-flight turn, so we don't
      // double-drain into a concurrent turn (if a step_complete already advanced
      // it) or act on a state a stop()/new turn already replaced. drainQueue
      // re-queues safely when the daemon is unreachable, so this can't spin.
      if (this.agents.get(agentId) === state && state.turnState === 'processing') {
        state.turnState = 'waiting_for_input';
        this.drainQueue(agentId, state);
        this.applyPendingModelCatalogReload();
      }
    }
  }

  private drainQueue(agentId: string, state: AgentState): void {
    if (state.queue.length === 0) return;
    const next = state.queue.shift()!;
    const proc = this.process;
    if (!proc || !proc.isAlive()) {
      prependQueuedMessage(state.queue, next);
      return;
    }
    log.log(`📤 Delivering queued follow-up to ${agentId.slice(0, 8)} (${state.queue.length} remaining)`);
    agentService.updateAgent(agentId, { status: 'working', currentTask: next.substring(0, 100) });
    void this.startTurn(agentId, state, next, proc, false);
  }

  sendMessage(agentId: string, message: string): boolean {
    return withAgentContext(agentId, () => {
      const state = this.agents.get(agentId);
      if (!state) {
        log.warn(`sendMessage: no live session for ${agentId.slice(0, 8)}`);
        return false;
      }
      const proc = this.process;
      if (!proc || !proc.isAlive()) return false;

      if (state.turnState === 'processing') {
        appendQueuedMessage(state.queue, message);
        this.persistAgents();
        log.log(`📋 Coalesced mid-turn message for ${agentId.slice(0, 8)} (${state.queue[0].length} total chars)`);
        return true;
      }

      void this.startTurn(agentId, state, message, proc, false);
      return true;
    });
  }

  getQueuedMessages(agentId: string): string[] {
    return [...(this.agents.get(agentId)?.queue ?? [])];
  }

  removeQueuedMessage(agentId: string, index: number, expectedText: string): boolean {
    const queue = this.agents.get(agentId)?.queue;
    if (!queue || index < 0 || index >= queue.length || queue[index] !== expectedText) return false;
    queue.splice(index, 1);
    this.persistAgents();
    log.log(`🗑️ Removed queued message at ${index} for ${agentId.slice(0, 8)} (${queue.length} remaining)`);
    return true;
  }

  async interruptTurn(agentId: string, clearQueue: boolean = true): Promise<boolean> {
    return withAgentContext(agentId, async () => {
      const state = this.agents.get(agentId);
      if (!state) return false;
      const proc = this.process;
      if (!proc || !proc.isAlive()) return false;
      if (state.turnState === 'processing') {
        state.interruptRequested = true;
        try {
          await proc.abort(state.sessionId);
        } catch (err) {
          state.interruptRequested = false;
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`abort failed for ${agentId.slice(0, 8)}: ${msg}`);
          return false;
        }
      }
      // Clear only after a successful abort so a failed request never
      // silently drops queued messages.
      if (clearQueue) state.queue.length = 0;
      return true;
    });
  }

  async stop(agentId: string, _clearQueue: boolean = true): Promise<void> {
    await withAgentContext(agentId, async () => {
      const state = this.agents.get(agentId);
      if (!state) return;
      const proc = this.process;
      if (proc && proc.isAlive() && state.turnState === 'processing') {
        await proc.abort(state.sessionId);
      }
      this.sessionToAgent.delete(state.sessionId);
      this.agents.delete(agentId);
      this.activityCallbacks.delete(agentId);
      this.persistAgents();
      this.applyPendingModelCatalogReload();
    });
  }

  async stopAll(killProcesses: boolean = true, _clearQueue?: boolean): Promise<void> {
    // A graceful Commander restart must snapshot live sessions BEFORE clearing
    // the maps. The previous order saved an empty array on every SIGTERM, so the
    // detached daemon survived but the new Commander had nothing to reattach.
    if (!killProcesses) this.persistAgents();

    this.agents.clear();
    this.sessionToAgent.clear();
    this.activityCallbacks.clear();
    this.modelCatalogReloadPending = false;
    if (this.process) {
      if (killProcesses) this.process.killDaemon();
      else this.process.disconnect();
      this.process = null;
    } else if (killProcesses) {
      OpencodeServerProcess.terminatePersistedDaemon();
    }
    if (killProcesses) saveOpencodeAgents([]);
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
    if (!this.recovered) return;
    const list: PersistedOpencodeAgent[] = [];
    for (const [agentId, state] of this.agents) {
      const agent = agentService.getAgent(agentId);
      list.push({
        agentId,
        sessionId: state.sessionId,
        workingDir: state.lastRequest.workingDir,
        turnState: state.turnState,
        agentStatus: agent?.status,
        lastRequest: state.lastRequest,
        queue: [...state.queue],
      });
    }
    saveOpencodeAgents(list);
  }

  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    return [...this.agents.keys()].map((agentId) => ({ agentId, pid: undefined }));
  }
}
