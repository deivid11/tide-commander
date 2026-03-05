import type { ActiveProcess, CLIBackend, RunnerRequest } from '../types.js';
import {
  saveRunningProcesses,
  loadRunningProcesses,
  isProcessRunning,
  clearRunningProcesses,
  type RunningProcessInfo,
} from '../../data/index.js';
import * as agentService from '../../services/agent-service.js';
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
        const agent = agentService.getAgent(agentId);
        processes.push({
          agentId,
          pid: activeProcess.process.pid,
          sessionId: activeProcess.sessionId,
          startTime: activeProcess.startTime,
          outputFile: activeProcess.outputFile,
          stderrFile: activeProcess.stderrFile,
          lastRequest: activeProcess.lastRequest,
          agentStatus: agent?.status,
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
        // Only resume agents that were actively working when persisted.
        // Idle agents with live processes (e.g. Codex waiting for stdin) should not be resumed.
        if (savedProcess.agentStatus && savedProcess.agentStatus !== 'working') {
          log.log(`🔄 [RESUME] Skipping resume for agent ${savedProcess.agentId} - was ${savedProcess.agentStatus} (not working)`);
          continue;
        }
        toResume.push(savedProcess);
      }
    }

    clearRunningProcesses();

    if (toResume.length === 0) {
      return;
    }

    setTimeout(() => {
      for (const saved of toResume) {
        // Verify the agent still exists (it may have been deleted)
        const agent = agentService.getAgent(saved.agentId);
        if (!agent) {
          log.log(`🔄 [RESUME] Skipping resume for agent ${saved.agentId} - agent no longer exists`);
          continue;
        }

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
