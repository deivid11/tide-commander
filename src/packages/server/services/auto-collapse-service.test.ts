import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Agent } from '../../shared/agent-types.js';

// ─── Mocks for the service's three collaborators ───
const scheduleMock = vi.fn();
const stopMock = vi.fn();
const validateMock = vi.fn();
const collapseMock = vi.fn();

let subscriber: ((event: string, data: Agent | string) => void) | null = null;
let allAgents: Agent[] = [];

vi.mock('./cron-service.js', () => ({
  schedule: (...args: unknown[]) => scheduleMock(...args),
  stop: (...args: unknown[]) => stopMock(...args),
  validate: (...args: unknown[]) => validateMock(...args),
}));
vi.mock('./runtime-service.js', () => ({
  collapseAgentContext: (...args: unknown[]) => collapseMock(...args),
}));
vi.mock('./agent-service.js', () => ({
  getAllAgents: () => allAgents,
  subscribe: (cb: (event: string, data: Agent | string) => void) => {
    subscriber = cb;
    return () => { subscriber = null; };
  },
}));

import * as autoCollapse from './auto-collapse-service.js';

function makeAgent(over: Partial<Agent>): Agent {
  return {
    id: 'a1',
    name: 'Agent',
    class: 'scout',
    status: 'idle',
    provider: 'claude',
    position: { x: 0, y: 0, z: 0 },
    cwd: '/tmp',
    permissionMode: 'bypass',
    tokensUsed: 0,
    contextUsed: 0,
    contextLimit: 200000,
    taskCount: 0,
    createdAt: 0,
    lastActivity: 0,
    ...over,
  } as Agent;
}

let jobSeq = 0;

beforeEach(() => {
  autoCollapse.shutdown(); // clear module state between specs
  scheduleMock.mockReset();
  stopMock.mockReset();
  validateMock.mockReset();
  collapseMock.mockReset();
  validateMock.mockReturnValue(true);
  scheduleMock.mockImplementation(() => ({ id: `job_${++jobSeq}` }));
  collapseMock.mockResolvedValue({ status: 'collapse-initiated' });
  allAgents = [];
  subscriber = null;
});

describe('autoCollapseService.initAutoCollapse', () => {
  it('arms a cron job for each agent with auto-collapse enabled and a valid cron', () => {
    allAgents = [makeAgent({ id: 'a1', autoCollapse: true, autoCollapseCron: '0 3 * * *', autoCollapseTz: 'UTC' })];
    autoCollapse.initAutoCollapse();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledWith('0 3 * * *', 'UTC', expect.any(Function));
    expect(autoCollapse.armedCount()).toBe(1);
  });

  it('does not arm when disabled, missing cron, or cron is invalid', () => {
    validateMock.mockImplementation((expr: string) => expr !== 'bogus');
    allAgents = [
      makeAgent({ id: 'off', autoCollapse: false, autoCollapseCron: '0 3 * * *' }),
      makeAgent({ id: 'nocron', autoCollapse: true, autoCollapseCron: '' }),
      makeAgent({ id: 'bad', autoCollapse: true, autoCollapseCron: 'bogus' }),
    ];
    autoCollapse.initAutoCollapse();
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(autoCollapse.armedCount()).toBe(0);
  });
});

describe('autoCollapseService reconcile on agent events', () => {
  it('arms when an update turns auto-collapse on', () => {
    autoCollapse.initAutoCollapse();
    expect(scheduleMock).not.toHaveBeenCalled();

    subscriber?.('updated', makeAgent({ id: 'a1', autoCollapse: true, autoCollapseCron: '0 2 * * *', autoCollapseTz: 'UTC' }));
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(autoCollapse.armedCount()).toBe(1);
  });

  it('does NOT re-arm when an unrelated field changes (config unchanged)', () => {
    autoCollapse.initAutoCollapse();
    const armed = makeAgent({ id: 'a1', autoCollapse: true, autoCollapseCron: '0 2 * * *', autoCollapseTz: 'UTC' });
    subscriber?.('updated', armed);
    expect(scheduleMock).toHaveBeenCalledTimes(1);

    // A high-frequency status update with identical collapse config — must be a no-op.
    subscriber?.('updated', { ...armed, status: 'working', tokensUsed: 999 });
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('re-arms (stop old, schedule new) when the cron expression changes', () => {
    autoCollapse.initAutoCollapse();
    subscriber?.('updated', makeAgent({ id: 'a1', autoCollapse: true, autoCollapseCron: '0 2 * * *', autoCollapseTz: 'UTC' }));
    subscriber?.('updated', makeAgent({ id: 'a1', autoCollapse: true, autoCollapseCron: '0 5 * * *', autoCollapseTz: 'UTC' }));
    expect(scheduleMock).toHaveBeenCalledTimes(2);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenLastCalledWith('0 5 * * *', 'UTC', expect.any(Function));
  });

  it('disarms when auto-collapse is turned off', () => {
    autoCollapse.initAutoCollapse();
    subscriber?.('updated', makeAgent({ id: 'a1', autoCollapse: true, autoCollapseCron: '0 2 * * *', autoCollapseTz: 'UTC' }));
    expect(autoCollapse.armedCount()).toBe(1);

    subscriber?.('updated', makeAgent({ id: 'a1', autoCollapse: false, autoCollapseCron: '0 2 * * *', autoCollapseTz: 'UTC' }));
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(autoCollapse.armedCount()).toBe(0);
  });

  it('stops the job when the agent is deleted', () => {
    autoCollapse.initAutoCollapse();
    subscriber?.('updated', makeAgent({ id: 'a1', autoCollapse: true, autoCollapseCron: '0 2 * * *', autoCollapseTz: 'UTC' }));
    subscriber?.('deleted', 'a1');
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(autoCollapse.armedCount()).toBe(0);
  });

  it('fires collapseAgentContext with waitForIdle when the cron callback runs', async () => {
    autoCollapse.initAutoCollapse();
    subscriber?.('updated', makeAgent({ id: 'a1', autoCollapse: true, autoCollapseCron: '0 2 * * *', autoCollapseTz: 'UTC' }));
    const cronCallback = scheduleMock.mock.calls[0][2] as () => void;
    cronCallback();
    await Promise.resolve();
    expect(collapseMock).toHaveBeenCalledWith('a1', { waitForIdle: true });
  });
});
