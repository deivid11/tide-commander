/**
 * Slack Integration Plugin
 * Exports slackPlugin implementing IntegrationPlugin.
 * Wires together slack-client, slack-routes, slack-trigger-handler, slack-skill, and slack-config.
 */

import type { IntegrationPlugin, IntegrationContext } from '../../../shared/integration-types.js';
import * as slackClient from './slack-client.js';
import slackRoutes from './slack-routes.js';
import { slackTriggerHandler } from './slack-trigger-handler.js';
import { slackSkill } from './slack-skill.js';
import { slackConfigSchema, getConfigValues, setConfigValues, loadConfig } from './slack-config.js';

let integrationCtx: IntegrationContext | null = null;

export const slackPlugin: IntegrationPlugin = {
  id: 'slack',
  name: 'Slack',
  description: 'Bidirectional Slack messaging for agents',
  routePrefix: '/slack',

  async init(ctx: IntegrationContext) {
    integrationCtx = ctx;
    await slackClient.init(ctx);
  },

  async shutdown() {
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

  getStatus() {
    return slackClient.getStatus();
  },

  getConfigSchema() {
    return slackConfigSchema;
  },

  getConfig() {
    if (!integrationCtx) {
      const config = loadConfig();
      return {
        enabled: config.enabled,
        defaultChannelId: config.defaultChannelId || '',
        SLACK_BOT_TOKEN: '',
        SLACK_APP_TOKEN: '',
      };
    }
    return getConfigValues(integrationCtx.secrets);
  },

  async setConfig(config: Record<string, unknown>) {
    if (!integrationCtx) throw new Error('Slack not initialized');
    await setConfigValues(config, integrationCtx.secrets);
  },
};
