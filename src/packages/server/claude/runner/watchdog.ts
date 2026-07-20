import type { ActiveProcess, ProcessDeathInfo } from '../types.js';
import { createLogger } from '../../utils/logger.js';
import { isProcessRunning } from '../../data/index.js';
import type { RunnerInternalEventBus } from './internal-events.js';
import { hasTmuxSession, isTmuxPaneCommandAlive, killTmuxSession } from './tmux-helper.js';
import * as agentService from '../../services/agent-service.js';
import { clearPendingBackgroundTasks } from '../../services/runtime-subagents.js';
import { getTmuxIdleTimeoutMs } from '../../services/system-prompt-service.js';

const log = createLogger('Runner');

const MAX_DEATH_HISTORY = 50;
// Process is alive but no events have been emitted for this long while mid-turn → assume
// the subprocess is wedged (e.g. hung HTTP request to the model API where TCP retransmits
// can hang for many minutes without an exit signal) and SIGKILL it so the normal
// process_closed → maybeAutoRestart path can respawn with session resume.
const IDLE_RESPAWN_MS = Number.parseInt(process.env.TIDE_IDLE_RESPAWN_MS ?? '', 10) || 180_000;
// A 'working' agent whose turn already ended (waiting_for_input) and whose stream has
// been silent this long is stuck — a background-task completion signal we missed
// (killed task, CLI wording change) or a stale status restored across a server
// restart. Reconcile to idle. Live background tasks emit task_progress lines that
// count as activity, and message sends flip turnState to 'processing', so neither
// can trip this.
const STUCK_WORKING_RECONCILE_MS = Number.parseInt(process.env.TIDE_STUCK_WORKING_RECONCILE_MS ?? '', 10) || 180_000;

interface WatchdogDeps {
  activeProcesses: Map<string, ActiveProcess>;
  lastStderr: Map<string, string>;
  bus: RunnerInternalEventBus;
}

export class RunnerWatchdog {
  private activeProcesses: Map<string, ActiveProcess>;
  private lastStderr: Map<string, string>;
  private bus: RunnerInternalEventBus;
  private recentDeaths: ProcessDeathInfo[] = [];

  constructor(deps: WatchdogDeps) {
    this.activeProcesses = deps.activeProcesses;
    this.lastStderr = deps.lastStderr;
    this.bus = deps.bus;
  }

