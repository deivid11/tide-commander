import { describe, expect, it, vi } from 'vitest';
import { ClaudeRunner } from './runner.js';
import type { ActiveProcess, RunnerCallbacks } from './types.js';

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

/** A process that was just spawned with `--resume` and has not produced a turn yet. */
function makeFreshResumeProcess(): ActiveProcess {
  return {
    agentId: 'agent-1',
    startTime: Date.now() - 2_000,
    process: { pid: 4242, stdin: { writable: true, write: vi.fn() } } as unknown as ActiveProcess['process'],
    turnState: 'processing',
    lastActivityTime: Date.now(),
    lastRequest: {
      agentId: 'agent-1',
      prompt: 'hello',
      workingDir: '/tmp',
      sessionId: 'dead-session',
    },
  };
}

describe('ClaudeRunner when --resume points at a missing session', () => {
  const setup = () => {
    const callbacks = makeCallbacks();
    const runner = new ClaudeRunner(callbacks);
    const internals = runner as unknown as RunnerInternals;
    const proc = makeFreshResumeProcess();
    internals.activeProcesses.set(proc.agentId, proc);
    return { callbacks, internals, proc };
  };

  it('counts the failed resume as a finished turn', () => {
    const { internals, proc } = setup();

    internals.bus.emit({
      type: 'runner.event',
      agentId: 'agent-1',
      event: {
        type: 'error',
        errorCode: 'session_not_found',
        errorMessage: 'No conversation found with session ID: dead-session',
      },
    });

    expect(proc.turnState).toBe('waiting_for_input');
  });

  it('does not report the CLI exiting right after as a crash', () => {
    const { callbacks, internals } = setup();

    internals.bus.emit({
      type: 'runner.event',
      agentId: 'agent-1',
      event: { type: 'error', errorCode: 'session_not_found', errorMessage: 'No conversation found' },
    });
    internals.bus.emit({ type: 'runner.process_closed', agentId: 'agent-1', pid: 4242, code: 1, signal: null });

    expect(callbacks.onError).not.toHaveBeenCalled();
    // The restart policy settles on "finished its turn", not on a failed run.
    expect(callbacks.onComplete).toHaveBeenLastCalledWith('agent-1', true);
  });

  it('still treats an unexplained early exit as a crash', () => {
    const { callbacks, internals } = setup();

    internals.bus.emit({ type: 'runner.process_closed', agentId: 'agent-1', pid: 4242, code: 1, signal: null });

    expect(callbacks.onError).toHaveBeenCalledWith('agent-1', expect.stringContaining('crashed immediately'));
  });
});
