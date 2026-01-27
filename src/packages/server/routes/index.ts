/**
 * Routes Module
 * Aggregates all route handlers
 */

import { Router } from 'express';
import agentsRouter from './agents.js';
import filesRouter from './files.js';
import permissionsRouter from './permissions.js';
import notificationsRouter, { setBroadcast as setNotificationBroadcast } from './notifications.js';
import execRouter, { setBroadcast as setExecBroadcast } from './exec.js';
import customModelsRouter from './custom-models.js';

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
router.use('/custom-models', customModelsRouter);
// Permission routes are mounted at root level since they're called as /api/permission-request
router.use('/', permissionsRouter);

// Export the broadcast setters for WebSocket handler to use
export { setNotificationBroadcast, setExecBroadcast };

export default router;