  runWatchdog(): void {
    const activeCount = this.activeProcesses.size;
    if (activeCount > 0) {
      log.log(`🐕 [WATCHDOG] Checking ${activeCount} process(es)...`);
    }

    const idleTimeoutMs = getTmuxIdleTimeoutMs();
    const now = Date.now();

    for (const [agentId, activeProcess] of this.activeProcesses) {
      this.reconcileStuckWorking(agentId, activeProcess, now);

      // tmux mode: the launcher PID exits immediately — check the tmux session instead
      if (activeProcess.tmuxSession) {
        const sessionAlive = hasTmuxSession(agentId);
        // Zombie-session detection: the wrapping `(cat;cat) | claude` shell
        // pipeline keeps the tmux session alive even when the inner CLI dies
        // (e.g. claude exits on a stream-json parse error but cat is still
        // hung on the pane stdin). hasTmuxSession alone misses this — check
        // that the expected CLI binary is still in the pane's process tree.
        const expected = activeProcess.tmuxExpectedCommand;
        const cliAlive = !sessionAlive
          ? false
          : (expected ? isTmuxPaneCommandAlive(agentId, expected) : true);
        if (!sessionAlive || !cliAlive) {
          if (!sessionAlive) {
            log.error(`🐕 [WATCHDOG] Agent ${agentId}: tmux session ${activeProcess.tmuxSession} no longer exists!`);
          } else {
            log.error(`🐕 [WATCHDOG] Agent ${agentId}: tmux session ${activeProcess.tmuxSession} is alive but CLI '${expected}' is gone (zombie session)`);
          }
          // Drain any unread bytes from the log file BEFORE stopping the
          // tailer. The CLI's final step_complete event is often still
          // sitting in the file when the 5s watchdog beats the 100ms tailer
          // poll; without this drain those bytes are lost, turnState never
          // transitions to 'waiting_for_input', and the
          // watchdog_missing_process handler in runner.ts marks a clean
          // turn-end exit as a mid-turn death (status=error, spurious
          // auto-restart loop).
          try {
            activeProcess.tmuxTailer?.drain();
          } catch (err) {
            log.error(`🐕 [WATCHDOG] Agent ${agentId}: tailer drain failed: ${String(err)}`);
          }
          activeProcess.tmuxTailer?.stop();
          try {
            activeProcess.sideChannelStop?.();
          } catch {
            // ignore
          }
          this.recordDeath({
            agentId,
            pid: activeProcess.process.pid ?? 0,
            exitCode: null,
            signal: null,
            runtime: Date.now() - activeProcess.startTime,
            wasTracked: true,
            timestamp: Date.now(),
            stderr: this.lastStderr.get(agentId),
          });
          this.activeProcesses.delete(agentId);
          this.lastStderr.delete(agentId);
          this.bus.emit({
            type: 'runner.watchdog_missing_process',
            agentId,
            pid: activeProcess.process.pid ?? 0,
            activeProcess,
          });
          continue;
        }

        // Stuck mid-turn: the tmux CLI is still ALIVE (session + binary present)
        // but has produced NO events for too long. Grok deadlocks resuming a
        // session that was hard-killed mid-turn (Send now / stop) — it hangs
        // right after auth with a 0-byte stdout and never recovers, so the agent
        // shows 'working' forever and the message "never arrives". The pipe-mode
        // stuck-reconciler below never runs for tmux (we `continue`), and
        // reconcileStuckWorking only covers turns that already ended
        // (waiting_for_input), so this is the only place that catches a hung
        // mid-turn tmux CLI. Kill the session; next tick's session-gone path
        // records the death and routes respawn through restartPolicy — which is
        // capped (MAX_RESTART_ATTEMPTS) so a deterministically-hanging resume
        // ends in a clear error instead of an infinite loop. Uses `?? startTime`
        // so a fresh spawn that never emitted a single event is still covered
        // (lastActivityTime is only set once events flow).
        if (activeProcess.turnState === 'processing') {
          const silentFor = now - (activeProcess.lastActivityTime ?? activeProcess.startTime);
          if (silentFor > IDLE_RESPAWN_MS) {
            const silentSec = Math.round(silentFor / 1000);
            log.error(
              `🐕 [WATCHDOG] Agent ${agentId}: tmux CLI '${expected}' alive but stuck mid-turn `
              + `(no events for ${silentSec}s, threshold=${IDLE_RESPAWN_MS / 1000}s) `
              + `— killing tmux session ${activeProcess.tmuxSession} to recover`
            );
            this.lastStderr.set(
              agentId,
              `[idle-watchdog] tmux CLI produced no output for ${silentSec}s while processing — killed to recover`
            );
            activeProcess.tmuxTailer?.stop();
            killTmuxSession(agentId);
            continue;
          }
        }

        // Idle-timeout cleanup: if the owning agent is idle (not actively
        // working) and there's been no activity (output, send, spawn) for
        // longer than the configured threshold, kill the tmux session to
        // free resources. The natural watchdog_missing_process path on the
        // next tick will then route the cleanup through restartPolicy,
        // which skips restart for turnState='waiting_for_input'.
        const lastActivity = activeProcess.lastActivityTime ?? activeProcess.startTime;
        const idleFor = now - lastActivity;
        if (idleFor >= idleTimeoutMs) {
          const agent = agentService.getAgent(agentId);
          const status = agent?.status;
          if (status && status !== 'working') {
            log.log(`🐕 [WATCHDOG] Agent ${agentId}: idle for ${(idleFor / 1000).toFixed(0)}s (status=${status}, threshold=${(idleTimeoutMs / 1000).toFixed(0)}s) — killing tmux session ${activeProcess.tmuxSession}`);
            activeProcess.tmuxTailer?.stop();
            killTmuxSession(agentId);
          }
        }
        continue;
      }

      const pid = activeProcess.process.pid;
      if (!pid) continue;

      if (!isProcessRunning(pid)) {
        log.error(`🐕 [WATCHDOG] Agent ${agentId}: Process ${pid} is dead but was still being tracked!`);
        this.recordDeath({
          agentId,
          pid,
          exitCode: null,
          signal: null,
          runtime: Date.now() - activeProcess.startTime,
          wasTracked: true,
          timestamp: Date.now(),
          stderr: this.lastStderr.get(agentId),
        });

        try {
          activeProcess.sideChannelStop?.();
        } catch {
          // ignore
        }
        this.activeProcesses.delete(agentId);
        this.lastStderr.delete(agentId);

        const remaining = this.activeProcesses.size;
        if (remaining > 0) {
          log.log(`🐕 [WATCHDOG] After cleanup: ${remaining} process(es) still active`);
        }

        this.bus.emit({
          type: 'runner.watchdog_missing_process',
          agentId,
          pid,
          activeProcess,
        });
      } else if (
        activeProcess.turnState === 'processing'
        && activeProcess.lastActivityTime
        && Date.now() - activeProcess.lastActivityTime > IDLE_RESPAWN_MS
      ) {
        const idleSec = Math.round((Date.now() - activeProcess.lastActivityTime) / 1000);
        log.error(
          `🐕 [WATCHDOG] Agent ${agentId}: stuck mid-turn `
          + `(no events for ${idleSec}s, threshold=${IDLE_RESPAWN_MS / 1000}s) `
          + `— SIGKILL pid ${pid} to trigger respawn`
        );
        this.lastStderr.set(
          agentId,
          `[idle-watchdog] no model output for ${idleSec}s while processing — killed and respawning`
        );
        try {
          process.kill(pid, 'SIGKILL');
        } catch (err) {
          log.error(`🐕 [WATCHDOG] Agent ${agentId}: SIGKILL on pid ${pid} failed:`, err);
        }
      }
    }
  }

