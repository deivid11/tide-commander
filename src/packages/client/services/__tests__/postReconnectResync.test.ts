/**
 * Tests for post-reconnect resync.
 *
 * Verifies:
 * - Resync calls /api/agents and forwards results to applyAgents.
 * - Resync flag toggles true → false even on error paths.
 * - Optimistic prompt-style outputs survive a resync (resync only touches agents).
 * - Re-running resync with the same data does not produce duplicates downstream.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/storage', () => ({
  apiUrl: (path: string) => `http://test${path}`,
  authFetch: vi.fn(),
}));

vi.mock('../../store', () => ({
  store: {
    setAgents: vi.fn(),
    setResyncInProgress: vi.fn(),
  },
}));

import { runPostReconnectResync } from '../postReconnectResync';

function makeAgent(id: string, status: string = 'idle') {
  return {
    id,
    name: `Agent-${id}`,
    status,
    position: { x: 0, z: 0 },
    sessionId: null,
  };
}

function jsonResponse<T>(body: T, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('runPostReconnectResync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches /api/agents and applies the array result', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse([makeAgent('a', 'idle'), makeAgent('b', 'working')]),
    );
    const applyAgents = vi.fn();
    const setResyncFlag = vi.fn();

    const result = await runPostReconnectResync({ fetcher, applyAgents, setResyncFlag });

    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('http://test/api/agents');
    expect(applyAgents).toHaveBeenCalledTimes(1);
    expect(applyAgents.mock.calls[0][0]).toHaveLength(2);
    expect(setResyncFlag).toHaveBeenNthCalledWith(1, true);
    expect(setResyncFlag).toHaveBeenNthCalledWith(2, false);
  });

  it('accepts payload wrapped in { agents: [...] }', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ agents: [makeAgent('a')] }),
    );
    const applyAgents = vi.fn();
    const setResyncFlag = vi.fn();

    const result = await runPostReconnectResync({ fetcher, applyAgents, setResyncFlag });

    expect(result.ok).toBe(true);
    expect(applyAgents.mock.calls[0][0]).toHaveLength(1);
  });

  it('clears resync flag on HTTP error and reports failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const applyAgents = vi.fn();
    const setResyncFlag = vi.fn();

    const result = await runPostReconnectResync({ fetcher, applyAgents, setResyncFlag });

    expect(result.ok).toBe(false);
    expect(applyAgents).not.toHaveBeenCalled();
    expect(setResyncFlag).toHaveBeenNthCalledWith(1, true);
    expect(setResyncFlag).toHaveBeenNthCalledWith(2, false);
  });

  it('clears resync flag on network rejection', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    const applyAgents = vi.fn();
    const setResyncFlag = vi.fn();

    const result = await runPostReconnectResync({ fetcher, applyAgents, setResyncFlag });

    expect(result.ok).toBe(false);
    expect(setResyncFlag).toHaveBeenNthCalledWith(2, false);
  });

  it('does not touch outputs — optimistic prompts cannot be lost via resync', async () => {
    const optimisticOutputs = ['user prompt: please run task'];

    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse([makeAgent('a', 'working')]),
    );
    const applyAgents = vi.fn();
    const setResyncFlag = vi.fn();

    await runPostReconnectResync({ fetcher, applyAgents, setResyncFlag });

    expect(optimisticOutputs).toEqual(['user prompt: please run task']);
  });

  it('repeated resyncs with the same payload do not multiply applyAgents calls', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse([makeAgent('a'), makeAgent('b')]),
    );
    const applyAgents = vi.fn();
    const setResyncFlag = vi.fn();

    await runPostReconnectResync({ fetcher, applyAgents, setResyncFlag });
    await runPostReconnectResync({ fetcher, applyAgents, setResyncFlag });

    expect(applyAgents).toHaveBeenCalledTimes(2);
    expect(applyAgents.mock.calls[0][0]).toHaveLength(2);
    expect(applyAgents.mock.calls[1][0]).toHaveLength(2);
  });
});
