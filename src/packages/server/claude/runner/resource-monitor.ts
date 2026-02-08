import { execSync } from 'child_process';
import type { ActiveProcess } from '../types.js';

interface ResourceMonitorDeps {
  activeProcesses: Map<string, ActiveProcess>;
}

export class RunnerResourceMonitor {
  private activeProcesses: Map<string, ActiveProcess>;

  constructor(deps: ResourceMonitorDeps) {
    this.activeProcesses = deps.activeProcesses;
  }

  getProcessMemoryMB(agentId: string): number | undefined {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess || !activeProcess.process.pid) {
      return undefined;
    }

    const pid = activeProcess.process.pid;

    try {
      const status = execSync(`cat /proc/${pid}/status 2>/dev/null | grep VmRSS`, {
        encoding: 'utf8',
        timeout: 1000,
      });

      const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
      if (match) {
        const kB = parseInt(match[1], 10);
        return Math.round(kB / 1024);
      }
    } catch {
      try {
        const psOutput = execSync(`ps -o rss= -p ${pid}`, {
          encoding: 'utf8',
          timeout: 1000,
        });
        const kB = parseInt(psOutput.trim(), 10);
        if (!isNaN(kB)) {
          return Math.round(kB / 1024);
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  getAllProcessMemory(): Map<string, number> {
    const memoryMap = new Map<string, number>();

    for (const [agentId] of this.activeProcesses) {
      const memMB = this.getProcessMemoryMB(agentId);
      if (memMB !== undefined) {
        memoryMap.set(agentId, memMB);
      }
    }

    return memoryMap;
  }
}
