/**
 * Claude Code Process Runner
 * Spawns and manages Claude Code CLI processes with streaming output
 */

import type {
  CLIBackend,
  RunnerRequest,
  RunnerCallbacks,
  ActiveProcess,
  ProcessDeathInfo,
} from './types.js';
import { ClaudeBackend } from './backend.js';
import { createLogger } from '../utils/logger.js';
import { isProcessRunning } from '../data/index.js';
import { sendToTmux, hasTmuxSession, tmuxSessionName, getTmuxPanePid } from './runner/tmux-helper.js';
import type { RunningProcessInfo } from '../data/index.js';
import { spawn } from 'child_process';
import * as agentService from '../services/agent-service.js';
import { RunnerInternalEventBus } from './runner/internal-events.js';
import { RunnerStdoutPipeline } from './runner/stdout-pipeline.js';
import { RunnerProcessLifecycle } from './runner/process-lifecycle.js';
import { RunnerRestartPolicy } from './runner/restart-policy.js';
import { RunnerWatchdog } from './runner/watchdog.js';
import { RunnerRecoveryStore } from './runner/recovery-store.js';
import { RunnerResourceMonitor } from './runner/resource-monitor.js';

const log = createLogger('Runner');

const PERSIST_INTERVAL = 10000;
const WATCHDOG_INTERVAL = 5000;

export class ClaudeRunner {
  private backend: CLIBackend;
  private callbacks: RunnerCallbacks;
  private activeProcesses: Map<string, ActiveProcess> = new Map();
  private lastStderr: Map<string, string> = new Map();
  private activityCallbacks: Map<string, Array<() => void>> = new Map();
  private messageQueue: Map<string, string[]> = new Map();
  private autoRestartEnabled = true;

  private persistTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  private bus: RunnerInternalEventBus;
  private stdoutPipeline: RunnerStdoutPipeline;
  private lifecycle: RunnerProcessLifecycle;
  private restartPolicy: RunnerRestartPolicy;
  private watchdog: RunnerWatchdog;
  private recoveryStore: RunnerRecoveryStore;
  private resourceMonitor: RunnerResourceMonitor;

  constructor(callbacks: RunnerCallbacks);
  constructor(callbacks: RunnerCallbacks, backend: CLIBackend);
  constructor(callbacks: RunnerCallbacks, backend?: CLIBackend) {
    this.backend = backend ?? new ClaudeBackend();
    this.callbacks = callbacks;

    this.bus = new RunnerInternalEventBus();
    this.stdoutPipeline = new RunnerStdoutPipeline({
      backend: this.backend,
      callbacks: this.callbacks,
      bus: this.bus,
    });

    this.recoveryStore = new RunnerRecoveryStore({
      backend: this.backend,
      activeProcesses: this.activeProcesses,
      run: (request) => this.run(request),
      reconnectTmux: (agentId, logFile, offset, savedProcess) => {
        this.reconnectToTmuxSession(agentId, logFile, offset, savedProcess);
      },
    });

    this.lifecycle = new RunnerProcessLifecycle({
      backend: this.backend,
      callbacks: this.callbacks,
      activeProcesses: this.activeProcesses,
      lastStderr: this.lastStderr,
      activityCallbacks: this.activityCallbacks,
      bus: this.bus,
      stdoutPipeline: this.stdoutPipeline,
      recoveryStore: this.recoveryStore,
      onDisableAutoRestart: () => {
        this.autoRestartEnabled = false;
      },
    });

    this.restartPolicy = new RunnerRestartPolicy({
      callbacks: this.callbacks,
      activeProcesses: this.activeProcesses,
      getAutoRestartEnabled: () => this.autoRestartEnabled,
      run: (request) => this.run(request),
    });

    this.watchdog = new RunnerWatchdog({
      activeProcesses: this.activeProcesses,
      lastStderr: this.lastStderr,
      bus: this.bus,
    });

    this.resourceMonitor = new RunnerResourceMonitor({
      activeProcesses: this.activeProcesses,
    });

    this.wireInternalEvents();

    this.persistTimer = setInterval(() => {
      this.recoveryStore.persistRunningProcesses();
    }, PERSIST_INTERVAL);

    this.watchdogTimer = setInterval(() => {
      this.watchdog.runWatchdog();
    }, WATCHDOG_INTERVAL);

    this.recoveryStore.recoverOrphanedProcesses();
    log.log('🛡️ Runner initialized with auto-restart and watchdog enabled');
  }

