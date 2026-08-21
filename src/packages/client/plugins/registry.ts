import type {
  ClientPluginInfo,
  PluginCurlRendererRegistration,
  PluginModalRegistration,
  PluginOutputRendererRegistration,
  PluginSidebarViewRegistration,
  RegisteredPluginSlashCommand,
  TideClientPluginApi,
  TideExternalClientPlugin,
} from './types';
import { apiUrl, authFetch } from '../utils/storage';

interface OpenPluginModal {
  pluginId: string;
  id: string;
  data?: unknown;
}

type Listener = () => void;

const listeners = new Set<Listener>();
const catalog = new Map<string, ClientPluginInfo>();
const builtinIds = new Set<string>();
const slashCommands: RegisteredPluginSlashCommand[] = [];
const sidebarViews: PluginSidebarViewRegistration[] = [];
const modals: PluginModalRegistration[] = [];
const outputRenderers: PluginOutputRendererRegistration[] = [];
const curlRenderers: PluginCurlRendererRegistration<unknown>[] = [];
const externalCleanups = new Map<string, () => void>();
const externalLoads = new Map<string, Promise<void>>();
let catalogLoaded = false;
let openModalState: OpenPluginModal | null = null;
let revision = 0;

function emit(): void {
  revision++;
  for (const listener of listeners) listener();
}

