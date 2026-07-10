import { ClaudeRunner } from '../claude/runner.js';
import { GrokBackend } from '../grok/backend.js';
import type { RuntimeProvider, RuntimeRunner, RuntimeRunnerCallbacks } from './types.js';

class GrokRuntimeProvider implements RuntimeProvider {
  readonly name = 'grok';

  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner {
    return new ClaudeRunner(callbacks, new GrokBackend());
  }
}

export function createGrokRuntimeProvider(): RuntimeProvider {
  return new GrokRuntimeProvider();
}
