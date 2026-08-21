import type React from 'react';
import type { ParsedCurl } from '../components/ClaudeOutputPanel/curlParser';

/** Runtime metadata returned by GET /api/plugins. */
export interface ClientPluginInfo {
  id: string;
  name: string;
  description?: string;
  version: string;
  enabled: boolean;
  builtin?: boolean;
  source?: 'builtin' | 'installed';
  clientEntry?: string;
  manifest?: {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    browser?: string;
    contributes?: PluginManifestContributions;
  };
  contributes?: PluginManifestContributions;
  error?: string;
}

export interface PluginManifestContributions {
  slashCommands?: PluginSlashCommandContribution[];
  views?: Array<{
    id: string;
    title: string;
    icon?: string;
    location?: 'sidebar' | 'sidebar.right' | 'modal';
  }>;
  modals?: Array<{ id: string; title: string }>;
  outputRenderers?: Array<string | { id: string }>;
  settings?: unknown[];
}

export interface PluginSlashCommandContribution {
  name: string;
  aliases?: string[];
  summary: string;
  handler?: string;
  renderer?: string;
}

export interface RegisteredPluginSlashCommand extends PluginSlashCommandContribution {
  pluginId: string;
  pluginName?: string;
}

export interface PluginTaskItem {
  id: string | number;
  title: string;
  status?: string;
  project?: string;
  registeredAt?: string;
  due?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginTaskListData {
  kind: 'task-list';
  title?: string;
  emptyMessage?: string;
  count?: number;
  items: PluginTaskItem[];
  actions?: {
    complete?: string;
    reopen?: string;
    refresh?: string;
    openDetails?: string;
  };
}

export type PluginOutputData = PluginTaskListData | Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface PluginOutputEnvelope {
  pluginId: string;
  rendererId: string;
  instanceId: string;
  data: PluginOutputData;
  title?: string;
  command?: string;
  createdAt?: number;
}

export interface PluginOutputRendererProps {
  output: PluginOutputEnvelope;
  /** Absent for command results opened outside an agent conversation. */
  agentId?: string;
}

export interface PluginOutputRendererRegistration {
  pluginId: string;
  id: string;
  component?: React.ComponentType<PluginOutputRendererProps>;
  /** Framework-neutral renderer for dynamically installed browser bundles. */
  mount?: (
    container: HTMLElement,
    context: PluginMountContext & PluginOutputRendererProps,
  ) => void | (() => void) | Promise<void | (() => void)>;
}

export interface PluginSidebarViewProps {
  pluginId: string;
}

export interface PluginSidebarViewRegistration {
  pluginId: string;
  id: string;
  title: string;
  icon?: string;
  component?: React.ComponentType<PluginSidebarViewProps>;
  /** Framework-neutral extension entry point. Return cleanup for unmount. */
  mount?: (container: HTMLElement, context: PluginMountContext) => void | (() => void) | Promise<void | (() => void)>;
}

export interface PluginModalRegistration {
  pluginId: string;
  id: string;
  title: string;
  component?: React.ComponentType<{ pluginId: string; data?: unknown; onClose: () => void }>;
  mount?: (container: HTMLElement, context: PluginMountContext & { data?: unknown; close: () => void }) => void | (() => void) | Promise<void | (() => void)>;
}

export interface PluginCurlRendererProps<TMatch = unknown> {
  parsed: ParsedCurl;
  rawCommand?: string;
  output?: string;
  match: TMatch;
}

export interface PluginCurlRendererRegistration<TMatch = unknown> {
  pluginId: string;
  id: string;
  match: (parsed: ParsedCurl, rawCommand?: string) => TMatch | null;
  component: React.ComponentType<PluginCurlRendererProps<TMatch>>;
}

export interface PluginMountContext {
  pluginId: string;
  apiBaseUrl: string;
  fetch: typeof fetch;
  openModal: (id: string, data?: unknown) => void;
}

export interface TideClientPluginApi {
  pluginId: string;
  registerSlashCommand: (command: Omit<RegisteredPluginSlashCommand, 'pluginId'>) => () => void;
  registerSidebarView: (view: Omit<PluginSidebarViewRegistration, 'pluginId'>) => () => void;
  registerModal: (modal: Omit<PluginModalRegistration, 'pluginId'>) => () => void;
  registerOutputRenderer: (renderer: Omit<PluginOutputRendererRegistration, 'pluginId'>) => () => void;
  openModal: (id: string, data?: unknown) => void;
  closeModal: (id?: string) => void;
  authFetch: typeof fetch;
  apiUrl: (path: string) => string;
}

export interface TideExternalClientPlugin {
  activate: (api: TideClientPluginApi) => void | (() => void) | Promise<void | (() => void)>;
}
