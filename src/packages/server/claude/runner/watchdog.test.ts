import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('RunnerWatchdog idle detection', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsProcessRunning.mockReturnValue(true);
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  function makeProc(over: Partial<ActiveProcess> = {}): ActiveProcess {
    const tenMinAgo = Date.now() - 600_000;
    return {
      agentId: 'a1',
      startTime: tenMinAgo,
      process: { pid: 99_999 } as any,
      turnState: 'processing',
      lastActivityTime: tenMinAgo,
      ...over,
    };
  }

  async function makeWatchdog(processes: Map<string, ActiveProcess>, lastStderr = new Map<string, string>()) {
    const { RunnerWatchdog } = await import('./watchdog.js');
    return new RunnerWatchdog({
      activeProcesses: processes,
      lastStderr,
      bus: new RunnerInternalEventBus(),
    });
  }

  it('SIGKILLs a process stuck mid-turn beyond the idle threshold', async () => {
    const processes = new Map<string, ActiveProcess>([['a1', makeProc()]]);
    (await makeWatchdog(processes)).runWatchdog();
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(99_999, 'SIGKILL');
  });

  it('records a stderr breadcrumb so the user can see why the kill happened', async () => {
    const processes = new Map<string, ActiveProcess>([['a1', makeProc()]]);
    const lastStderr = new Map<string, string>();
    (await makeWatchdog(processes, lastStderr)).runWatchdog();
    expect(lastStderr.get('a1')).toMatch(/idle-watchdog/);
  });

  it('does NOT SIGKILL when the agent is waiting for input (turn already finished)', async () => {
    const processes = new Map<string, ActiveProcess>([
      ['a1', makeProc({ turnState: 'waiting_for_input' })],
    ]);
    (await makeWatchdog(processes)).runWatchdog();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('does NOT SIGKILL when activity is recent', async () => {
    const processes = new Map<string, ActiveProcess>([
      ['a1', makeProc({ lastActivityTime: Date.now() - 1_000 })],
    ]);
    (await makeWatchdog(processes)).runWatchdog();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('does NOT SIGKILL before the first activity event has been recorded', async () => {
    const processes = new Map<string, ActiveProcess>([
      ['a1', makeProc({ lastActivityTime: undefined })],
    ]);
    (await makeWatchdog(processes)).runWatchdog();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('swallows ESRCH from process.kill so the watchdog tick keeps running', async () => {
    killSpy.mockImplementation(() => {
      throw new Error('ESRCH');
    });
    const processes = new Map<string, ActiveProcess>([
      ['a1', makeProc()],
      ['a2', makeProc({ agentId: 'a2', process: { pid: 88_888 } as any })],
    ]);
    const wd = await makeWatchdog(processes);
    expect(() => wd.runWatchdog()).not.toThrow();
    expect(killSpy).toHaveBeenCalledTimes(2);
  });
});
