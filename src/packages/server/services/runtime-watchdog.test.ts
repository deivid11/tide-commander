import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingSilentContextRefresh,
  consumeStepCompleteReceived,
  hasPendingSilentContextRefresh,
  markPendingSilentContextRefresh,
  markStepCompleteReceived,
  resetWatchdogStateForTests,
} from './runtime-watchdog.js';

describe('runtime-watchdog state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWatchdogStateForTests();
  });

  it('tracks and clears pending silent context refresh', () => {
    markPendingSilentContextRefresh('agent-1');
    expect(hasPendingSilentContextRefresh('agent-1')).toBe(true);

    clearPendingSilentContextRefresh('agent-1');
    expect(hasPendingSilentContextRefresh('agent-1')).toBe(false);
  });

  it('consumes step_complete marker exactly once', () => {
    markStepCompleteReceived('agent-2');

    expect(consumeStepCompleteReceived('agent-2')).toBe(true);
    expect(consumeStepCompleteReceived('agent-2')).toBe(false);
  });
});

