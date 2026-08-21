import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getDataDir } from '../data/index.js';
import { createLogger } from '../utils/logger.js';
import type { ServerMessage } from '../../shared/types.js';
import type {
  PluginActionContext,
  PluginActionHandler,
  PluginCatalogEntry,
  PluginCommandContext,
  PluginCommandHandler,
  PluginHandlerResult,
  PluginManifestContributions,
  PluginOutputData,
  PluginOutputEnvelope,
  PluginSlashCommandContribution,
  TidePluginManifest,
  TideServerPluginActivate,
  TideServerPluginActivation,
  TideServerPluginApi,
  TideServerPluginModule,
} from '../../shared/plugin-types.js';

const log = createLogger('Plugins');
const PLUGIN_ID_RE = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
const COMMAND_RE = /^\/?[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const HANDLER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

export class PluginRuntimeError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'PLUGIN_ERROR',
  ) {
    super(message);
    this.name = 'PluginRuntimeError';
  }
}

export interface BuiltinPluginDefinition {
  manifest: TidePluginManifest;
  activate: TideServerPluginActivate;
}

interface PersistedPluginRecord {
  sourcePath: string;
  enabled: boolean;
}

interface PluginStateFile {
  version: 1;
  installed: PersistedPluginRecord[];
  enabled: Record<string, boolean>;
}

interface PluginEntry {
  manifest: TidePluginManifest;
  rootDir: string;
  manifestPath?: string;
  builtin: boolean;
  enabled: boolean;
  active: boolean;
  error?: string;
  activateBuiltin?: TideServerPluginActivate;
  commandHandlers: Map<string, PluginCommandHandler>;
  actionHandlers: Map<string, PluginActionHandler>;
  registrationCleanups: Array<() => void>;
  deactivate?: () => void | Promise<void>;
}

export interface PluginManagerOptions {
  dataDir?: string;
  builtins?: BuiltinPluginDefinition[];
  broadcast?: (message: ServerMessage) => void;
}

