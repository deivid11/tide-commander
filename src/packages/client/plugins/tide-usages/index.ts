import {
  registerBuiltinPlugin,
  registerPluginOutputRenderer,
  registerPluginSlashCommand,
} from '../registry';
import { TideUsagesCard } from './TideUsagesCard';

const PLUGIN_ID = 'tide-commander';
let registered = false;

/** Register Tide Commander's built-in runtime utility commands. */
export function registerTideUsagesPlugin(): void {
  if (registered) return;
  registered = true;
  registerBuiltinPlugin(PLUGIN_ID);
  registerPluginSlashCommand({
    pluginId: PLUGIN_ID,
    pluginName: 'Tide Commander',
    name: '/usages',
    summary: 'Muestra los límites diarios y semanales de todos los proveedores LLM registrados',
    handler: 'usages',
    renderer: 'provider-usages',
  });
  registerPluginOutputRenderer({
    pluginId: PLUGIN_ID,
    id: 'provider-usages',
    component: TideUsagesCard,
  });
}
