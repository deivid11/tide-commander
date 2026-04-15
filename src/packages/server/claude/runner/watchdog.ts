import type { ActiveProcess, ProcessDeathInfo } from '../types.js';
import { createLogger } from '../../utils/logger.js';
import { isProcessRunning } from '../../data/index.js';
import type { RunnerInternalEventBus } from './internal-events.js';
import { hasTmuxSession } from './tmux-helper.js';

const log = createLogger('Runner');

const MAX_DEATH_HISTORY = 50;

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

    for (const [agentId, activeProcess] of this.activeProcesses) {
      // tmux mode: the launcher PID exits immediately — check the tmux session instead
      if (activeProcess.tmuxSession) {
        if (!hasTmuxSession(agentId)) {
          log.error(`🐕 [WATCHDOG] Agent ${agentId}: tmux session ${activeProcess.tmuxSession} no longer exists!`);
          activeProcess.tmuxTailer?.stop();
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
      }
    }
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

