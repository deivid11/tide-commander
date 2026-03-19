/**
 * Slack Routes
 * Express Router with endpoints for Slack messaging, channels, users, and connection management.
 * Mounted at /api/slack/ by the integration registry.
 */

import { Router, Request, Response } from 'express';
import * as slackClient from './slack-client.js';
import { loadConfig } from './slack-config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SlackRoutes');

const router = Router();

// POST /api/slack/send — Send a message
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { channel, text, threadTs, agentId, workflowInstanceId } = req.body;
    if (!channel || !text) {
      res.status(400).json({ error: 'channel and text are required' });
      return;
    }

    const result = await slackClient.sendMessage({ channel, text, threadTs, agentId, workflowInstanceId });
    res.json({ success: true, ts: result.ts, channel: result.channel });
  } catch (err) {
    log.error(`Slack send error: ${err}`);
    res.status(500).json({ error: `Failed to send message: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/messages — Read channel messages
router.get('/messages', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel as string;
    if (!channel) {
      res.status(400).json({ error: 'channel query param is required' });
      return;
    }

    const messages = await slackClient.getChannelMessages({
      channel,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      oldest: req.query.oldest as string | undefined,
      latest: req.query.latest as string | undefined,
    });

    res.json({ messages });
  } catch (err) {
    log.error(`Slack messages error: ${err}`);
    res.status(500).json({ error: `Failed to read messages: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/thread — Read thread replies
router.get('/thread', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel as string;
    const threadTs = req.query.threadTs as string;
    if (!channel || !threadTs) {
      res.status(400).json({ error: 'channel and threadTs query params are required' });
      return;
    }

    const messages = await slackClient.getThreadReplies({
      channel,
      threadTs,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });

    res.json({ messages });
  } catch (err) {
    log.error(`Slack thread error: ${err}`);
    res.status(500).json({ error: `Failed to read thread: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/wait-for-reply — Long-poll for a reply in a thread
router.post('/wait-for-reply', async (req: Request, res: Response) => {
  try {
    const { channel, threadTs, fromUsers, timeoutMs, messagePattern } = req.body;
    if (!channel || !threadTs) {
      res.status(400).json({ error: 'channel and threadTs are required' });
      return;
    }

    const message = await slackClient.waitForReply({
      channel,
      threadTs,
      fromUsers,
      timeoutMs,
      messagePattern,
    });

    res.json({ message, timedOut: message === null });
  } catch (err) {
    log.error(`Slack wait-for-reply error: ${err}`);
    res.status(500).json({ error: `Failed to wait for reply: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/channels — List all channels
router.get('/channels', async (_req: Request, res: Response) => {
  try {
    const channels = await slackClient.listChannels();
    res.json({ channels });
  } catch (err) {
    log.error(`Slack channels error: ${err}`);
    res.status(500).json({ error: `Failed to list channels: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/users/:userId — Resolve a user
router.get('/users/:userId', async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const user = await slackClient.resolveUser(req.params.userId);
    res.json({ user });
  } catch (err) {
    log.error(`Slack user resolve error: ${err}`);
    res.status(500).json({ error: `Failed to resolve user: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/status — Get connection status
router.get('/status', (_req: Request, res: Response) => {
  const config = loadConfig();
  res.json(config);
});

// POST /api/slack/connect — Manually trigger connection
router.post('/connect', async (_req: Request, res: Response) => {
  try {
    await slackClient.reconnect();
    res.json({ success: true, status: loadConfig() });
  } catch (err) {
    log.error(`Slack connect error: ${err}`);
    res.status(500).json({ error: `Failed to connect: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/disconnect — Manually disconnect
router.post('/disconnect', async (_req: Request, res: Response) => {
  try {
    await slackClient.disconnect();
    res.json({ success: true, status: loadConfig() });
  } catch (err) {
    log.error(`Slack disconnect error: ${err}`);
    res.status(500).json({ error: `Failed to disconnect: ${err instanceof Error ? err.message : err}` });
  }
});

export default router;
