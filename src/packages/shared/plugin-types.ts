/**
 * Contracts for Tide Commander's trusted-local plugin runtime.
 *
 * Plugins are ordinary local JavaScript modules. Tide Commander does not
 * sandbox them: enabling a plugin grants it the same filesystem/network access
 * as the server process. Browser entries are served only through the
 * authenticated /api/plugins route.
 */

export type PluginJsonPrimitive = string | number | boolean | null;
export type PluginJsonValue =
  | PluginJsonPrimitive
  | PluginJsonValue[]
  | { [key: string]: PluginJsonValue };

export interface PluginSlashCommandContribution {
  /** Canonical command name. A leading slash is optional in manifests. */
  name: string;
  aliases?: string[];
  summary: string;
  /** Handler registered by the server entry. Defaults to the canonical name. */
  handler?: string;
  /** Client renderer id. Defaults to the first contributed renderer or "default". */
  renderer?: string;
}

export interface PluginViewContribution {
  id: string;
  title: string;
  icon?: string;
  location?: 'sidebar' | 'sidebar.right' | 'modal';
}

export interface PluginModalContribution {
  id: string;
  title: string;
}

export interface PluginOutputRendererContribution {
  id: string;
}

export interface PluginManifestContributions {
  slashCommands?: PluginSlashCommandContribution[];
  views?: PluginViewContribution[];
  modals?: PluginModalContribution[];
  outputRenderers?: Array<string | PluginOutputRendererContribution>;
  settings?: unknown[];
}

export interface TidePluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Server-side ESM/CommonJS entry, relative to the manifest directory. */
  main?: string;
  /** Browser ESM entry, relative to the manifest directory. */
  browser?: string;
  contributes?: PluginManifestContributions;
}

/** Safe runtime metadata returned by GET /api/plugins. */
export interface PluginCatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  builtin?: boolean;
  source?: 'builtin' | 'installed';
  /** Authenticated route for an external browser entry. */
  clientEntry?: string;
  manifest?: TidePluginManifest;
  contributes?: PluginManifestContributions;
  /** Activation/load failure. Never contains source code or credentials. */
  error?: string;
}

export interface PluginTaskItem {
  id: string | number;
  title: string;
  status?: string;
  project?: string;
  /** Original registration/creation timestamp supplied by the plugin. */
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

export type PluginOutputData =
  | PluginTaskListData
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

export interface PluginOutputEnvelope {
  pluginId: string;
  rendererId: string;
  instanceId: string;
  data: PluginOutputData;
  title?: string;
  command?: string;
  createdAt?: number;
}

export interface PluginOutputMessagePayload {
  agentId: string;
  output: PluginOutputEnvelope;
}

export interface PluginOutputPatchMessagePayload {
  agentId: string;
  pluginId: string;
  instanceId: string;
  data: PluginOutputData;
}

export interface PluginCommandContext {
  pluginId: string;
  agentId?: string;
  /** Canonical contributed command name, always beginning with '/'. */
  command: string;
  /** The command or alias the caller actually used. */
  invokedAs: string;
  rawCommand: string;
  argsText: string;
  args: string[];
  body?: Record<string, unknown>;
}

export interface PluginActionContext {
  pluginId: string;
  action: string;
  agentId?: string;
  instanceId?: string;
  rendererId?: string;
  item?: unknown;
  itemId?: string | number;
  data?: unknown;
  body: Record<string, unknown>;
}

export type PluginHandlerResult = PluginOutputEnvelope | PluginOutputData | void;
export type PluginCommandHandler = (
  context: PluginCommandContext,
) => PluginHandlerResult | Promise<PluginHandlerResult>;
export type PluginActionHandler = (
  context: PluginActionContext,
) => PluginHandlerResult | Promise<PluginHandlerResult>;

export interface TideServerPluginApi {
  readonly pluginId: string;
  readonly manifest: TidePluginManifest;
  readonly sourcePath: string;
  registerCommand(name: string, handler: PluginCommandHandler): () => void;
  registerAction(name: string, handler: PluginActionHandler): () => void;
  emitOutput(agentId: string, output: PluginOutputEnvelope): void;
  emitPatch(agentId: string, instanceId: string, data: PluginOutputData): void;
  log: {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };
}

export interface TideServerPluginActivation {
  commands?: Record<string, PluginCommandHandler>;
  actions?: Record<string, PluginActionHandler>;
  deactivate?: () => void | Promise<void>;
  dispose?: () => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
}

export type TideServerPluginActivate = (
  api: TideServerPluginApi,
) => void
  | (() => void | Promise<void>)
  | TideServerPluginActivation
  | Promise<void | (() => void | Promise<void>) | TideServerPluginActivation>;

export interface TideServerPluginModule extends Partial<TideServerPluginActivation> {
  activate?: TideServerPluginActivate;
  default?: TideServerPluginActivate | TideServerPluginModule;
}
