import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveProcess, RunnerCallbacks, RunnerRequest } from '../types.js';
import { RunnerRestartPolicy } from './restart-policy.js';

describe('RunnerRestartPolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('restarts crashed process and updates restart tracking', async () => {
    const callbacks: RunnerCallbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const activeProcesses = new Map<string, ActiveProcess>();
    const request: RunnerRequest = {
      agentId: 'agent-1',
      prompt: 'hello',
      workingDir: '/tmp',
    };

    const crashedProcess: ActiveProcess = {
      agentId: 'agent-1',
      startTime: Date.now() - 10_000,
      process: { pid: 123 } as any,
      lastRequest: request,
      restartCount: 1,
      lastRestartTime: Date.now() - 5_000,
    };

    const run = vi.fn(async (req: RunnerRequest) => {
      activeProcesses.set('agent-1', {
        agentId: 'agent-1',
        startTime: Date.now(),
        process: { pid: 456 } as any,
        lastRequest: req,
      });
    });

    const policy = new RunnerRestartPolicy({
      callbacks,
      activeProcesses,
      getAutoRestartEnabled: () => true,
      run,
    });

    policy.maybeAutoRestart('agent-1', crashedProcess, 1, null);

    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(run).toHaveBeenCalledWith(request);
    expect(activeProcesses.get('agent-1')?.restartCount).toBe(2);
    expect(activeProcesses.get('agent-1')?.lastRestartTime).toBeTypeOf('number');
    expect(callbacks.onOutput).toHaveBeenCalledWith(
      'agent-1',
      '[System] Process was automatically restarted after crash'
    );
  });

  it('stops restarting after max attempts and reports error', () => {
    const callbacks: RunnerCallbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const activeProcesses = new Map<string, ActiveProcess>();
    const run = vi.fn(async () => {});

    const policy = new RunnerRestartPolicy({
      callbacks,
      activeProcesses,
      getAutoRestartEnabled: () => true,
      run,
    });

    const processAtLimit: ActiveProcess = {
      agentId: 'agent-1',
      startTime: Date.now() - 10_000,
      process: { pid: 123 } as any,
      lastRequest: {
        agentId: 'agent-1',
        prompt: 'continue',
        workingDir: '/tmp',
      },
      restartCount: 3,
      lastRestartTime: Date.now(),
    };

    policy.maybeAutoRestart('agent-1', processAtLimit, 1, null);

    expect(run).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith(
      'agent-1',
      'Process keeps crashing - auto-restart disabled after 3 attempts. Manual intervention required.'
    );
  });
});
