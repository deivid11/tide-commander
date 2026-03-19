/**
 * DOCX Integration Plugin
 * Implements IntegrationPlugin interface for document generation from templates.
 */

import type {
  IntegrationPlugin,
  IntegrationContext,
  IntegrationStatus,
  ConfigField,
  TriggerHandler,
} from '../../../shared/integration-types.js';
import { docxConfigSchema, type DocxConfig } from './docx-config.js';
import { initEvents } from './docx-events.js';
import * as docxEngine from './docx-engine.js';
import docxRoutes from './docx-routes.js';
import { docxSkill } from './docx-skill.js';

let initialized = false;

export const docxPlugin: IntegrationPlugin = {
  id: 'docx',
  name: 'Document Generator',
  description: 'Generate DOCX documents from templates with variable substitution and PDF conversion',
  routePrefix: '/documents',

  // ─── Lifecycle ───

  async init(ctx: IntegrationContext): Promise<void> {
    initEvents(ctx);

    // Build config from current values (defaults only for first run)
    const cfg: Partial<DocxConfig> = {};
    const stored = docxPlugin.getConfig();
    if (stored.templateDir) cfg.templateDir = stored.templateDir as string;
    if (stored.generatedDir) cfg.generatedDir = stored.generatedDir as string;
    if (stored.retentionDays !== undefined) cfg.retentionDays = stored.retentionDays as number;
    if (stored.libreOfficePath) cfg.libreOfficePath = stored.libreOfficePath as string;

    docxEngine.init(ctx, cfg);
    initialized = true;
    ctx.log.info('DOCX integration initialized');
  },

  async shutdown(): Promise<void> {
    initialized = false;
  },

  // ─── Capabilities ───

  getRoutes(): unknown {
    return docxRoutes;
  },

  getSkills(): unknown[] {
    return [docxSkill];
  },

  getTriggerHandler(): TriggerHandler | null {
    // DOCX integration does not provide triggers
    return null;
  },

  getStatus(): IntegrationStatus {
    return {
      connected: initialized,
      lastChecked: Date.now(),
    };
  },

  // ─── Configuration ───

  getConfigSchema(): ConfigField[] {
    return docxConfigSchema;
  },

  getConfig(): Record<string, unknown> {
    if (!initialized) return {};
    const cfg = docxEngine.getConfig();
    return {
      templateDir: cfg.templateDir,
      generatedDir: cfg.generatedDir,
      retentionDays: cfg.retentionDays,
      libreOfficePath: cfg.libreOfficePath,
    };
  },

  async setConfig(config: Record<string, unknown>): Promise<void> {
    const updates: Partial<DocxConfig> = {};
    if (config.templateDir !== undefined) updates.templateDir = config.templateDir as string;
    if (config.generatedDir !== undefined) updates.generatedDir = config.generatedDir as string;
    if (config.retentionDays !== undefined) updates.retentionDays = config.retentionDays as number;
    if (config.libreOfficePath !== undefined) updates.libreOfficePath = config.libreOfficePath as string;
    docxEngine.updateConfig(updates);
  },
};
