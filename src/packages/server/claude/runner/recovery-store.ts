import type { ActiveProcess, CLIBackend, RunnerRequest } from '../types.js';
import {
  saveRunningProcesses,
  loadRunningProcesses,
  isProcessRunning,
  clearRunningProcesses,
  type RunningProcessInfo,
} from '../../data/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Runner');

interface RecoveryStoreDeps {
  backend: CLIBackend;
  activeProcesses: Map<string, ActiveProcess>;
  run: (request: RunnerRequest) => Promise<void>;
}

export class RunnerRecoveryStore {
  private backend: CLIBackend;
  private activeProcesses: Map<string, ActiveProcess>;
  private run: (request: RunnerRequest) => Promise<void>;

  constructor(deps: RecoveryStoreDeps) {
    this.backend = deps.backend;
    this.activeProcesses = deps.activeProcesses;
    this.run = deps.run;
  }

  persistRunningProcesses(): void {
    const processes: RunningProcessInfo[] = [];

    for (const [agentId, activeProcess] of this.activeProcesses) {
      if (activeProcess.process.pid) {
        processes.push({
          agentId,
          pid: activeProcess.process.pid,
          sessionId: activeProcess.sessionId,
          startTime: activeProcess.startTime,
          outputFile: activeProcess.outputFile,
          stderrFile: activeProcess.stderrFile,
          lastRequest: activeProcess.lastRequest,
        });
      }
    }

    if (processes.length > 0) {
      saveRunningProcesses(processes);
      return;
    }
    clearRunningProcesses();
  }

  clearPersistedProcesses(): void {
    clearRunningProcesses();
  }

  recoverOrphanedProcesses(): void {
    const savedProcesses = loadRunningProcesses();
    if (savedProcesses.length === 0) {
      return;
    }

    log.log(`🔍 Checking ${savedProcesses.length} processes from previous commander instance...`);

    const toResume: RunningProcessInfo[] = [];
    for (const savedProcess of savedProcesses) {
      if (isProcessRunning(savedProcess.pid)) {
        log.log(`✅ Found orphaned process for agent ${savedProcess.agentId} (PID ${savedProcess.pid}) - still running`);
        continue;
      }

      log.log(`❌ Process for agent ${savedProcess.agentId} (PID ${savedProcess.pid}) is no longer running`);
      if (!this.backend.requiresStdinInput() && savedProcess.sessionId && savedProcess.lastRequest) {
        toResume.push(savedProcess);
      }
    }

    clearRunningProcesses();

    if (toResume.length === 0) {
      return;
    }

    setTimeout(() => {
      for (const saved of toResume) {
        const lastRequest = saved.lastRequest as RunnerRequest;
        log.log(`🔄 [RESUME] Resuming codex session for agent ${saved.agentId} (session ${saved.sessionId})`);
        this.run({
          ...lastRequest,
          sessionId: saved.sessionId,
          prompt: 'continue',
        }).catch((err) => {
          log.error(`🔄 [RESUME] Failed to resume agent ${saved.agentId}:`, err);
        });
      }
    }, 2000);
  }
}
