import { registerBolbaTasksPlugin } from './bolba-tasks';
import { registerGmailPendingPlugin } from './gmail';
import { registerJiraTicketsPlugin } from './jira';
import { registerRenameAgentPlugin } from './rename-agent';
import { registerShellCommandsPlugin } from './shell-commands';
import { registerTideUsagesPlugin } from './tide-usages';
import { initializePluginRuntime } from './registry';

/** Register bundled contributions synchronously, then discover installed plugins. */
export function initializePlugins(): void {
  registerBolbaTasksPlugin();
  registerGmailPendingPlugin();
  registerJiraTicketsPlugin();
  registerRenameAgentPlugin();
  registerShellCommandsPlugin();
  registerTideUsagesPlugin();
  initializePluginRuntime();
}

export * from './types';
export * from './registry';
