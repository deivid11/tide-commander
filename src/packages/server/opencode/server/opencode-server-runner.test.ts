import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunnerRequest } from '../../claude/types.js';
import { OpencodeServerRunner } from './opencode-server-runner.js';
import { loadOpencodeAgents, saveOpencodeAgents } from './opencode-server-recovery-store.js';

function createRunner(): OpencodeServerRunner {
  return new OpencodeServerRunner({
    onEvent: vi.fn(),
    onOutput: vi.fn(),
    onSessionId: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
  });
}

type TestAgentState = {
  sessionId?: string;
  turnState: 'processing' | 'waiting_for_input';
  lastRequest?: RunnerRequest;
  queue?: string[];
  startTime?: number;
  lastActivityTime?: number;
  turnSeq?: number;
};

type RunnerInternals = {
  process: { killDaemon: () => boolean; disconnect?: () => void } | null;
  agents: Map<string, TestAgentState>;
  recovered: boolean;
  applyPendingModelCatalogReload: () => void;
  startTurn: (
    agentId: string,
    state: TestAgentState,
    prompt: string,
    process: { sendPrompt: () => Promise<void> },
    injectInstructions: boolean,
  ) => Promise<void>;
};

afterEach(() => {
  saveOpencodeAgents([]);
});

describe('OpencodeServerRunner model catalog reload', () => {
  it('invalidates an idle attached daemon immediately', () => {
    const runner = createRunner();
    const killDaemon = vi.fn(() => true);
    const internals = runner as unknown as RunnerInternals;
    internals.process = { killDaemon };

    expect(runner.requestModelCatalogReload()).toBe('restarted');
    expect(killDaemon).toHaveBeenCalledOnce();
    expect(internals.process).toBeNull();
  });

  it('defers invalidation until all active turns finish', () => {
    const runner = createRunner();
    const killDaemon = vi.fn(() => true);
    const internals = runner as unknown as RunnerInternals;
    internals.process = { killDaemon };
    const state = { turnState: 'processing' as const };
    internals.agents.set('agent-1', state);

    expect(runner.requestModelCatalogReload()).toBe('deferred');
    expect(killDaemon).not.toHaveBeenCalled();

    internals.agents.set('agent-1', { turnState: 'waiting_for_input' });
    internals.applyPendingModelCatalogReload();
    expect(killDaemon).toHaveBeenCalledOnce();
    expect(internals.process).toBeNull();
  });
});

describe('OpencodeServerRunner restart recovery', () => {
  it('persists a processing turn before the turn-length request resolves', () => {
    const runner = createRunner();
    const internals = runner as unknown as RunnerInternals;
    internals.recovered = true;
    const state: TestAgentState = {
      sessionId: 'ses_active',
      turnState: 'waiting_for_input',
      lastRequest: {
        agentId: 'agent-active',
        prompt: 'long task',
        workingDir: '/workspace',
        model: 'opencode-go/glm-5.3',
      },
      queue: [],
      startTime: Date.now(),
      lastActivityTime: Date.now(),
      turnSeq: 0,
    };
    internals.agents.set('agent-active', state);

    void internals.startTurn(
      'agent-active',
      state,
      'long task',
      { sendPrompt: () => new Promise<void>(() => {}) },
      false,
    );

    expect(loadOpencodeAgents()).toEqual([
      expect.objectContaining({
        agentId: 'agent-active',
        sessionId: 'ses_active',
        turnState: 'processing',
      }),
    ]);
  });

  it('persists sessions and queued follow-ups before graceful map cleanup', async () => {
    const runner = createRunner();
    const disconnect = vi.fn();
    const internals = runner as unknown as RunnerInternals;
    internals.recovered = true;
    internals.process = { killDaemon: vi.fn(() => true), disconnect };
    internals.agents.set('agent-1', {
      sessionId: 'ses_1',
      turnState: 'processing',
      lastRequest: {
        agentId: 'agent-1',
        prompt: 'build it',
        workingDir: '/workspace',
        model: 'opencode-go/glm-5.3',
      },
      queue: ['follow up'],
    });

    await runner.stopAll(false);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(loadOpencodeAgents()).toEqual([
      expect.objectContaining({
        agentId: 'agent-1',
        sessionId: 'ses_1',
        turnState: 'processing',
        queue: ['follow up'],
      }),
    ]);
    expect(internals.agents.size).toBe(0);
  });
});
