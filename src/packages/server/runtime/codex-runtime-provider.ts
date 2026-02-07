import { ClaudeRunner } from '../claude/runner.js';
import { CodexBackend } from '../codex/backend.js';
import type { RuntimeProvider, RuntimeRunner, RuntimeRunnerCallbacks } from './types.js';

class CodexRuntimeProvider implements RuntimeProvider {
  readonly name = 'codex';

  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner {
    return new ClaudeRunner(callbacks, new CodexBackend());
  }
}

export function createCodexRuntimeProvider(): RuntimeProvider {
  return new CodexRuntimeProvider();
}
