import { registerBolbaTasksPlugin } from './bolba-tasks';
import { registerGmailPendingPlugin } from './gmail';
import { registerJiraTicketsPlugin } from './jira';
import { registerTideUsagesPlugin } from './tide-usages';
import { initializePluginRuntime } from './registry';

/** Register bundled contributions synchronously, then discover installed plugins. */
export function initializePlugins(): void {
  registerBolbaTasksPlugin();
  registerGmailPendingPlugin();
  registerJiraTicketsPlugin();
  registerTideUsagesPlugin();
  initializePluginRuntime();
}

export * from './types';
export * from './registry';
