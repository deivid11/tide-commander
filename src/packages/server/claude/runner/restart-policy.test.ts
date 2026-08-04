import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

  it('treats a fast-exiting process in waiting_for_input as a completed turn, not a crash', () => {
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

    // Simulates a Codex `exec` run that finishes its turn in under 5 seconds:
    // tmux session ends, watchdog calls maybeAutoRestart with null/null, but the
    // parser has already set turnState='waiting_for_input' from turn.completed.
    const shortLivedCodexTurn: ActiveProcess = {
      agentId: 'agent-1',
      startTime: Date.now() - 2_800,
      process: { pid: 123 } as any,
      lastRequest: {
        agentId: 'agent-1',
        prompt: 'which your model?',
        workingDir: '/tmp',
      },
      turnState: 'waiting_for_input',
    };

    policy.maybeAutoRestart('agent-1', shortLivedCodexTurn, null, null);

    expect(run).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onComplete).toHaveBeenCalledWith('agent-1', true);
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
      // Produced output before dying — a genuine crash loop, not a hung resume.
      lastActivityTime: Date.now() - 5_000,
    };

    policy.maybeAutoRestart('agent-1', processAtLimit, 1, null);

    expect(run).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith(
      'agent-1',
      'Process keeps crashing - auto-restart disabled after 3 attempts. Manual intervention required.'
    );
  });

  it('reports an unresumable session when every restart produced zero output', () => {
    const callbacks: RunnerCallbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const policy = new RunnerRestartPolicy({
      callbacks,
      activeProcesses: new Map<string, ActiveProcess>(),
      getAutoRestartEnabled: () => true,
      run: vi.fn(async () => {}),
    });

    // No lastActivityTime: the CLI hung replaying the session and never emitted
    // a single byte — the id must be dropped so the next message starts fresh
    // instead of resuming the same corpse forever.
    const deadProcess: ActiveProcess = {
      agentId: 'agent-1',
      startTime: Date.now() - 200_000,
      process: { pid: 123 } as any,
      sessionId: 'dead-session',
      lastRequest: {
        agentId: 'agent-1',
        prompt: 'continue',
        workingDir: '/tmp',
        sessionId: 'dead-session',
      },
      restartCount: 3,
      lastRestartTime: Date.now(),
    };

    policy.maybeAutoRestart('agent-1', deadProcess, 1, null);

    expect(deadProcess.sessionId).toBeUndefined();
    expect(deadProcess.lastRequest?.sessionId).toBeUndefined();
    expect(callbacks.onError).toHaveBeenCalledWith(
      'agent-1',
      'Session was unresumable - 3 restarts produced no output at all. '
      + 'It has been cleared; your next message will start a fresh session (previous conversation is not recoverable).'
    );
  });

  it('treats an empty stdout log as no output even when lastActivityTime was touched', () => {
    const callbacks: RunnerCallbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const run = vi.fn(async () => {});
    const policy = new RunnerRestartPolicy({
      callbacks,
      activeProcesses: new Map<string, ActiveProcess>(),
      getAutoRestartEnabled: () => true,
      run,
    });

    // Regression: the grok side-channel watcher emits a usage_snapshot from the
    // PREVIOUS turn's signals.json the moment it attaches (~300ms after spawn),
    // which bumps lastActivityTime without the CLI writing a byte. Trusting that
    // marked a hung resume "healthy" and reset the counter on every cycle.
    const emptyLog = path.join(os.tmpdir(), `tide-restart-policy-empty-${process.pid}.log`);
    fs.writeFileSync(emptyLog, '');
    try {
      policy.maybeAutoRestart('agent-1', {
        agentId: 'agent-1',
        startTime: Date.now() - 200_000,
        process: { pid: 123 } as any,
        lastRequest: { agentId: 'agent-1', prompt: 'continue', workingDir: '/tmp' },
        restartCount: 3,
        lastRestartTime: Date.now() - 190_000,
        tmuxLogFile: emptyLog,
        lastActivityTime: Date.now() - 199_700,
      }, null, null);

      expect(run).not.toHaveBeenCalled();
      expect(callbacks.onError).toHaveBeenCalledWith(
        'agent-1',
        expect.stringContaining('Session was unresumable'),
      );
    } finally {
      fs.rmSync(emptyLog, { force: true });
    }
  });

  it('counts a non-empty stdout log as real output', () => {
    const callbacks: RunnerCallbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const policy = new RunnerRestartPolicy({
      callbacks,
      activeProcesses: new Map<string, ActiveProcess>(),
      getAutoRestartEnabled: () => true,
      run: vi.fn(async () => {}),
    });

    const busyLog = path.join(os.tmpdir(), `tide-restart-policy-busy-${process.pid}.log`);
    fs.writeFileSync(busyLog, '{"type":"text"}\n');
    try {
      policy.maybeAutoRestart('agent-1', {
        agentId: 'agent-1',
        startTime: Date.now() - 200_000,
        process: { pid: 123 } as any,
        lastRequest: { agentId: 'agent-1', prompt: 'continue', workingDir: '/tmp' },
        restartCount: 3,
        lastRestartTime: Date.now(),
        tmuxLogFile: busyLog,
      }, 1, null);

      expect(callbacks.onError).toHaveBeenCalledWith(
        'agent-1',
        'Process keeps crashing - auto-restart disabled after 3 attempts. Manual intervention required.'
      );
    } finally {
      fs.rmSync(busyLog, { force: true });
    }
  });

  it('does not reset the attempt counter for a silent process that outlived the cooldown', () => {
    const callbacks: RunnerCallbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const run = vi.fn(async () => {});
    const policy = new RunnerRestartPolicy({
      callbacks,
      activeProcesses: new Map<string, ActiveProcess>(),
      getAutoRestartEnabled: () => true,
      run,
    });

    // Regression: the idle watchdog only kills a wedged CLI after 180s, which
    // always exceeds the 60s restart cooldown. A purely time-based reset put
    // every hang→kill→restart cycle back at attempt 1/3, so the capped loop ran
    // forever. A process that emitted nothing must never earn a counter reset.
    policy.maybeAutoRestart('agent-1', {
      agentId: 'agent-1',
      startTime: Date.now() - 200_000,
      process: { pid: 123 } as any,
      lastRequest: { agentId: 'agent-1', prompt: 'continue', workingDir: '/tmp' },
      restartCount: 3,
      lastRestartTime: Date.now() - 190_000,
    }, 1, null);

    expect(run).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
  });
});
