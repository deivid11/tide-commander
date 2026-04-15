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
import { hasTmuxSession, isTmuxEnabled, tmuxLogPath } from './tmux-helper.js';

const log = createLogger('Runner');

interface RecoveryStoreDeps {
  backend: CLIBackend;
  activeProcesses: Map<string, ActiveProcess>;
  run: (request: RunnerRequest) => Promise<void>;
  reconnectTmux?: (agentId: string, logFile: string, offset: number, savedProcess?: RunningProcessInfo) => void;
}

export class RunnerRecoveryStore {
  private backend: CLIBackend;
  private activeProcesses: Map<string, ActiveProcess>;
  private run: (request: RunnerRequest) => Promise<void>;
  private reconnectTmux?: (agentId: string, logFile: string, offset: number, savedProcess?: RunningProcessInfo) => void;

  constructor(deps: RecoveryStoreDeps) {
    this.backend = deps.backend;
    this.activeProcesses = deps.activeProcesses;
    this.run = deps.run;
    this.reconnectTmux = deps.reconnectTmux;
  }

  persistRunningProcesses(): void {
    const myProcesses: RunningProcessInfo[] = [];

    for (const [agentId, activeProcess] of this.activeProcesses) {
      const hasPid = !!activeProcess.process.pid;
      const hasTmux = !!activeProcess.tmuxSession;

      if (hasPid || hasTmux) {
        const agent = agentService.getAgent(agentId);
        myProcesses.push({
          agentId,
          pid: activeProcess.process.pid ?? 0,
          sessionId: activeProcess.sessionId,
          startTime: activeProcess.startTime,
          outputFile: activeProcess.outputFile,
          stderrFile: activeProcess.stderrFile,
          lastRequest: activeProcess.lastRequest,
          agentStatus: agent?.status,
          tmuxSession: activeProcess.tmuxSession,
          tmuxLogOffset: activeProcess.tmuxTailer?.getOffset(),
          provider: this.backend.name,
        });
      }
    }

    // Multiple runners (claude, codex, opencode) share the same persist file.
    // Merge: keep entries from OTHER providers, replace entries from OUR provider.
    const existing = loadRunningProcesses();
    const otherProviders = existing.filter((p) => p.provider && p.provider !== this.backend.name);
    const merged = [...otherProviders, ...myProcesses];

    if (merged.length > 0) {
      saveRunningProcesses(merged);
    }
    // NOTE: Do NOT call clearRunningProcesses() when the merged list is empty.
    // The file is cleaned up by recoverOrphanedProcesses() on startup instead.
  }

  clearPersistedProcesses(): void {
    clearRunningProcesses();
  }

  recoverOrphanedProcesses(): void {
    const savedProcesses = loadRunningProcesses();
    if (savedProcesses.length === 0) {
      return;
    }

    log.log(`🔍 [${this.backend.name}] Checking ${savedProcesses.length} processes from previous commander instance...`);

    const toResume: RunningProcessInfo[] = [];
    const toReconnectTmux: RunningProcessInfo[] = [];

    for (const savedProcess of savedProcesses) {
      // Only recover processes that belong to this runner's provider.
      // Each provider (claude, codex, opencode) has its own runner and event parser.
      // If provider is missing (old persist format / stale .bak), look up the agent's actual provider.
      const effectiveProvider = savedProcess.provider ?? agentService.getAgent(savedProcess.agentId)?.provider ?? 'claude';
      if (effectiveProvider !== this.backend.name) {
        continue;
      }

      // Skip agents already tracked (another runner may have recovered them)
      if (this.activeProcesses.has(savedProcess.agentId)) {
        continue;
      }

      // tmux mode: check if the tmux session is still alive
      if (savedProcess.tmuxSession && isTmuxEnabled()) {
        if (hasTmuxSession(savedProcess.agentId)) {
          log.log(`✅ [TMUX] Found live tmux session for agent ${savedProcess.agentId} (${savedProcess.tmuxSession}) - will reconnect`);
          toReconnectTmux.push(savedProcess);
        } else {
          log.log(`❌ [TMUX] tmux session ${savedProcess.tmuxSession} for agent ${savedProcess.agentId} no longer exists`);
        }
        continue;
      }

      if (isProcessRunning(savedProcess.pid)) {
        log.log(`✅ Found orphaned process for agent ${savedProcess.agentId} (PID ${savedProcess.pid}) - still running`);
        continue;
      }

      log.log(`❌ Process for agent ${savedProcess.agentId} (PID ${savedProcess.pid}) is no longer running`);
      const canResume = this.backend.supportsSessionResume?.() ?? !this.backend.requiresStdinInput();
      if (canResume && savedProcess.sessionId && savedProcess.lastRequest) {
        // Only resume agents that were actively working when persisted.
        // Idle agents with live processes (e.g. Codex waiting for stdin) should not be resumed.
        if (savedProcess.agentStatus && savedProcess.agentStatus !== 'working') {
          log.log(`🔄 [RESUME] Skipping resume for agent ${savedProcess.agentId} - was ${savedProcess.agentStatus} (not working)`);
          continue;
        }
        toResume.push(savedProcess);
      }
    }

    // Only clear THIS provider's entries from the persist file, not the whole file.
    // Other runners haven't recovered yet and still need their entries.
    const remaining = savedProcesses.filter((p) => {
      const prov = p.provider ?? agentService.getAgent(p.agentId)?.provider ?? 'claude';
      return prov !== this.backend.name;
    });
    if (remaining.length > 0) {
      saveRunningProcesses(remaining);
    } else {
      clearRunningProcesses();
    }

    // Reconnect to live tmux sessions (just resume log tailing)
    if (toReconnectTmux.length > 0 && this.reconnectTmux) {
      setTimeout(() => {
        for (const saved of toReconnectTmux) {
          const agent = agentService.getAgent(saved.agentId);
          if (!agent) {
            log.log(`🔄 [TMUX] Skipping reconnect for agent ${saved.agentId} - agent no longer exists`);
            continue;
          }

          const logFile = tmuxLogPath(saved.agentId);
          const offset = saved.tmuxLogOffset ?? 0;
          log.log(`🔄 [TMUX] Reconnecting to tmux session for agent ${saved.agentId} at offset ${offset}`);
          this.reconnectTmux!(saved.agentId, logFile, offset, saved);
        }
      }, 1000);
    }

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
