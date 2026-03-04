import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBossDelegation, resetBossDelegationStateForTests } from './boss-response-handler.js';

vi.mock('../../services/index.js', () => ({
  agentService: {
    getAgent: vi.fn(),
  },
  runtimeService: {
    sendCommand: vi.fn(() => Promise.resolve()),
  },
  bossService: {
    addDelegationToHistory: vi.fn(),
  },
  workPlanService: {
    parseWorkPlanBlock: vi.fn(),
    createWorkPlan: vi.fn(),
    parseAnalysisRequestBlock: vi.fn(() => []),
    createAnalysisRequest: vi.fn(),
    startAnalysisRequest: vi.fn(),
  },
}));

vi.mock('../../utils/index.js', () => ({
  logger: {
    ws: {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

vi.mock('./command-handler.js', () => ({
  getLastBossCommand: vi.fn(),
  buildCustomAgentConfig: vi.fn(() => undefined),
}));

import { agentService, runtimeService, bossService } from '../../services/index.js';
import { getLastBossCommand } from './command-handler.js';

describe('boss-response-handler parseBossDelegation', () => {
  const broadcast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetBossDelegationStateForTests();
    vi.mocked(agentService.getAgent).mockReturnValue(undefined as any);
    vi.mocked(getLastBossCommand).mockReturnValue('fallback delegated task');
  });

  it('parses multiple delegation blocks with mixed prose and dispatches all valid items', async () => {
    const resultText = `I will delegate this in parts.

\`\`\`delegation
I picked this owner:
[{"selectedAgentId":"agent-1","selectedAgentName":"Scout One","taskCommand":"Investigate token race around \\\"refresh\\\" flow","reasoning":"context owner","confidence":"high"}]
extra prose that should be ignored
\`\`\`

More notes between blocks.

\`\`\`delegation
[
  {"selectedAgentId":"agent-2","selectedAgentName":"Builder Two","taskCommand":"Implement fix in websocket handler","reasoning":"builder","confidence":"medium"},
  {"selectedAgentId":"agent-3","selectedAgentName":"Support Three","taskCommand":"Add tests for malformed delegation payloads","reasoning":"testing","confidence":"low"}
]
\`\`\``;

    parseBossDelegation('boss-1', 'Boss', resultText, broadcast);
    await Promise.resolve();

    expect(runtimeService.sendCommand).toHaveBeenCalledTimes(3);
    expect(runtimeService.sendCommand).toHaveBeenNthCalledWith(1, 'agent-1', expect.stringContaining('Investigate token race around "refresh" flow'), undefined, undefined, undefined);
    expect(runtimeService.sendCommand).toHaveBeenNthCalledWith(2, 'agent-2', expect.stringContaining('Implement fix in websocket handler'), undefined, undefined, undefined);
    expect(runtimeService.sendCommand).toHaveBeenNthCalledWith(3, 'agent-3', expect.stringContaining('Add tests for malformed delegation payloads'), undefined, undefined, undefined);
    expect(bossService.addDelegationToHistory).toHaveBeenCalledTimes(3);
  });

  it('parses single-object delegation payload and wraps it as one item', async () => {
    const resultText = `\`\`\`delegation
{"selectedAgentId":"agent-1","selectedAgentName":"Scout One","reasoning":"single payload","confidence":"high"}
\`\`\``;

    parseBossDelegation('boss-1', 'Boss', resultText, broadcast);
    await Promise.resolve();

    expect(runtimeService.sendCommand).toHaveBeenCalledTimes(1);
    expect(runtimeService.sendCommand).toHaveBeenCalledWith('agent-1', expect.stringContaining('fallback delegated task'), undefined, undefined, undefined);
  });

  it('skips invalid delegation items and emits clear error output', async () => {
    const resultText = `\`\`\`delegation
[
  {"selectedAgentId":"agent-1","selectedAgentName":"Scout One","taskCommand":"valid","confidence":"high"},
  {"selectedAgentId":"agent-2","selectedAgentName":"Scout Two","taskCommand":"invalid confidence","confidence":"certain"},
  {"selectedAgentName":"Scout Three","taskCommand":"missing id","confidence":"low"}
]
\`\`\``;

    parseBossDelegation('boss-1', 'Boss', resultText, broadcast);
    await Promise.resolve();

    expect(runtimeService.sendCommand).toHaveBeenCalledTimes(1);
    expect(runtimeService.sendCommand).toHaveBeenCalledWith('agent-1', expect.stringContaining('valid'), undefined, undefined, undefined);

    const errorOutputs = broadcast.mock.calls
      .map((call) => call[0])
      .filter((msg) => msg?.type === 'output' && typeof msg?.payload?.text === 'string' && msg.payload.text.includes('Delegation parse error'));
    expect(errorOutputs.length).toBe(2);
  });

  it('emits parse error and dispatches nothing when no JSON can be recovered', async () => {
    const resultText = `\`\`\`delegation
This is not JSON and has no parseable payload.
\`\`\``;

    parseBossDelegation('boss-1', 'Boss', resultText, broadcast);
    await Promise.resolve();

    expect(runtimeService.sendCommand).not.toHaveBeenCalled();
    const errorOutputs = broadcast.mock.calls
      .map((call) => call[0])
      .filter((msg) => msg?.type === 'output' && typeof msg?.payload?.text === 'string' && msg.payload.text.includes('Delegation parse error'));
    expect(errorOutputs.length).toBeGreaterThan(0);
  });
});
