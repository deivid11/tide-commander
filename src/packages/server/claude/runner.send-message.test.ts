import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeRunner } from './runner.js';
import type { ActiveProcess, RunnerCallbacks, RunnerRequest } from './types.js';

type RunnerInternals = {
  activeProcesses: Map<string, ActiveProcess>;
  bus: { emit(event: Record<string, unknown>): void };
};

function makeCallbacks(): RunnerCallbacks {
  return {
    onEvent: vi.fn(),
    onOutput: vi.fn(),
    onSessionId: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
  };
}

function makeIdleProcess(): ActiveProcess {
  const request: RunnerRequest = {
    agentId: 'agent-1',
    prompt: 'prompt that spawned this process',
    workingDir: '/tmp',
    sessionId: 'session-1',
  };
  return {
    agentId: 'agent-1',
    startTime: Date.now() - 60_000,
    process: {
      pid: 4242,
      stdin: { writable: true, write: vi.fn((_chunk: string, _enc: string, cb: () => void) => cb()) },
    } as unknown as ActiveProcess['process'],
    turnState: 'waiting_for_input',
    lastActivityTime: Date.now() - 405_000,
    lastRequest: request,
  };
}

function registerProcess(runner: ClaudeRunner, proc: ActiveProcess): RunnerInternals {
  const internals = runner as unknown as RunnerInternals;
  internals.activeProcesses.set(proc.agentId, proc);
  return internals;
}

describe('ClaudeRunner.sendMessage on a live process', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes activity tracking so the idle watchdog does not kill a process that just got a message', () => {
    const runner = new ClaudeRunner(makeCallbacks());
    const proc = makeIdleProcess();
    registerProcess(runner, proc);

    expect(runner.sendMessage('agent-1', 'latest message')).toBe(true);

    expect(proc.process.stdin?.write).toHaveBeenCalledTimes(1);
    expect(proc.turnState).toBe('processing');
    expect(Date.now() - (proc.lastActivityTime ?? 0)).toBeLessThan(1000);
  });

  it('records the message as lastRequest.prompt without touching the rest of the request', () => {
    const runner = new ClaudeRunner(makeCallbacks());
    const proc = makeIdleProcess();
    registerProcess(runner, proc);

    runner.sendMessage('agent-1', 'latest message');

    expect(proc.lastRequest).toMatchObject({
      agentId: 'agent-1',
      prompt: 'latest message',
      workingDir: '/tmp',
      sessionId: 'session-1',
    });
  });

  it('replays the latest message, not the spawn prompt, when the process crashes afterwards', async () => {
    const runner = new ClaudeRunner(makeCallbacks());
    const run = vi.spyOn(runner, 'run').mockResolvedValue(undefined as never);
    const proc = makeIdleProcess();
    const internals = registerProcess(runner, proc);

    runner.sendMessage('agent-1', 'latest message');
    internals.bus.emit({ type: 'runner.process_closed', agentId: 'agent-1', pid: 4242, code: 1, signal: null });
    await vi.advanceTimersByTimeAsync(1000);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1', prompt: 'latest message' }));
  });

  it('keeps the last message through several deliveries before a crash', async () => {
    const runner = new ClaudeRunner(makeCallbacks());
    const run = vi.spyOn(runner, 'run').mockResolvedValue(undefined as never);
    const proc = makeIdleProcess();
    const internals = registerProcess(runner, proc);

    runner.sendMessage('agent-1', 'first follow-up');
    proc.turnState = 'waiting_for_input';
    runner.sendMessage('agent-1', 'second follow-up');
    internals.bus.emit({ type: 'runner.process_closed', agentId: 'agent-1', pid: 4242, code: 1, signal: null });
    await vi.advanceTimersByTimeAsync(1000);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'second follow-up' }));
  });
});
