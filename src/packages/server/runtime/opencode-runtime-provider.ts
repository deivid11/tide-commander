import { ClaudeRunner } from '../claude/runner.js';
import { OpencodeBackend } from '../opencode/backend.js';
import type { RuntimeProvider, RuntimeRunner, RuntimeRunnerCallbacks } from './types.js';

class OpencodeRuntimeProvider implements RuntimeProvider {
  readonly name = 'opencode';

  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner {
    return new ClaudeRunner(callbacks, new OpencodeBackend());
  }
}

export function createOpencodeRuntimeProvider(): RuntimeProvider {
  return new OpencodeRuntimeProvider();
}
