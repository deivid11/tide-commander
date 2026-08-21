import {
  registerBuiltinPlugin,
  registerPluginOutputRenderer,
  registerPluginSlashCommand,
} from '../registry';
import { GmailPendingCard } from './GmailPendingCard';

const PLUGIN_ID = 'gmail-pending';
let registered = false;

export function registerGmailPendingPlugin(): void {
  if (registered) return;
  registered = true;
  registerBuiltinPlugin(PLUGIN_ID);
  registerPluginSlashCommand({
    pluginId: PLUGIN_ID,
    pluginName: 'Gmail Inbox',
    name: '/gmail',
    aliases: ['/gmail-pending', '/correos', '/gmail-all', '/todos-correos'],
    summary: 'Mostrar correos no leídos o todos; uso: /gmail [all|unread] [1-50]',
    handler: 'show-pending-emails',
    renderer: 'gmail-pending-list',
  });
  registerPluginOutputRenderer({
    pluginId: PLUGIN_ID,
    id: 'gmail-pending-list',
    component: GmailPendingCard,
  });
}