export interface MatchedPluginCommand {
  pluginId: string;
  command: PluginSlashCommandContribution;
  invokedAs: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommandName(name: string): string {
  const clean = name.trim().toLowerCase();
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function normalizeHandlerName(name: string): string {
  return name.trim().replace(/^\//, '').toLowerCase();
}

function assertShortString(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginRuntimeError(`Plugin manifest field "${field}" must be a non-empty string`);
  }
  const clean = value.trim();
  if (clean.length > max || clean.includes('\0')) {
    throw new PluginRuntimeError(`Plugin manifest field "${field}" is invalid`);
  }
  return clean;
}

function validateCommandContribution(value: unknown, index: number): PluginSlashCommandContribution {
  if (!isRecord(value)) {
    throw new PluginRuntimeError(`contributes.slashCommands[${index}] must be an object`);
  }
  const name = assertShortString(value.name, `contributes.slashCommands[${index}].name`, 80);
  if (!COMMAND_RE.test(name)) {
    throw new PluginRuntimeError(`Invalid slash command name: ${name}`);
  }
  const aliases = value.aliases === undefined
    ? undefined
    : Array.isArray(value.aliases)
      ? value.aliases.map((alias, aliasIndex) => {
        const clean = assertShortString(alias, `slashCommands[${index}].aliases[${aliasIndex}]`, 80);
        if (!COMMAND_RE.test(clean)) throw new PluginRuntimeError(`Invalid slash command alias: ${clean}`);
        return normalizeCommandName(clean);
      })
      : (() => { throw new PluginRuntimeError(`slashCommands[${index}].aliases must be an array`); })();
  const handler = value.handler === undefined
    ? undefined
    : assertShortString(value.handler, `slashCommands[${index}].handler`, 100);
  if (handler && !HANDLER_RE.test(handler)) {
    throw new PluginRuntimeError(`Invalid command handler name: ${handler}`);
  }
  const renderer = value.renderer === undefined
    ? undefined
    : assertShortString(value.renderer, `slashCommands[${index}].renderer`, 100);
  return {
    name: normalizeCommandName(name),
    aliases,
    summary: assertShortString(value.summary, `contributes.slashCommands[${index}].summary`, 500),
    handler,
    renderer,
  };
}

function validateContributions(value: unknown): PluginManifestContributions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new PluginRuntimeError('Plugin manifest "contributes" must be an object');
  const slashCommands = value.slashCommands === undefined
    ? undefined
    : Array.isArray(value.slashCommands)
      ? value.slashCommands.map(validateCommandContribution)
      : (() => { throw new PluginRuntimeError('contributes.slashCommands must be an array'); })();

  const validateIdTitle = (items: unknown, field: string) => {
    if (items === undefined) return undefined;
    if (!Array.isArray(items)) throw new PluginRuntimeError(`contributes.${field} must be an array`);
    return items.map((item, index) => {
      if (!isRecord(item)) throw new PluginRuntimeError(`contributes.${field}[${index}] must be an object`);
      return {
        ...item,
        id: assertShortString(item.id, `contributes.${field}[${index}].id`, 100),
        title: assertShortString(item.title, `contributes.${field}[${index}].title`, 200),
      };
    });
  };

  let outputRenderers: PluginManifestContributions['outputRenderers'];
  if (value.outputRenderers !== undefined) {
    if (!Array.isArray(value.outputRenderers)) {
      throw new PluginRuntimeError('contributes.outputRenderers must be an array');
    }
    outputRenderers = value.outputRenderers.map((renderer, index) => {
      if (typeof renderer === 'string') return assertShortString(renderer, `outputRenderers[${index}]`, 100);
      if (!isRecord(renderer)) throw new PluginRuntimeError(`outputRenderers[${index}] must be a string or object`);
      return { id: assertShortString(renderer.id, `outputRenderers[${index}].id`, 100) };
    });
  }

  return {
    slashCommands,
    views: validateIdTitle(value.views, 'views') as PluginManifestContributions['views'],
    modals: validateIdTitle(value.modals, 'modals') as PluginManifestContributions['modals'],
    outputRenderers,
    settings: value.settings === undefined
      ? undefined
      : Array.isArray(value.settings)
        ? value.settings
        : (() => { throw new PluginRuntimeError('contributes.settings must be an array'); })(),
  };
}

function validateManifest(raw: unknown, packageDefaults?: Record<string, unknown>): TidePluginManifest {
  if (!isRecord(raw)) throw new PluginRuntimeError('Plugin manifest must be a JSON object');
  const id = assertShortString(raw.id ?? packageDefaults?.name, 'id', 100).toLowerCase();
  if (!PLUGIN_ID_RE.test(id)) {
    throw new PluginRuntimeError(`Invalid plugin id "${id}"; use lowercase letters, numbers, dots, dashes, or underscores`);
  }
  const main = raw.main === undefined ? undefined : assertShortString(raw.main, 'main', 500);
  const browser = raw.browser === undefined ? undefined : assertShortString(raw.browser, 'browser', 500);
  return {
    id,
    name: assertShortString(raw.name ?? packageDefaults?.name ?? id, 'name', 200),
    version: assertShortString(raw.version ?? packageDefaults?.version ?? '0.0.0', 'version', 80),
    description: raw.description === undefined && packageDefaults?.description === undefined
      ? undefined
      : assertShortString(raw.description ?? packageDefaults?.description, 'description', 2_000),
    main,
    browser,
    contributes: validateContributions(raw.contributes),
  };
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveContainedFile(rootDir: string, relativePath: string, field: string): Promise<string> {
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new PluginRuntimeError(`Plugin ${field} must be a relative path inside the plugin directory`);
  }
  const lexical = path.resolve(rootDir, relativePath);
  if (!isPathInside(rootDir, lexical)) {
    throw new PluginRuntimeError(`Plugin ${field} escapes the plugin directory`);
  }
  let real: string;
  try {
    real = await fsp.realpath(lexical);
  } catch {
    throw new PluginRuntimeError(`Plugin ${field} file does not exist: ${relativePath}`, 422, 'PLUGIN_ENTRY_MISSING');
  }
  if (!isPathInside(rootDir, real)) {
    throw new PluginRuntimeError(`Plugin ${field} resolves outside the plugin directory`);
  }
  const stat = await fsp.stat(real);
  if (!stat.isFile()) throw new PluginRuntimeError(`Plugin ${field} is not a file`);
  if (stat.size > MAX_ENTRY_BYTES) throw new PluginRuntimeError(`Plugin ${field} exceeds the 5 MB limit`);
  return real;
}

function parseCommandArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (escaped) current += '\\';
  if (current) args.push(current);
  return args;
}

