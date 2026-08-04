import * as fs from 'fs';
import type { ActiveProcess, RunnerCallbacks, RunnerRequest } from '../types.js';
import { createLogger } from '../../utils/logger.js';
import * as agentService from '../../services/agent-service.js';

const log = createLogger('Runner');

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_COOLDOWN_MS = 60000;
const MIN_RUNTIME_FOR_RESTART_MS = 5000;

/**
 * Did the CLI itself actually write anything to stdout during this spawn?
 *
 * `lastActivityTime` is NOT usable for this. Side channels update it without
 * the CLI producing a byte — the grok session watcher emits a usage_snapshot
 * the moment it attaches, reading signals.json left over from the PREVIOUS
 * turn. That happens ~300ms after spawn, so a stone-dead hung resume looked
 * "active", the restart counter reset to zero every cycle, and the capped
 * restart loop ran forever.
 *
 * The stdout log is truncated on every spawn (tmux-helper writes '' before
 * launching), so a non-empty file means THIS process emitted something.
 */
function producedStdout(activeProcess: ActiveProcess): boolean {
  const file = activeProcess.tmuxLogFile ?? activeProcess.outputFile;
  if (!file) {
    // Pipe mode without a log file: fall back to activity time.
    return activeProcess.lastActivityTime != null
      && activeProcess.lastActivityTime > activeProcess.startTime;
  }
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

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

    // Normal-exit conditions must be checked BEFORE the "runtime < 5s" crash
    // heuristic, because single-shot backends like Codex routinely finish a
    // turn in under 5 seconds — classifying that as a crash wedges the agent.
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      log.log(`🔄 [AUTO-RESTART] Process ${agentId} was stopped intentionally (${signal}), not restarting`);
      return;
    }

    if (activeProcess.turnState === 'waiting_for_input') {
      log.log(`🔄 [AUTO-RESTART] Process ${agentId} exited after completing its turn (turnState=waiting_for_input), not restarting`);
      this.callbacks.onComplete(agentId, true);
      return;
    }

    if (exitCode === 0) {
      log.log(`🔄 [AUTO-RESTART] Process ${agentId} exited cleanly (code 0), not restarting`);
      return;
    }

    const runtime = Date.now() - activeProcess.startTime;
    if (runtime < MIN_RUNTIME_FOR_RESTART_MS) {
      log.error(`🔄 [AUTO-RESTART] Process ${agentId} died after only ${runtime}ms - NOT restarting (likely config error)`);
      this.callbacks.onError(agentId, `Process crashed immediately (${runtime}ms) - not auto-restarting. Check Claude Code installation.`);
      return;
    }

    const restartCount = activeProcess.restartCount || 0;
    const lastRestartTime = activeProcess.lastRestartTime || 0;
    const timeSinceLastRestart = Date.now() - lastRestartTime;
    // Elapsed time alone is NOT proof that a restart was healthy — the CLI must
    // actually have written to stdout. The idle watchdog only kills a wedged CLI
    // after IDLE_RESPAWN_MS (180s), which always exceeds RESTART_COOLDOWN_MS
    // (60s), so a purely time-based reset put every hang→kill→restart cycle back
    // at "attempt 1/3" and the supposedly capped loop ran forever. That is
    // exactly the case the cap exists to stop: grok deadlocks replaying a
    // session that was killed mid-turn, hanging before it opens a single socket
    // and emitting zero bytes, forever.
    const producedOutput = producedStdout(activeProcess);
    const effectiveRestartCount = producedOutput && timeSinceLastRestart > RESTART_COOLDOWN_MS
      ? 0
      : restartCount;

    if (effectiveRestartCount >= MAX_RESTART_ATTEMPTS) {
      log.error(`🔄 [AUTO-RESTART] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached for ${agentId}`);

      if (!producedOutput && activeProcess.sessionId) {
        // Every attempt replayed the same session and the CLI never wrote a
        // byte — the session itself is unresumable (grok deadlocks loading a
        // session that was killed mid-turn, before it even opens a socket).
        // Retrying it again can only fail the same way, and leaving the id in
        // place strands the agent: every later message resumes the same corpse,
        // so the user "can't send messages" until someone manually clears the
        // context. Drop the id here so the next message starts a fresh session.
        // Deliberately narrow: only when stdout was completely empty.
        log.error(`🔄 [AUTO-RESTART] Session ${activeProcess.sessionId} is unresumable for ${agentId} — clearing it so the next message starts fresh`);
        if (activeProcess.lastRequest) activeProcess.lastRequest.sessionId = undefined;
        activeProcess.sessionId = undefined;
        try {
          agentService.updateAgent(agentId, { sessionId: undefined });
        } catch (err) {
          log.error(`🔄 [AUTO-RESTART] Failed to clear session for ${agentId}:`, err);
        }
      }

      this.callbacks.onError(
        agentId,
        producedOutput
          ? `Process keeps crashing - auto-restart disabled after ${MAX_RESTART_ATTEMPTS} attempts. Manual intervention required.`
          : `Session was unresumable - ${MAX_RESTART_ATTEMPTS} restarts produced no output at all. `
            + `It has been cleared; your next message will start a fresh session (previous conversation is not recoverable).`
      );
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
