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
      } else {
        this.callbacks.onComplete(agentId, code === 0);
      }

      if (trackedProcess && code !== 0 && signal !== 'SIGINT' && signal !== 'SIGTERM') {
        this.restartPolicy.maybeAutoRestart(agentId, trackedProcess, code, signal);
      }
    });
  }

  supportsStdin(): boolean {
    return this.backend.requiresStdinInput();
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

    // tmux mode: send via tmux send-keys
    if (activeProcess.tmuxSession) {
      const stdinInput = this.backend.formatStdinInput(message);
      log.log(`📨 [SEND_MESSAGE] Agent ${agentId} (tmux mode), sending via tmux send-keys (${stdinInput.length} chars)`);
      const ok = sendToTmux(agentId, stdinInput);
      if (ok) {
        activeProcess.turnState = 'processing';
      }
      return ok;
    }

    const stdin = activeProcess.process.stdin;
    if (!stdin) {
      log.error(`❌ [SEND_MESSAGE] stdin is null for agent ${agentId}`);
      return false;
    }
    if (!stdin.writable) {
      log.error(`❌ [SEND_MESSAGE] stdin is not writable for agent ${agentId} (destroyed: ${stdin.destroyed}, closed: ${(stdin as any).closed})`);
      return false;
    }

    const turnState = activeProcess.turnState || 'processing';
    const messageLen = message.length;

    if (turnState === 'processing') {
      // Agent is mid-turn: write to stdin buffer, Claude Code will process after current turn
      // NOTE: SIGINT kills the process entirely, so we can't interrupt - just queue via stdin
      log.log(`⚡ [SEND_MESSAGE] Agent ${agentId} is mid-turn (turnState=${turnState}), writing to stdin buffer (${messageLen} chars) - will be processed after current turn`);
      return this.writeToStdin(agentId, activeProcess, message);
    }

    // Agent is waiting for input: send directly via stdin (immediate processing)
    log.log(`📨 [SEND_MESSAGE] Agent ${agentId} is idle (turnState=${turnState}), sending directly via stdin (${messageLen} chars)`);
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

  async stop(agentId: string): Promise<void> {
    await this.lifecycle.stop(agentId);
  }

  async stopAll(killProcesses: boolean = true): Promise<void> {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
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
