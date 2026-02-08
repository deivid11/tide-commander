import { describe, expect, it, vi } from 'vitest';
import type { CLIBackend, RunnerCallbacks, StandardEvent } from '../types.js';
import { RunnerInternalEventBus } from './internal-events.js';
import { RunnerStdoutPipeline } from './stdout-pipeline.js';

describe('RunnerStdoutPipeline', () => {
  it('emits activity/session events and forwards parsed events', () => {
    const parsedEvent: StandardEvent = {
      type: 'text',
      text: 'hello world',
      isStreaming: true,
    };

    const backend: CLIBackend = {
      name: 'test-backend',
      buildArgs: vi.fn(() => []),
      parseEvent: vi.fn(() => parsedEvent),
      extractSessionId: vi.fn(() => 'session-123'),
      getExecutablePath: vi.fn(() => 'test-bin'),
      detectInstallation: vi.fn(() => null),
      requiresStdinInput: vi.fn(() => false),
      formatStdinInput: vi.fn((prompt: string) => prompt),
    };

    const callbacks: RunnerCallbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const bus = new RunnerInternalEventBus();
    const onActivity = vi.fn();
    const onSession = vi.fn();

    bus.on('runner.activity', onActivity);
    bus.on('runner.session_id', onSession);

    const pipeline = new RunnerStdoutPipeline({ backend, callbacks, bus });

    (pipeline as any).processLine('agent-1', JSON.stringify({ type: 'assistant', message: {} }));

    expect(callbacks.onSessionId).toHaveBeenCalledWith('agent-1', 'session-123');
    expect(onSession).toHaveBeenCalledWith({
      type: 'runner.session_id',
      agentId: 'agent-1',
      sessionId: 'session-123',
    });

    expect(callbacks.onEvent).toHaveBeenCalledWith('agent-1', parsedEvent);
    expect(callbacks.onOutput).toHaveBeenCalledWith('agent-1', 'hello world', true, undefined, undefined);

    expect(onActivity).toHaveBeenCalledTimes(1);
    expect(onActivity.mock.calls[0][0]).toMatchObject({
      type: 'runner.activity',
      agentId: 'agent-1',
    });
    expect(typeof onActivity.mock.calls[0][0].timestamp).toBe('number');
  });

  it('forwards non-json lines as raw output', () => {
    const backend: CLIBackend = {
      name: 'test-backend',
      buildArgs: vi.fn(() => []),
      parseEvent: vi.fn(() => null),
      extractSessionId: vi.fn(() => null),
      getExecutablePath: vi.fn(() => 'test-bin'),
      detectInstallation: vi.fn(() => null),
      requiresStdinInput: vi.fn(() => false),
      formatStdinInput: vi.fn((prompt: string) => prompt),
    };

    const callbacks: RunnerCallbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const bus = new RunnerInternalEventBus();
    const pipeline = new RunnerStdoutPipeline({ backend, callbacks, bus });

    (pipeline as any).processLine('agent-2', 'not-json');

    expect(callbacks.onOutput).toHaveBeenCalledWith('agent-2', '[raw] not-json');
    expect(callbacks.onEvent).not.toHaveBeenCalled();
  });
});
