/**
 * PiRpcRunner — persistent `pi --mode rpc` process per agent with true
 * mid-turn steering. When Tide's tmux mode is enabled, each RPC process runs
 * in an isolated `tc-pi-rpc-<agentId>` session and is reconnected on restart.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import type { RunnerCallbacks, RunnerRequest } from '../../claude/types.js';
import type { RuntimeRunner } from '../../runtime/types.js';
import { RunnerStdoutPipeline } from '../../claude/runner/stdout-pipeline.js';
import { RunnerInternalEventBus } from '../../claude/runner/internal-events.js';
import {
  checkTmuxAvailability,
  getPiRpcTmuxPanePid,
  hasPiRpcTmuxSession,
  isTmuxEnabled,
  killPiRpcTmuxSession,
  listPiRpcTmuxSessions,
  piRpcTmuxLogPath,
  piRpcTmuxSessionName,
  sendToPiRpcTmux,
  spawnInPiRpcTmux,
  type TmuxFileTailer,
} from '../../claude/runner/tmux-helper.js';
import { PiBackend, buildPiPrompt, shouldPassPiModel, piThinkingLevelForEffort } from '../backend.js';
import { addPiDetailedReasoningExtension } from '../detailed-reasoning.js';
import * as agentService from '../../services/agent-service.js';
import {
  clearPiRpcProcesses,
  loadPiRpcProcesses,
  savePiRpcProcesses,
  type PersistedPiRpcProcess,
} from './pi-rpc-recovery-store.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('PiRpc');
const ABORT_SETTLE_TIMEOUT_MS = 4000;
const PERSIST_INTERVAL_MS = 10_000;
const LIVENESS_INTERVAL_MS = 5_000;
const TMUX_START_TIMEOUT_MS = 2500;
const RPC_COMMAND_TIMEOUT_MS = 10_000;
const LOG_TAIL_SCAN_BYTES = 64 * 1024;

interface PiRpcResponse {
  id?: string;
  type?: string;
  command?: string;
  success?: boolean;
  error?: string;
  data?: unknown;
}

interface PendingPiRpcCommand {
  agentId: string;
  command: string;
  resolve: (response: PiRpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PiRpcAgentState {
  agentId: string;
  process: ChildProcess;
  workingDir: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  startTime: number;
  turnState: 'processing' | 'waiting_for_input';
  lastActivityTime: number;
  lastRequest?: RunnerRequest;
  responseBuffer: string;
  stderrTail: string;
  idleWaiters: Array<() => void>;
  tmuxSession?: string;
  tmuxLogFile?: string;
  tmuxTailer?: TmuxFileTailer;
  isReconnected?: boolean;
  /** True from native compact dispatch until response/agent_settled. */
  manualCompactionPending?: boolean;
}

export function inferPiRpcTurnStateFromLogLines(
  lines: string[],
): 'processing' | 'waiting_for_input' {
  const activeEvents = new Set([
    'agent_start', 'agent_end', 'turn_start', 'turn_end', 'message_start', 'message_update',
    'message_end', 'tool_execution_start', 'tool_execution_update',
    'tool_execution_end', 'compaction_start', 'compaction_end',
    'auto_retry_start', 'auto_retry_end',
  ]);
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const event = JSON.parse(lines[index]);
      if (event?.type === 'agent_settled') return 'waiting_for_input';
      // Manual RPC compaction has no agent_settled; its command response is the
      // authoritative completion boundary.
      if (event?.type === 'response' && event?.command === 'compact') return 'waiting_for_input';
      // A successful prompt response means Pi accepted a new run; agent_start
      // follows on the next line, but recovery may land in that narrow gap.
      if (event?.type === 'response' && event?.command === 'prompt' && event?.success === true) return 'processing';
      // agent_end is deliberately not idle: Pi may immediately auto-compact,
      // retry, or process queued continuations before agent_settled.
      if (activeEvents.has(event?.type)) return 'processing';
    } catch {
      // Ignore a partial head/tail line and continue backwards.
    }
  }
  return 'waiting_for_input';
}

