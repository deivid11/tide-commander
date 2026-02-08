import { spawn, type ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type { ActiveProcess, CLIBackend, RunnerCallbacks, RunnerRequest } from '../types.js';
import type { RunnerStdoutPipeline } from './stdout-pipeline.js';
import type { RunnerInternalEventBus } from './internal-events.js';
import type { RunnerRecoveryStore } from './recovery-store.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Runner');

interface ProcessLifecycleDeps {
  backend: CLIBackend;
  callbacks: RunnerCallbacks;
  activeProcesses: Map<string, ActiveProcess>;
  lastStderr: Map<string, string>;
  activityCallbacks: Map<string, Array<() => void>>;
  bus: RunnerInternalEventBus;
  stdoutPipeline: RunnerStdoutPipeline;
  recoveryStore: RunnerRecoveryStore;
  onDisableAutoRestart: () => void;
}

export class RunnerProcessLifecycle {
  private backend: CLIBackend;
  private callbacks: RunnerCallbacks;
  private activeProcesses: Map<string, ActiveProcess>;
  private lastStderr: Map<string, string>;
  private activityCallbacks: Map<string, Array<() => void>>;
  private bus: RunnerInternalEventBus;
  private stdoutPipeline: RunnerStdoutPipeline;
  private recoveryStore: RunnerRecoveryStore;
  private onDisableAutoRestart: () => void;

  constructor(deps: ProcessLifecycleDeps) {
    this.backend = deps.backend;
    this.callbacks = deps.callbacks;
    this.activeProcesses = deps.activeProcesses;
    this.lastStderr = deps.lastStderr;
    this.activityCallbacks = deps.activityCallbacks;
    this.bus = deps.bus;
    this.stdoutPipeline = deps.stdoutPipeline;
    this.recoveryStore = deps.recoveryStore;
    this.onDisableAutoRestart = deps.onDisableAutoRestart;
  }

  async run(request: RunnerRequest): Promise<void> {
    const {
      agentId,
      prompt,
      workingDir,
      sessionId,
      model,
      useChrome,
      permissionMode = 'bypass',
      systemPrompt,
      forceNewSession,
      customAgent,
    } = request;

    await this.stop(agentId);

    const backendConfig = {
      agentId,
      sessionId: forceNewSession ? undefined : sessionId,
      model,
      workingDir,
      permissionMode,
      useChrome,
      prompt,
      systemPrompt,
      customAgent,
      codexConfig: request.codexConfig,
    };

    const args = this.backend.buildArgs(backendConfig);
    const executable = this.backend.getExecutablePath();
    log.log(`🚀 Spawning: ${executable} ${args.join(' ')}`);

    const isWindows = process.platform === 'win32';
    const childProcess = spawn(executable, args, {
      cwd: workingDir,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        TIDE_SERVER: `http://localhost:${process.env.TIDE_PORT || process.env.PORT || 5174}`,
      },
      shell: isWindows ? true : false,
      detached: isWindows ? false : true,
    });

    if (!isWindows) {
      childProcess.unref();
    }

    const activeProcess: ActiveProcess = {
      agentId,
      sessionId,
      startTime: Date.now(),
      process: childProcess,
      lastRequest: request,
      restartCount: 0,
    };
    this.activeProcesses.set(agentId, activeProcess);

    const stdoutDone = this.stdoutPipeline.handleStdout(agentId, childProcess);
    this.handleStderr(agentId, childProcess);

    childProcess.on('close', async (code, signal) => {
      await stdoutDone;
      this.bus.emit({
        type: 'runner.process_closed',
        agentId,
        pid: childProcess.pid,
        code,
        signal,
      });
    });

    childProcess.on('error', (err) => {
      this.bus.emit({
        type: 'runner.process_spawn_error',
        agentId,
        error: err,
      });
    });

    childProcess.on('spawn', () => {
      this.bus.emit({
        type: 'runner.process_spawned',
        agentId,
        pid: childProcess.pid,
      });
    });

    if (this.backend.requiresStdinInput() && childProcess.stdin) {
      const stdinInput = this.backend.formatStdinInput(prompt);
      log.log(`📤 [STDIN] Sending initial prompt (${prompt.length} chars) to agent ${agentId}`);
      childProcess.stdin.write(stdinInput + '\n', 'utf8', (err) => {
        if (err) {
          log.error(`❌ [STDIN] Failed to write initial prompt to stdin for ${agentId}: ${err.message}`);
          activeProcess.lastError = {
            type: 'initial_stdin_write_error',
            message: err.message,
            timestamp: Date.now(),
          };
        } else {
          log.log(`✅ [STDIN] Initial prompt sent successfully to ${agentId}`);
        }
      });
    } else {
      log.log(`⏭️ [STDIN] Skipping stdin input for ${agentId} (requiresStdinInput=${this.backend.requiresStdinInput()}, stdin=${!!childProcess.stdin})`);
    }
  }

  interrupt(agentId: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      return false;
    }

    const pid = activeProcess.process.pid;
    if (!pid) {
      return false;
    }

    try {
      activeProcess.process.kill('SIGINT');
      return true;
    } catch (e) {
      log.error(`Failed to interrupt ${agentId}:`, e);
      return false;
    }
  }

  async stop(agentId: string): Promise<void> {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      return;
    }

    const pid = activeProcess.process.pid;
    log.log(`🛑 Stopping agent ${agentId} (pid ${pid})`);

    this.activeProcesses.delete(agentId);
    this.activityCallbacks.delete(agentId);

    if (pid) {
      try {
        process.kill(-pid, 'SIGINT');
      } catch {
        // ignore
      }
    }

    try {
      activeProcess.process.kill('SIGINT');
    } catch {
      // ignore
    }

    this.callbacks.onComplete(agentId, false);

    setTimeout(() => {
      try {
        if (pid && !activeProcess.process.killed) {
          process.kill(-pid, 'SIGTERM');
          activeProcess.process.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    }, 500);

    setTimeout(() => {
      try {
        if (pid && !activeProcess.process.killed) {
          process.kill(-pid, 'SIGKILL');
          activeProcess.process.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
    }, 1500);
  }

  async stopAll(killProcesses: boolean = true): Promise<void> {
    this.onDisableAutoRestart();

    if (killProcesses) {
      for (const [agentId] of this.activeProcesses) {
        await this.stop(agentId);
      }
      this.recoveryStore.clearPersistedProcesses();
    } else {
      this.recoveryStore.persistRunningProcesses();
      this.activeProcesses.clear();
      this.activityCallbacks.clear();
    }

    this.lastStderr.clear();
  }

  private handleStderr(agentId: string, process: ChildProcess): void {
    const decoder = new StringDecoder('utf8');
    let stderrBuffer = '';

    process.stderr?.on('data', (data: Buffer) => {
      const text = decoder.write(data);
      log.error(` stderr for ${agentId}:`, text);

      stderrBuffer += text;
      if (stderrBuffer.length > 2048) {
        stderrBuffer = stderrBuffer.slice(-2048);
      }
      this.lastStderr.set(agentId, stderrBuffer);
    });
  }
}
