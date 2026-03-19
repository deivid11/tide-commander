/**
 * Google Calendar Integration Plugin
 * Exports googleCalendarPlugin implementing IntegrationPlugin.
 * Shares OAuth2 credentials with the Gmail plugin via the shared secrets system.
 * No trigger handler — calendar doesn't provide triggers.
 */

import type { IntegrationPlugin, IntegrationContext } from '../../../shared/integration-types.js';
import * as calendarClient from './calendar-client.js';
import calendarRoutes from './calendar-routes.js';
import { calendarSkill } from './calendar-skill.js';
import { calendarConfigSchema, getConfigValues, setConfigValues, loadConfig } from './calendar-config.js';

let integrationCtx: IntegrationContext | null = null;

export const googleCalendarPlugin: IntegrationPlugin = {
  id: 'google-calendar',
  name: 'Google Calendar',
  description: 'Create and manage Google Calendar events, schedule release windows',
  routePrefix: '/calendar',

  async init(ctx: IntegrationContext) {
    integrationCtx = ctx;
    await calendarClient.init(ctx);
  },

  async shutdown() {
    await calendarClient.shutdown();
  },

  getRoutes() {
    return calendarRoutes;
  },

  getSkills() {
    return [calendarSkill];
  },

  getTriggerHandler() {
    return null; // Calendar doesn't provide triggers
  },

  getStatus() {
    return calendarClient.getStatus();
  },

  getConfigSchema() {
    return calendarConfigSchema;
  },

  getConfig() {
    if (!integrationCtx) {
      const config = loadConfig();
      return {
        enabled: config.enabled,
        calendarId: config.calendarId,
        holidays: config.holidays.join('\n'),
        urgentThreshold: config.urgentThreshold,
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        GOOGLE_REFRESH_TOKEN: '',
      };
    }
    return getConfigValues(integrationCtx.secrets);
  },

  async setConfig(config: Record<string, unknown>) {
    if (!integrationCtx) throw new Error('Google Calendar not initialized');
    await setConfigValues(config, integrationCtx.secrets);
  },
};
