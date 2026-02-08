import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveProcess } from '../types.js';
import { RunnerInternalEventBus } from './internal-events.js';

const mockIsProcessRunning = vi.hoisted(() => vi.fn());

vi.mock('../../data/index.js', () => ({
  isProcessRunning: mockIsProcessRunning,
}));

describe('RunnerWatchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits watchdog_missing_process and records death for dead tracked process', async () => {
    const { RunnerWatchdog } = await import('./watchdog.js');

    mockIsProcessRunning.mockReturnValue(false);

    const activeProcess: ActiveProcess = {
      agentId: 'agent-1',
      startTime: Date.now() - 2000,
      process: { pid: 999 } as any,
    };

    const activeProcesses = new Map<string, ActiveProcess>([['agent-1', activeProcess]]);
    const lastStderr = new Map<string, string>([['agent-1', 'stderr tail']]);
    const bus = new RunnerInternalEventBus();

    const onMissing = vi.fn();
    bus.on('runner.watchdog_missing_process', onMissing);

    const watchdog = new RunnerWatchdog({
      activeProcesses,
      lastStderr,
      bus,
    });

    watchdog.runWatchdog();

    expect(activeProcesses.has('agent-1')).toBe(false);
    expect(lastStderr.has('agent-1')).toBe(false);

    expect(onMissing).toHaveBeenCalledWith({
      type: 'runner.watchdog_missing_process',
      agentId: 'agent-1',
      pid: 999,
      activeProcess,
    });

    const deaths = watchdog.getDeathHistory();
    expect(deaths).toHaveLength(1);
    expect(deaths[0]).toMatchObject({
      agentId: 'agent-1',
      pid: 999,
      exitCode: null,
      signal: null,
      wasTracked: true,
      stderr: 'stderr tail',
    });
  });

  it('keeps process tracked when it is still alive', async () => {
    const { RunnerWatchdog } = await import('./watchdog.js');

    mockIsProcessRunning.mockReturnValue(true);

    const activeProcess: ActiveProcess = {
      agentId: 'agent-1',
      startTime: Date.now() - 2000,
      process: { pid: 777 } as any,
    };

    const activeProcesses = new Map<string, ActiveProcess>([['agent-1', activeProcess]]);
    const lastStderr = new Map<string, string>();
    const bus = new RunnerInternalEventBus();

    const onMissing = vi.fn();
    bus.on('runner.watchdog_missing_process', onMissing);

    const watchdog = new RunnerWatchdog({
      activeProcesses,
      lastStderr,
      bus,
    });

    watchdog.runWatchdog();

    expect(activeProcesses.has('agent-1')).toBe(true);
    expect(onMissing).not.toHaveBeenCalled();
    expect(watchdog.getDeathHistory()).toHaveLength(0);
  });
});
