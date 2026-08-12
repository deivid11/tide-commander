/**
 * PiRpcRunner — persistent `pi --mode rpc` process per agent with TRUE
 * mid-turn message delivery.
 *
 * Unlike the single-shot `pi --mode json -p` runner (queue until process exit,
 * then respawn with --session), RPC mode keeps a JSONL command channel open on
 * stdin:
 *   - {"type":"prompt","message":…}                        → start a turn
 *   - {"type":"prompt","message":…,"streamingBehavior":"steer"}
 *       → MID-TURN: delivered after the current tool round, before the next
 *         LLM call — the model reacts within the same agentic run.
 *   - {"type":"abort"}                                     → interrupt the turn
 *
 * Events stream to stdout in the same AgentSessionEvent format as json mode,
 * so the shared RunnerStdoutPipeline (with PiBackend.parseEvent) renders
 * identically to the headless runner. `response` acknowledgment envelopes are
 * inspected by a lightweight side listener for command failures.
 *
 * Lifecycle notes:
 *   - The child is NOT detached: it dies with the commander (a TC restart ends
 *     in-flight turns; the next message respawns with --session resume).
 *   - Session ids come from the stream's `session` header (backend
 *     .extractSessionId via the pipeline) and persist in ~/.pi/agent/sessions.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { RunnerCallbacks, RunnerRequest } from '../../claude/types.js';
import type { RuntimeRunner } from '../../runtime/types.js';
import { RunnerStdoutPipeline } from '../../claude/runner/stdout-pipeline.js';
import { RunnerInternalEventBus } from '../../claude/runner/internal-events.js';
import { PiBackend, buildPiPrompt, shouldPassPiModel, piThinkingLevelForEffort } from '../backend.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('PiRpc');

/** How long interruptTurn waits for the aborted turn to finalize. */
const ABORT_SETTLE_TIMEOUT_MS = 4000;

interface PiRpcAgentState {
  agentId: string;
  process: ChildProcess;
  workingDir: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  turnState: 'processing' | 'waiting_for_input';
  lastActivityTime: number;
  /** Config of the last run() — reused to compose follow-up prompts. */
  lastRequest?: RunnerRequest;
  /** Line buffer for the response-envelope side listener. */
  responseBuffer: string;
  stderrTail: string;
  /** Resolvers waiting for the turn to leave 'processing' (interruptTurn). */
  idleWaiters: Array<() => void>;
}

export class PiRpcRunner implements RuntimeRunner {
  private readonly callbacks: RunnerCallbacks;
  private readonly backend = new PiBackend();
  private readonly bus = new RunnerInternalEventBus();
  private readonly pipeline: RunnerStdoutPipeline;
  private readonly agents = new Map<string, PiRpcAgentState>();
  private readonly nextActivityCallbacks = new Map<string, Array<() => void>>();

  constructor(callbacks: RunnerCallbacks) {
    this.callbacks = callbacks;
    this.pipeline = new RunnerStdoutPipeline({
      backend: this.backend,
      callbacks,
      bus: this.bus,
    });

    this.bus.on('runner.session_id', ({ agentId, sessionId }) => {
      const state = this.agents.get(agentId);
      if (state) state.sessionId = sessionId;
    });

    this.bus.on('runner.activity', ({ agentId, timestamp }) => {
      const state = this.agents.get(agentId);
      if (state) state.lastActivityTime = timestamp;
      const waiters = this.nextActivityCallbacks.get(agentId);
      if (waiters && waiters.length > 0) {
        this.nextActivityCallbacks.delete(agentId);
        for (const cb of waiters) cb();
      }
    });

    this.bus.on('runner.event', ({ agentId, event }) => {
      const state = this.agents.get(agentId);
      if (!state) return;
      if (event.type === 'init') {
        state.turnState = 'processing';
      } else if (event.type === 'step_complete') {
        // agent_end → the agentic run is over; the process stays alive for the
        // next prompt. onComplete drives the idle transition + queue drains.
        state.turnState = 'waiting_for_input';
        this.releaseIdleWaiters(state);
        this.callbacks.onComplete(agentId, true);
      }
    });
  }

