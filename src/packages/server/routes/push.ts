/**
 * Push Notification Routes
 *
 * Device-token registry + FCM configuration for battery-free background
 * delivery. The Android app registers its token here on boot; agent
 * notifications are then fanned out by
 * src/packages/server/services/push-service.ts.
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/index.js';
import {
  registerDevice,
  unregisterDevice,
  getPushStatus,
  isPushConfigured,
  saveServiceAccount,
  clearServiceAccount,
  sendAgentPush,
} from '../services/push-service.js';
import type { AgentNotification } from '../../shared/types.js';

const log = createLogger('PushRoutes');

const router = Router();

/**
 * GET /api/push/status - Is FCM configured, and which devices are registered?
 *
 * The Android client calls this before asking the OS for a push token: with no
 * service account on the server there is nothing to register with, and it must
 * keep using the WebSocket foreground service instead.
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json(getPushStatus());
});

/**
 * POST /api/push/register - Register (or refresh) an FCM device token
 *
 * Body: { token, platform?, deviceId?, deviceName?, appVersion? }
 */
router.post('/register', (req: Request, res: Response) => {
  try {
    const { token, platform, deviceId, deviceName, appVersion } = req.body ?? {};
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Missing required field: token' });
      return;
    }
    if (!isPushConfigured()) {
      // Not an error the client should retry-loop on — it just means the
      // server owner hasn't dropped in a service account yet.
      res.status(409).json({ error: 'Push is not configured on this server', configured: false });
      return;
    }

    const device = registerDevice({ token, platform, deviceId, deviceName, appVersion });
    res.json({ success: true, device: { ...device, token: undefined } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to register device: ${message}`);
    res.status(500).json({ error: message });
  }
});

/** POST /api/push/unregister - Body: { token } */
router.post('/unregister', (req: Request, res: Response) => {
  const { token } = req.body ?? {};
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Missing required field: token' });
    return;
  }
  const removed = unregisterDevice(token);
  res.json({ success: true, removed });
});

/**
 * POST /api/push/service-account - Install the Firebase service-account JSON
 *
 * Body: the raw service-account object, or { json: "<pasted text>" }.
 */
router.post('/service-account', (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const candidate = typeof body.json === 'string' ? JSON.parse(body.json) : body;
    const account = saveServiceAccount(candidate);
    res.json({ success: true, projectId: account.project_id, clientEmail: account.client_email });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

/** DELETE /api/push/service-account - Remove credentials (falls back to the WS service). */
router.delete('/service-account', (_req: Request, res: Response) => {
  try {
    clearServiceAccount();
    res.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/push/test - Send a test push to every registered device.
 * Body: { title?, message? }
 */
router.post('/test', async (req: Request, res: Response) => {
  const { title, message } = req.body ?? {};
  const notification: AgentNotification = {
    id: `push-test-${Date.now()}`,
    agentId: 'push-test',
    agentName: 'Tide Commander',
    agentClass: 'support',
    title: typeof title === 'string' && title ? title : 'Test notification',
    message:
      typeof message === 'string' && message
        ? message
        : 'If you can read this, push delivery works.',
    timestamp: Date.now(),
  };

  const result = await sendAgentPush(notification);
  res.json({ success: result.sent > 0, ...result });
});

export default router;
