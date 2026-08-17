import { describe, expect, it, vi } from 'vitest';
import { PiRpcRunner, inferPiRpcTurnStateFromLogLines } from './pi-rpc-runner.js';

const tmuxIsolation = vi.hoisted(() => ({
  enabled: false,
  listSessions: vi.fn(() => ['live-production-agent']),
  killSession: vi.fn(),
}));

vi.mock('../../claude/runner/tmux-helper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../claude/runner/tmux-helper.js')>();
  return {
    ...actual,
    isTmuxEnabled: () => tmuxIsolation.enabled,
    listPiRpcTmuxSessions: tmuxIsolation.listSessions,
    killPiRpcTmuxSession: tmuxIsolation.killSession,
  };
});

describe('Pi RPC tmux recovery state inference', () => {
  it('treats agent_settled as idle even when get_state responses follow it', () => {
    expect(inferPiRpcTurnStateFromLogLines([
      '{"type":"agent_start"}',
      '{"type":"message_update"}',
      '{"type":"agent_end"}',
      '{"type":"agent_settled"}',
      '{"type":"response","command":"get_state","success":true}',
    ])).toBe('waiting_for_input');
  });

  it('treats the latest active lifecycle event as an in-flight turn', () => {
    expect(inferPiRpcTurnStateFromLogLines([
      '{"type":"agent_settled"}',
      '{"type":"response","command":"prompt","success":true}',
      '{"type":"agent_start"}',
      '{"type":"tool_execution_start"}',
    ])).toBe('processing');
  });

  it('treats an accepted prompt as processing before agent_start arrives', () => {
    expect(inferPiRpcTurnStateFromLogLines([
      '{"type":"agent_settled"}',
      '{"type":"response","command":"prompt","success":true}',
    ])).toBe('processing');
  });

  it('does not infer idle from agent_end before agent_settled', () => {
    expect(inferPiRpcTurnStateFromLogLines([
      '{"type":"agent_start"}',
      '{"type":"agent_end"}',
    ])).toBe('processing');
  });

  it('does not infer idle from agent_end before overflow compaction settles', () => {
    expect(inferPiRpcTurnStateFromLogLines([
      '{"type":"agent_start"}',
      '{"type":"agent_end"}',
      '{"type":"compaction_start","reason":"overflow"}',
      '{"type":"compaction_end","reason":"overflow"}',
    ])).toBe('processing');
  });

  it('uses the manual compact response as its completion boundary', () => {
    expect(inferPiRpcTurnStateFromLogLines([
      '{"type":"compaction_start","reason":"manual"}',
      '{"type":"compaction_end","reason":"manual"}',
      '{"type":"response","command":"compact","success":true}',
    ])).toBe('waiting_for_input');
  });

  it('ignores partial lines and response-only logs', () => {
    expect(inferPiRpcTurnStateFromLogLines([
      '{partial',
      '{"type":"response","command":"get_state","success":true}',
    ])).toBe('waiting_for_input');
  });
});

describe('Pi RPC process isolation', () => {
  it('does not enumerate or kill host tmux sessions when tmux mode is disabled', async () => {
    const callbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    const runner = new PiRpcRunner(callbacks);

    runner.start();
    expect(tmuxIsolation.listSessions).not.toHaveBeenCalled();
    expect(tmuxIsolation.killSession).not.toHaveBeenCalled();

    await runner.stopAll(false);
  });

  it('does not kill an unowned host session absent from the sandbox recovery store', async () => {
    const callbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    const runner = new PiRpcRunner(callbacks);
    tmuxIsolation.enabled = true;
    tmuxIsolation.listSessions.mockClear();
    tmuxIsolation.killSession.mockClear();

    try {
      runner.start();
      expect(tmuxIsolation.listSessions).toHaveBeenCalledOnce();
      expect(tmuxIsolation.killSession).not.toHaveBeenCalled();
    } finally {
      await runner.stopAll(false);
      tmuxIsolation.enabled = false;
    }
  });
});

