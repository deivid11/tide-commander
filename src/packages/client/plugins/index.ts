import { registerBolbaTasksPlugin } from './bolba-tasks';
import { initializePluginRuntime } from './registry';

/** Register bundled contributions synchronously, then discover installed plugins. */
export function initializePlugins(): void {
  registerBolbaTasksPlugin();
  initializePluginRuntime();
}

export * from './types';
export * from './registry';
