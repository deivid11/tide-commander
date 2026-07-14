import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeCommandExecution } from './runtime-command-execution.js';

const mockGetAgent = vi.fn();
const mockUpdateAgent = vi.fn();

vi.mock('./agent-service.js', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
  sanitizeModelForProvider: vi.fn((_p: string, m: string) => m),
  sanitizeOpencodeModel: vi.fn((m: string) => m),
  sanitizeGrokModel: vi.fn((m: string) => m ?? 'grok-4.5'),
  sanitizeCodexModel: vi.fn((m: string) => m),
}));

vi.mock('../utils/log-context.js', () => ({
  withAgentContext: (_id: string, fn: () => unknown) => fn(),
}));

vi.mock('./runtime-watchdog.js', () => ({
  clearPendingSilentContextRefresh: vi.fn(),
  clearStdinWatchdog: vi.fn(),
  hasPendingSilentContextRefresh: vi.fn(() => false),
  markPendingSilentContextRefresh: vi.fn(),
  startStdinWatchdog: vi.fn(),
}));

vi.mock('../websocket/handlers/command-handler.js', () => ({
  buildCustomAgentConfig: vi.fn(() => undefined),
}));

function makeRunner(overrides: Partial<{
  isRunning: boolean;
  closesStdin: boolean;
  supportsStdin: boolean;
  sendMessage: boolean;
  turnState: 'processing' | 'waiting_for_input';
}> = {}) {
  return {
    isRunning: vi.fn(() => overrides.isRunning ?? true),
    closesStdinAfterPrompt: vi.fn(() => overrides.closesStdin ?? true),
    supportsStdin: vi.fn(() => overrides.supportsStdin ?? false),
    sendMessage: vi.fn(() => overrides.sendMessage ?? true),
    getTurnState: vi.fn(() => overrides.turnState ?? 'processing'),
    stop: vi.fn(async () => {}),
    run: vi.fn(async () => {}),
    hasRecentActivity: vi.fn(() => false),
    onNextActivity: vi.fn(),
  };
}

describe('runtime-command-execution mid-run stdin-closed', () => {
  const log = { log: vi.fn(), warn: vi.fn() };
  const notifyCommandStarted = vi.fn();
  const emitOutput = vi.fn();
  const killDetached = vi.fn(async () => false);

  let runner: ReturnType<typeof makeRunner>;
  let api: ReturnType<typeof createRuntimeCommandExecution>;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = makeRunner();
    mockGetAgent.mockReturnValue({
      id: 'agent-1',
      provider: 'grok',
      status: 'working',
      taskCount: 2,
      cwd: '/tmp/project',
      class: 'dev',
      grokModel: 'grok-4.5',
    });
    api = createRuntimeCommandExecution({
      log,
      getRunner: () => runner as any,
      getRunnerForAgent: () => runner as any,
      notifyCommandStarted,
      emitOutput,
      killDetachedProviderProcessInCwd: killDetached,
    });
  });

  it('queues mid-run prompts by default (no interrupt)', async () => {
    await api.sendCommand('agent-1', 'continua ahi');

    expect(runner.sendMessage).toHaveBeenCalledWith('agent-1', 'continua ahi');
    expect(runner.stop).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    expect(notifyCommandStarted).toHaveBeenCalledWith('agent-1', 'continua ahi', { queued: true });
    expect(emitOutput).toHaveBeenCalledWith(
      'agent-1',
      expect.stringContaining('Mid-run message for Grok will be sent when the agent is free'),
      false,
      undefined,
      expect.stringMatching(/^system-midrun-queued-/),
    );
    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        lastAssignedTask: 'continua ahi',
        taskCount: 3,
      }),
    );
  });

  it('forceInterrupt stops the process and respawns with the new prompt', async () => {
    await api.sendCommand('agent-1', 'ok no', undefined, undefined, undefined, { forceInterrupt: true });

    expect(runner.sendMessage).not.toHaveBeenCalled();
    // clearQueue=false: other queued messages must survive a "Send now".
    expect(runner.stop).toHaveBeenCalledWith('agent-1', false);
    expect(emitOutput).toHaveBeenCalledWith(
      'agent-1',
      '🛑 [System] Interrupting current work to process new prompt…',
      false,
      undefined,
      'system-interrupt-restart',
    );
    // executeCommand → runner.run
    expect(runner.run).toHaveBeenCalled();
    expect(notifyCommandStarted).toHaveBeenCalledWith('agent-1', 'ok no');
  });

  it('does not queue when process is not running (normal spawn path)', async () => {
    runner = makeRunner({ isRunning: false });
    api = createRuntimeCommandExecution({
      log,
      getRunner: () => runner as any,
      getRunnerForAgent: () => runner as any,
      notifyCommandStarted,
      emitOutput,
      killDetachedProviderProcessInCwd: killDetached,
    });

    await api.sendCommand('agent-1', 'hello');

    expect(runner.sendMessage).not.toHaveBeenCalled();
    expect(runner.stop).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalled();
  });

  it('falls through to interrupt when sendMessage fails to queue', async () => {
    runner = makeRunner({ sendMessage: false });
    api = createRuntimeCommandExecution({
      log,
      getRunner: () => runner as any,
      getRunnerForAgent: () => runner as any,
      notifyCommandStarted,
      emitOutput,
      killDetachedProviderProcessInCwd: killDetached,
    });

    await api.sendCommand('agent-1', 'retry me');

    expect(runner.sendMessage).toHaveBeenCalled();
    expect(runner.stop).toHaveBeenCalledWith('agent-1', true);
    expect(runner.run).toHaveBeenCalled();
  });

  it('still injects mid-run via stdin for open-stdin backends (Claude)', async () => {
    mockGetAgent.mockReturnValue({
      id: 'agent-claude',
      provider: 'claude',
      status: 'working',
      taskCount: 1,
      cwd: '/tmp/project',
    });
    runner = makeRunner({
      isRunning: true,
      closesStdin: false,
      supportsStdin: true,
      sendMessage: true,
    });
    api = createRuntimeCommandExecution({
      log,
      getRunner: () => runner as any,
      getRunnerForAgent: () => runner as any,
      notifyCommandStarted,
      emitOutput,
      killDetachedProviderProcessInCwd: killDetached,
    });

    await api.sendCommand('agent-claude', 'mid turn note');

    expect(runner.sendMessage).toHaveBeenCalledWith('agent-claude', 'mid turn note');
    expect(runner.stop).not.toHaveBeenCalled();
    expect(emitOutput).not.toHaveBeenCalledWith(
      'agent-claude',
      expect.stringContaining('Mid-run message'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    // Claude path notifies without queued flag
    expect(notifyCommandStarted).toHaveBeenCalledWith('agent-claude', 'mid turn note');
  });
});

