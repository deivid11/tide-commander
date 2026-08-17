import { describe, expect, it, vi } from 'vitest';
import type { CLIBackend, RunnerCallbacks, StandardEvent } from '../types.js';
import { RunnerInternalEventBus } from './internal-events.js';
import { RunnerStdoutPipeline } from './stdout-pipeline.js';

describe('RunnerStdoutPipeline', () => {
  function createPipeline(backendName = 'test-backend') {
    const backend: CLIBackend = {
      name: backendName,
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

    return { backend, callbacks, bus, pipeline };
  }

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

  it('forwards finalized thinking visibility metadata to the terminal output', () => {
    const { callbacks, pipeline } = createPipeline('pi');

    (pipeline as any).handleEvent('agent-pi', {
      type: 'thinking',
      text: 'Planning the patch',
      isStreaming: false,
      uuid: 'pi-thinking-1-0',
      reasoningTokens: 693,
      reasoningSummaryCount: 1,
      reasoningEncrypted: true,
      reasoningSummaryOnly: true,
    } satisfies StandardEvent);

    expect(callbacks.onOutput).toHaveBeenCalledWith(
      'agent-pi',
      '[thinking] Planning the patch',
      false,
      undefined,
      'pi-thinking-1-0',
      {
        reasoningTokens: 693,
        reasoningSummaryCount: 1,
        reasoningEncrypted: true,
        reasoningSummaryOnly: true,
      },
    );
  });

  it('forwards non-json lines as raw output', () => {
    const { callbacks, pipeline } = createPipeline();

    (pipeline as any).processLine('agent-2', 'not-json');

    expect(callbacks.onOutput).toHaveBeenCalledWith('agent-2', '[raw] not-json');
    expect(callbacks.onEvent).not.toHaveBeenCalled();
  });

  it('suppresses output-producing events after notification curl', () => {
    const { callbacks, pipeline } = createPipeline('opencode');

    (pipeline as any).handleEvent('agent-3', {
      type: 'tool_start',
      toolName: 'Bash',
      toolInput: { command: 'curl -s http://localhost:5174/api/notify' },
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-3', {
      type: 'text',
      text: 'should not be emitted',
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-3', {
      type: 'tool_start',
      toolName: 'Read',
      toolInput: { file_path: 'src/packages/server/claude/runner/stdout-pipeline.ts' },
    } satisfies StandardEvent);

    expect(callbacks.onOutput).toHaveBeenCalledTimes(2);
    expect(callbacks.onOutput).toHaveBeenNthCalledWith(
      1,
      'agent-3',
      'Using tool: Bash',
      false,
      undefined,
      undefined,
      {
        toolName: 'Bash',
        toolInput: { command: 'curl -s http://localhost:5174/api/notify' },
      },
    );
    expect(callbacks.onOutput).toHaveBeenNthCalledWith(
      2,
      'agent-3',
      'Tool input: {\"command\":\"curl -s http://localhost:5174/api/notify\"}',
      false,
      undefined,
      undefined,
    );
  });

  it('allows passthrough events after notification curl and resets on init', () => {
    const { callbacks, pipeline } = createPipeline('opencode');

    (pipeline as any).handleEvent('agent-4', {
      type: 'tool_start',
      toolName: 'Bash',
      toolInput: { command: 'curl -s http://localhost:5174/api/notify' },
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-4', {
      type: 'usage_snapshot',
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-4', {
      type: 'step_complete',
      resultText: 'final result',
      tokens: { input: 1, output: 2 },
      cost: 0.25,
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-4', {
      type: 'error',
      errorMessage: 'still surfaced',
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-4', {
      type: 'init',
      sessionId: 'session-456',
      model: 'gpt-test',
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-4', {
      type: 'text',
      text: 'emitted after reset',
    } satisfies StandardEvent);

    expect(callbacks.onEvent).toHaveBeenCalledTimes(6);
    expect(callbacks.onOutput).toHaveBeenCalledWith('agent-4', 'final result', false, undefined, undefined);
    expect(callbacks.onOutput).toHaveBeenCalledWith('agent-4', 'Tokens: 1 in, 2 out', false, undefined, undefined);
    expect(callbacks.onOutput).toHaveBeenCalledWith('agent-4', 'Cost: $0.2500', false, undefined, undefined);
    expect(callbacks.onSessionId).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith('agent-4', 'still surfaced');
    expect(callbacks.onOutput).toHaveBeenCalledWith('agent-4', 'Session started: session-456 (gpt-test)');
    expect(callbacks.onOutput).toHaveBeenCalledWith('agent-4', 'emitted after reset', undefined, undefined, undefined);
  });

  it('turns a model_fallback event into a visible warning row', () => {
    const { callbacks, pipeline } = createPipeline();

    (pipeline as any).handleEvent('agent-mf', {
      type: 'model_fallback',
      requestedModel: 'claude-fable-5',
      servedModel: 'claude-opus-4-8',
      text: 'Fable 5 → Opus 4.8',
    } satisfies StandardEvent);

    const [, line] = vi.mocked(callbacks.onOutput).mock.calls[0];
    expect(line).toContain('⚠ [System] Model fallback:');
    expect(line).toContain('Fable 5 → Opus 4.8');
  });

  it('turns a restored model_fallback into a success row', () => {
    const { callbacks, pipeline } = createPipeline();

    (pipeline as any).handleEvent('agent-mf2', {
      type: 'model_fallback',
      fallbackRestored: true,
      requestedModel: 'claude-fable-5',
      servedModel: 'claude-fable-5',
      text: 'Fable 5',
    } satisfies StandardEvent);

    const [, line] = vi.mocked(callbacks.onOutput).mock.calls[0];
    expect(line).toBe('✅ [System] Model restored: back on Fable 5');
  });

  it('does not apply notification suppression to codex backends', () => {
    const { callbacks, pipeline } = createPipeline('codex');

    (pipeline as any).handleEvent('agent-5', {
      type: 'tool_start',
      toolName: 'Bash',
      toolInput: { command: 'curl -s http://localhost:5174/api/notify' },
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-5', {
      type: 'text',
      text: 'future codex output stays live',
      isStreaming: false,
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-5', {
      type: 'tool_start',
      toolName: 'Read',
      toolInput: { file_path: 'src/packages/server/codex/json-event-parser.ts' },
    } satisfies StandardEvent);

    expect(callbacks.onOutput).toHaveBeenCalledWith(
      'agent-5',
      'future codex output stays live',
      false,
      undefined,
      undefined,
    );
    expect(callbacks.onOutput).toHaveBeenCalledWith(
      'agent-5',
      'Using tool: Read',
      false,
      undefined,
      undefined,
      {
        toolName: 'Read',
        toolInput: { file_path: 'src/packages/server/codex/json-event-parser.ts' },
      },
    );
  });

  it('does not emit terminal rows for Grok early empty tool_start (name only)', () => {
    const { callbacks, pipeline } = createPipeline('grok');

    (pipeline as any).handleEvent('agent-grok', {
      type: 'tool_start',
      toolName: 'ListFiles',
      toolInput: {},
      uuid: 'grok-early-list_dir-1',
      toolUseId: 'grok-early-list_dir-1',
    } satisfies StandardEvent);

    // Activity / event bus still receive the event via onEvent
    expect(callbacks.onEvent).toHaveBeenCalled();
    // But no bare "Using tool: ListFiles" / "Tool input: {}" terminal rows
    expect(callbacks.onOutput).not.toHaveBeenCalled();
  });

  it('emits Grok tool_start once full args arrive (upgrade after early empty)', () => {
    const { callbacks, pipeline } = createPipeline('grok');
    const uuid = 'grok-early-list_dir-1';

    (pipeline as any).handleEvent('agent-grok', {
      type: 'tool_start',
      toolName: 'ListFiles',
      toolInput: {},
      uuid,
      toolUseId: uuid,
    } satisfies StandardEvent);
    (pipeline as any).handleEvent('agent-grok', {
      type: 'tool_start',
      toolName: 'ListFiles',
      toolInput: { target_directory: '/tmp/project' },
      uuid,
      toolUseId: uuid,
    } satisfies StandardEvent);

    expect(callbacks.onOutput).toHaveBeenCalledWith(
      'agent-grok',
      'Using tool: ListFiles',
      false,
      undefined,
      uuid,
      {
        toolName: 'ListFiles',
        toolInput: { target_directory: '/tmp/project' },
      },
    );
    expect(callbacks.onOutput).toHaveBeenCalledWith(
      'agent-grok',
      'Tool input: {"target_directory":"/tmp/project"}',
      false,
      undefined,
      uuid,
    );
    // Empty early never produced a row
    const emptyInputCalls = (callbacks.onOutput as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[1] === 'string' && c[1].includes('Tool input: {}')
    );
    expect(emptyInputCalls).toHaveLength(0);
  });
});