  start(): void {
    // No orphan recovery: RPC children die with the commander by design; the
    // next command respawns them with --session resume.
  }

  private releaseIdleWaiters(state: PiRpcAgentState): void {
    if (state.idleWaiters.length === 0) return;
    const waiters = state.idleWaiters.splice(0, state.idleWaiters.length);
    for (const w of waiters) w();
  }

  private isProcessAlive(state: PiRpcAgentState | undefined): state is PiRpcAgentState {
    return !!state && state.process.exitCode === null && !state.process.killed;
  }

  /** Write one JSONL command to the agent's pi stdin. */
  private writeCommand(state: PiRpcAgentState, command: Record<string, unknown>): boolean {
    try {
      if (!state.process.stdin || !state.process.stdin.writable) return false;
      state.process.stdin.write(JSON.stringify(command) + '\n');
      return true;
    } catch (err) {
      log.error(`writeCommand failed for ${state.agentId.slice(0, 8)}: ${String(err)}`);
      return false;
    }
  }

  /**
   * Side listener for RPC `response` envelopes — surfaces command failures and
   * captures the session id from get_state (RPC mode never emits the json-mode
   * `{"type":"session"}` stream header, so this is the ONLY session id source).
   */
  private handleResponseLine(agentId: string, line: string): void {
    let parsed: {
      type?: string;
      command?: string;
      success?: boolean;
      error?: string;
      data?: { sessionId?: string };
    };
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed?.type !== 'response') return;
    if (parsed.success === false) {
      const message = `Pi RPC ${parsed.command || 'command'} rejected: ${parsed.error || 'unknown error'}`;
      log.warn(`${agentId.slice(0, 8)}: ${message}`);
      this.callbacks.onOutput(agentId, `⚠️ [System] ${message}`, false, undefined, `pi-rpc-reject-${Date.now()}`);
      return;
    }
    if (parsed.command === 'get_state' && parsed.data?.sessionId) {
      const sessionId = parsed.data.sessionId;
      const state = this.agents.get(agentId);
      if (state && state.sessionId !== sessionId) {
        state.sessionId = sessionId;
        log.log(`${agentId.slice(0, 8)}: session id from get_state: ${sessionId}`);
      }
      this.callbacks.onSessionId(agentId, sessionId);
    }
  }

  private spawnAgentProcess(request: RunnerRequest): PiRpcAgentState {
    const args: string[] = ['--mode', 'rpc'];

    if (shouldPassPiModel(request.model)) {
      args.push('--model', request.model);
    }
    if (request.effort) {
      args.push('--thinking', piThinkingLevelForEffort(request.effort));
    }
    if (request.sessionId && !request.forceNewSession) {
      if (request.forkSession) {
        args.push('--fork', request.sessionId);
      } else {
        args.push('--session', request.sessionId);
      }
    }

    const exe = this.backend.getExecutablePath();
    log.log(`Spawning pi RPC for ${request.agentId.slice(0, 8)}: ${exe} ${args.join(' ')} (cwd=${request.workingDir})`);

    const child = spawn(exe, args, {
      cwd: request.workingDir,
      env: { ...process.env, ...this.backend.getExtraEnv() },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const state: PiRpcAgentState = {
      agentId: request.agentId,
      process: child,
      workingDir: request.workingDir,
      model: request.model,
      effort: request.effort,
      sessionId: request.sessionId,
      turnState: 'waiting_for_input',
      lastActivityTime: Date.now(),
      lastRequest: request,
      responseBuffer: '',
      stderrTail: '',
      idleWaiters: [],
    };

    // Shared pipeline renders the event stream exactly like headless mode.
    this.pipeline.handleStdout(request.agentId, child);

    // Side listener: response envelopes (pipeline ignores them by design).
    child.stdout?.on('data', (data: Buffer) => {
      state.responseBuffer += data.toString('utf-8');
      let idx: number;
      while ((idx = state.responseBuffer.indexOf('\n')) >= 0) {
        const line = state.responseBuffer.slice(0, idx);
        state.responseBuffer = state.responseBuffer.slice(idx + 1);
        if (line.trim()) this.handleResponseLine(request.agentId, line);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      state.stderrTail = (state.stderrTail + data.toString('utf-8')).slice(-2000);
    });

    child.on('close', (code, signal) => {
      const current = this.agents.get(request.agentId);
      if (current !== state) return; // superseded by a newer spawn
      this.agents.delete(request.agentId);
      const midTurn = state.turnState === 'processing';
      log.log(`pi RPC for ${request.agentId.slice(0, 8)} closed (code=${code}, signal=${signal ?? 'none'}, midTurn=${midTurn})`);
      this.releaseIdleWaiters(state);
      if (midTurn) {
        // Unexpected death mid-turn — surface stderr and finalize the turn so
        // the agent doesn't hang in 'working'.
        const detail = state.stderrTail.trim().split('\n').slice(-3).join('\n');
        this.callbacks.onError(
          request.agentId,
          `Pi RPC process exited mid-turn (code=${code ?? 'null'})${detail ? `: ${detail}` : ''}`
        );
        this.callbacks.onComplete(request.agentId, false);
      }
    });

    child.on('error', (err) => {
      const current = this.agents.get(request.agentId);
      if (current === state) this.agents.delete(request.agentId);
      log.error(`pi RPC spawn error for ${request.agentId.slice(0, 8)}: ${String(err)}`);
      this.callbacks.onError(request.agentId, `Failed to start pi RPC: ${String(err)}`);
      this.callbacks.onComplete(request.agentId, false);
    });

    this.agents.set(request.agentId, state);

    // RPC mode has no `{"type":"session"}` stream header — ask for the session
    // id explicitly so history loading and resume-after-death work.
    this.writeCommand(state, { type: 'get_state' });

    return state;
  }

  /** True when the live process can serve this request without a respawn. */
  private isReusable(state: PiRpcAgentState, request: RunnerRequest): boolean {
    if (request.forceNewSession) return false;
    return (
      state.workingDir === request.workingDir &&
      state.model === request.model &&
      state.effort === request.effort
    );
  }

  async run(request: RunnerRequest): Promise<void> {
    const existing = this.agents.get(request.agentId);

    let state: PiRpcAgentState;
    if (this.isProcessAlive(existing) && this.isReusable(existing, request)) {
      state = existing;
      state.lastRequest = request;
    } else {
      if (this.isProcessAlive(existing)) {
        log.log(`Config changed for ${request.agentId.slice(0, 8)} — respawning pi RPC`);
        await this.stop(request.agentId);
      }
      state = this.spawnAgentProcess(request);
    }

    const promptText = buildPiPrompt({
      agentId: request.agentId,
      // sessionId gates instruction injection: absent → full block (fresh
      // conversation); present → bare prompt unless instructions were dirtied.
      sessionId: request.forceNewSession ? undefined : (request.sessionId ?? undefined),
      prompt: request.prompt,
      workingDir: request.workingDir,
      systemPrompt: request.systemPrompt,
      customAgent: request.customAgent,
    });

    const command: Record<string, unknown> = { type: 'prompt', message: promptText };
    if (state.turnState === 'processing') {
      // Defensive: run() while a turn streams (races) — steer instead of erroring.
      command.streamingBehavior = 'steer';
    } else {
      state.turnState = 'processing';
    }

    if (!this.writeCommand(state, command)) {
      state.turnState = 'waiting_for_input';
      throw new Error('Pi RPC stdin write failed');
    }
    state.lastActivityTime = Date.now();
  }

  /**
   * Follow-up delivery. Mid-turn messages STEER the live run (delivered after
   * the current tool round, before the next LLM call) — no queue, no respawn.
   */
  sendMessage(agentId: string, message: string): boolean {
    const state = this.agents.get(agentId);
    if (!this.isProcessAlive(state)) return false;

    const promptText = buildPiPrompt({
      agentId,
      sessionId: state.sessionId ?? state.lastRequest?.sessionId ?? 'live',
      prompt: message,
      workingDir: state.workingDir,
      systemPrompt: state.lastRequest?.systemPrompt,
      customAgent: state.lastRequest?.customAgent,
    });

    const midTurn = state.turnState === 'processing';
    const command: Record<string, unknown> = midTurn
      ? { type: 'prompt', message: promptText, streamingBehavior: 'steer' }
      : { type: 'prompt', message: promptText };

    const written = this.writeCommand(state, command);
    if (written) {
      if (!midTurn) state.turnState = 'processing';
      log.log(`${agentId.slice(0, 8)}: ${midTurn ? 'STEERED mid-turn' : 'prompted'} (${message.length} chars)`);
      state.lastActivityTime = Date.now();
    }
    return written;
  }

  /**
   * Interrupt the in-flight turn in place ("Send now"): abort, then wait for
   * the aborted run to finalize so the caller's follow-up prompt starts clean.
   */
  async interruptTurn(agentId: string, _clearQueue?: boolean): Promise<boolean> {
    const state = this.agents.get(agentId);
    if (!this.isProcessAlive(state)) return false;
    if (state.turnState !== 'processing') return true;

    if (!this.writeCommand(state, { type: 'abort' })) return false;
    log.log(`${agentId.slice(0, 8)}: abort sent — waiting for turn to settle`);

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), ABORT_SETTLE_TIMEOUT_MS);
      state.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    // Whatever happened (settled or timeout), let the follow-up proceed; a
    // still-streaming run will receive it as a steer via sendMessage.
    return true;
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    const state = this.agents.get(agentId);
    if (!this.isProcessAlive(state)) return undefined;
    return state.turnState;
  }

  /** Steering delivers immediately — there is no internal queue. */
  getQueuedMessages(_agentId: string): string[] {
    return [];
  }

  removeQueuedMessage(_agentId: string, _index: number, _expectedText: string): boolean {
    return false;
  }

  async stop(agentId: string, _clearQueue?: boolean): Promise<void> {
    const state = this.agents.get(agentId);
    if (!state) return;
    this.agents.delete(agentId);
    this.releaseIdleWaiters(state);
    try {
      this.writeCommand(state, { type: 'abort' });
      state.process.stdin?.end();
    } catch {
      // best-effort
    }
    if (state.process.exitCode === null && !state.process.killed) {
      state.process.kill('SIGTERM');
      const proc = state.process;
      setTimeout(() => {
        try {
          if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL');
        } catch {
          // already gone
        }
      }, 1500);
    }
  }

  async stopAll(_killProcesses?: boolean, _clearQueue?: boolean): Promise<void> {
    const ids = Array.from(this.agents.keys());
    for (const agentId of ids) {
      await this.stop(agentId);
    }
  }

  isRunning(agentId: string): boolean {
    return this.isProcessAlive(this.agents.get(agentId));
  }

  hasRecentActivity(agentId: string, withinMs: number): boolean {
    const state = this.agents.get(agentId);
    if (!state) return false;
    return Date.now() - state.lastActivityTime <= withinMs;
  }

  onNextActivity(agentId: string, callback: () => void): void {
    const list = this.nextActivityCallbacks.get(agentId) ?? [];
    list.push(callback);
    this.nextActivityCallbacks.set(agentId, list);
  }

  supportsStdin(): boolean {
    return true;
  }

  closesStdinAfterPrompt(): boolean {
    return false;
  }

  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    return Array.from(this.agents.values()).map((s) => ({
      agentId: s.agentId,
      pid: s.process.pid,
    }));
  }
}
