import { OpencodeRunnerRouter } from './opencode-runner-router.js';
import type { RuntimeProvider, RuntimeRunner, RuntimeRunnerCallbacks } from './types.js';

class OpencodeRuntimeProvider implements RuntimeProvider {
  readonly name = 'opencode';

  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner {
    // The router picks per-launch between the default `opencode run` runner and
    // the experimental persistent `opencode serve` runner (streaming), driven by
    // the live isOpencodeServerModeEnabled() setting.
    return new OpencodeRunnerRouter(callbacks);
  }
}

export function createOpencodeRuntimeProvider(): RuntimeProvider {
  return new OpencodeRuntimeProvider();
}