function rendererIdFromManifest(manifest: TidePluginManifest): string {
  const first = manifest.contributes?.outputRenderers?.[0];
  if (typeof first === 'string') return first;
  return first?.id || 'default';
}

function isOutputEnvelope(value: unknown): value is PluginOutputEnvelope {
  return isRecord(value)
    && typeof value.pluginId === 'string'
    && typeof value.rendererId === 'string'
    && typeof value.instanceId === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'data');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PluginManager {
  private readonly dataDir: string;
  private readonly stateFile: string;
  private readonly builtins: BuiltinPluginDefinition[];
  private readonly entries = new Map<string, PluginEntry>();
  private readonly persistedInstalled = new Map<string, PersistedPluginRecord>();
  private broadcast?: (message: ServerMessage) => void;
  private initialized = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: PluginManagerOptions = {}) {
    this.dataDir = options.dataDir ?? path.join(getDataDir(), 'plugins');
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.builtins = options.builtins ?? [];
    this.broadcast = options.broadcast;
  }

  setBroadcast(broadcast: (message: ServerMessage) => void): void {
    this.broadcast = broadcast;
  }

  async initialize(): Promise<void> {
    await this.mutate(async () => {
      if (this.initialized) return;
      const state = await this.readState();
      for (const record of state.installed) this.persistedInstalled.set(record.sourcePath, record);

      for (const builtin of this.builtins) {
        const manifest = validateManifest(builtin.manifest);
        if (this.entries.has(manifest.id)) throw new PluginRuntimeError(`Duplicate builtin plugin id: ${manifest.id}`);
        this.entries.set(manifest.id, {
          manifest,
          rootDir: `builtin:${manifest.id}`,
          builtin: true,
          enabled: state.enabled[manifest.id] ?? true,
          active: false,
          activateBuiltin: builtin.activate,
          commandHandlers: new Map(),
          actionHandlers: new Map(),
          registrationCleanups: [],
        });
      }

      for (const record of state.installed) {
        try {
          const entry = await this.loadExternalEntry(record.sourcePath, record.enabled);
          if (this.entries.has(entry.manifest.id)) {
            throw new PluginRuntimeError(`Duplicate plugin id: ${entry.manifest.id}`);
          }
          this.entries.set(entry.manifest.id, entry);
        } catch (error) {
          log.error(`Failed to load installed plugin from ${record.sourcePath}:`, error);
        }
      }

      for (const entry of this.entries.values()) {
        if (!entry.enabled) continue;
        try {
          await this.activateEntry(entry);
        } catch (error) {
          entry.error = errorMessage(error);
          log.error(`Failed to activate plugin ${entry.manifest.id}:`, error);
        }
      }
      this.initialized = true;
      await this.persistState();
      log.log(`Loaded ${this.entries.size} trusted-local plugin(s)`);
    });
  }

  async shutdown(): Promise<void> {
    await this.mutate(async () => {
      const active = Array.from(this.entries.values()).filter((entry) => entry.active).reverse();
      for (const entry of active) await this.deactivateEntry(entry);
      this.entries.clear();
      this.persistedInstalled.clear();
      this.initialized = false;
    });
  }

  list(): PluginCatalogEntry[] {
    return Array.from(this.entries.values())
      .map((entry) => this.toCatalogEntry(entry))
      .sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name));
  }

  get(pluginId: string): PluginCatalogEntry | undefined {
    const entry = this.entries.get(pluginId);
    return entry ? this.toCatalogEntry(entry) : undefined;
  }

  async install(sourcePath: string): Promise<PluginCatalogEntry> {
    return this.mutate(async () => {
      this.assertInitialized();
      const entry = await this.loadExternalEntry(sourcePath, false);
      if (this.entries.has(entry.manifest.id)) {
        throw new PluginRuntimeError(`Plugin "${entry.manifest.id}" is already installed`, 409, 'PLUGIN_EXISTS');
      }
      this.entries.set(entry.manifest.id, entry);
      this.persistedInstalled.set(entry.rootDir, { sourcePath: entry.rootDir, enabled: false });
      try {
        this.assertNoCommandCollisions(entry);
        await this.activateEntry(entry);
        entry.enabled = true;
        entry.error = undefined;
      } catch (error) {
        entry.enabled = false;
        entry.error = errorMessage(error);
        await this.persistState();
        throw new PluginRuntimeError(
          `Plugin was installed but could not be enabled: ${entry.error}`,
          422,
          'PLUGIN_ACTIVATION_FAILED',
        );
      }
      await this.persistState();
      return this.toCatalogEntry(entry);
    });
  }

  async enable(pluginId: string): Promise<PluginCatalogEntry> {
    return this.setEnabled(pluginId, true);
  }

  async disable(pluginId: string): Promise<PluginCatalogEntry> {
    return this.setEnabled(pluginId, false);
  }

  matchSlashCommand(rawCommand: string): MatchedPluginCommand | null {
    const invokedAs = normalizeCommandName(rawCommand.trim().split(/\s+/, 1)[0] || '');
    if (invokedAs === '/') return null;
    for (const entry of this.entries.values()) {
      if (!entry.enabled || !entry.active) continue;
      for (const command of entry.manifest.contributes?.slashCommands ?? []) {
        if (normalizeCommandName(command.name) === invokedAs
          || command.aliases?.some((alias) => normalizeCommandName(alias) === invokedAs)) {
          return { pluginId: entry.manifest.id, command, invokedAs };
        }
      }
    }
    return null;
  }

  async executeSlashCommand(agentId: string, rawCommand: string): Promise<PluginOutputEnvelope> {
    const matched = this.matchSlashCommand(rawCommand);
    if (!matched) throw new PluginRuntimeError('Plugin slash command not found', 404, 'PLUGIN_COMMAND_NOT_FOUND');
    const argsText = rawCommand.trim().slice(rawCommand.trim().split(/\s+/, 1)[0].length).trim();
    return this.invokeCommand(matched.pluginId, matched.command, {
      agentId,
      invokedAs: matched.invokedAs,
      rawCommand,
      argsText,
      args: parseCommandArgs(argsText),
    });
  }

  async executeCommand(
    pluginId: string,
    commandName: string,
    body: Record<string, unknown> = {},
  ): Promise<PluginOutputEnvelope> {
    const entry = this.requireActiveEntry(pluginId);
    const invokedAs = normalizeCommandName(commandName);
    const contribution = (entry.manifest.contributes?.slashCommands ?? []).find((command) => (
      normalizeCommandName(command.name) === invokedAs
      || command.aliases?.some((alias) => normalizeCommandName(alias) === invokedAs)
    )) ?? {
      name: invokedAs,
      summary: invokedAs,
      handler: normalizeHandlerName(commandName),
    };
    const suppliedArgs = Array.isArray(body.args)
      ? body.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined;
    const argsText = typeof body.argsText === 'string'
      ? body.argsText
      : suppliedArgs?.join(' ') ?? '';
    const rawCommand = typeof body.rawCommand === 'string'
      ? body.rawCommand
      : `${invokedAs}${argsText ? ` ${argsText}` : ''}`;
    return this.invokeCommand(pluginId, contribution, {
      agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
      invokedAs,
      rawCommand,
      argsText,
      args: suppliedArgs ?? parseCommandArgs(argsText),
      body,
    });
  }

  async executeAction(
    pluginId: string,
    actionName: string,
    body: Record<string, unknown> = {},
  ): Promise<PluginOutputEnvelope> {
    const entry = this.requireActiveEntry(pluginId);
    const normalized = normalizeHandlerName(actionName);
    const handler = entry.actionHandlers.get(normalized);
    if (!handler) throw new PluginRuntimeError(`Plugin action "${actionName}" not found`, 404, 'PLUGIN_ACTION_NOT_FOUND');
    const context: PluginActionContext = {
      pluginId,
      action: normalized,
      agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
      instanceId: typeof body.instanceId === 'string' ? body.instanceId : undefined,
      rendererId: typeof body.rendererId === 'string' ? body.rendererId : undefined,
      item: body.item,
      itemId: typeof body.itemId === 'string' || typeof body.itemId === 'number' ? body.itemId : undefined,
      data: body.data,
      body,
    };
    const result = await handler(context);
    return this.normalizeOutput(entry, result, {
      instanceId: context.instanceId,
      rendererId: context.rendererId,
      title: entry.manifest.name,
    });
  }

  publishOutput(agentId: string, output: PluginOutputEnvelope): void {
    this.broadcast?.({ type: 'plugin_output', payload: { agentId, output } });
  }

  publishPatch(agentId: string, pluginId: string, instanceId: string, data: PluginOutputData): void {
    this.broadcast?.({ type: 'plugin_output_patch', payload: { agentId, pluginId, instanceId, data } });
  }

  async readClientEntry(pluginId: string): Promise<{ source: string; filePath: string }> {
    const entry = this.requireActiveEntry(pluginId);
    if (entry.builtin || !entry.manifest.browser) {
      throw new PluginRuntimeError(`Plugin "${pluginId}" has no external browser entry`, 404, 'PLUGIN_CLIENT_NOT_FOUND');
    }
    const filePath = await resolveContainedFile(entry.rootDir, entry.manifest.browser, 'browser');
    const source = await fsp.readFile(filePath, 'utf8');
    return { source, filePath };
  }

  private async setEnabled(pluginId: string, enabled: boolean): Promise<PluginCatalogEntry> {
    return this.mutate(async () => {
      this.assertInitialized();
      const entry = this.entries.get(pluginId);
      if (!entry) throw new PluginRuntimeError(`Plugin "${pluginId}" not found`, 404, 'PLUGIN_NOT_FOUND');
      if (enabled) {
        if (!entry.active) {
          this.assertNoCommandCollisions(entry);
          try {
            await this.activateEntry(entry);
          } catch (error) {
            entry.enabled = false;
            entry.error = errorMessage(error);
            await this.persistState();
            throw new PluginRuntimeError(entry.error, 422, 'PLUGIN_ACTIVATION_FAILED');
          }
        }
        entry.enabled = true;
        entry.error = undefined;
      } else {
        await this.deactivateEntry(entry);
        entry.enabled = false;
      }
      if (!entry.builtin) {
        this.persistedInstalled.set(entry.rootDir, { sourcePath: entry.rootDir, enabled: entry.enabled });
      }
      await this.persistState();
      return this.toCatalogEntry(entry);
    });
  }

  private async invokeCommand(
    pluginId: string,
    contribution: PluginSlashCommandContribution,
    input: Omit<PluginCommandContext, 'pluginId' | 'command'>,
  ): Promise<PluginOutputEnvelope> {
    const entry = this.requireActiveEntry(pluginId);
    const canonical = normalizeCommandName(contribution.name);
    const handlerName = normalizeHandlerName(contribution.handler ?? canonical);
    const handler = entry.commandHandlers.get(handlerName);
    if (!handler) {
      throw new PluginRuntimeError(
        `Plugin command handler "${handlerName}" is not registered`,
        500,
        'PLUGIN_HANDLER_MISSING',
      );
    }
    const context: PluginCommandContext = {
      ...input,
      pluginId,
      command: canonical,
    };
    const result = await handler(context);
    return this.normalizeOutput(entry, result, {
      rendererId: contribution.renderer,
      command: input.rawCommand,
      title: entry.manifest.name,
    });
  }

  private normalizeOutput(
    entry: PluginEntry,
    result: PluginHandlerResult,
    defaults: { instanceId?: string; rendererId?: string; title?: string; command?: string },
  ): PluginOutputEnvelope {
    if (isOutputEnvelope(result)) {
      return {
        ...result,
        pluginId: entry.manifest.id,
        rendererId: result.rendererId || defaults.rendererId || rendererIdFromManifest(entry.manifest),
        instanceId: result.instanceId || defaults.instanceId || randomUUID(),
        createdAt: result.createdAt ?? Date.now(),
      };
    }
    return {
      pluginId: entry.manifest.id,
      rendererId: defaults.rendererId || rendererIdFromManifest(entry.manifest),
      instanceId: defaults.instanceId || randomUUID(),
      data: result === undefined ? null : result,
      title: defaults.title,
      command: defaults.command,
      createdAt: Date.now(),
    };
  }

  private requireActiveEntry(pluginId: string): PluginEntry {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new PluginRuntimeError(`Plugin "${pluginId}" not found`, 404, 'PLUGIN_NOT_FOUND');
    if (!entry.enabled || !entry.active) {
      throw new PluginRuntimeError(`Plugin "${pluginId}" is disabled`, 409, 'PLUGIN_DISABLED');
    }
    return entry;
  }

  private assertNoCommandCollisions(candidate: PluginEntry): void {
    const claimed = new Map<string, string>();
    for (const entry of this.entries.values()) {
      if (entry === candidate || !entry.enabled || !entry.active) continue;
      for (const command of entry.manifest.contributes?.slashCommands ?? []) {
        for (const name of [command.name, ...(command.aliases ?? [])]) claimed.set(normalizeCommandName(name), entry.manifest.id);
      }
    }
    const local = new Set<string>();
    for (const command of candidate.manifest.contributes?.slashCommands ?? []) {
      for (const name of [command.name, ...(command.aliases ?? [])]) {
        const normalized = normalizeCommandName(name);
        if (local.has(normalized)) throw new PluginRuntimeError(`Plugin declares slash command "${normalized}" more than once`);
        local.add(normalized);
        const owner = claimed.get(normalized);
        if (owner) throw new PluginRuntimeError(`Slash command "${normalized}" is already provided by plugin "${owner}"`, 409, 'PLUGIN_COMMAND_CONFLICT');
      }
    }
  }

  private async activateEntry(entry: PluginEntry): Promise<void> {
    if (entry.active) return;
    this.assertNoCommandCollisions(entry);
    entry.commandHandlers.clear();
    entry.actionHandlers.clear();
    entry.registrationCleanups.length = 0;
    entry.deactivate = undefined;

    const api = this.createPluginApi(entry);
    try {
      let activate: TideServerPluginActivate | undefined = entry.activateBuiltin;
      let moduleObject: TideServerPluginModule | undefined;
      if (!activate && entry.manifest.main) {
        const mainPath = await resolveContainedFile(entry.rootDir, entry.manifest.main, 'main');
        const stat = await fsp.stat(mainPath);
        const url = pathToFileURL(mainPath);
        url.searchParams.set('tide', String(stat.mtimeMs));
        const imported = await import(url.href) as TideServerPluginModule;
        moduleObject = imported;
        if (typeof imported.activate === 'function') activate = imported.activate;
        else if (typeof imported.default === 'function') activate = imported.default;
        else if (isRecord(imported.default) && typeof imported.default.activate === 'function') {
          activate = imported.default.activate as TideServerPluginActivate;
          moduleObject = imported.default as TideServerPluginModule;
        }
      }

      this.registerActivationHandlers(entry, moduleObject);
      const activation = activate ? await activate(api) : undefined;
      if (typeof activation === 'function') {
        entry.deactivate = activation;
      } else if (isRecord(activation)) {
        const lifecycle = activation as TideServerPluginActivation;
        this.registerActivationHandlers(entry, lifecycle);
        const deactivate = lifecycle.deactivate ?? lifecycle.dispose ?? lifecycle.shutdown;
        entry.deactivate = deactivate ? deactivate.bind(lifecycle) : undefined;
      } else if (moduleObject) {
        const deactivate = moduleObject.deactivate ?? moduleObject.dispose ?? moduleObject.shutdown;
        entry.deactivate = deactivate ? deactivate.bind(moduleObject) : undefined;
      }
      entry.active = true;
      entry.error = undefined;
    } catch (error) {
      await this.cleanupFailedActivation(entry);
      throw error;
    }
  }

  private registerActivationHandlers(entry: PluginEntry, activation: TideServerPluginActivation | TideServerPluginModule | undefined): void {
    if (!activation) return;
    for (const [name, handler] of Object.entries(activation.commands ?? {})) {
      if (typeof handler === 'function') entry.commandHandlers.set(normalizeHandlerName(name), handler);
    }
    for (const [name, handler] of Object.entries(activation.actions ?? {})) {
      if (typeof handler === 'function') entry.actionHandlers.set(normalizeHandlerName(name), handler);
    }
  }

  private createPluginApi(entry: PluginEntry): TideServerPluginApi {
    const register = <T extends PluginCommandHandler | PluginActionHandler>(
      target: Map<string, T>,
      name: string,
      handler: T,
    ): (() => void) => {
      const normalized = normalizeHandlerName(name);
      if (!HANDLER_RE.test(normalized) || typeof handler !== 'function') {
        throw new PluginRuntimeError(`Invalid plugin handler registration: ${name}`);
      }
      target.set(normalized, handler);
      const cleanup = () => {
        if (target.get(normalized) === handler) target.delete(normalized);
      };
      entry.registrationCleanups.push(cleanup);
      return cleanup;
    };
    return {
      pluginId: entry.manifest.id,
      manifest: entry.manifest,
      sourcePath: entry.rootDir,
      registerCommand: (name, handler) => register(entry.commandHandlers, name, handler),
      registerAction: (name, handler) => register(entry.actionHandlers, name, handler),
      emitOutput: (agentId, output) => this.publishOutput(agentId, {
        ...output,
        pluginId: entry.manifest.id,
        createdAt: output.createdAt ?? Date.now(),
      }),
      emitPatch: (agentId, instanceId, data) => this.publishPatch(agentId, entry.manifest.id, instanceId, data),
      log: {
        info: (message, ...args) => log.log(`[${entry.manifest.id}] ${message}`, ...args),
        warn: (message, ...args) => log.warn(`[${entry.manifest.id}] ${message}`, ...args),
        error: (message, ...args) => log.error(`[${entry.manifest.id}] ${message}`, ...args),
      },
    };
  }

  private async deactivateEntry(entry: PluginEntry): Promise<void> {
    if (!entry.active && !entry.deactivate && entry.registrationCleanups.length === 0) return;
    let failure: unknown;
    try {
      await entry.deactivate?.();
    } catch (error) {
      failure = error;
      entry.error = `Deactivate failed: ${errorMessage(error)}`;
      log.error(`Plugin ${entry.manifest.id} deactivate failed:`, error);
    } finally {
      for (const cleanup of entry.registrationCleanups.splice(0).reverse()) {
        try { cleanup(); } catch { /* registration cleanup is best effort */ }
      }
      entry.commandHandlers.clear();
      entry.actionHandlers.clear();
      entry.deactivate = undefined;
      entry.active = false;
    }
    if (!failure) entry.error = undefined;
  }

  private async cleanupFailedActivation(entry: PluginEntry): Promise<void> {
    try { await entry.deactivate?.(); } catch { /* original activation error wins */ }
    for (const cleanup of entry.registrationCleanups.splice(0).reverse()) {
      try { cleanup(); } catch { /* best effort */ }
    }
    entry.commandHandlers.clear();
    entry.actionHandlers.clear();
    entry.deactivate = undefined;
    entry.active = false;
  }

  private async loadExternalEntry(sourcePath: string, enabled: boolean): Promise<PluginEntry> {
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
      throw new PluginRuntimeError('sourcePath must be an absolute local directory path');
    }
    let rootDir: string;
    try {
      rootDir = await fsp.realpath(sourcePath);
    } catch {
      throw new PluginRuntimeError('Plugin sourcePath does not exist', 404, 'PLUGIN_SOURCE_NOT_FOUND');
    }
    const stat = await fsp.stat(rootDir);
    if (!stat.isDirectory()) throw new PluginRuntimeError('Plugin sourcePath must be a directory');

    const tideManifestPath = path.join(rootDir, 'tide-plugin.json');
    const genericManifestPath = path.join(rootDir, 'manifest.json');
    const packageManifestPath = path.join(rootDir, 'package.json');
    const manifestPath = fs.existsSync(tideManifestPath)
      ? tideManifestPath
      : fs.existsSync(genericManifestPath)
        ? genericManifestPath
        : fs.existsSync(packageManifestPath)
          ? packageManifestPath
          : undefined;
    if (!manifestPath) {
      throw new PluginRuntimeError(
        'Plugin directory must contain manifest.json, tide-plugin.json, or package.json',
        422,
        'PLUGIN_MANIFEST_MISSING',
      );
    }

    let packageJson: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as unknown;
      if (!isRecord(parsed)) throw new Error('not an object');
      packageJson = parsed;
    } catch (error) {
      throw new PluginRuntimeError(`Invalid plugin manifest JSON: ${errorMessage(error)}`, 422, 'PLUGIN_MANIFEST_INVALID');
    }

    let rawManifest: unknown = packageJson;
    if (manifestPath === packageManifestPath) {
      const tideCommander = isRecord(packageJson.tideCommander) ? packageJson.tideCommander : undefined;
      rawManifest = packageJson.tidePlugin
        ?? (tideCommander?.plugin ?? tideCommander)
        ?? packageJson;
    }
    const manifest = validateManifest(rawManifest, packageJson);
    if (!manifest.main && !manifest.browser && !manifest.contributes) {
      throw new PluginRuntimeError('Plugin manifest must define main, browser, or contributes', 422, 'PLUGIN_MANIFEST_EMPTY');
    }
    if (manifest.main) await resolveContainedFile(rootDir, manifest.main, 'main');
    if (manifest.browser) await resolveContainedFile(rootDir, manifest.browser, 'browser');

    return {
      manifest,
      rootDir,
      manifestPath,
      builtin: false,
      enabled,
      active: false,
      commandHandlers: new Map(),
      actionHandlers: new Map(),
      registrationCleanups: [],
    };
  }

  private toCatalogEntry(entry: PluginEntry): PluginCatalogEntry {
    return {
      id: entry.manifest.id,
      name: entry.manifest.name,
      version: entry.manifest.version,
      description: entry.manifest.description,
      enabled: entry.enabled && entry.active,
      builtin: entry.builtin || undefined,
      source: entry.builtin ? 'builtin' : 'installed',
      clientEntry: !entry.builtin && entry.manifest.browser
        ? `/api/plugins/${encodeURIComponent(entry.manifest.id)}/client`
        : undefined,
      manifest: entry.manifest,
      contributes: entry.manifest.contributes,
      error: entry.error,
    };
  }

  private async readState(): Promise<PluginStateFile> {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.stateFile, 'utf8')) as unknown;
      if (!isRecord(parsed)) throw new Error('state is not an object');
      const installed = Array.isArray(parsed.installed)
        ? parsed.installed.filter((record): record is PersistedPluginRecord => (
          isRecord(record) && typeof record.sourcePath === 'string' && typeof record.enabled === 'boolean'
        ))
        : [];
      const enabled = isRecord(parsed.enabled)
        ? Object.fromEntries(Object.entries(parsed.enabled).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
        : {};
      return { version: 1, installed, enabled };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log.error('Failed to read plugin state; using defaults:', error);
      return { version: 1, installed: [], enabled: {} };
    }
  }

  private async persistState(): Promise<void> {
    await fsp.mkdir(this.dataDir, { recursive: true });
    for (const entry of this.entries.values()) {
      if (!entry.builtin) this.persistedInstalled.set(entry.rootDir, { sourcePath: entry.rootDir, enabled: entry.enabled });
    }
    const enabled = Object.fromEntries(
      Array.from(this.entries.values()).filter((entry) => entry.builtin).map((entry) => [entry.manifest.id, entry.enabled]),
    );
    const state: PluginStateFile = {
      version: 1,
      installed: Array.from(this.persistedInstalled.values()),
      enabled,
    };
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temporary, this.stateFile);
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new PluginRuntimeError('Plugin manager is not initialized', 503, 'PLUGIN_MANAGER_UNAVAILABLE');
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
