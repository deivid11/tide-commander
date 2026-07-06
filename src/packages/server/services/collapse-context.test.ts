import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCollapseContextService, type CollapseAgentSnapshot } from './collapse-context.js';

// Fake agent registry + event bus. Lets each test stage the agent's status and
// fire `updated` events at will, without pulling in the real agentService.

interface FakeBus {
  agents: Map<string, CollapseAgentSnapshot>;
  listeners: Set<(event: string, data: CollapseAgentSnapshot | string | undefined) => void>;
  emitUpdated: (snapshot: CollapseAgentSnapshot) => void;
}

function makeBus(): FakeBus {
  const agents = new Map<string, CollapseAgentSnapshot>();
  const listeners = new Set<(event: string, data: CollapseAgentSnapshot | string | undefined) => void>();
  return {
    agents,
    listeners,
    emitUpdated(snapshot) {
      agents.set(snapshot.id, snapshot); // mirror real semantics
      for (const l of listeners) l('updated', snapshot);
    },
  };
}

let bus: FakeBus;
type SendCommandFn = (agentId: string, command: string) => Promise<void>;
let sendCommand: ReturnType<typeof vi.fn<SendCommandFn>>;

function makeService(opts: { sendCommandFails?: boolean } = {}) {
  sendCommand = vi.fn<SendCommandFn>(async () => {
    if (opts.sendCommandFails) throw new Error('boom');
  });
  return createCollapseContextService({
    getAgent: (id) => bus.agents.get(id),
    sendCommand,
    subscribe: (l) => {
      bus.listeners.add(l);
      return () => { bus.listeners.delete(l); };
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

beforeEach(() => {
  bus = makeBus();
});

describe('collapseAgentContext — synchronous paths', () => {
  it('returns not-found when the agent does not exist', async () => {
    const svc = makeService();
    const result = await svc.collapse('missing');
    expect(result).toEqual({ status: 'not-found' });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('fires /compact immediately when the agent is idle', async () => {
    bus.agents.set('A', { id: 'A', status: 'idle' });
    const svc = makeService();

    const result = await svc.collapse('A');

    expect(result).toEqual({ status: 'collapse-initiated' });
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('A', '/compact');
  });

  it('returns busy when the agent is working and waitForIdle is not set', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    const svc = makeService();

    const result = await svc.collapse('A');

    expect(result).toEqual({ status: 'busy', currentStatus: 'working' });
    expect(sendCommand).not.toHaveBeenCalled();
    expect(svc.hasPending('A')).toBe(false);
  });

  it('surfaces a sendCommand failure as status: error (no queue side effect)', async () => {
    bus.agents.set('A', { id: 'A', status: 'idle' });
    const svc = makeService({ sendCommandFails: true });

    const result = await svc.collapse('A');

    expect(result).toEqual({ status: 'error', error: 'boom' });
    expect(svc.hasPending('A')).toBe(false);
  });
});

describe('collapseAgentContext — waitForIdle queue', () => {
  it('queues the collapse when busy + waitForIdle: true', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    const svc = makeService();

    const result = await svc.collapse('A', { waitForIdle: true });

    expect(result).toEqual({ status: 'queued' });
    expect(sendCommand).not.toHaveBeenCalled();
    expect(svc.hasPending('A')).toBe(true);
    expect(svc.pendingCount()).toBe(1);
  });

  it('drains the queue on the first idle transition for the queued agent', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    const svc = makeService();

    await svc.collapse('A', { waitForIdle: true });
    expect(svc.hasPending('A')).toBe(true);

    // Agent transitions to idle — listener fires drain.
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledExactlyOnceWith('A', '/compact'));

    expect(svc.hasPending('A')).toBe(false);
    expect(svc.pendingCount()).toBe(0);
  });

  it('does NOT drain when a different agent goes idle', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    bus.agents.set('B', { id: 'B', status: 'idle' });
    const svc = makeService();

    await svc.collapse('A', { waitForIdle: true });
    bus.emitUpdated({ id: 'B', status: 'idle' });

    expect(sendCommand).not.toHaveBeenCalled();
    expect(svc.hasPending('A')).toBe(true);
  });

  it('does NOT drain on non-idle status transitions of the queued agent', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    const svc = makeService();

    await svc.collapse('A', { waitForIdle: true });

    // Status flips between non-idle values — should NOT drain.
    bus.emitUpdated({ id: 'A', status: 'waiting' });
    bus.emitUpdated({ id: 'A', status: 'waiting_permission' });
    bus.emitUpdated({ id: 'A', status: 'working' });
    expect(sendCommand).not.toHaveBeenCalled();
    expect(svc.hasPending('A')).toBe(true);

    // Then idle → drain.
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
  });

  it('coalesces multiple waitForIdle calls into a single drained /compact', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    const svc = makeService();

    await svc.collapse('A', { waitForIdle: true });
    await svc.collapse('A', { waitForIdle: true });
    await svc.collapse('A', { waitForIdle: true });
    expect(svc.pendingCount()).toBe(1);

    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    expect(svc.hasPending('A')).toBe(false);
  });

  it('drains independently per-agent', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    bus.agents.set('B', { id: 'B', status: 'working' });
    const svc = makeService();

    await svc.collapse('A', { waitForIdle: true });
    await svc.collapse('B', { waitForIdle: true });
    expect(svc.pendingCount()).toBe(2);

    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    expect(svc.hasPending('A')).toBe(false);
    expect(svc.hasPending('B')).toBe(true);

    bus.emitUpdated({ id: 'B', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
    expect(svc.hasPending('B')).toBe(false);
  });

  it('idle target + waitForIdle: true still fires immediately (no spurious queue)', async () => {
    bus.agents.set('A', { id: 'A', status: 'idle' });
    const svc = makeService();

    const result = await svc.collapse('A', { waitForIdle: true });

    expect(result).toEqual({ status: 'collapse-initiated' });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(svc.hasPending('A')).toBe(false);
  });

  it('not-found + waitForIdle: true returns not-found (no queue side effect)', async () => {
    const svc = makeService();

    const result = await svc.collapse('missing', { waitForIdle: true });

    expect(result).toEqual({ status: 'not-found' });
    expect(svc.hasPending('missing')).toBe(false);
  });

  it('drain swallows sendCommand errors without rethrowing or leaking pending state', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    const svc = makeService({ sendCommandFails: true });

    await svc.collapse('A', { waitForIdle: true });
    bus.emitUpdated({ id: 'A', status: 'idle' });

    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    // Pending was cleared on dispatch attempt — we don't retry forever on failure.
    expect(svc.hasPending('A')).toBe(false);
  });
});

