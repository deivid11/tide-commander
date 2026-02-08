import { describe, expect, it, vi } from 'vitest';
import { RunnerInternalEventBus } from './internal-events.js';

describe('RunnerInternalEventBus', () => {
  it('dispatches typed events and supports unsubscribe', () => {
    const bus = new RunnerInternalEventBus();
    const activityHandler = vi.fn();

    const unsubscribe = bus.on('runner.activity', activityHandler);

    bus.emit({
      type: 'runner.activity',
      agentId: 'agent-1',
      timestamp: 123,
    });

    expect(activityHandler).toHaveBeenCalledTimes(1);
    expect(activityHandler).toHaveBeenCalledWith({
      type: 'runner.activity',
      agentId: 'agent-1',
      timestamp: 123,
    });

    unsubscribe();
    bus.emit({
      type: 'runner.activity',
      agentId: 'agent-1',
      timestamp: 456,
    });

    expect(activityHandler).toHaveBeenCalledTimes(1);
  });
});