/** Derive the state of an unpersisted live RPC session without replaying its log. */
export function scanPiRpcLogTailForTurnState(logFile: string): 'processing' | 'waiting_for_input' {
  let fd: number | undefined;
  try {
    const stat = fs.statSync(logFile);
    if (stat.size === 0) return 'waiting_for_input';
    const readLength = Math.min(stat.size, LOG_TAIL_SCAN_BYTES);
    const buffer = Buffer.alloc(readLength);
    fd = fs.openSync(logFile, 'r');
    fs.readSync(fd, buffer, 0, readLength, stat.size - readLength);
    fs.closeSync(fd);
    fd = undefined;

    return inferPiRpcTurnStateFromLogLines(buffer.toString('utf8').split('\n'));
  } catch {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
  return 'waiting_for_input';
}

export class PiRpcRunner implements RuntimeRunner {
  private readonly callbacks: RunnerCallbacks;
  private readonly backend = new PiBackend();
  private readonly bus = new RunnerInternalEventBus();
  private readonly pipeline: RunnerStdoutPipeline;
  private readonly agents = new Map<string, PiRpcAgentState>();
  private readonly nextActivityCallbacks = new Map<string, Array<() => void>>();
  private readonly pendingCommands = new Map<string, PendingPiRpcCommand>();
  private commandSequence = 0;
  private persistTimer: NodeJS.Timeout | null = null;
  private livenessTimer: NodeJS.Timeout | null = null;
  private started = false;
  private recovered = false;

  constructor(callbacks: RunnerCallbacks) {
    this.callbacks = callbacks;
    this.pipeline = new RunnerStdoutPipeline({ backend: this.backend, callbacks, bus: this.bus });

    this.bus.on('runner.session_id', ({ agentId, sessionId }) => {
      const state = this.agents.get(agentId);
      if (state) {
        state.sessionId = sessionId;
        this.persistAll();
      }
    });

    this.bus.on('runner.activity', ({ agentId, timestamp }) => {
      const state = this.agents.get(agentId);
      if (state) state.lastActivityTime = timestamp;
      const waiters = this.nextActivityCallbacks.get(agentId);
      if (waiters && waiters.length > 0) {
        this.nextActivityCallbacks.delete(agentId);
        for (const callback of waiters) callback();
      }
    });

    this.bus.on('runner.event', ({ agentId, event }) => {
      const state = this.agents.get(agentId);
      if (!state) return;
      if (event.type === 'init') {
        state.turnState = 'processing';
        this.persistAll();
      } else if (event.type === 'step_complete') {
        state.turnState = 'waiting_for_input';
        state.manualCompactionPending = false;
        this.releaseIdleWaiters(state);
        this.callbacks.onComplete(agentId, true);
        this.persistAll();
      }
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    checkTmuxAvailability();
    // Recovery enumerates host-level tmux sessions. Respect the live tmux
    // setting before touching that global namespace: Vitest redirects
    // XDG_DATA_HOME, where tmux mode is intentionally disabled, so test runs
    // can never mistake production Pi sessions for orphaned test processes.
    if (process.platform !== 'win32' && isTmuxEnabled()) {
      this.recoverProcesses();
    } else {
      this.recovered = true;
    }
    this.persistTimer = setInterval(() => this.persistAll(), PERSIST_INTERVAL_MS);
    this.livenessTimer = setInterval(() => this.checkLiveness(), LIVENESS_INTERVAL_MS);
    log.log(`Pi RPC runner started${isTmuxEnabled() ? ' with tmux recovery enabled' : ' without tmux recovery'}`);
  }

  private recoverProcesses(): void {
    const saved = loadPiRpcProcesses();
    const savedByAgent = new Map(saved.map((entry) => [entry.agentId, entry]));

    for (const entry of saved) {
      const agent = agentService.getAgent(entry.agentId);
      if (!agent || agent.provider !== 'pi') {
        if (hasPiRpcTmuxSession(entry.agentId)) killPiRpcTmuxSession(entry.agentId);
        continue;
      }
      if (!hasPiRpcTmuxSession(entry.agentId) || this.agents.has(entry.agentId)) continue;
      this.reconnectTmux(entry);
    }

    // A hard crash can land before the first persistence write. The tmux
    // session itself is the source of truth, so synthesize enough state to
    // reconnect and ask the RPC process for its authoritative session id.
    for (const agentId of listPiRpcTmuxSessions()) {
      if (this.agents.has(agentId)) continue;
      const agent = agentService.getAgent(agentId);
      if (!agent || agent.provider !== 'pi') {
        // An unpersisted session with no matching agent may belong to another
        // Tide profile/process (most notably an isolated test worker). Only a
        // session named in THIS recovery store is ours to clean up.
        if (savedByAgent.has(agentId)) killPiRpcTmuxSession(agentId);
        continue;
      }
      const logFile = piRpcTmuxLogPath(agentId);
      let offset = 0;
      try { offset = fs.statSync(logFile).size; } catch { /* log not created yet */ }
      const turnState = scanPiRpcLogTailForTurnState(logFile);
      const entry = savedByAgent.get(agentId) ?? {
        agentId,
        sessionId: agent.sessionId,
        workingDir: agent.cwd,
        model: agent.piModel,
        effort: agent.effort,
        startTime: Date.now(),
        turnState,
        agentStatus: turnState === 'processing' ? 'working' : 'idle',
        tmuxSession: piRpcTmuxSessionName(agentId),
        tmuxLogOffset: offset,
        lastRequest: this.recoveryRequestForAgent(agentId),
      };
      this.reconnectTmux(entry);
    }

    this.recovered = true;
    this.persistAll();
  }

  private recoveryRequestForAgent(agentId: string): RunnerRequest | undefined {
    const agent = agentService.getAgent(agentId);
    if (!agent) return undefined;
    return {
      agentId,
      prompt: '',
      workingDir: agent.cwd,
      sessionId: agent.sessionId,
      model: agent.piModel,
      effort: agent.effort,
      permissionMode: agent.permissionMode,
    };
  }

  private reconnectTmux(entry: PersistedPiRpcProcess): void {
    const dummyProcess = spawn('true', [], { stdio: 'ignore' });
    dummyProcess.unref();
    const state: PiRpcAgentState = {
      agentId: entry.agentId,
      process: dummyProcess,
      workingDir: entry.workingDir,
      model: entry.model,
      effort: entry.effort,
      sessionId: entry.sessionId,
      startTime: entry.startTime,
      turnState: entry.turnState,
      lastActivityTime: Date.now(),
      lastRequest: entry.lastRequest ?? this.recoveryRequestForAgent(entry.agentId),
      responseBuffer: '',
      stderrTail: '',
      idleWaiters: [],
      tmuxSession: piRpcTmuxSessionName(entry.agentId),
      tmuxLogFile: piRpcTmuxLogPath(entry.agentId),
      isReconnected: true,
    };
    this.agents.set(entry.agentId, state);

    const agent = agentService.getAgent(entry.agentId);
    const wasWorking = entry.agentStatus === 'working' || entry.turnState === 'processing';
    if (agent) {
      agentService.updateAgent(entry.agentId, {
        status: wasWorking ? 'working' : 'idle',
        isDetached: false,
      });
    }

    this.attachTmuxOutput(state, entry.tmuxLogOffset);
    this.writeCommand(state, { type: 'get_state' });
    log.log(`Reconnected Pi RPC agent ${entry.agentId.slice(0, 8)} to ${state.tmuxSession} at offset ${entry.tmuxLogOffset}`);
  }

  private persistAll(): void {
    if (!this.recovered) return;
    const processes: PersistedPiRpcProcess[] = [];
    for (const state of this.agents.values()) {
      if (!state.tmuxSession || !state.tmuxLogFile) continue;
      processes.push({
        agentId: state.agentId,
        sessionId: state.sessionId,
        workingDir: state.workingDir,
        model: state.model,
        effort: state.effort,
        startTime: state.startTime,
        turnState: state.turnState,
        agentStatus: agentService.getAgent(state.agentId)?.status,
        tmuxSession: state.tmuxSession,
        tmuxLogOffset: state.tmuxTailer?.getOffset() ?? 0,
        lastRequest: state.lastRequest,
      });
    }
    savePiRpcProcesses(processes);
  }

  private checkLiveness(): void {
    let changed = false;
    for (const [agentId, state] of [...this.agents]) {
      if (!state.tmuxSession || hasPiRpcTmuxSession(agentId)) continue;
      try { state.tmuxTailer?.drain(); } catch { /* ignore */ }
      state.tmuxTailer?.stop();
      this.agents.delete(agentId);
      this.releaseIdleWaiters(state);
      this.rejectPendingCommands(agentId, new Error('Pi RPC tmux session exited'));
      if (state.turnState === 'processing') {
        const stderr = this.readTmuxStderr(state);
        const detail = stderr ? `: ${stderr}` : '';
        this.callbacks.onError(agentId, `Pi RPC tmux session exited mid-turn${detail}`);
        this.callbacks.onComplete(agentId, false);
      }
      changed = true;
    }
    if (changed) this.persistAll();
  }

  private readTmuxStderr(state: PiRpcAgentState): string {
    if (!state.tmuxLogFile) return '';
    try {
      return fs.readFileSync(`${state.tmuxLogFile}.stderr`, 'utf8').trim().split('\n').slice(-3).join('\n');
    } catch {
      return '';
    }
  }

  private releaseIdleWaiters(state: PiRpcAgentState): void {
    const waiters = state.idleWaiters.splice(0, state.idleWaiters.length);
    for (const waiter of waiters) waiter();
  }

  private isProcessAlive(state: PiRpcAgentState | undefined): state is PiRpcAgentState {
    if (!state) return false;
    if (state.tmuxSession) return hasPiRpcTmuxSession(state.agentId);
    return state.process.exitCode === null && !state.process.killed;
  }

  private writeCommand(state: PiRpcAgentState, command: Record<string, unknown>): boolean {
    const line = JSON.stringify(command);
    if (state.tmuxSession) return sendToPiRpcTmux(state.agentId, line);
    try {
      if (!state.process.stdin || !state.process.stdin.writable) return false;
      state.process.stdin.write(line + '\n');
      return true;
    } catch (err) {
      log.error(`writeCommand failed for ${state.agentId.slice(0, 8)}: ${String(err)}`);
      return false;
    }
  }

  private sendCommandAndWait(
    state: PiRpcAgentState,
    command: Record<string, unknown> & { type: string },
  ): Promise<PiRpcResponse> {
    const id = `tc-${command.type}-${state.agentId}-${Date.now()}-${++this.commandSequence}`;
    return new Promise<PiRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Pi RPC ${command.type} timed out`));
      }, RPC_COMMAND_TIMEOUT_MS);
      this.pendingCommands.set(id, {
        agentId: state.agentId,
        command: command.type,
        resolve,
        reject,
        timer,
      });
      if (!this.writeCommand(state, { id, ...command })) {
        clearTimeout(timer);
        this.pendingCommands.delete(id);
        reject(new Error(`Pi RPC ${command.type} write failed`));
      }
    });
  }

  private rejectPendingCommands(agentId: string, error: Error): void {
    for (const [id, pending] of this.pendingCommands) {
      if (pending.agentId !== agentId) continue;
      clearTimeout(pending.timer);
      this.pendingCommands.delete(id);
      pending.reject(error);
    }
  }

  private handleResponseLine(agentId: string, line: string): void {
    let parsed: PiRpcResponse;
    try { parsed = JSON.parse(line); } catch { return; }
    if (parsed?.type !== 'response') return;

    if (parsed.id) {
      const pending = this.pendingCommands.get(parsed.id);
      if (pending && pending.agentId === agentId) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(parsed.id);
        pending.resolve(parsed);
      }
    }

    const state = this.agents.get(agentId);
    const isManualCompaction = parsed.command === 'compact';
    if (parsed.success === false) {
      const message = `Pi RPC ${parsed.command || 'command'} rejected: ${parsed.error || 'unknown error'}`;
      log.warn(`${agentId.slice(0, 8)}: ${message}`);
      this.callbacks.onOutput(agentId, `⚠️ [System] ${message}`, false, undefined, `pi-rpc-reject-${Date.now()}`);
      if (isManualCompaction && state?.manualCompactionPending) {
        state.manualCompactionPending = false;
        state.turnState = 'waiting_for_input';
        this.releaseIdleWaiters(state);
        this.callbacks.onComplete(agentId, false);
        this.persistAll();
      }
      return;
    }

    if (isManualCompaction && state) {
      // Pi RPC's compact response arrives only after compaction_end. Manual
      // compaction normally emits no agent_settled, so this response settles
      // Tide. The pending guard prevents a duplicate completion if a future Pi
      // release emits agent_settled before the response.
      if (state.manualCompactionPending) {
        state.manualCompactionPending = false;
        state.turnState = 'waiting_for_input';
        this.releaseIdleWaiters(state);
        this.callbacks.onComplete(agentId, true);
        this.persistAll();
      }
      return;
    }

    if (parsed.command === 'get_state') {
      const data = parsed.data as {
        sessionId?: string;
        model?: { provider?: string; contextWindow?: number } | null;
      } | undefined;
      const modelProvider = typeof data?.model?.provider === 'string'
        ? data.model.provider.trim().toLowerCase()
        : '';
      const contextWindow = typeof data?.model?.contextWindow === 'number'
        ? data.model.contextWindow
        : 0;
      const currentAgent = agentService.getAgent(agentId);
      const modelUpdates: {
        piModelProvider?: string;
        contextLimit?: number;
        contextStats?: undefined;
      } = {};
      if (modelProvider) modelUpdates.piModelProvider = modelProvider;
      if (contextWindow > 0 && contextWindow !== currentAgent?.contextLimit) {
        modelUpdates.contextLimit = contextWindow;
        modelUpdates.contextStats = undefined;
      }
      if (Object.keys(modelUpdates).length > 0) {
        agentService.updateAgent(agentId, modelUpdates, false);
      }

      if (data?.sessionId) {
        const sessionId = data.sessionId;
        if (state) {
          state.sessionId = sessionId;
          if (state.lastRequest) state.lastRequest.sessionId = sessionId;
        }
        this.callbacks.onSessionId(agentId, sessionId);
        this.persistAll();
      }
    }
  }

  private attachTmuxOutput(state: PiRpcAgentState, offset = 0): void {
    state.tmuxTailer = this.pipeline.handleTmuxLog(
      state.agentId,
      state.tmuxLogFile!,
      offset,
      (line) => this.handleResponseLine(state.agentId, line),
    );
  }

  private buildArgs(request: RunnerRequest): string[] {
    const args = ['--mode', 'rpc'];
    addPiDetailedReasoningExtension(args);
    if (shouldPassPiModel(request.model)) args.push('--model', request.model);
    if (request.effort) args.push('--thinking', piThinkingLevelForEffort(request.effort));
    if (request.sessionId && !request.forceNewSession) {
      args.push(request.forkSession ? '--fork' : '--session', request.sessionId);
    }
    return args;
  }

  private async waitForTmux(agentId: string): Promise<boolean> {
    const deadline = Date.now() + TMUX_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (hasPiRpcTmuxSession(agentId)) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  private async spawnAgentProcess(request: RunnerRequest): Promise<PiRpcAgentState> {
    const args = this.buildArgs(request);
    const executable = this.backend.getExecutablePath();
    const env = {
      ...process.env,
      ...this.backend.getExtraEnv(),
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TIDE_SERVER: `http://localhost:${process.env.TIDE_PORT || process.env.PORT || 5174}`,
      TIDE_AGENT_ID: request.agentId,
    };
    const useTmux = process.platform !== 'win32' && isTmuxEnabled();
    log.log(`Spawning pi RPC for ${request.agentId.slice(0, 8)}${useTmux ? ' in tmux' : ''}: ${executable} ${args.join(' ')}`);

    let child: ChildProcess;
    let tmuxSession: string | undefined;
    let tmuxLogFile: string | undefined;
    if (useTmux) {
      const result = spawnInPiRpcTmux(executable, args, {
        agentId: request.agentId,
        cwd: request.workingDir,
        env,
      });
      child = result.launcherProcess;
      tmuxSession = result.sessionName;
      tmuxLogFile = result.logFile;
    } else {
      child = spawn(executable, args, {
        cwd: request.workingDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    const state: PiRpcAgentState = {
      agentId: request.agentId,
      process: child,
      workingDir: request.workingDir,
      model: request.model,
      effort: request.effort,
      sessionId: request.sessionId,
      startTime: Date.now(),
      turnState: 'waiting_for_input',
      lastActivityTime: Date.now(),
      lastRequest: request,
      responseBuffer: '',
      stderrTail: '',
      idleWaiters: [],
      tmuxSession,
      tmuxLogFile,
    };
    this.agents.set(request.agentId, state);

    if (tmuxSession) {
      this.attachTmuxOutput(state);
      child.on('error', (err) => {
        if (this.agents.get(request.agentId) !== state) return;
        this.callbacks.onError(request.agentId, `Failed to start Pi RPC tmux session: ${String(err)}`);
      });
      if (!(await this.waitForTmux(request.agentId))) {
        state.tmuxTailer?.stop();
        this.agents.delete(request.agentId);
        killPiRpcTmuxSession(request.agentId);
        throw new Error(`Pi RPC tmux session ${tmuxSession} did not start`);
      }
    } else {
      const stdoutDone = this.pipeline.handleStdout(request.agentId, child);
      child.stdout?.on('data', (data: Buffer) => {
        state.responseBuffer += data.toString('utf-8');
        let index: number;
        while ((index = state.responseBuffer.indexOf('\n')) >= 0) {
          const line = state.responseBuffer.slice(0, index);
          state.responseBuffer = state.responseBuffer.slice(index + 1);
          if (line.trim()) this.handleResponseLine(request.agentId, line);
        }
      });
      child.stderr?.on('data', (data: Buffer) => {
        state.stderrTail = (state.stderrTail + data.toString('utf-8')).slice(-2000);
      });
      child.on('close', async (code, signal) => {
        await stdoutDone;
        if (this.agents.get(request.agentId) !== state) return;
        this.agents.delete(request.agentId);
        const midTurn = state.turnState === 'processing';
        this.releaseIdleWaiters(state);
        this.rejectPendingCommands(request.agentId, new Error('Pi RPC process exited'));
        if (midTurn) {
          const detail = state.stderrTail.trim().split('\n').slice(-3).join('\n');
          this.callbacks.onError(request.agentId, `Pi RPC process exited mid-turn (code=${code ?? 'null'})${detail ? `: ${detail}` : ''}`);
          this.callbacks.onComplete(request.agentId, false);
        }
        log.log(`pi RPC for ${request.agentId.slice(0, 8)} closed (code=${code}, signal=${signal ?? 'none'})`);
      });
      child.on('error', (err) => {
        if (this.agents.get(request.agentId) !== state) return;
        this.agents.delete(request.agentId);
        this.rejectPendingCommands(request.agentId, new Error(`Pi RPC process error: ${String(err)}`));
        this.callbacks.onError(request.agentId, `Failed to start pi RPC: ${String(err)}`);
        this.callbacks.onComplete(request.agentId, false);
      });
    }

    this.persistAll();
    this.writeCommand(state, { type: 'get_state' });
    return state;
  }

  private isReusable(state: PiRpcAgentState, request: RunnerRequest): boolean {
    return !request.forceNewSession
      && state.workingDir === request.workingDir
      && state.model === request.model
      && state.effort === request.effort;
  }

  async run(request: RunnerRequest): Promise<void> {
    const existing = this.agents.get(request.agentId);
    let state: PiRpcAgentState;
    if (this.isProcessAlive(existing) && this.isReusable(existing, request)) {
      state = existing;
      state.lastRequest = request;
    } else {
      if (this.isProcessAlive(existing)) await this.stop(request.agentId);
      state = await this.spawnAgentProcess(request);
    }

    const promptText = buildPiPrompt({
      agentId: request.agentId,
      sessionId: request.forceNewSession ? undefined : request.sessionId,
      prompt: request.prompt,
      workingDir: request.workingDir,
      systemPrompt: request.systemPrompt,
      customAgent: request.customAgent,
    });
    const command: Record<string, unknown> = { type: 'prompt', message: promptText };
    if (state.turnState === 'processing') command.streamingBehavior = 'steer';
    else state.turnState = 'processing';

    if (!this.writeCommand(state, command)) {
      state.turnState = 'waiting_for_input';
      throw new Error('Pi RPC stdin write failed');
    }
    state.lastActivityTime = Date.now();
    this.persistAll();
  }

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
      state.lastActivityTime = Date.now();
      this.persistAll();
    }
    return written;
  }

  async interruptTurn(agentId: string, _clearQueue?: boolean): Promise<boolean> {
    const state = this.agents.get(agentId);
    if (!this.isProcessAlive(state)) return false;
    if (state.turnState !== 'processing') return true;
    if (!this.writeCommand(state, { type: 'abort' })) return false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ABORT_SETTLE_TIMEOUT_MS);
      state.idleWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
    return true;
  }

  async switchModel(agentId: string, model: string, effort?: string): Promise<boolean> {
    let state = this.agents.get(agentId);
    const separator = model.indexOf('/');
    if (!this.isProcessAlive(state) || separator <= 0 || separator === model.length - 1) return false;

    if (state.turnState === 'processing') {
      await this.interruptTurn(agentId, true);
      state = this.agents.get(agentId);
      if (!this.isProcessAlive(state) || state.turnState !== 'waiting_for_input') return false;
    }

    const provider = model.slice(0, separator);
    const modelId = model.slice(separator + 1);
    try {
      const response = await this.sendCommandAndWait(state, {
        type: 'set_model',
        provider,
        modelId,
      });
      if (response.success !== true) {
        throw new Error(response.error || `Pi rejected model ${model}`);
      }

      state.model = model;
      if (state.lastRequest) state.lastRequest.model = model;

      if (effort) {
        try {
          const thinkingResponse = await this.sendCommandAndWait(state, {
            type: 'set_thinking_level',
            level: piThinkingLevelForEffort(effort),
          });
          if (thinkingResponse.success === true) {
            state.effort = effort;
            if (state.lastRequest) state.lastRequest.effort = effort;
          }
        } catch (err) {
          // The model change already succeeded. Keep it and let Pi retain or
          // clamp its current thinking level rather than reporting a false
          // model-switch failure that would desync Tide from the live session.
          log.warn(`Pi model switched for ${agentId.slice(0, 8)}, but thinking level could not be updated: ${String(err)}`);
        }
      }

      state.lastActivityTime = Date.now();
      this.persistAll();
      this.writeCommand(state, { type: 'get_state' });
      return true;
    } catch (err) {
      log.warn(`Could not switch Pi model for ${agentId.slice(0, 8)}: ${String(err)}`);
      throw err;
    }
  }

  async compactContext(agentId: string, customInstructions?: string): Promise<boolean> {
    const state = this.agents.get(agentId);
    if (!this.isProcessAlive(state) || state.turnState !== 'waiting_for_input') return false;

    const command: Record<string, unknown> = {
      id: `tc-compact-${Date.now()}`,
      type: 'compact',
    };
    const instructions = customInstructions?.trim();
    if (instructions) command.customInstructions = instructions;

    state.turnState = 'processing';
    state.manualCompactionPending = true;
    if (!this.writeCommand(state, command)) {
      state.turnState = 'waiting_for_input';
      state.manualCompactionPending = false;
      return false;
    }
    state.lastActivityTime = Date.now();
    this.persistAll();
    return true;
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    const state = this.agents.get(agentId);
    return this.isProcessAlive(state) ? state.turnState : undefined;
  }

  getQueuedMessages(_agentId: string): string[] { return []; }
  removeQueuedMessage(_agentId: string, _index: number, _expectedText: string): boolean { return false; }

  async stop(agentId: string, _clearQueue?: boolean): Promise<void> {
    const state = this.agents.get(agentId);
    this.agents.delete(agentId);
    this.nextActivityCallbacks.delete(agentId);
    if (!state) {
      if (hasPiRpcTmuxSession(agentId)) killPiRpcTmuxSession(agentId);
      this.persistAll();
      return;
    }
    this.releaseIdleWaiters(state);
    this.rejectPendingCommands(agentId, new Error('Pi RPC agent stopped'));
    try { this.writeCommand(state, { type: 'abort' }); } catch { /* best effort */ }
    state.tmuxTailer?.stop();
    if (state.tmuxSession) {
      killPiRpcTmuxSession(agentId);
    } else {
      try { state.process.stdin?.end(); } catch { /* ignore */ }
      if (state.process.exitCode === null && !state.process.killed) state.process.kill('SIGTERM');
    }
    this.persistAll();
  }

  async stopAll(killProcesses: boolean = true, _clearQueue?: boolean): Promise<void> {
    if (this.persistTimer) clearInterval(this.persistTimer);
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    this.persistTimer = null;
    this.livenessTimer = null;

    if (!killProcesses) this.persistAll();
    for (const [agentId, state] of [...this.agents]) {
      state.tmuxTailer?.stop();
      this.releaseIdleWaiters(state);
      this.rejectPendingCommands(agentId, new Error('Pi RPC runner stopped'));
      this.agents.delete(agentId);
      if (state.tmuxSession) {
        if (killProcesses) killPiRpcTmuxSession(agentId);
      } else {
        try { state.process.kill('SIGTERM'); } catch { /* already gone */ }
      }
    }
    this.nextActivityCallbacks.clear();
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Pi RPC runner stopped'));
    }
    this.pendingCommands.clear();
    if (killProcesses) clearPiRpcProcesses();
  }

  isRunning(agentId: string): boolean {
    const state = this.agents.get(agentId);
    if (!state) return false;
    const alive = state.tmuxSession
      ? hasPiRpcTmuxSession(agentId)
      : state.process.exitCode === null && !state.process.killed;
    if (alive) return true;
    state.tmuxTailer?.stop();
    this.agents.delete(agentId);
    return false;
  }

  hasRecentActivity(agentId: string, withinMs: number): boolean {
    const state = this.agents.get(agentId);
    return !!state && Date.now() - state.lastActivityTime <= withinMs;
  }

  onNextActivity(agentId: string, callback: () => void): void {
    const callbacks = this.nextActivityCallbacks.get(agentId) ?? [];
    callbacks.push(callback);
    this.nextActivityCallbacks.set(agentId, callbacks);
  }

  supportsStdin(): boolean { return true; }
  closesStdinAfterPrompt(): boolean { return false; }

  getActiveProcessesState(): Array<{ agentId: string; pid: number | undefined }> {
    return Array.from(this.agents.values()).map((state) => ({
      agentId: state.agentId,
      pid: state.tmuxSession ? getPiRpcTmuxPanePid(state.agentId) : state.process.pid,
    }));
  }
}
