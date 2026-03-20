/**
 * Gmail Integration Plugin
 * Exports gmailPlugin implementing IntegrationPlugin.
 * Wires together gmail-client, gmail-routes, gmail-skill, and gmail-config.
 */

import type { IntegrationPlugin, IntegrationContext } from '../../../shared/integration-types.js';
import * as gmailClient from './gmail-client.js';
import gmailRoutes from './gmail-routes.js';
import { gmailSkill } from './gmail-skill.js';
import { gmailConfigSchema } from './gmail-config.js';

let integrationCtx: IntegrationContext | null = null;

export const gmailPlugin: IntegrationPlugin = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Email sending, receiving, and approval checking via Gmail',
  routePrefix: '/email',

  async init(ctx: IntegrationContext) {
    integrationCtx = ctx;
    await gmailClient.init(ctx);
  },

  async shutdown() {
    gmailClient.shutdown();
  },

  getRoutes() {
    return gmailRoutes;
  },

  getSkills() {
    return [gmailSkill];
  },

  getTriggerHandler() {
    return null;
  },

  getStatus() {
    return gmailClient.getStatus();
  },

  getConfigSchema() {
    return gmailConfigSchema;
  },

  getConfig() {
    if (!integrationCtx) {
      return {
        clientId: '',
        clientSecret: '',
        pollingIntervalMs: 30000,
        defaultApprovalKeywords: 'approved,aprobado,autorizado,yes,ok',
      };
    }
    return {
      clientId: integrationCtx.secrets.get('GOOGLE_CLIENT_ID') || '',
      clientSecret: integrationCtx.secrets.get('GOOGLE_CLIENT_SECRET') || '',
      pollingIntervalMs: gmailClient.getConfig().pollingIntervalMs,
      defaultApprovalKeywords: gmailClient.getConfig().defaultApprovalKeywords.join(','),
    };
  },

  async setConfig(config: Record<string, unknown>) {
    if (!integrationCtx) throw new Error('Gmail not initialized');

    const updates: Record<string, string | number | string[]> = {};

    if (config.clientId) {
      updates.clientId = config.clientId as string;
      integrationCtx.secrets.set('GOOGLE_CLIENT_ID', config.clientId as string);
    }
    if (config.clientSecret) {
      updates.clientSecret = config.clientSecret as string;
      integrationCtx.secrets.set('GOOGLE_CLIENT_SECRET', config.clientSecret as string);
    }
    if (config.pollingIntervalMs) {
      updates.pollingIntervalMs = config.pollingIntervalMs as number;
    }
    if (config.defaultApprovalKeywords) {
      const keywords = (config.defaultApprovalKeywords as string)
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);
      updates.defaultApprovalKeywords = keywords;
    }

    gmailClient.updateConfig(updates);
  },

  getCustomSettingsComponent() {
    return 'gmail-oauth';
  },
};
