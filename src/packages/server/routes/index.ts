/**
 * Routes Module
 * Aggregates all route handlers
 */

import { Router, raw, Request, Response, NextFunction } from 'express';
import agentsRouter, { setBroadcast as setAgentsBroadcast } from './agents.js';
import filesRouter from './files.js';
import permissionsRouter from './permissions.js';
import notificationsRouter, { setBroadcast as setNotificationBroadcast } from './notifications.js';
import execRouter, { setBroadcast as setExecBroadcast } from './exec.js';
import focusAgentRouter, { setBroadcast as setFocusAgentBroadcast } from './focus-agent.js';
import customModelsRouter from './custom-models.js';
import configRouter from './config.js';
import ttsRouter from './tts.js';
import sttRouter from './stt.js';
import voiceAssistantRouter from './voice-assistant.js';
import snapshotsRouter from './snapshots.js';
import areasRouter from './areas.js';
import workspacesRouter from './workspaces.js';
import perfRouter from './perf.js';
import triggerRouter, { setBroadcast as setTriggerBroadcast } from './trigger-routes.js';
import integrationRouter from './integration-routes.js';
import eventRouter from './event-routes.js';
import workflowRouter from './workflow-routes.js';
import { getPlugins } from '../integrations/integration-registry.js';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Mount sub-routers
router.use('/agents', agentsRouter);
router.use('/files', filesRouter);
router.use('/notify', notificationsRouter);
router.use('/exec', execRouter);
router.use('/focus-agent', focusAgentRouter);
router.use('/custom-models', customModelsRouter);
router.use('/tts', ttsRouter);
router.use('/stt', sttRouter);
router.use('/voice-assistant', voiceAssistantRouter);
router.use('/snapshots', snapshotsRouter);
router.use('/areas', areasRouter);
router.use('/workspaces', workspacesRouter);
router.use('/perf', perfRouter);
router.use('/triggers', triggerRouter);
router.use('/integrations', integrationRouter);
router.use('/events', eventRouter);
router.use('/workflows', workflowRouter);
// Integration plugin routes (e.g. /api/slack/*, /api/documents/*, /api/jira/*)
// Uses lazy lookup so plugins can be registered after route setup
router.use((req: Request, res: Response, next: NextFunction) => {
  for (const plugin of getPlugins()) {
    const prefix = plugin.routePrefix;
    if (req.path.startsWith(prefix)) {
      const pluginRouter = plugin.getRoutes() as import('express').Router;
      req.url = req.url.slice(prefix.length) || '/';
      return pluginRouter(req, res, next);
    }
  }
  next();
});
// Config import/export routes - use raw body parser for ZIP file uploads
router.use('/config', raw({ type: 'application/zip', limit: '100mb' }), configRouter);
// Permission routes are mounted at root level since they're called as /api/permission-request
router.use('/', permissionsRouter);

// Export the broadcast setters for WebSocket handler to use
export { setNotificationBroadcast, setExecBroadcast, setFocusAgentBroadcast, setAgentsBroadcast, setTriggerBroadcast };

export default router;