describe('collapseAgentContext — afterPrompt', () => {
  it('idle path: sends /compact, then the prompt on the next idle transition', async () => {
    bus.agents.set('A', { id: 'A', status: 'idle' });
    const svc = makeService();

    const result = await svc.collapse('A', { afterPrompt: 'resume monitoring' });

    expect(result).toEqual({ status: 'collapse-initiated' });
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('A', '/compact');
    expect(svc.hasPendingPrompt('A')).toBe(true);

    // Compact turn runs and finishes — prompt fires on the idle transition.
    bus.emitUpdated({ id: 'A', status: 'working' });
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
    expect(sendCommand).toHaveBeenLastCalledWith('A', 'resume monitoring');
    expect(svc.hasPendingPrompt('A')).toBe(false);
  });

  it('queued path: /compact drains on first idle, prompt fires on the following idle', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    const svc = makeService();

    const result = await svc.collapse('A', { waitForIdle: true, afterPrompt: 'resume monitoring' });
    expect(result).toEqual({ status: 'queued' });
    expect(svc.hasPendingPrompt('A')).toBe(false);

    // First idle → queued /compact drains and arms the prompt.
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledExactlyOnceWith('A', '/compact'));
    expect(svc.hasPending('A')).toBe(false);
    expect(svc.hasPendingPrompt('A')).toBe(true);

    // Compact turn finishes → prompt fires.
    bus.emitUpdated({ id: 'A', status: 'working' });
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
    expect(sendCommand).toHaveBeenLastCalledWith('A', 'resume monitoring');
  });

  it('prompt is single-shot: later idle transitions do not resend it', async () => {
    bus.agents.set('A', { id: 'A', status: 'idle' });
    const svc = makeService();

    await svc.collapse('A', { afterPrompt: 'once only' });
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));

    bus.emitUpdated({ id: 'A', status: 'working' });
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await new Promise((r) => setTimeout(r, 10));
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it('blank/whitespace afterPrompt is ignored', async () => {
    bus.agents.set('A', { id: 'A', status: 'idle' });
    const svc = makeService();

    await svc.collapse('A', { afterPrompt: '   ' });

    expect(svc.hasPendingPrompt('A')).toBe(false);
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await new Promise((r) => setTimeout(r, 10));
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('A', '/compact');
  });

  it('does not arm the prompt when the /compact send fails', async () => {
    bus.agents.set('A', { id: 'A', status: 'idle' });
    const svc = makeService({ sendCommandFails: true });

    const result = await svc.collapse('A', { afterPrompt: 'never sent' });

    expect(result).toEqual({ status: 'error', error: 'boom' });
    expect(svc.hasPendingPrompt('A')).toBe(false);
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await new Promise((r) => setTimeout(r, 10));
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it('coalesced waitForIdle calls keep the latest afterPrompt', async () => {
    bus.agents.set('A', { id: 'A', status: 'working' });
    const svc = makeService();

    await svc.collapse('A', { waitForIdle: true, afterPrompt: 'first' });
    await svc.collapse('A', { waitForIdle: true, afterPrompt: 'second' });
    expect(svc.pendingCount()).toBe(1);

    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledExactlyOnceWith('A', '/compact'));
    bus.emitUpdated({ id: 'A', status: 'working' });
    bus.emitUpdated({ id: 'A', status: 'idle' });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
    expect(sendCommand).toHaveBeenLastCalledWith('A', 'second');
  });

  it('deleting the agent clears both queued collapse and armed prompt', async () => {
    bus.agents.set('A', { id: 'A', status: 'idle' });
    const svc = makeService();

    await svc.collapse('A', { afterPrompt: 'orphaned' });
    expect(svc.hasPendingPrompt('A')).toBe(true);

    for (const l of bus.listeners) l('deleted', 'A');
    expect(svc.hasPendingPrompt('A')).toBe(false);

    bus.emitUpdated({ id: 'A', status: 'idle' });
    await new Promise((r) => setTimeout(r, 10));
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('A', '/compact');
  });
});
