/**
 * Integration Registry
 * Loads, initializes, and wires all integration plugins.
 * Each plugin is explicitly registered — no dynamic scanning.
 */

import type { Express } from 'express';
import type {
  IntegrationPlugin,
  IntegrationContext,
  IntegrationStatus,
  ConfigField,
  TriggerHandler,
  IntegrationInfo,
} from '../../shared/integration-types.js';
import type { BuiltinSkillDefinition } from '../data/builtin-skills/types.js';
import { createLogger } from '../utils/logger.js';
import { slackPlugin } from './slack/index.js';
import { docxPlugin } from './docx/index.js';
import { jiraPlugin } from './jira/index.js';
import { googleCalendarPlugin } from './google-calendar/index.js';

const log = createLogger('Integrations');

// ─── Plugin Registration ───

// Explicit registration — no dynamic scanning.
// Add new plugins here as they are implemented.
const ALL_PLUGINS: IntegrationPlugin[] = [
  slackPlugin,
  // gmailPlugin,
  googleCalendarPlugin,
  docxPlugin,
  jiraPlugin,
];

const plugins = new Map<string, IntegrationPlugin>();

// ─── Lifecycle ───

/** Initialize all integrations. Called once at server startup. */
export async function initIntegrations(ctx: IntegrationContext): Promise<void> {
  for (const plugin of ALL_PLUGINS) {
    try {
      await plugin.init(ctx);
      plugins.set(plugin.id, plugin);
      log.log(`Integration loaded: ${plugin.name}`);
    } catch (err) {
      log.error(`Failed to load integration ${plugin.name}: ${err}`);
      // Integration failure is non-fatal — other integrations still work
    }
  }
}

/** Shut down all integrations gracefully. */
export async function shutdownIntegrations(): Promise<void> {
  for (const [, plugin] of plugins) {
    try {
      await plugin.shutdown();
    } catch (err) {
      log.error(`Failed to shut down integration ${plugin.id}: ${err}`);
    }
  }
  plugins.clear();
}

// ─── Accessors ───

/** Get all loaded plugins. */
export function getPlugins(): IntegrationPlugin[] {
  return Array.from(plugins.values());
}

/** Get a specific plugin by ID. */
export function getPlugin(id: string): IntegrationPlugin | undefined {
  return plugins.get(id);
}

// ─── Wiring Helpers ───

/** Mount all integration routes on the Express app. */
export function mountIntegrationRoutes(app: Express): void {
  for (const plugin of plugins.values()) {
    app.use(`/api${plugin.routePrefix}`, plugin.getRoutes() as import('express').Router);
  }
}

/** Collect all integration skills for the skill service. */
export function getIntegrationSkills(): BuiltinSkillDefinition[] {
  return Array.from(plugins.values()).flatMap(
    (p) => p.getSkills() as BuiltinSkillDefinition[]
  );
}

/** Collect all trigger handlers for the trigger service. */
export function getIntegrationTriggerHandlers(): TriggerHandler[] {
  return Array.from(plugins.values())
    .map((p) => p.getTriggerHandler())
    .filter((h): h is TriggerHandler => h !== null);
}

/** Get all integration statuses (for the UI). */
export function getIntegrationStatuses(): { id: string; name: string; status: IntegrationStatus }[] {
  return Array.from(plugins.values()).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.getStatus(),
  }));
}

/** Get all config schemas (for the generic settings UI). */
export function getIntegrationConfigs(): IntegrationInfo[] {
  return Array.from(plugins.values()).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    schema: p.getConfigSchema(),
    values: p.getConfig(),
    status: p.getStatus(),
    customComponent: p.getCustomSettingsComponent?.() ?? undefined,
  }));
}
