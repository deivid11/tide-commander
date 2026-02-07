import { ClaudeRunner } from '../claude/runner.js';
import type { RuntimeProvider, RuntimeRunner, RuntimeRunnerCallbacks } from './types.js';

class ClaudeRuntimeProvider implements RuntimeProvider {
  readonly name = 'claude';

  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner {
    return new ClaudeRunner(callbacks);
  }
}

export function createClaudeRuntimeProvider(): RuntimeProvider {
  return new ClaudeRuntimeProvider();
}