  private wireInternalEvents(): void {
    this.bus.on('runner.activity', ({ agentId, timestamp }) => {
      const activeProcess = this.activeProcesses.get(agentId);
      if (activeProcess) {
        activeProcess.lastActivityTime = timestamp;
      }

      const callbacks = this.activityCallbacks.get(agentId);
      if (!callbacks || callbacks.length === 0) {
        return;
      }

      for (const callback of callbacks) {
        try {
          callback();
        } catch (err) {
          log.error(`Activity callback error for ${agentId}:`, err);
        }
      }
      this.activityCallbacks.delete(agentId);
    });

    this.bus.on('runner.session_id', ({ agentId, sessionId }) => {
      const activeProcess = this.activeProcesses.get(agentId);
      if (!activeProcess) {
        return;
      }
      activeProcess.sessionId = sessionId;
      if (activeProcess.lastRequest && !activeProcess.lastRequest.sessionId) {
        activeProcess.lastRequest.sessionId = sessionId;
      }
    });

    this.bus.on('runner.process_spawned', ({ agentId, pid }) => {
      log.log(`🚀 [SPAWN] Agent ${agentId}: Process started with pid ${pid}`);
    });

    this.bus.on('runner.process_spawn_error', ({ agentId, error }) => {
      log.error(`❌ [SPAWN ERROR] Agent ${agentId}: Failed to spawn process: ${error.message}`);
      this.activeProcesses.delete(agentId);
      this.callbacks.onError(agentId, error.message);
    });

    this.bus.on('runner.watchdog_missing_process', ({ agentId, activeProcess }) => {
      // If the process (tmux session or pipe process) exited after completing
      // its turn (turnState='waiting_for_input') and has queued messages, treat
      // it the same as a clean turn-end exit in process_closed: respawn with
      // session resume, delivering the queued message as the new prompt.
      // This is the tmux analogue of the cleanTurnEnd branch in process_closed.
      // Without this, codex/opencode agents in tmux mode silently lose queued
      // messages because the tmux launcher PID doesn't emit 'close' events —
      // the watchdog is the only signal we get when the session dies.
      const queuedCount = this.messageQueue.get(agentId)?.length ?? 0;
      if (
        activeProcess.turnState === 'waiting_for_input'
        && queuedCount > 0
        && activeProcess.lastRequest
      ) {
        log.log(`🔁 [WATCHDOG] Agent ${agentId}: session died after turn complete with ${queuedCount} queued message(s), respawning to deliver`);
        this.respawnWithQueuedMessage(agentId, activeProcess);
        return;
      }
      this.restartPolicy.maybeAutoRestart(agentId, activeProcess, null, null);
    });

    // Track turn state transitions based on events
    this.bus.on('runner.event', ({ agentId, event }) => {
      const activeProcess = this.activeProcesses.get(agentId);
      if (!activeProcess) return;

      if (event.type === 'init') {
        // Process just initialized or started a new turn - it's processing
        activeProcess.turnState = 'processing';
      } else if (event.type === 'step_complete') {
        // Turn completed - process is now waiting for the next stdin message
        activeProcess.turnState = 'waiting_for_input';
        log.log(`🔄 [TURN] Agent ${agentId}: Turn complete, now waiting for input (stdin reuse ready)`);
        // Drain any messages that were queued while the agent was mid-turn
        this.drainMessageQueue(agentId, activeProcess);
      } else if (event.type === 'text' || event.type === 'tool_start' || event.type === 'thinking') {
        // Actively processing
        activeProcess.turnState = 'processing';
      }
    });

    this.bus.on('runner.process_closed', ({ agentId, pid, code, signal }) => {
      const wasTracked = this.activeProcesses.has(agentId);
      const trackedProcess = this.activeProcesses.get(agentId);
      const runtime = trackedProcess ? Date.now() - trackedProcess.startTime : 0;

      const deathInfo: ProcessDeathInfo = {
        agentId,
        pid,
        exitCode: code,
        signal,
        runtime,
        wasTracked,
        timestamp: Date.now(),
        stderr: this.lastStderr.get(agentId),
      };

      this.activeProcesses.delete(agentId);
      this.lastStderr.delete(agentId);

      if (signal) {
        if (signal === 'SIGINT') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process terminated by SIGINT (user interrupt), pid was ${pid}, runtime ${(runtime / 1000).toFixed(1)}s`);
        } else if (signal === 'SIGTERM') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process terminated by SIGTERM (stop request), pid was ${pid}, runtime ${(runtime / 1000).toFixed(1)}s`);
        } else if (signal === 'SIGKILL') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process force-killed by SIGKILL, pid was ${pid}, runtime ${(runtime / 1000).toFixed(1)}s`);
          this.watchdog.recordDeath(deathInfo);
        } else {
          log.log(`⚠️ [EXIT] Agent ${agentId}: Process killed by signal ${signal}, pid was ${pid}, runtime ${(runtime / 1000).toFixed(1)}s`);
          this.watchdog.recordDeath(deathInfo);
        }
      } else if (code === 0) {
        log.log(`✅ [EXIT] Agent ${agentId}: Process completed successfully (exit code 0), pid was ${pid}, runtime ${(runtime / 1000).toFixed(1)}s`);
      } else {
        log.error(`❌ [EXIT] Agent ${agentId}: Process exited with error code ${code}, pid was ${pid}, runtime ${(runtime / 1000).toFixed(1)}s${!wasTracked ? ' (unexpected - was not being tracked)' : ''}`);
        this.watchdog.recordDeath(deathInfo);
      }

      // If the backend closes stdin per-turn (e.g. opencode) and a user sent a
      // message while this turn was in flight, that message is still queued.
      // Detect a clean turn-end exit and respawn with session resume so the
      // queued message gets delivered as the next prompt.
      const queuedCount = this.messageQueue.get(agentId)?.length ?? 0;
      const cleanTurnEnd =
        wasTracked
        && code === 0
        && !signal
        && !!trackedProcess?.lastRequest
        && queuedCount > 0;

      if (!wasTracked && (signal === 'SIGINT' || signal === 'SIGTERM')) {
        log.log(`⏭️ [EXIT] Agent ${agentId}: Skipping onComplete - process was explicitly stopped (signal=${signal})`);
        // Belt-and-suspenders: ensure the agent ends up idle even if stale
        // stdout events (buffered before the process died) set it back to working.
        const currentAgent = agentService.getAgent(agentId);
        if (currentAgent && currentAgent.status === 'working') {
          log.log(`⚠️ [EXIT] Agent ${agentId}: Was still 'working' after explicit stop - forcing idle`);
          agentService.updateAgent(agentId, {
            status: 'idle',
            currentTask: undefined,
            currentTool: undefined,
            isDetached: false,
          });
        }
      } else if (cleanTurnEnd) {
        log.log(`⏭️ [EXIT] Agent ${agentId}: Skipping onComplete - respawning to deliver ${queuedCount} queued message(s)`);
      } else {
        this.callbacks.onComplete(agentId, code === 0);
      }

      if (cleanTurnEnd && trackedProcess) {
        this.respawnWithQueuedMessage(agentId, trackedProcess);
      } else if (trackedProcess && code !== 0 && signal !== 'SIGINT' && signal !== 'SIGTERM') {
        this.restartPolicy.maybeAutoRestart(agentId, trackedProcess, code, signal);
      }
    });
  }

  supportsStdin(): boolean {
    return this.backend.requiresStdinInput();
  }

  closesStdinAfterPrompt(): boolean {
    return this.backend.shouldCloseStdinAfterPrompt?.() === true;
  }

  setAutoRestart(enabled: boolean): void {
    this.autoRestartEnabled = enabled;
    log.log(`🔄 Auto-restart ${enabled ? 'enabled' : 'disabled'}`);
  }

  getDeathHistory(): ProcessDeathInfo[] {
    return this.watchdog.getDeathHistory();
  }

  getActiveProcessesState(): Array<{
    agentId: string;
    pid: number | undefined;
    runtimeSec: number;
    lastActivitySec: number;
    hasError: boolean;
    stdinWritable: boolean;
    turnState: string;
  }> {
    const now = Date.now();
    return Array.from(this.activeProcesses.entries()).map(([agentId, proc]) => {
      // For tmux processes, the launcher PID exits quickly — resolve the real
      // PID from the tmux pane so witr/debug tools can find the process.
      let pid = proc.process.pid;
      if (proc.tmuxSession) {
        const panePid = getTmuxPanePid(agentId);
        if (panePid) {
          pid = panePid;
        }
      }
      return {
        agentId,
        pid,
        runtimeSec: (now - proc.startTime) / 1000,
        lastActivitySec: proc.lastActivityTime ? (now - proc.lastActivityTime) / 1000 : -1,
        hasError: !!proc.lastError,
        stdinWritable: !!(proc.process.stdin && proc.process.stdin.writable),
        turnState: proc.turnState || 'unknown',
      };
    });
  }

  logProcessDiagnostics(): void {
    const state = this.getActiveProcessesState();
    const count = state.length;

    if (count === 0) {
      log.log('📊 [DIAGNOSTICS] No active processes');
      return;
    }

    log.log(`📊 [DIAGNOSTICS] ${count} active process(es):`);
    for (const proc of state) {
      const errorStr = proc.hasError ? ' ❌ERROR' : '';
      const stdinStr = proc.stdinWritable ? ' ✅stdin' : ' ❌stdin';
      const turnStr = ` turn=${proc.turnState}`;
      log.log(`   ${proc.agentId.slice(0, 8)}: PID=${proc.pid} runtime=${proc.runtimeSec.toFixed(1)}s activity=${proc.lastActivitySec >= 0 ? `${proc.lastActivitySec.toFixed(1)}s` : 'none'}${stdinStr}${turnStr}${errorStr}`);
    }
  }

  async run(request: RunnerRequest): Promise<void> {
    await this.lifecycle.run(request);
  }

  sendMessage(agentId: string, message: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      log.error(`❌ [SEND_MESSAGE] No active process for agent ${agentId}`);
      return false;
    }

    // tmux mode dispatch:
    //   - Stdin-closed backends (codex, opencode) MUST queue. They were
    //     launched as `cat <file> | codex …` so their stdin is the pipe, not
    //     the tmux pane. Once cat hits EOF they receive EOF; tmux send-keys
    //     would write to a pane they aren't reading. Delivery happens via
    //     respawn-with-session-resume when the session dies (handled by the
    //     watchdog_missing_process branch).
    //   - Stdin-open backends (claude) are launched as
    //     `(cat <file>; cat) | claude --input-format stream-json …` — the
    //     trailing `cat` reads from the tmux pane, so send-keys writes are
    //     fed to claude's stdin as additional stream-json lines. Claude
    //     handles mid-turn `{type:"user",…}` messages natively (queues them
    //     internally for post-turn or injects them per its own protocol), so
    //     we write immediately regardless of turnState instead of blocking
    //     the user until step_complete.
    if (activeProcess.tmuxSession) {
      const tmuxTurnState = activeProcess.turnState || 'processing';
      const tmuxBackendClosesStdin = this.backend.shouldCloseStdinAfterPrompt?.() === true;
      if (tmuxBackendClosesStdin) {
        const queue = this.messageQueue.get(agentId) ?? [];
        queue.push(message);
        this.messageQueue.set(agentId, queue);
        log.log(`📋 [QUEUE-TMUX] Agent ${agentId}: queued message (stdin-closed backend, turnState=${tmuxTurnState}, queue=${queue.length}, ${message.length} chars)`);
        return true;
      }
      const stdinInput = this.backend.formatStdinInput(message);
      log.log(`📨 [SEND_MESSAGE] Agent ${agentId} (tmux, turnState=${tmuxTurnState}), sending via tmux send-keys (${stdinInput.length} chars)`);
      const ok = sendToTmux(agentId, stdinInput);
      if (ok) {
        activeProcess.turnState = 'processing';
      }
      return ok;
    }

    const turnState = activeProcess.turnState || 'processing';
    const messageLen = message.length;
    const backendClosesStdin = this.backend.shouldCloseStdinAfterPrompt?.() === true;

    // Stdin-closed backends (codex, opencode) MUST always queue: there is
    // literally no open stdin to write to after the initial prompt.
    // sendCommand's interrupt-and-restart branch handles mid-turn prompts for
    // these by stopping+respawning; this queue catches the narrow
    // step_complete/process_exit race window where respawn is the only
    // delivery path (cleanTurnEnd in runner.ts:248 picks it up).
    if (backendClosesStdin) {
      const queue = this.messageQueue.get(agentId) ?? [];
      queue.push(message);
      this.messageQueue.set(agentId, queue);
      log.log(`📋 [QUEUE] Agent ${agentId}: queued message for respawn delivery (stdin-closed backend, turnState=${turnState}, queue=${queue.length}, ${messageLen} chars)`);
      return true;
    }

    // Stdin-open backends (claude): write directly regardless of turnState.
    // Claude's --input-format stream-json accepts additional
    // {type:"user",...} JSON lines at any time and interleaves them with the
    // current turn per its own protocol. Blocking on 'waiting_for_input'
    // previously made the user wait for step_complete before Claude even saw
    // the message; now it goes straight to Claude's stdin.
    const stdin = activeProcess.process.stdin;
    if (!stdin || !stdin.writable) {
      // Defensive fallback: if stdin unexpectedly isn't writable (pipe
      // closed, process dying), queue so the respawn path can recover the
      // message instead of dropping it.
      log.warn(`⚠️ [SEND_MESSAGE] Agent ${agentId}: stdin not writable (stdin=${!!stdin}, writable=${stdin?.writable}); queueing for recovery path (turnState=${turnState}, ${messageLen} chars)`);
      const queue = this.messageQueue.get(agentId) ?? [];
      queue.push(message);
      this.messageQueue.set(agentId, queue);
      return true;
    }

    log.log(`📨 [SEND_MESSAGE] Agent ${agentId} (turnState=${turnState}), sending directly via stdin (${messageLen} chars)`);
    return this.writeToStdin(agentId, activeProcess, message);
  }

  /**
   * Write a message directly to the process stdin (no turn state checks)
   */
  private writeToStdin(agentId: string, activeProcess: ActiveProcess, message: string): boolean {
    const stdin = activeProcess.process.stdin;
    if (!stdin || !stdin.writable) {
      log.error(`❌ [WRITE_STDIN] stdin not writable for ${agentId}`);
      return false;
    }

    const stdinInput = this.backend.formatStdinInput(message);
    const messageLen = message.length;

    stdin.write(stdinInput + '\n', 'utf8', (err) => {
      if (err) {
        log.error(`❌ [WRITE_STDIN] Failed to write ${messageLen} chars to stdin for ${agentId}: ${err.message}`);
        activeProcess.lastError = {
          type: 'stdin_write_error',
          message: err.message,
          timestamp: Date.now(),
        };
      } else {
        log.log(`✅ [WRITE_STDIN] Successfully wrote ${messageLen} chars to ${agentId}`);
        activeProcess.turnState = 'processing';
      }
    });

    return true;
  }

  /**
   * Drain the next queued message (if any) to the process stdin.
   * Called after step_complete when the process transitions to waiting_for_input.
   *
   * For backends that close stdin after each turn (e.g. opencode), the process
   * is about to exit — we leave the message in the queue and let the
   * runner.process_closed handler respawn with session resume.
   */
  private drainMessageQueue(agentId: string, activeProcess: ActiveProcess): void {
    const queue = this.messageQueue.get(agentId);
    if (!queue || queue.length === 0) return;

    if (activeProcess.tmuxSession) {
      // For stdin-closing backends in tmux mode (codex): the process was launched
      // as `cat <file> | codex` so codex's stdin is the pipe, not the tmux pane.
      // Once the initial file is consumed codex gets EOF; tmux send-keys would
      // write to a pane codex isn't reading. Leave the message in the queue and
      // let the runner.watchdog_missing_process handler respawn with session
      // resume when the codex process exits and the tmux session dies.
      if (this.backend.shouldCloseStdinAfterPrompt?.() === true) {
        log.log(`⏸️ [QUEUE-DRAIN] Agent ${agentId}: tmux + stdin-closed backend, deferring delivery to respawn after session exit (${queue.length} queued)`);
        return;
      }
      const nextMessage = queue.shift()!;
      if (queue.length === 0) this.messageQueue.delete(agentId);
      log.log(`📤 [QUEUE-DRAIN] Agent ${agentId}: Delivering queued message via tmux (${queue.length} remaining, ${nextMessage.length} chars)`);
      const stdinInput = this.backend.formatStdinInput(nextMessage);
      const ok = sendToTmux(agentId, stdinInput);
      if (ok) {
        activeProcess.turnState = 'processing';
      } else {
        log.error(`❌ [QUEUE-DRAIN] Agent ${agentId}: tmux send failed for queued message`);
      }
      return;
    }

    const stdin = activeProcess.process.stdin;
    if (!stdin || !stdin.writable) {
      // Backend closes stdin per-turn (e.g. opencode). The process will exit on
      // its own now that the turn is done and stdin is at EOF. The message stays
      // in the queue; the runner.process_closed handler will respawn with session
      // resume and deliver it as the next prompt.
      log.log(`⏸️ [QUEUE-DRAIN] Agent ${agentId}: stdin closed, deferring delivery to respawn after process exit (${queue.length} queued)`);
      return;
    }

    const nextMessage = queue.shift()!;
    if (queue.length === 0) this.messageQueue.delete(agentId);
    log.log(`📤 [QUEUE-DRAIN] Agent ${agentId}: Delivering queued message via stdin (${queue.length} remaining, ${nextMessage.length} chars)`);
    this.writeToStdin(agentId, activeProcess, nextMessage);
  }

  /**
   * Respawn the agent process with session resume, using the next queued
   * message as the new prompt. Used for backends that close stdin per-turn
   * (e.g. opencode): after the process exits at end-of-turn we create a new
   * process that resumes the same session, delivering the queued message.
   */
  private respawnWithQueuedMessage(agentId: string, exitedProcess: ActiveProcess): void {
    const queue = this.messageQueue.get(agentId);
    if (!queue || queue.length === 0) return;

    const lastRequest = exitedProcess.lastRequest;
    if (!lastRequest) {
      log.error(`❌ [RESPAWN] No lastRequest for ${agentId}, cannot respawn with queued message — queue preserved for next user send`);
      return;
    }

    const nextMessage = queue.shift()!;
    if (queue.length === 0) this.messageQueue.delete(agentId);

    const sessionId = exitedProcess.sessionId ?? lastRequest.sessionId;
    log.log(`🔁 [RESPAWN] Agent ${agentId}: Spawning new process to deliver queued message (session=${sessionId ?? 'none'}, prompt=${nextMessage.length} chars, ${queue.length} more queued)`);

    const newRequest: RunnerRequest = {
      ...lastRequest,
      prompt: nextMessage,
      sessionId,
      forceNewSession: false,
    };

    // Re-assert 'working' state so the brief window between the old process's
    // exit and the new process's first event doesn't show the agent as idle.
    agentService.updateAgent(agentId, {
      status: 'working',
      currentTask: nextMessage.substring(0, 100),
      isDetached: false,
    });

    void this.run(newRequest).catch((err) => {
      log.error(`❌ [RESPAWN] Failed to respawn ${agentId} with queued message: ${err}`);
      // Put the message back at the head of the queue so it isn't lost.
      const currentQueue = this.messageQueue.get(agentId) ?? [];
      currentQueue.unshift(nextMessage);
      this.messageQueue.set(agentId, currentQueue);
      this.callbacks.onError(agentId, `Failed to deliver queued message: ${err}`);
    });
  }

  /**
   * Reconnect to a live tmux session after a server restart.
   * Creates a minimal ActiveProcess and starts tailing the log file from the saved offset.
   */
  private reconnectToTmuxSession(agentId: string, logFile: string, offset: number, savedProcess?: RunningProcessInfo): void {
    const sessionName = tmuxSessionName(agentId);
    log.log(`🔄 [TMUX] Reconnecting to tmux session ${sessionName} for agent ${agentId}, log offset=${offset}`);

    // Create a dummy child process (we don't own the real one — tmux does)
    const dummyProcess = spawn('true', [], { stdio: 'ignore' });
    dummyProcess.unref();

    const activeProcess: ActiveProcess = {
      agentId,
      sessionId: savedProcess?.sessionId,
      startTime: savedProcess?.startTime ?? Date.now(),
      process: dummyProcess,
      lastRequest: savedProcess?.lastRequest as RunnerRequest | undefined,
      restartCount: 0,
      turnState: 'waiting_for_input',
      tmuxSession: sessionName,
      tmuxLogFile: logFile,
      isReconnected: true,
    };
    this.activeProcesses.set(agentId, activeProcess);

    // Resume tailing the log file from where we left off
    const tailer = this.stdoutPipeline.handleTmuxLog(agentId, logFile, offset);
    activeProcess.tmuxTailer = tailer;

    // Ensure the agent status reflects that we're connected
    const agent = agentService.getAgent(agentId);
    if (agent && agent.status === 'working') {
      // Keep it as working — it was mid-task when the server restarted
    } else if (agent) {
      // Set to idle — the tmux session is alive but waiting for input
      agentService.updateAgent(agentId, { status: 'idle' });
    }

    log.log(`✅ [TMUX] Reconnected to tmux session ${sessionName} for agent ${agentId}`);
  }

  interrupt(agentId: string): boolean {
    return this.lifecycle.interrupt(agentId);
  }

  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  async stop(agentId: string, clearQueue: boolean = true): Promise<void> {
    // Only clear queued messages on explicit user-initiated stops.
    // Respawns (watchdog, auto-restart) should preserve the queue so
    // messages sent while the agent was processing are not lost.
    if (clearQueue && this.messageQueue.has(agentId)) {
      const count = this.messageQueue.get(agentId)!.length;
      this.messageQueue.delete(agentId);
      if (count > 0) {
        log.log(`🗑️ [QUEUE] Agent ${agentId}: Discarded ${count} queued message(s) on stop`);
      }
    }
    await this.lifecycle.stop(agentId);
  }

  async stopAll(killProcesses: boolean = true, clearQueue: boolean = true): Promise<void> {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (clearQueue) {
      this.messageQueue.clear();
    }
    await this.lifecycle.stopAll(killProcesses);
  }

  isRunning(agentId: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      return false;
    }

    // tmux mode: check if the tmux session still exists
    if (activeProcess.tmuxSession) {
      const alive = hasTmuxSession(agentId);
      if (!alive) {
        // Stop tailer if running
        activeProcess.tmuxTailer?.stop();
        this.activeProcesses.delete(agentId);
        this.lastStderr.delete(agentId);
        return false;
      }
      return true;
    }

    const pid = activeProcess.process.pid;
    if (!pid) {
      this.activeProcesses.delete(agentId);
      return false;
    }

    const actuallyRunning = isProcessRunning(pid);
    if (!actuallyRunning) {
      this.activeProcesses.delete(agentId);
      this.lastStderr.delete(agentId);
      return false;
    }

    return true;
  }

  getSessionId(agentId: string): string | undefined {
    return this.activeProcesses.get(agentId)?.sessionId;
  }

  getTurnState(agentId: string): 'processing' | 'waiting_for_input' | undefined {
    return this.activeProcesses.get(agentId)?.turnState;
  }

  hasRecentActivity(agentId: string, withinMs: number): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      return false;
    }
    const lastActivity = activeProcess.lastActivityTime || activeProcess.startTime;
    return Date.now() - lastActivity < withinMs;
  }

  onNextActivity(agentId: string, callback: () => void): void {
    if (!this.activityCallbacks.has(agentId)) {
      this.activityCallbacks.set(agentId, []);
    }
    this.activityCallbacks.get(agentId)!.push(callback);
  }

  clearActivityCallbacks(agentId: string): void {
    this.activityCallbacks.delete(agentId);
  }

  getProcessMemoryMB(agentId: string): number | undefined {
    return this.resourceMonitor.getProcessMemoryMB(agentId);
  }

  getAllProcessMemory(): Map<string, number> {
    return this.resourceMonitor.getAllProcessMemory();
  }
}
