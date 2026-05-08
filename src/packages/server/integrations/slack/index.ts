/**
 * Slack Integration Plugin
 * Exports slackPlugin implementing IntegrationPlugin.
 *
 * Multi-instance: this plugin owns N independent Slack connections (e.g. one
 * for a team bot using xoxb-, one for the user's personal xoxp- token). Each
 * instance has its own config file, secret keys, and watermark file, but they
 * share the same dispatcher pipeline (so triggers / wait-for-reply / WS
 * broadcasts work uniformly).
 *
 * The IntegrationPlugin contract is per-plugin, not per-instance — Slack
 * exposes its instance management through a custom settings component
 * (registered via `getCustomSettingsComponent()`) and dedicated /instances
 * CRUD routes.
 */

import type { IntegrationPlugin, IntegrationContext } from '../../../shared/integration-types.js';
import * as slackClient from './slack-client.js';
import slackRoutes, { setIntegrationContextForRoutes } from './slack-routes.js';
import { slackTriggerHandler } from './slack-trigger-handler.js';
import { slackSkill } from './slack-skill.js';
import {
  slackConfigSchema,
  getConfigValues,
  setConfigValues,
  loadConfig,
} from './slack-config.js';
import {
  getInstance,
  listInstances,
  DEFAULT_INSTANCE_ID,
} from './slack-instance.js';
import { listInstanceMetas } from './slack-instance-manifest.js';

let integrationCtx: IntegrationContext | null = null;

export const slackPlugin: IntegrationPlugin = {
  id: 'slack',
  name: 'Slack',
  description: 'Bidirectional Slack messaging for agents (multi-instance)',
  routePrefix: '/slack',

  async init(ctx: IntegrationContext) {
    integrationCtx = ctx;
    setIntegrationContextForRoutes(ctx);

    // Bring up every instance from the manifest. The default instance is
    // always present (the manifest auto-creates it); user-added instances
    // come in alongside it.
    const metas = listInstanceMetas();
    for (const meta of metas) {
      const inst = getInstance(meta.id);
      inst.setContext(ctx);
      try {
        await inst.init();
      } catch (err) {
        ctx.log.error(`Slack[${meta.id}] init failed: ${err}`);
        // One bad instance shouldn't take the others down.
      }
    }
  },

  async shutdown() {
    setIntegrationContextForRoutes(null);
    await slackClient.shutdown();
  },

  getRoutes() {
    return slackRoutes;
  },

  getSkills() {
    return [slackSkill];
  },

  getTriggerHandler() {
    return slackTriggerHandler;
  },

  /**
   * Status reflects the default instance (back-compat for the generic UI).
   * Per-instance status is exposed through GET /api/slack/instances and the
   * custom settings component reads from there.
   */
  getStatus() {
    return getInstance(DEFAULT_INSTANCE_ID).getStatus();
  },

  getConfigSchema() {
    return slackConfigSchema;
  },

  /**
   * The generic UI calls getConfig once and gets the default-instance values.
   * The custom multi-instance UI uses /api/slack/instances/:id for per-instance
   * config.
   */
  getConfig() {
    if (!integrationCtx) {
      const config = loadConfig(DEFAULT_INSTANCE_ID);
      return {
        enabled: config.enabled,
        defaultChannelId: config.defaultChannelId || '',
        SLACK_BOT_TOKEN: '',
        SLACK_APP_TOKEN: '',
      };
    }
    return getConfigValues(integrationCtx.secrets, DEFAULT_INSTANCE_ID);
  },

  async setConfig(config: Record<string, unknown>) {
    if (!integrationCtx) throw new Error('Slack not initialized');
    await setConfigValues(config, integrationCtx.secrets, DEFAULT_INSTANCE_ID);

    // Reconnect the default instance based on its new config / secrets.
    const updated = loadConfig(DEFAULT_INSTANCE_ID);
    const botToken = integrationCtx.secrets.get('SLACK_BOT_TOKEN');

    const inst = getInstance(DEFAULT_INSTANCE_ID);
    if (updated.enabled && botToken) {
      try {
        await inst.reconnect();
      } catch {
        // Error captured via updateConfig's status:'error' path.
      }
    } else if (!updated.enabled && inst.isConnected()) {
      await inst.disconnect();
    }
  },

  /**
   * Tells the frontend to render the custom multi-instance UI instead of the
   * generic single-form schema renderer. The component name is mapped client-
   * side in IntegrationsPanel.tsx.
   */
  getCustomSettingsComponent() {
    return 'slack-multi-instance';
  },
};

// Re-export for use by routes / trigger handler.
export { listInstances };
