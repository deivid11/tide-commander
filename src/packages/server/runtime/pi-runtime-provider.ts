import { PiRunnerRouter } from './pi-runner-router.js';
import type { RuntimeProvider, RuntimeRunner, RuntimeRunnerCallbacks } from './types.js';

class PiRuntimeProvider implements RuntimeProvider {
  readonly name = 'pi';

  createRunner(callbacks: RuntimeRunnerCallbacks): RuntimeRunner {
    // Router picks single-shot (`pi --mode json -p`) vs persistent RPC
    // (`pi --mode rpc`, mid-turn steering) per launch from the live setting.
    return new PiRunnerRouter(callbacks);
  }
}

export function createPiRuntimeProvider(): RuntimeProvider {
  return new PiRuntimeProvider();
}
