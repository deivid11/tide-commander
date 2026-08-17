import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

describe('offline send-command queue', () => {
  const storage = new MemoryStorage();
  let sendMessage: typeof import('./send.js').sendMessage;
  let getPendingMessagesForAgent: typeof import('./send.js').getPendingMessagesForAgent;

  beforeAll(async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    ({ sendMessage, getPendingMessagesForAgent } = await import('./send.js'));
  });

  beforeEach(() => {
    storage.clear();
    (window as unknown as { __tideWsState: { ws: null } }).__tideWsState.ws = null;
  });

  it('coalesces disconnected messages for the same agent', () => {
    sendMessage({ type: 'send_command', payload: { agentId: 'agent-a', command: 'first' } });
    sendMessage({ type: 'send_command', payload: { agentId: 'agent-a', command: 'second' } });
    sendMessage({ type: 'send_command', payload: { agentId: 'agent-a', command: 'third' } });

    expect(getPendingMessagesForAgent('agent-a').map((entry) => entry.command)).toEqual([
      'first\n\nsecond\n\nthird',
    ]);
  });

  it('keeps separate combined entries for different agents', () => {
    sendMessage({ type: 'send_command', payload: { agentId: 'agent-a', command: 'a1' } });
    sendMessage({ type: 'send_command', payload: { agentId: 'agent-b', command: 'b1' } });
    sendMessage({ type: 'send_command', payload: { agentId: 'agent-a', command: 'a2' } });

    expect(getPendingMessagesForAgent('agent-a').map((entry) => entry.command)).toEqual(['a1\n\na2']);
    expect(getPendingMessagesForAgent('agent-b').map((entry) => entry.command)).toEqual(['b1']);
  });
});
