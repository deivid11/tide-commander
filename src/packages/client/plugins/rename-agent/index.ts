import {
  registerBuiltinPlugin,
  registerPluginOutputRenderer,
  registerPluginSlashCommand,
} from '../registry';
import { RenameAgentCard } from './RenameAgentCard';

const PLUGIN_ID = 'rename-agent';
let registered = false;

export function registerRenameAgentPlugin(): void {
  if (registered) return;
  registered = true;
  registerBuiltinPlugin(PLUGIN_ID);
  registerPluginSlashCommand({
    pluginId: PLUGIN_ID,
    pluginName: 'Rename Agent',
    name: '/rename-agent',
    summary: 'Pide al agente tres nombres contextuales y deja que el usuario elija',
    handler: 'propose',
    renderer: 'agent-name-proposals',
    requiresAgent: true,
  });
  registerPluginOutputRenderer({
    pluginId: PLUGIN_ID,
    id: 'agent-name-proposals',
    component: RenameAgentCard,
  });
}
