/**
 * WhatsApp Integration Plugin
 * Exports whatsappPlugin implementing IntegrationPlugin.
 *
 * Phase 1: outbound session management + send-message.
 * Phase 2: long-lived WS subscription to the upstream whatsapp-api server,
 *          rebroadcasting incoming messages on the TC client WS.
 *
 * Wraps the local WhatsApp API server (default http://localhost:3007, X-API-Key auth).
 */

import type {
  IntegrationPlugin,
  IntegrationContext,
  IntegrationStatus,
  ConfigField,
  TriggerHandler,
} from '../../../shared/integration-types.js';
import { createWhatsAppRoutes } from './whatsapp-routes.js';
import {
  whatsappConfigSchema,
  getConfigValues,
  setConfigValues,
  loadConfig,
  WHATSAPP_API_KEY_SECRET,
} from './whatsapp-config.js';
import {
  createWhatsAppTriggerHandler,
  type WhatsAppMessageBridge,
} from './whatsapp-trigger-handler.js';
import { whatsappSkill } from './whatsapp-skill.js';

let integrationCtx: IntegrationContext | null = null;
let lastChecked = 0;
let lastError: string | undefined;

// Bridge cache — module-level so syncBridge() can compare and bounce only on change.
let bridge: WhatsAppMessageBridge | null = null;
let bridgeBaseUrl: string | undefined;
let bridgeApiKey: string | undefined;
let bridgeEnabled = false;

/**
 * Reconcile the WS bridge against the latest persisted config + secrets.
 * Idempotent: no-op when nothing relevant changed; restarts the bridge when
 * `enabled`, `baseUrl`, or the API key changes; tears down when disabled or
 * the key is cleared.
 *
 * Exported so the dedicated REST handlers (POST/DELETE /api-key, PATCH /config)
 * can call it after persisting their changes — without those calls the bridge
 * would only react to changes made through the generic plugin.setConfig path.
 */
export function syncBridge(ctx: IntegrationContext): void {
  const config = loadConfig();
  const apiKey = ctx.secrets.get(WHATSAPP_API_KEY_SECRET);

  const targetEnabled = config.enabled;
  const targetBaseUrl = config.baseUrl;
  const targetApiKey = apiKey;

  lastChecked = Date.now();
  lastError = targetEnabled && !targetApiKey ? 'WhatsApp API key is not configured' : undefined;

  // No-op if nothing the bridge cares about changed.
  if (
    bridgeEnabled === targetEnabled &&
    bridgeBaseUrl === targetBaseUrl &&
    bridgeApiKey === targetApiKey
  ) {
    return;
  }

  // Tear down any existing bridge before (re)starting.
  if (bridge) {
    bridge.stop();
    bridge = null;
    ctx.log.info('WhatsApp message bridge: stopped (config change)');
  }

  // Start a fresh bridge if eligible. The bridge itself logs the actual WS connect.
  if (targetEnabled && targetApiKey) {
    bridge = createWhatsAppTriggerHandler(ctx);
    bridge.start();
  }

  bridgeEnabled = targetEnabled;
  bridgeBaseUrl = targetBaseUrl;
  bridgeApiKey = targetApiKey;
}

export const whatsappPlugin: IntegrationPlugin = {
  id: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages and manage Baileys sessions via the local WhatsApp API server',
  routePrefix: '/whatsapp',

  async init(ctx: IntegrationContext): Promise<void> {
    integrationCtx = ctx;
    const config = loadConfig();
    const apiKey = ctx.secrets.get(WHATSAPP_API_KEY_SECRET);

    if (!config.enabled) {
      ctx.log.info('WhatsApp integration disabled — skipping bridge start');
    } else if (!apiKey) {
      ctx.log.warn('WhatsApp integration enabled but missing API key');
    } else {
      ctx.log.info(`WhatsApp integration ready (baseUrl=${config.baseUrl})`);
    }

    syncBridge(ctx);
  },

  async shutdown(): Promise<void> {
    if (bridge) {
      bridge.stop();
      bridge = null;
    }
    bridgeBaseUrl = undefined;
    bridgeApiKey = undefined;
    bridgeEnabled = false;
    integrationCtx = null;
  },

  getRoutes(): unknown {
    if (!integrationCtx) {
      throw new Error('WhatsApp plugin not initialized');
    }
    return createWhatsAppRoutes(integrationCtx);
  },

  getSkills(): unknown[] {
    return [whatsappSkill];
  },

  getTriggerHandler(): TriggerHandler | null {
    // The TriggerHandler interface here is the trigger-service one.
    // Our incoming-message bridge is in-process and not surfaced through it.
    return null;
  },

  getStatus(): IntegrationStatus {
    const config = loadConfig();
    const apiKey = integrationCtx?.secrets.get(WHATSAPP_API_KEY_SECRET);
    return {
      connected: config.enabled && !!apiKey,
      lastChecked,
      error: lastError,
    };
  },

  getConfigSchema(): ConfigField[] {
    return whatsappConfigSchema;
  },

  getConfig(): Record<string, unknown> {
    if (!integrationCtx) {
      const config = loadConfig();
      return {
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        defaultSessionId: config.defaultSessionId || '',
        whatsappApiKey: '',
        webhookVerifyToken: config.webhookVerifyToken ? '********' : '',
      };
    }
    return getConfigValues(integrationCtx.secrets);
  },

  async setConfig(config: Record<string, unknown>): Promise<void> {
    if (!integrationCtx) throw new Error('WhatsApp plugin not initialized');
    await setConfigValues(config, integrationCtx.secrets);
    syncBridge(integrationCtx);
  },
};
