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
import { gmailTriggerHandler } from './gmail-trigger-handler.js';

let integrationCtx: IntegrationContext | null = null;

export const gmailPlugin: IntegrationPlugin = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Send and receive emails through Gmail. Supports OAuth 2.0 and Service Account authentication.',
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
    return gmailTriggerHandler;
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
        authMethod: 'oauth2',
        clientId: '',
        clientSecret: '',
        serviceAccountJson: '',
        impersonateEmail: '',
        pollingIntervalMs: 30000,
        defaultApprovalKeywords: 'approved,aprobado,autorizado,yes,ok',
      };
    }
    return {
      authMethod: gmailClient.getConfig().authMethod || 'oauth2',
      // Mask shared OAuth credentials with '********' placeholder (consistent with
      // Calendar and Drive integrations, which share these same secrets).
      clientId: integrationCtx.secrets.get('GOOGLE_CLIENT_ID') ? '********' : '',
      clientSecret: integrationCtx.secrets.get('GOOGLE_CLIENT_SECRET') ? '********' : '',
      serviceAccountJson: integrationCtx.secrets.get('GOOGLE_SERVICE_ACCOUNT_JSON') ? '********' : '',
      impersonateEmail: integrationCtx.secrets.get('GOOGLE_IMPERSONATE_EMAIL') || '',
      pollingIntervalMs: gmailClient.getConfig().pollingIntervalMs,
      defaultApprovalKeywords: gmailClient.getConfig().defaultApprovalKeywords.join(','),
    };
  },

  async setConfig(config: Record<string, unknown>) {
    if (!integrationCtx) throw new Error('Gmail not initialized');

    const updates: Record<string, string | number | string[]> = {};

    if (config.authMethod !== undefined) {
      updates.authMethod = config.authMethod as string;
    }
    if (config.clientId && config.clientId !== '********') {
      updates.clientId = config.clientId as string;
      integrationCtx.secrets.set('GOOGLE_CLIENT_ID', config.clientId as string);
    }
    if (config.clientSecret && config.clientSecret !== '********') {
      updates.clientSecret = config.clientSecret as string;
      integrationCtx.secrets.set('GOOGLE_CLIENT_SECRET', config.clientSecret as string);
    }
    if (config.serviceAccountJson && config.serviceAccountJson !== '********') {
      updates.serviceAccountJson = config.serviceAccountJson as string;
      integrationCtx.secrets.set('GOOGLE_SERVICE_ACCOUNT_JSON', config.serviceAccountJson as string);
    }
    if (config.impersonateEmail) {
      updates.impersonateEmail = config.impersonateEmail as string;
      integrationCtx.secrets.set('GOOGLE_IMPERSONATE_EMAIL', config.impersonateEmail as string);
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

    // Re-initialize authentication when auth method or credentials change
    if (config.authMethod !== undefined || config.serviceAccountJson || config.clientId) {
      gmailClient.shutdown();
      await gmailClient.init(integrationCtx);
    }
  },

  getCustomSettingsComponent() {
    return 'gmail-oauth';
  },
};
