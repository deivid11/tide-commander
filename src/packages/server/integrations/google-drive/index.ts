/**
 * Google Drive Integration Plugin
 * Exports googleDrivePlugin implementing IntegrationPlugin.
 * Shares OAuth2 credentials with Gmail/Calendar plugins via the shared secrets system.
 * No trigger handler — Drive doesn't provide triggers.
 */

import type { IntegrationPlugin, IntegrationContext } from '../../../shared/integration-types.js';
import * as driveClient from './drive-client.js';
import driveRoutes from './drive-routes.js';
import { driveSkill } from './drive-skill.js';
import { driveConfigSchema, getConfigValues, setConfigValues, loadConfig } from './drive-config.js';

let integrationCtx: IntegrationContext | null = null;

export const googleDrivePlugin: IntegrationPlugin = {
  id: 'google-drive',
  name: 'Google Drive',
  description: 'Read, create, and edit files in Google Drive',
  routePrefix: '/drive',

  async init(ctx: IntegrationContext) {
    integrationCtx = ctx;
    await driveClient.init(ctx);
  },

  async shutdown() {
    await driveClient.shutdown();
  },

  getRoutes() {
    return driveRoutes;
  },

  getSkills() {
    return [driveSkill];
  },

  getTriggerHandler() {
    return null; // Drive doesn't provide triggers
  },

  getStatus() {
    return driveClient.getStatus();
  },

  getConfigSchema() {
    return driveConfigSchema;
  },

  getConfig() {
    if (!integrationCtx) {
      const config = loadConfig();
      return {
        enabled: config.enabled,
        defaultFolderId: config.defaultFolderId,
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        GOOGLE_REFRESH_TOKEN: '',
      };
    }
    return getConfigValues(integrationCtx.secrets);
  },

  async setConfig(config: Record<string, unknown>) {
    if (!integrationCtx) throw new Error('Google Drive not initialized');
    await setConfigValues(config, integrationCtx.secrets);
  },

  getCustomSettingsComponent() {
    return 'google-oauth';
  },
};
