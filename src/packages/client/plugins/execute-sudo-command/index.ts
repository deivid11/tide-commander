import {
  registerBuiltinPlugin,
  registerPluginOutputRenderer,
  registerPluginSlashCommand,
} from '../registry';
import { ExecuteSudoCommandStatusCard } from './ExecuteSudoCommandStatusCard';

export const EXECUTE_SUDO_COMMAND_PLUGIN_ID = 'execute-sudo-command';
let registered = false;

export function registerExecuteSudoCommandPlugin(): void {
  if (registered) return;
  registered = true;
  registerBuiltinPlugin(EXECUTE_SUDO_COMMAND_PLUGIN_ID);
  registerPluginSlashCommand({
    pluginId: EXECUTE_SUDO_COMMAND_PLUGIN_ID,
    pluginName: 'Execute Sudo Command',
    name: '/execute-sudo-command',
    summary: 'Solicita autorización para ejecutar un comando con sudo',
    handler: 'execute',
    requiresAgent: true,
  });
  registerPluginOutputRenderer({
    pluginId: EXECUTE_SUDO_COMMAND_PLUGIN_ID,
    id: 'sudo-command-requested',
    component: ExecuteSudoCommandStatusCard,
  });
}
