import type { ActiveProcess, RunnerCallbacks, RunnerRequest } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Runner');

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_COOLDOWN_MS = 60000;
const MIN_RUNTIME_FOR_RESTART_MS = 5000;

interface RestartPolicyDeps {
  callbacks: RunnerCallbacks;
  activeProcesses: Map<string, ActiveProcess>;
  getAutoRestartEnabled: () => boolean;
  run: (request: RunnerRequest) => Promise<void>;
}

export class RunnerRestartPolicy {
  private callbacks: RunnerCallbacks;
  private activeProcesses: Map<string, ActiveProcess>;
  private getAutoRestartEnabled: () => boolean;
  private run: (request: RunnerRequest) => Promise<void>;

  constructor(deps: RestartPolicyDeps) {
    this.callbacks = deps.callbacks;
    this.activeProcesses = deps.activeProcesses;
    this.getAutoRestartEnabled = deps.getAutoRestartEnabled;
    this.run = deps.run;
  }

  maybeAutoRestart(
    agentId: string,
    activeProcess: ActiveProcess,
    exitCode: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (!this.getAutoRestartEnabled()) {
      log.log(`🔄 [AUTO-RESTART] Disabled, not restarting ${agentId}`);
      return;
    }

    const lastRequest = activeProcess.lastRequest;
    if (!lastRequest) {
      log.log(`🔄 [AUTO-RESTART] No last request stored for ${agentId}, cannot restart`);
      return;
    }

    const runtime = Date.now() - activeProcess.startTime;
    if (runtime < MIN_RUNTIME_FOR_RESTART_MS) {
      log.error(`🔄 [AUTO-RESTART] Process ${agentId} died after only ${runtime}ms - NOT restarting (likely config error)`);
      this.callbacks.onError(agentId, `Process crashed immediately (${runtime}ms) - not auto-restarting. Check Claude Code installation.`);
      return;
    }

    if (exitCode === 0) {
      log.log(`🔄 [AUTO-RESTART] Process ${agentId} exited cleanly (code 0), not restarting`);
      return;
    }
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      log.log(`🔄 [AUTO-RESTART] Process ${agentId} was stopped intentionally (${signal}), not restarting`);
      return;
    }

    const restartCount = activeProcess.restartCount || 0;
    const lastRestartTime = activeProcess.lastRestartTime || 0;
    const timeSinceLastRestart = Date.now() - lastRestartTime;
    const effectiveRestartCount = timeSinceLastRestart > RESTART_COOLDOWN_MS ? 0 : restartCount;

    if (effectiveRestartCount >= MAX_RESTART_ATTEMPTS) {
      log.error(`🔄 [AUTO-RESTART] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached for ${agentId}`);
      this.callbacks.onError(agentId, `Process keeps crashing - auto-restart disabled after ${MAX_RESTART_ATTEMPTS} attempts. Manual intervention required.`);
      return;
    }

    log.log(`🔄 [AUTO-RESTART] Restarting ${agentId} (attempt ${effectiveRestartCount + 1}/${MAX_RESTART_ATTEMPTS})...`);

    setTimeout(async () => {
      try {
        const newRequest: RunnerRequest = { ...lastRequest };
        await this.run(newRequest);

        const newProcess = this.activeProcesses.get(agentId);
        if (newProcess) {
          newProcess.restartCount = effectiveRestartCount + 1;
          newProcess.lastRestartTime = Date.now();
        }

        log.log(`🔄 [AUTO-RESTART] Successfully restarted ${agentId}`);
        this.callbacks.onOutput(agentId, '[System] Process was automatically restarted after crash');
      } catch (err) {
        log.error(`🔄 [AUTO-RESTART] Failed to restart ${agentId}:`, err);
        this.callbacks.onError(agentId, `Auto-restart failed: ${err}`);
      }
    }, 1000);
  }
}
