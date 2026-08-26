import {
  registerBuiltinPlugin,
  registerPluginCurlRenderer,
  registerPluginModal,
  registerPluginOutputRenderer,
  registerPluginSidebarView,
  registerPluginSlashCommand,
} from '../registry';
import { BolbaCurlCard } from './BolbaCurlCard';
import { detectBolbaTasksCall } from './bolbaCurl';
import { BolbaTaskDetailsModal, BolbaTasksSidebarView } from './BolbaTasksView';
import { RecommendedTasksCard } from './RecommendedTasksCard';

const PLUGIN_ID = 'bolba-tasks';
let registered = false;

/** Register all client contributions from the built-in Bolba plugin. */
export function registerBolbaTasksPlugin(): void {
  if (registered) return;
  registered = true;
  registerBuiltinPlugin(PLUGIN_ID);
  registerPluginSlashCommand({
    pluginId: PLUGIN_ID,
    pluginName: 'Bolba Tasks',
    name: '/tasks',
    aliases: ['/show-pending-tasks'],
    summary: 'Show pending tasks and the 8 most recently completed tasks',
    handler: 'show-pending-tasks',
    renderer: 'task-list',
  });
  registerPluginSlashCommand({
    pluginId: PLUGIN_ID,
    pluginName: 'Bolba Tasks',
    name: '/tasks-recommended',
    aliases: ['/recommended-tasks', '/tasks-today'],
    summary: 'Ask the selected agent AI which Bolba tasks should be completed today',
    handler: 'show-recommended-tasks',
    renderer: 'recommended-task-list',
    requiresAgent: true,
  });
  registerPluginOutputRenderer({
    pluginId: PLUGIN_ID,
    id: 'recommended-task-list',
    component: RecommendedTasksCard,
  });
  registerPluginSidebarView({
    pluginId: PLUGIN_ID,
    id: 'pending-tasks',
    title: 'Tasks',
    icon: 'plant',
    component: BolbaTasksSidebarView,
  });
  registerPluginModal({
    pluginId: PLUGIN_ID,
    id: 'openDetails',
    title: 'Detalle de tarea',
    component: BolbaTaskDetailsModal,
  });
  registerPluginCurlRenderer({
    pluginId: PLUGIN_ID,
    id: 'legacy-curl-output',
    match: detectBolbaTasksCall,
    component: BolbaCurlCard,
  });
}
