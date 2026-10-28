import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

// Only the tmux probes are faked: a zombie session is one that `has-session`
// still reports but whose CLI binary is no longer in the pane's process tree.
vi.mock('./runner/tmux-helper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runner/tmux-helper.js')>();
  return {
    ...actual,
    isTmuxPaneCommandAlive: vi.fn(() => false),
    killTmuxSession: vi.fn(),
    sendToTmux: vi.fn(() => true),
  };
});

import { ClaudeRunner } from './runner.js';
import { isTmuxPaneCommandAlive, killTmuxSession, sendToTmux } from './runner/tmux-helper.js';
import type { ActiveProcess, RunnerCallbacks, RunnerRequest } from './types.js';

type RunnerInternals = { activeProcesses: Map<string, ActiveProcess> };

function makeCallbacks(): RunnerCallbacks {
  return { onEvent: vi.fn(), onOutput: vi.fn(), onSessionId: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
}

function makeTmuxProcess(over: Partial<ActiveProcess> = {}): ActiveProcess {
  const request: RunnerRequest = { agentId: 'agent-1', prompt: 'earlier prompt', workingDir: '/tmp', sessionId: 'session-1' };
  return {
    agentId: 'agent-1',
    startTime: Date.now() - 60_000,
    process: { pid: 4242 } as unknown as ActiveProcess['process'],
    turnState: 'waiting_for_input',
    lastActivityTime: Date.now() - 1_000,
    lastRequest: request,
    tmuxSession: 'tc-agent-1',
    tmuxExpectedCommand: 'claude',
    tmuxTailer: { drain: vi.fn(), stop: vi.fn() } as unknown as ActiveProcess['tmuxTailer'],
    ...over,
  };
}

function register(runner: ClaudeRunner, proc: ActiveProcess): RunnerInternals {
  const internals = runner as unknown as RunnerInternals;
  internals.activeProcesses.set(proc.agentId, proc);
  return internals;
}

afterEach(() => {
  vi.clearAllMocks();
  (isTmuxPaneCommandAlive as Mock).mockReturnValue(false);
});

// Writing into a tmux pane whose claude already died only kills the stray `cat`;
// the session then closes and looks like a clean end of turn — the message is
// gone and the agent sits idle (Catys Magnemite, 2026-10-27).
describe('ClaudeRunner.sendMessage into a zombie tmux session', () => {
  it('refuses to write, kills the session and forgets the process so the caller respawns', () => {
    const runner = new ClaudeRunner(makeCallbacks());
    const proc = makeTmuxProcess();
    const internals = register(runner, proc);

    expect(runner.sendMessage('agent-1', 'hola')).toBe(false);

    expect(isTmuxPaneCommandAlive).toHaveBeenCalledWith('agent-1', 'claude');
    expect(sendToTmux).not.toHaveBeenCalled();
    expect(killTmuxSession).toHaveBeenCalledWith('agent-1');
    expect(proc.tmuxTailer?.stop).toHaveBeenCalled();
    expect(internals.activeProcesses.has('agent-1')).toBe(false);
  });

  it('writes as usual while the CLI is alive in the pane', () => {
    (isTmuxPaneCommandAlive as Mock).mockReturnValue(true);
    const runner = new ClaudeRunner(makeCallbacks());
    const proc = makeTmuxProcess();
    const internals = register(runner, proc);

    expect(runner.sendMessage('agent-1', 'hola')).toBe(true);

    expect(sendToTmux).toHaveBeenCalledTimes(1);
    expect(killTmuxSession).not.toHaveBeenCalled();
    expect(internals.activeProcesses.has('agent-1')).toBe(true);
    expect(proc.turnState).toBe('processing');
  });

  it('without a known CLI command (legacy bookkeeping) it does not probe and writes as before', () => {
    const runner = new ClaudeRunner(makeCallbacks());
    register(runner, makeTmuxProcess({ tmuxExpectedCommand: undefined }));

    expect(runner.sendMessage('agent-1', 'hola')).toBe(true);

    expect(isTmuxPaneCommandAlive).not.toHaveBeenCalled();
    expect(sendToTmux).toHaveBeenCalledTimes(1);
  });
});
