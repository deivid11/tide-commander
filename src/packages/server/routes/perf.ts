/**
 * Performance Metrics Route
 * Returns server-side performance data for the performance monitor overlay
 */

import { Router } from 'express';
import * as agentService from '../services/agent-service.js';
import * as runtimeService from '../services/runtime-service.js';
import { execSync } from 'child_process';
import os from 'os';

const router = Router();

// Server start time for uptime calculation
const serverStartTime = Date.now();

// WebSocket message counters (set by handler)
let wsMessagesSent = 0;
let wsMessagesReceived = 0;
let wsClientsCount = 0;

export function incrementWsSent(): void {
  wsMessagesSent++;
}

export function incrementWsReceived(): void {
  wsMessagesReceived++;
}

export function setWsClientsCount(count: number): void {
  wsClientsCount = count;
}

// Track request latencies
interface RequestTiming {
  path: string;
  method: string;
  duration: number;
  timestamp: number;
}

const recentRequests: RequestTiming[] = [];
const MAX_RECENT_REQUESTS = 100;

export function recordRequestTiming(method: string, path: string, duration: number): void {
  recentRequests.push({ method, path, duration, timestamp: Date.now() });
  if (recentRequests.length > MAX_RECENT_REQUESTS) {
    recentRequests.shift();
  }
}

function getProcessMemoryMB(pid: number): number | undefined {
  try {
    const status = execSync(`cat /proc/${pid}/status 2>/dev/null | grep VmRSS`, {
      encoding: 'utf8',
      timeout: 500,
    });
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
    if (match) {
      return Math.round(parseInt(match[1], 10) / 1024);
    }
  } catch {
    try {
      const psOutput = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8', timeout: 500 });
      const kB = parseInt(psOutput.trim(), 10);
      if (!isNaN(kB)) return Math.round(kB / 1024);
    } catch {
      // Process may not exist
    }
  }
  return undefined;
}

router.get('/', async (_req, res) => {
  try {
    // Process memory
    const mem = process.memoryUsage();

    // CPU usage
    const cpuUsage = process.cpuUsage();

    // System info
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // Agent stats
    const agents = agentService.getAllAgents();
    const workingAgents = agents.filter(a => a.status === 'working');
    const idleAgents = agents.filter(a => a.status === 'idle');

    // Per-agent process info with memory
    const agentProcesses: Array<{
      id: string;
      name: string;
      status: string;
      memoryMB?: number;
      pid?: number;
    }> = [];

    const rawProcessInfo: Array<{
      id: string;
      name: string;
      status: string;
      source: runtimeService.AgentRuntimeProcessInfo['source'];
      pid?: number;
    }> = [];

    for (const agent of agents) {
      try {
        const info = await runtimeService.getAgentRuntimeProcessInfo(agent.id);
        rawProcessInfo.push({
          id: agent.id,
          name: agent.name,
          status: agent.status,
          source: info.source,
          pid: info.pid,
        });
      } catch {
        rawProcessInfo.push({
          id: agent.id,
          name: agent.name,
          status: agent.status,
          source: 'none',
        });
      }
    }

    // "discovered" PIDs are inferred by cwd and may map multiple agents to one process.
    // Only show discovered PID/memory when that discovered PID is unique in this snapshot.
    const discoveredPidCounts = new Map<number, number>();
    for (const info of rawProcessInfo) {
      if (info.source !== 'discovered' || !info.pid) {
        continue;
      }
      discoveredPidCounts.set(info.pid, (discoveredPidCounts.get(info.pid) ?? 0) + 1);
    }

    for (const info of rawProcessInfo) {
      const isReliableSource = info.source === 'active' || info.source === 'persisted';
      const isUniqueDiscoveredPid =
        info.source === 'discovered' &&
        info.pid !== undefined &&
        (discoveredPidCounts.get(info.pid) ?? 0) === 1;
      const shouldShowProcessMetrics = isReliableSource || isUniqueDiscoveredPid;
      const pid = shouldShowProcessMetrics ? info.pid : undefined;
      const memMB = pid ? getProcessMemoryMB(pid) : undefined;

      agentProcesses.push({
        id: info.id,
        name: info.name,
        status: info.status,
        memoryMB: memMB,
        pid,
      });
    }

    // Request latency stats
    const last30s = recentRequests.filter(r => Date.now() - r.timestamp < 30000);
    const avgLatency = last30s.length > 0
      ? Math.round(last30s.reduce((sum, r) => sum + r.duration, 0) / last30s.length)
      : 0;
    const maxLatency = last30s.length > 0
      ? Math.round(Math.max(...last30s.map(r => r.duration)))
      : 0;
    const reqPerSec = last30s.length > 0
      ? Math.round((last30s.length / 30) * 10) / 10
      : 0;

    res.json({
      uptime: Math.round((Date.now() - serverStartTime) / 1000),
      process: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
        cpuUser: Math.round(cpuUsage.user / 1000),
        cpuSystem: Math.round(cpuUsage.system / 1000),
      },
      system: {
        loadAvg: loadAvg.map(l => Math.round(l * 100) / 100),
        totalMemMB: Math.round(totalMem / 1024 / 1024),
        freeMemMB: Math.round(freeMem / 1024 / 1024),
        cpuCount: os.cpus().length,
      },
      agents: {
        total: agents.length,
        working: workingAgents.length,
        idle: idleAgents.length,
        processes: agentProcesses,
      },
      websocket: {
        clients: wsClientsCount,
        messagesSent: wsMessagesSent,
        messagesReceived: wsMessagesReceived,
      },
      http: {
        recentRequests: last30s.length,
        avgLatencyMs: avgLatency,
        maxLatencyMs: maxLatency,
        reqPerSec,
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

export default router;