  // Safety net for stuck 'working' status: the turn ended, no events are flowing,
  // yet the agent still shows working. Flip it to idle and drop any pending
  // background-task tracking so the tmux idle-timeout can later reclaim the session.
  private reconcileStuckWorking(agentId: string, activeProcess: ActiveProcess, now: number): void {
    if (activeProcess.turnState !== 'waiting_for_input') {
      return;
    }
    const lastActivity = activeProcess.lastActivityTime ?? activeProcess.startTime;
    if (now - lastActivity < STUCK_WORKING_RECONCILE_MS) {
      return;
    }
    const agent = agentService.getAgent(agentId);
    if (agent?.status !== 'working') {
      return;
    }
    const silentSec = Math.round((now - lastActivity) / 1000);
    log.error(
      `🐕 [WATCHDOG] Agent ${agentId}: status 'working' but turn ended and stream silent for ${silentSec}s `
      + `(threshold=${STUCK_WORKING_RECONCILE_MS / 1000}s) — reconciling to idle and clearing pending background tasks`
    );
    clearPendingBackgroundTasks(agentId);
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
    });
  }

  recordDeath(info: ProcessDeathInfo): void {
    this.recentDeaths.unshift(info);
    if (this.recentDeaths.length > MAX_DEATH_HISTORY) {
      this.recentDeaths.pop();
    }

    const runtimeSec = (info.runtime / 1000).toFixed(1);
    log.error(`💀 [DEATH RECORD] Agent ${info.agentId}:`);
    log.error(`   PID: ${info.pid}`);
    log.error(`   Exit code: ${info.exitCode}`);
    log.error(`   Signal: ${info.signal}`);
    log.error(`   Runtime: ${runtimeSec}s`);
    log.error(`   Was tracked: ${info.wasTracked}`);
    if (info.stderr) {
      log.error(`   Last stderr: ${info.stderr.substring(0, 500)}`);
    }

    this.analyzeDeathPatterns();
  }

  getDeathHistory(): ProcessDeathInfo[] {
    return [...this.recentDeaths];
  }

  private analyzeDeathPatterns(): void {
    const recentWindow = 60000;
    const now = Date.now();
    const recentDeaths = this.recentDeaths.filter((d) => now - d.timestamp < recentWindow);

    if (recentDeaths.length < 3) {
      return;
    }

    log.error(`⚠️ [PATTERN] ${recentDeaths.length} processes died in the last minute!`);
    log.error('   Deaths summary:');
    for (const death of recentDeaths) {
      const age = Math.round((now - death.timestamp) / 1000);
      log.error(`   - Agent ${death.agentId}: exit=${death.exitCode} signal=${death.signal} runtime=${(death.runtime / 1000).toFixed(1)}s ago=${age}s${death.wasTracked ? '' : ' [UNTRACKED]'}`);
    }

    const signals = recentDeaths.map((d) => d.signal).filter((s): s is NodeJS.Signals => !!s);
    if (signals.length > 0 && signals.every((s) => s === signals[0])) {
      log.error(`⚠️ [PATTERN] All deaths have signal: ${signals[0]} - possible external kill or resource exhaustion`);
    }

    const codes = recentDeaths.map((d) => d.exitCode).filter((c): c is number => c !== null);
    if (codes.length > 0 && codes.every((c) => c === codes[0])) {
      log.error(`⚠️ [PATTERN] All deaths have exit code: ${codes[0]}`);
      if (codes[0] === 137) {
        log.error('⚠️ [PATTERN] Exit code 137 = Out of Memory killed! System memory exhausted.');
        log.error('   Actions: Reduce number of concurrent agents or increase system RAM');
      } else if (codes[0] === 1) {
        log.error('⚠️ [PATTERN] Exit code 1 = general error. Check Claude Code installation.');
      } else if (codes[0] === 139) {
        log.error('⚠️ [PATTERN] Exit code 139 = Segmentation fault (SIGSEGV). Possible memory corruption.');
      }
    }

    const shortLived = recentDeaths.filter((d) => d.runtime < 5000);
    if (shortLived.length >= 2) {
      log.error(`⚠️ [PATTERN] ${shortLived.length} processes died within 5s of starting:`);
      for (const death of shortLived) {
        log.error(`   - ${death.agentId}: ${death.runtime}ms - likely config/startup error`);
      }
    }

    const trackedCount = recentDeaths.filter((d) => d.wasTracked).length;
    if (trackedCount === recentDeaths.length) {
      log.error('✅ [PATTERN] All deaths were properly tracked and logged');
    }
  }
}

