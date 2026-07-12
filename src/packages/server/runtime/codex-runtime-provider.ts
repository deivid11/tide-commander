import { CodexRunnerRouter } from './codex-runner-router.js';
import type { RuntimeProvider, RuntimeRunner, RuntimeRunnerCallbacks } from './types.js';

class CodexRuntimeProvider implements RuntimeProvider {
  readonly name = 'codex';

  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner {
    // The router picks per-launch between the default `codex exec` runner and
    // the experimental persistent `codex app-server` runner (streaming), driven
    // by the live isCodexAppServerModeEnabled() setting.
    return new CodexRunnerRouter(callbacks);
  }
}

export function createCodexRuntimeProvider(): RuntimeProvider {
  return new CodexRuntimeProvider();
}
