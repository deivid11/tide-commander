import type { ServerMessage } from '../../shared/types.js';
import { bolbaTasksPlugin } from './builtin/bolba-tasks.js';
import { gmailPendingPlugin } from './builtin/gmail-pending.js';
import { jiraTicketsPlugin } from './builtin/jira-tickets.js';
import { shellCommandsPlugin } from './builtin/shell-commands.js';
import { tideUsagesPlugin } from './builtin/tide-usages.js';
import { PluginManager } from './manager.js';
import { pluginShellCommandService } from '../services/plugin-shell-command-service.js';

export { PluginManager, PluginRuntimeError } from './manager.js';
export type { BuiltinPluginDefinition, MatchedPluginCommand, PluginManagerOptions } from './manager.js';

export const pluginManager = new PluginManager({
  builtins: [bolbaTasksPlugin, gmailPendingPlugin, jiraTicketsPlugin, shellCommandsPlugin, tideUsagesPlugin],
});

export async function initPlugins(broadcast: (message: ServerMessage) => void): Promise<void> {
  pluginManager.setBroadcast(broadcast);
  const managedCommands = await pluginShellCommandService.list();
  pluginManager.setExternalSlashCommands(
    'shell-commands',
    managedCommands.filter((command) => command.enabled).map((command) => command.name),
  );
  await pluginManager.initialize();
}

export async function shutdownPlugins(): Promise<void> {
  await pluginManager.shutdown();
}
