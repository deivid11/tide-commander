import type { ServerMessage } from '../../shared/types.js';
import { bolbaTasksPlugin } from './builtin/bolba-tasks.js';
import { gmailPendingPlugin } from './builtin/gmail-pending.js';
import { jiraTicketsPlugin } from './builtin/jira-tickets.js';
import { tideUsagesPlugin } from './builtin/tide-usages.js';
import { PluginManager } from './manager.js';

export { PluginManager, PluginRuntimeError } from './manager.js';
export type { BuiltinPluginDefinition, MatchedPluginCommand, PluginManagerOptions } from './manager.js';

export const pluginManager = new PluginManager({
  builtins: [bolbaTasksPlugin, gmailPendingPlugin, jiraTicketsPlugin, tideUsagesPlugin],
});

export async function initPlugins(broadcast: (message: ServerMessage) => void): Promise<void> {
  pluginManager.setBroadcast(broadcast);
  await pluginManager.initialize();
}

export async function shutdownPlugins(): Promise<void> {
  await pluginManager.shutdown();
}
