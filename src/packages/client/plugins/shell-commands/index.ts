import { apiUrl, authFetch } from '../../utils/storage';
import {
  registerBuiltinPlugin,
  registerPluginOutputRenderer,
  registerPluginSlashCommand,
} from '../registry';
import type { PluginShellCommandDefinition } from '../types';
import { ShellCommandExecCard } from './ShellCommandExecCard';
import { ShellCommandSudoRequestCard } from './ShellCommandSudoRequestCard';
import { SHELL_COMMAND_PLUGIN_ID } from './execution';

const commandCleanups = new Map<string, () => void>();
let initialized = false;

export async function refreshShellSlashCommands(): Promise<PluginShellCommandDefinition[]> {
  const response = await authFetch(apiUrl('/api/plugins/shell-commands'));
  const body = await response.json().catch(() => null) as { commands?: PluginShellCommandDefinition[] } | null;
  if (!response.ok || !Array.isArray(body?.commands)) {
    throw new Error(`Failed to load command scripts (${response.status})`);
  }

  for (const cleanup of commandCleanups.values()) cleanup();
  commandCleanups.clear();
  for (const command of body.commands) {
    if (!command.enabled) continue;
    commandCleanups.set(command.id, registerPluginSlashCommand({
      pluginId: SHELL_COMMAND_PLUGIN_ID,
      pluginName: 'Command Scripts',
      name: command.name,
      summary: command.summary,
      handler: command.id,
    }));
  }
  return body.commands;
}

export function registerShellCommandsPlugin(): void {
  if (initialized) return;
  initialized = true;
  registerBuiltinPlugin(SHELL_COMMAND_PLUGIN_ID);
  registerPluginOutputRenderer({
    pluginId: SHELL_COMMAND_PLUGIN_ID,
    id: 'shell-command-exec',
    component: ShellCommandExecCard,
  });
  registerPluginOutputRenderer({
    pluginId: SHELL_COMMAND_PLUGIN_ID,
    id: 'shell-command-sudo-request',
    component: ShellCommandSudoRequestCard,
  });
  void refreshShellSlashCommands().catch((error) => {
    console.warn('[Command Scripts] Unable to load managed slash commands:', error);
  });
}

export { ShellCommandExecutionHost } from './ShellCommandExecutionHost';
export {
  executeShellSlashCommand,
  findShellSlashCommand,
  SHELL_COMMAND_PLUGIN_ID,
} from './execution';
