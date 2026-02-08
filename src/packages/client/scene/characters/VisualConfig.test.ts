import { describe, it, expect } from 'vitest';
import { getContextRemainingPercent } from './VisualConfig';
import type { Agent } from '../../../shared/types';

function createMockAgent(overrides: Partial<any> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    class: 'scout',
    status: 'idle',
    provider: 'claude',
    position: { x: 0, y: 0, z: 0 },
    tokensUsed: 0,
    contextUsed: 0,
    contextLimit: 200000,
    taskCount: 0,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    cwd: '/tmp',
    permissionMode: 'bypass',
    ...overrides,
  } as Agent;
}

describe('getContextRemainingPercent', () => {
  it('returns 100% when no context used', () => {
    const agent = createMockAgent({ contextUsed: 0, contextLimit: 200000 });
    expect(getContextRemainingPercent(agent)).toBe(100);
  });

  it('returns 50% when half context used', () => {
    const agent = createMockAgent({ contextUsed: 100000, contextLimit: 200000 });
    expect(getContextRemainingPercent(agent)).toBe(50);
  });

  it('returns 0% when all context used', () => {
    const agent = createMockAgent({ contextUsed: 200000, contextLimit: 200000 });
    expect(getContextRemainingPercent(agent)).toBe(0);
  });

  it('clamps to 0% when context exceeds limit', () => {
    const agent = createMockAgent({ contextUsed: 250000, contextLimit: 200000 });
    expect(getContextRemainingPercent(agent)).toBe(0);
  });

  it('uses contextStats when available', () => {
    const agent = createMockAgent({
      contextUsed: 50000,
      contextLimit: 200000,
      contextStats: { usedPercent: 75 },
    });
    // Should use contextStats (100 - 75 = 25), not basic calc (75%)
    expect(getContextRemainingPercent(agent)).toBe(25);
  });

  it('falls back to basic calc without contextStats', () => {
    const agent = createMockAgent({
      contextUsed: 150000,
      contextLimit: 200000,
      contextStats: undefined,
    });
    expect(getContextRemainingPercent(agent)).toBe(25);
  });

  it('defaults to 200000 context limit when limit is 0', () => {
    const agent = createMockAgent({ contextUsed: 100000, contextLimit: 0 });
    // contextLimit || 200000 = 200000 when contextLimit is 0
    expect(getContextRemainingPercent(agent)).toBe(50);
  });

  it('handles zero contextUsed gracefully', () => {
    const agent = createMockAgent({ contextUsed: 0, contextLimit: 0 });
    // contextUsed || 0 = 0, contextLimit || 200000 = 200000
    expect(getContextRemainingPercent(agent)).toBe(100);
  });
});