export function subscribePluginRegistry(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPluginRegistryRevision(): number {
  return revision;
}

function normalizeCommandName(name: string): string {
  const clean = name.trim();
  return clean.startsWith('/') ? clean.toLowerCase() : `/${clean.toLowerCase()}`;
}

function isEnabled(pluginId: string): boolean {
  const info = catalog.get(pluginId);
  // Built-ins are immediately available during boot, before the catalog fetch.
  if (!catalogLoaded && builtinIds.has(pluginId)) return true;
  return info?.enabled ?? builtinIds.has(pluginId);
}

export function registerBuiltinPlugin(pluginId: string): () => void {
  builtinIds.add(pluginId);
  emit();
  return () => {
    builtinIds.delete(pluginId);
    emit();
  };
}

export function registerPluginSlashCommand(command: RegisteredPluginSlashCommand): () => void {
  const normalized: RegisteredPluginSlashCommand = {
    ...command,
    name: normalizeCommandName(command.name),
    aliases: command.aliases?.map(normalizeCommandName),
  };
  const duplicate = slashCommands.findIndex((entry) => (
    entry.pluginId === normalized.pluginId && entry.name === normalized.name
  ));
  if (duplicate >= 0) slashCommands.splice(duplicate, 1);
  slashCommands.push(normalized);
  emit();
  return () => {
    const index = slashCommands.indexOf(normalized);
    if (index >= 0) slashCommands.splice(index, 1);
    emit();
  };
}

export function registerPluginSidebarView(view: PluginSidebarViewRegistration): () => void {
  const duplicate = sidebarViews.findIndex((entry) => entry.pluginId === view.pluginId && entry.id === view.id);
  if (duplicate >= 0) sidebarViews.splice(duplicate, 1);
  sidebarViews.push(view);
  emit();
  return () => {
    const index = sidebarViews.indexOf(view);
    if (index >= 0) sidebarViews.splice(index, 1);
    emit();
  };
}

export function registerPluginModal(modal: PluginModalRegistration): () => void {
  const duplicate = modals.findIndex((entry) => entry.pluginId === modal.pluginId && entry.id === modal.id);
  if (duplicate >= 0) modals.splice(duplicate, 1);
  modals.push(modal);
  emit();
  return () => {
    const index = modals.indexOf(modal);
    if (index >= 0) modals.splice(index, 1);
    if (openModalState?.pluginId === modal.pluginId && openModalState.id === modal.id) {
      openModalState = null;
    }
    emit();
  };
}

export function registerPluginOutputRenderer(renderer: PluginOutputRendererRegistration): () => void {
  const duplicate = outputRenderers.findIndex((entry) => entry.pluginId === renderer.pluginId && entry.id === renderer.id);
  if (duplicate >= 0) outputRenderers.splice(duplicate, 1);
  outputRenderers.push(renderer);
  emit();
  return () => {
    const index = outputRenderers.indexOf(renderer);
    if (index >= 0) outputRenderers.splice(index, 1);
    emit();
  };
}

export function registerPluginCurlRenderer<TMatch>(renderer: PluginCurlRendererRegistration<TMatch>): () => void {
  const erased = renderer as PluginCurlRendererRegistration<unknown>;
  const duplicate = curlRenderers.findIndex((entry) => entry.pluginId === renderer.pluginId && entry.id === renderer.id);
  if (duplicate >= 0) curlRenderers.splice(duplicate, 1);
  curlRenderers.push(erased);
  emit();
  return () => {
    const index = curlRenderers.indexOf(erased);
    if (index >= 0) curlRenderers.splice(index, 1);
    emit();
  };
}

export function getPluginSlashCommands(): RegisteredPluginSlashCommand[] {
  return slashCommands.filter((entry) => isEnabled(entry.pluginId));
}

export function getPluginSidebarViews(): PluginSidebarViewRegistration[] {
  return sidebarViews.filter((entry) => isEnabled(entry.pluginId));
}

export function getPluginModals(): PluginModalRegistration[] {
  return modals.filter((entry) => isEnabled(entry.pluginId));
}

export function getPluginOutputRenderer(pluginId: string, rendererId: string): PluginOutputRendererRegistration | undefined {
  return outputRenderers.find((entry) => (
    entry.pluginId === pluginId && entry.id === rendererId && isEnabled(entry.pluginId)
  ));
}

export function findPluginCurlRenderer(parsed: Parameters<PluginCurlRendererRegistration['match']>[0], rawCommand?: string): {
  registration: PluginCurlRendererRegistration<unknown>;
  match: unknown;
} | null {
  for (const registration of curlRenderers) {
    if (!isEnabled(registration.pluginId)) continue;
    const match = registration.match(parsed, rawCommand);
    if (match !== null && match !== undefined) return { registration, match };
  }
  return null;
}

export function getPluginCatalog(): ClientPluginInfo[] {
  return Array.from(catalog.values());
}

export function openPluginModal(pluginId: string, id: string, data?: unknown): void {
  if (!isEnabled(pluginId)) return;
  openModalState = { pluginId, id, data };
  emit();
}

export function closePluginModal(pluginId?: string, id?: string): void {
  if (!openModalState) return;
  if (pluginId && openModalState.pluginId !== pluginId) return;
  if (id && openModalState.id !== id) return;
  openModalState = null;
  emit();
}

export function getOpenPluginModal(): OpenPluginModal | null {
  return openModalState;
}

function makeExternalApi(pluginId: string): TideClientPluginApi {
  return {
    pluginId,
    registerSlashCommand: (command) => registerPluginSlashCommand({ ...command, pluginId }),
    registerSidebarView: (view) => registerPluginSidebarView({ ...view, pluginId }),
    registerModal: (modal) => registerPluginModal({ ...modal, pluginId }),
    registerOutputRenderer: (renderer) => registerPluginOutputRenderer({ ...renderer, pluginId }),
    openModal: (id, data) => openPluginModal(pluginId, id, data),
    closeModal: (id) => closePluginModal(pluginId, id),
    authFetch: authFetch as typeof fetch,
    apiUrl,
  };
}

async function loadExternalClient(plugin: ClientPluginInfo): Promise<void> {
  if (!plugin.enabled || plugin.builtin || plugin.source === 'builtin') return;
  if (externalCleanups.has(plugin.id)) return;
  const existing = externalLoads.get(plugin.id);
  if (existing) return existing;

  const pending = (async () => {
    const entry = plugin.clientEntry || `/api/plugins/${encodeURIComponent(plugin.id)}/client`;
    const response = await authFetch(apiUrl(entry));
    if (!response.ok) throw new Error(`Failed to load ${plugin.id} client (${response.status})`);
    const source = await response.text();
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      const imported = await import(/* @vite-ignore */ blobUrl) as Partial<TideExternalClientPlugin> & {
        default?: TideExternalClientPlugin | TideExternalClientPlugin['activate'];
      };
      const activate = typeof imported.activate === 'function'
        ? imported.activate
        : typeof imported.default === 'function'
          ? imported.default
          : imported.default && typeof imported.default.activate === 'function'
            ? imported.default.activate.bind(imported.default)
            : null;
      if (!activate) throw new Error(`Plugin ${plugin.id} client does not export activate(api)`);
      const cleanup = await activate(makeExternalApi(plugin.id));
      externalCleanups.set(plugin.id, typeof cleanup === 'function' ? cleanup : () => undefined);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  })().catch((error) => {
    console.error(`[Plugins] Failed to activate client plugin ${plugin.id}:`, error);
  }).finally(() => {
    externalLoads.delete(plugin.id);
    emit();
  });
  externalLoads.set(plugin.id, pending);
  return pending;
}

function unloadExternalClient(pluginId: string): void {
  const cleanup = externalCleanups.get(pluginId);
  if (!cleanup) return;
  try {
    cleanup();
  } catch (error) {
    console.error(`[Plugins] Failed to clean up client plugin ${pluginId}:`, error);
  }
  externalCleanups.delete(pluginId);
}

function commandsFromManifest(info: ClientPluginInfo): void {
  const contributes = info.contributes || info.manifest?.contributes;
  if (!contributes?.slashCommands) return;
  for (const command of contributes.slashCommands) {
    const exists = slashCommands.some((entry) => entry.pluginId === info.id && normalizeCommandName(entry.name) === normalizeCommandName(command.name));
    if (!exists) registerPluginSlashCommand({ ...command, pluginId: info.id, pluginName: info.name });
  }
}

export async function refreshPluginCatalog(): Promise<ClientPluginInfo[]> {
  const response = await authFetch(apiUrl('/api/plugins'));
  if (!response.ok) throw new Error(`Failed to load plugins (${response.status})`);
  const body = await response.json() as unknown;
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { plugins?: unknown }).plugins)
      ? (body as { plugins: ClientPluginInfo[] }).plugins
      : [];

  const nextIds = new Set<string>();
  for (const raw of list as ClientPluginInfo[]) {
    if (!raw || typeof raw.id !== 'string') continue;
    const info: ClientPluginInfo = {
      ...raw,
      name: raw.name || raw.manifest?.name || raw.id,
      version: raw.version || raw.manifest?.version || '0.0.0',
      enabled: raw.enabled !== false,
    };
    nextIds.add(info.id);
    catalog.set(info.id, info);
    commandsFromManifest(info);
    if (info.enabled) void loadExternalClient(info);
    else unloadExternalClient(info.id);
  }
  for (const id of Array.from(catalog.keys())) {
    if (!nextIds.has(id) && !builtinIds.has(id)) {
      catalog.delete(id);
      unloadExternalClient(id);
    }
  }
  catalogLoaded = true;
  emit();
  return getPluginCatalog();
}

/** Start catalog synchronization without delaying the first app paint. */
export function initializePluginRuntime(): void {
  void refreshPluginCatalog().catch((error) => {
    console.warn('[Plugins] Plugin catalog unavailable; built-ins remain active:', error);
  });
}
