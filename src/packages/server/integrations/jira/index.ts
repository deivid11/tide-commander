/**
 * Jira Integration Plugin
 * Exports jiraPlugin implementing IntegrationPlugin.
 *
 * Connects to Jira Cloud via REST API v3 to create, update, and track
 * Service Desk tickets. Supports webhook-based triggers and custom field mappings.
 */

import type {
  IntegrationPlugin,
  IntegrationContext,
  IntegrationStatus,
  ConfigField,
  TriggerHandler,
} from '../../../shared/integration-types.js';
import { JiraClient } from './jira-client.js';
import { createJiraRoutes } from './jira-routes.js';
import { jiraSkill } from './jira-skill.js';
import { jiraTriggerHandler } from './jira-trigger-handler.js';
import { jiraConfigSchema, type JiraConfig } from './jira-config.js';

// ─── Plugin State ───

let ctx: IntegrationContext | null = null;
let client: JiraClient | null = null;
let configured = false;
let lastError: string | undefined;
let lastChecked = 0;

// ─── Helpers ───

function getConfigValue(key: keyof JiraConfig): string | undefined {
  if (!ctx) return undefined;
  return ctx.secrets.get(key) || undefined;
}

function isFullyConfigured(): boolean {
  return Boolean(
    getConfigValue('jira_base_url') &&
    getConfigValue('jira_email') &&
    getConfigValue('jira_api_token')
  );
}

function reconfigure(): void {
  if (!ctx || !client) return;

  const baseUrl = getConfigValue('jira_base_url');
  const email = getConfigValue('jira_email');
  const apiToken = getConfigValue('jira_api_token');

  if (baseUrl && email && apiToken) {
    client.configure(baseUrl, email, apiToken);
    configured = true;
    lastError = undefined;
    ctx.log.info(`Configured for ${baseUrl}`);
  } else {
    configured = false;
    lastError = 'Missing required configuration (base URL, email, or API token)';
  }

  lastChecked = Date.now();
}

// ─── Plugin Export ───

export const jiraPlugin: IntegrationPlugin = {
  id: 'jira',
  name: 'Jira Service Desk',
  description: 'Create, update, and track Jira Service Desk tickets for change control processes',
  routePrefix: '/jira',

  async init(context: IntegrationContext): Promise<void> {
    ctx = context;
    client = new JiraClient(ctx);

    reconfigure();

    if (configured) {
      ctx.log.info('Jira integration initialized');
    } else {
      ctx.log.warn('Jira integration not configured — set base URL, email, and API token in settings');
    }
  },

  async shutdown(): Promise<void> {
    // REST-only — no persistent connections to close
    client = null;
    ctx = null;
    configured = false;
  },

  getRoutes(): unknown {
    if (!client || !ctx) {
      throw new Error('Jira plugin not initialized');
    }
    return createJiraRoutes(client, ctx);
  },

  getSkills(): unknown[] {
    return [jiraSkill];
  },

  getTriggerHandler(): TriggerHandler | null {
    return jiraTriggerHandler;
  },

  getStatus(): IntegrationStatus {
    return {
      connected: configured,
      lastChecked,
      error: lastError,
    };
  },

  getConfigSchema(): ConfigField[] {
    return jiraConfigSchema;
  },

  getConfig(): Record<string, unknown> {
    // Return current config values, masking secrets
    return {
      jira_base_url: getConfigValue('jira_base_url') ?? '',
      jira_email: getConfigValue('jira_email') ?? '',
      jira_api_token: getConfigValue('jira_api_token') ? '••••••••' : '',
      jira_default_project: getConfigValue('jira_default_project') ?? '',
      jira_default_issue_type: getConfigValue('jira_default_issue_type') ?? '',
      jira_webhook_secret: getConfigValue('jira_webhook_secret') ? '••••••••' : '',
      jira_custom_field_mappings: getConfigValue('jira_custom_field_mappings') ?? '',
    };
  },

  async setConfig(config: Record<string, unknown>): Promise<void> {
    if (!ctx) throw new Error('Jira plugin not initialized');

    // Persist each config value to the secrets store
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.length > 0 && value !== '••••••••') {
        ctx.secrets.set(key, value);
      }
    }

    // Re-initialize client with new config
    reconfigure();
  },
};
