import { describe, expect, it } from 'vitest';
import type { Agent } from '../../shared/types';
import { buildOpencodeUsageSnapshot } from './opencode-usage-service';

function agent(model: string): Agent {
  return {
    id: 'w7ixavap',
    name: 'Wooper Juanito',
    class: 'wooper',
    provider: 'opencode',
    opencodeModel: model,
    status: 'idle',
    position: { x: 0, y: 0, z: 0 },
    cwd: '/repo',
    permissionMode: 'bypass',
    useChrome: false,
    tokensUsed: 382,
    contextUsed: 12_003,
    contextLimit: 200_000,
    taskCount: 1,
    createdAt: 0,
    lastActivity: 0,
  } as Agent;
}

describe('buildOpencodeUsageSnapshot', () => {
  it('marks built-in OpenCode models as dynamic free capacity', async () => {
    const snapshot = await buildOpencodeUsageSnapshot(
      agent('opencode/muse-spark-1.2-contributor-free'),
    );

    expect(snapshot).toMatchObject({
      provider: 'opencode',
      modelProvider: 'opencode',
      plan: 'free',
      quotaWindows: [],
      rateLimitsError: null,
      session: {
        contextUsed: 12_003,
        contextLimit: 200_000,
      },
    });
    expect(snapshot.cliHint).toContain('dynamic');
  });

  it('does not label unknown underlying providers as free', async () => {
    const snapshot = await buildOpencodeUsageSnapshot(agent('anthropic/claude-sonnet-4-5'));
    expect(snapshot.plan).toBe('unavailable');
    expect(snapshot.modelProvider).toBe('anthropic');
  });
});