describe('Pi RPC native model switching', () => {
  function makeHarness(model = 'anthropic/claude-sonnet-4-5') {
    const callbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    const writes: string[] = [];
    const runner = new PiRpcRunner(callbacks);
    const state = {
      agentId: 'agent-pi',
      process: {
        exitCode: null,
        killed: false,
        stdin: {
          writable: true,
          write: (line: string) => { writes.push(line); return true; },
        },
      },
      workingDir: '/tmp/project',
      model,
      effort: undefined as string | undefined,
      startTime: Date.now(),
      turnState: 'waiting_for_input',
      lastActivityTime: Date.now(),
      lastRequest: {
        agentId: 'agent-pi',
        prompt: '',
        workingDir: '/tmp/project',
        model,
      },
      responseBuffer: '',
      stderrTail: '',
      idleWaiters: [],
    };
    (runner as any).agents.set('agent-pi', state);
    return { runner, callbacks, writes, state };
  }

  it('uses set_model and keeps the live Pi session state', async () => {
    const { runner, writes, state } = makeHarness();
    const switching = runner.switchModel('agent-pi', 'openai-codex/gpt-5.6-sol', 'high');

    const command = JSON.parse(writes[0]);
    expect(command).toMatchObject({
      type: 'set_model',
      provider: 'openai-codex',
      modelId: 'gpt-5.6-sol',
    });

    (runner as any).handleResponseLine('agent-pi', JSON.stringify({
      id: command.id,
      type: 'response',
      command: 'set_model',
      success: true,
      data: { provider: 'openai-codex', id: 'gpt-5.6-sol' },
    }));

    await Promise.resolve();
    const thinkingCommand = JSON.parse(writes[1]);
    expect(thinkingCommand).toMatchObject({ type: 'set_thinking_level', level: 'high' });
    (runner as any).handleResponseLine('agent-pi', JSON.stringify({
      id: thinkingCommand.id,
      type: 'response',
      command: 'set_thinking_level',
      success: true,
    }));

    await expect(switching).resolves.toBe(true);
    expect(state.model).toBe('openai-codex/gpt-5.6-sol');
    expect(state.effort).toBe('high');
    expect(state.lastRequest.model).toBe('openai-codex/gpt-5.6-sol');
    expect(JSON.parse(writes.at(-1)!)).toMatchObject({ type: 'get_state' });
  });

  it('keeps the old model when Pi rejects the target', async () => {
    const { runner, writes, state } = makeHarness();
    const switching = runner.switchModel('agent-pi', 'openai-codex/not-available');
    const command = JSON.parse(writes[0]);

    (runner as any).handleResponseLine('agent-pi', JSON.stringify({
      id: command.id,
      type: 'response',
      command: 'set_model',
      success: false,
      error: 'Model not found',
    }));

    await expect(switching).rejects.toThrow('Model not found');
    expect(state.model).toBe('anthropic/claude-sonnet-4-5');
  });
});

describe('Pi RPC native compaction', () => {
  function makeHarness(turnState: 'processing' | 'waiting_for_input' = 'waiting_for_input') {
    const callbacks = {
      onEvent: vi.fn(),
      onOutput: vi.fn(),
      onSessionId: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    const writes: string[] = [];
    const runner = new PiRpcRunner(callbacks);
    const state = {
      agentId: 'agent-pi',
      process: {
        exitCode: null,
        killed: false,
        stdin: {
          writable: true,
          write: (line: string) => { writes.push(line); return true; },
        },
      },
      workingDir: '/tmp/project',
      startTime: Date.now(),
      turnState,
      lastActivityTime: Date.now(),
      responseBuffer: '',
      stderrTail: '',
      idleWaiters: [],
    };
    (runner as any).agents.set('agent-pi', state);
    return { runner, callbacks, writes, state };
  }

  it('writes the native compact RPC command and settles on its response', async () => {
    const { runner, callbacks, writes, state } = makeHarness();

    await expect(runner.compactContext('agent-pi')).resolves.toBe(true);
    expect(state.turnState).toBe('processing');
    expect(JSON.parse(writes[0])).toMatchObject({ type: 'compact' });

    (runner as any).handleResponseLine(
      'agent-pi',
      '{"type":"response","command":"compact","success":true,"data":{}}',
    );
    expect(state.turnState).toBe('waiting_for_input');
    expect(callbacks.onComplete).toHaveBeenCalledExactlyOnceWith('agent-pi', true);
  });

  it('refuses native compaction while another Pi run is processing', async () => {
    const { runner, writes } = makeHarness('processing');

    await expect(runner.compactContext('agent-pi')).resolves.toBe(false);
    expect(writes).toHaveLength(0);
  });
});