describe('runtime-command-execution mid-run persistent-stream (app-server/serve)', () => {
  const log = { log: vi.fn(), warn: vi.fn() };
  const notifyCommandStarted = vi.fn();
  const emitOutput = vi.fn();
  const killDetached = vi.fn(async () => false);

  function makeApi(runner: unknown) {
    return createRuntimeCommandExecution({
      log,
      getRunner: () => runner as any,
      getRunnerForAgent: () => runner as any,
      notifyCommandStarted,
      emitOutput,
      killDetachedProviderProcessInCwd: killDetached,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockReturnValue({
      id: 'agent-codex',
      provider: 'codex',
      status: 'working',
      taskCount: 5,
      cwd: '/tmp/project',
      class: 'dev',
    });
  });

  it('forceInterrupt interrupts the turn in place and queues the prompt (no stop/respawn)', async () => {
    const runner = {
      ...makeRunner({ closesStdin: false, supportsStdin: true, turnState: 'processing' }),
      interruptTurn: vi.fn(async () => true),
    };
    const api = makeApi(runner);

    await api.sendCommand('agent-codex', 'do this now', undefined, undefined, undefined, { forceInterrupt: true });

    expect(runner.interruptTurn).toHaveBeenCalledWith('agent-codex', true);
    expect(runner.sendMessage).toHaveBeenCalledWith('agent-codex', 'do this now');
    expect(runner.stop).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    expect(emitOutput).toHaveBeenCalledWith(
      'agent-codex',
      '🛑 [System] Interrupting current work to process new prompt…',
      false,
      undefined,
      'system-interrupt-restart',
    );
    expect(notifyCommandStarted).toHaveBeenCalledWith('agent-codex', 'do this now');
    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-codex',
      expect.objectContaining({ lastAssignedTask: 'do this now', taskCount: 6 }),
    );
  });

  it('restores sibling queued messages behind the forced prompt', async () => {
    const runner = {
      ...makeRunner({ closesStdin: false, supportsStdin: true, turnState: 'processing' }),
      interruptTurn: vi.fn(async () => true),
      getQueuedMessages: vi.fn(() => ['first note', 'second note']),
    };
    const api = makeApi(runner);

    await api.sendCommand('agent-codex', 'do this now', undefined, undefined, undefined, { forceInterrupt: true });

    // Forced prompt first, then the previously queued messages re-appended.
    expect(runner.sendMessage.mock.calls.map((c: unknown[]) => c[1])).toEqual([
      'do this now',
      'first note',
      'second note',
    ]);
  });

  it('falls through to normal delivery when interruptTurn fails', async () => {
    const runner = {
      ...makeRunner({ closesStdin: false, supportsStdin: true, turnState: 'processing' }),
      interruptTurn: vi.fn(async () => false),
    };
    const api = makeApi(runner);

    await api.sendCommand('agent-codex', 'do this now', undefined, undefined, undefined, { forceInterrupt: true });

    expect(runner.interruptTurn).toHaveBeenCalled();
    // Falls through to the supportsStdin branch → still delivered via queue.
    expect(runner.sendMessage).toHaveBeenCalledWith('agent-codex', 'do this now');
    expect(runner.stop).not.toHaveBeenCalled();
  });

  it('skips the interrupt when the turn is already waiting for input', async () => {
    const runner = {
      ...makeRunner({ closesStdin: false, supportsStdin: true, turnState: 'waiting_for_input' }),
      interruptTurn: vi.fn(async () => true),
    };
    const api = makeApi(runner);

    await api.sendCommand('agent-codex', 'next task', undefined, undefined, undefined, { forceInterrupt: true });

    expect(runner.interruptTurn).not.toHaveBeenCalled();
    expect(runner.sendMessage).toHaveBeenCalledWith('agent-codex', 'next task');
  });

  it('without forceInterrupt, mid-turn messages queue as before', async () => {
    const runner = {
      ...makeRunner({ closesStdin: false, supportsStdin: true, turnState: 'processing' }),
      interruptTurn: vi.fn(async () => true),
    };
    const api = makeApi(runner);

    await api.sendCommand('agent-codex', 'just a note');

    expect(runner.interruptTurn).not.toHaveBeenCalled();
    expect(runner.sendMessage).toHaveBeenCalledWith('agent-codex', 'just a note');
    expect(runner.stop).not.toHaveBeenCalled();
  });
});
