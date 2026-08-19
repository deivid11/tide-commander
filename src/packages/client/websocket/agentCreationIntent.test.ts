import { beforeEach, describe, expect, it } from 'vitest';
import type { Agent, ClientMessage } from '../../shared/types';
import {
  clearLocalAgentCreationIntents,
  consumeLocalAgentCreationIntent,
  recordLocalAgentCreationIntent,
} from './agentCreationIntent';

const now = 1_800_000_000_000;
const localMessage = {
  type: 'spawn_agent',
  payload: { name: 'Local Agent', class: 'scout', cwd: '/work/local' },
} as ClientMessage;
const localAgent = {
  id: 'local-id',
  name: 'Local Agent',
  class: 'scout',
  cwd: '/work/local',
} as Agent;

beforeEach(clearLocalAgentCreationIntents);

describe('agent creation intent', () => {
  it('consumes a matching creation requested by this tab', () => {
    recordLocalAgentCreationIntent(localMessage, now);
    expect(consumeLocalAgentCreationIntent(localAgent, now + 100)).toBe(true);
    expect(consumeLocalAgentCreationIntent(localAgent, now + 101)).toBe(false);
  });

  it('does not mistake another tab creation for the local request', () => {
    recordLocalAgentCreationIntent(localMessage, now);
    const remoteAgent = { ...localAgent, id: 'remote-id', name: 'Remote Agent' };
    expect(consumeLocalAgentCreationIntent(remoteAgent, now + 100)).toBe(false);
    expect(consumeLocalAgentCreationIntent(localAgent, now + 200)).toBe(true);
  });

  it('expires abandoned requests', () => {
    recordLocalAgentCreationIntent(localMessage, now);
    expect(consumeLocalAgentCreationIntent(localAgent, now + 30_001)).toBe(false);
  });

  it('ignores ordinary websocket messages', () => {
    recordLocalAgentCreationIntent({
      type: 'send_command',
      payload: { agentId: 'local-id', command: 'hello' },
    }, now);
    expect(consumeLocalAgentCreationIntent(localAgent, now + 100)).toBe(false);
  });
});
