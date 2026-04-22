/**
 * Slack Routes
 * Express Router with endpoints for Slack messaging, channels, users, and connection management.
 * Mounted at /api/slack/ by the integration registry.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as slackClient from './slack-client.js';
import { loadConfig } from './slack-config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SlackRoutes');

const router = Router();

// 50 MB cap matches other integrations (docx). Slack's own limit is higher but this keeps memory sane.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

// POST /api/slack/channels/join — Join a channel
router.post('/channels/join', async (req: Request, res: Response) => {
  try {
    const { channel } = req.body;
    if (!channel) {
      res.status(400).json({ error: 'channel is required' });
      return;
    }

    const result = await slackClient.joinChannel(channel);
    res.json({ success: true, channel: result });
  } catch (err) {
    log.error(`Slack join channel error: ${err}`);
    res.status(500).json({ error: `Failed to join channel: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/users/search?q=... — Search users by name or email
router.get('/users/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: 'q query param is required' });
      return;
    }

    const users = await slackClient.searchUsers(query);
    res.json({ users });
  } catch (err) {
    log.error(`Slack user search error: ${err}`);
    res.status(500).json({ error: `Failed to search users: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/users/:userId — Resolve a user by ID
router.get('/users/:userId', async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const user = await slackClient.resolveUser(req.params.userId);
    res.json({ user });
  } catch (err) {
    log.error(`Slack user resolve error: ${err}`);
    res.status(500).json({ error: `Failed to resolve user: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/dm — Send a direct message to a user
router.post('/dm', async (req: Request, res: Response) => {
  try {
    const { userId, text, agentId, workflowInstanceId } = req.body;
    if (!userId || !text) {
      res.status(400).json({ error: 'userId and text are required' });
      return;
    }

    const result = await slackClient.sendDm({ userId, text, agentId, workflowInstanceId });
    res.json({ success: true, ts: result.ts, channel: result.channel });
  } catch (err) {
    log.error(`Slack DM error: ${err}`);
    res.status(500).json({ error: `Failed to send DM: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/upload — Upload a file (multipart/form-data)
// Fields: file (binary, required), channelId?, title?, initialComment?, threadTs?
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });
      return;
    }

    const filename = (req.body.filename as string) || req.file.originalname || 'upload.bin';
    const channelId = req.body.channelId as string | undefined;
    const title = req.body.title as string | undefined;
    const initialComment = req.body.initialComment as string | undefined;
    const threadTs = req.body.threadTs as string | undefined;

    const result = await slackClient.uploadFile({
      filename,
      bytes: req.file.buffer,
      channelId,
      title,
      initialComment,
      threadTs,
    });
    res.json({ success: true, fileId: result.fileId, file: result.file });
  } catch (err) {
    log.error(`Slack upload error: ${err}`);
    res.status(500).json({ error: `Failed to upload file: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/upload-base64 — Upload a file via JSON (base64-encoded bytes).
// Body: { filename, contentBase64, channelId?, title?, initialComment?, threadTs? }
router.post('/upload-base64', async (req: Request, res: Response) => {
  try {
    const { filename, contentBase64, channelId, title, initialComment, threadTs } = req.body as {
      filename?: string;
      contentBase64?: string;
      channelId?: string;
      title?: string;
      initialComment?: string;
      threadTs?: string;
    };
    if (!filename || !contentBase64) {
      res.status(400).json({ error: 'filename and contentBase64 are required' });
      return;
    }

    const bytes = Buffer.from(contentBase64, 'base64');
    if (!bytes.length) {
      res.status(400).json({ error: 'contentBase64 decoded to 0 bytes' });
      return;
    }

    const result = await slackClient.uploadFile({
      filename,
      bytes,
      channelId,
      title,
      initialComment,
      threadTs,
    });
    res.json({ success: true, fileId: result.fileId, file: result.file });
  } catch (err) {
    log.error(`Slack upload-base64 error: ${err}`);
    res.status(500).json({ error: `Failed to upload file: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/files — List files (optional filters: channelId, userId, tsFrom, tsTo, types, count, page)
router.get('/files', async (req: Request, res: Response) => {
  try {
    const count = req.query.count ? parseInt(req.query.count as string, 10) : undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const files = await slackClient.listFiles({
      channelId: req.query.channelId as string | undefined,
      userId: req.query.userId as string | undefined,
      tsFrom: req.query.tsFrom as string | undefined,
      tsTo: req.query.tsTo as string | undefined,
      types: req.query.types as string | undefined,
      count,
      page,
    });
    res.json({ files });
  } catch (err) {
    log.error(`Slack files list error: ${err}`);
    res.status(500).json({ error: `Failed to list files: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/files/:id — Get file metadata
router.get('/files/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const file = await slackClient.getFileInfo(req.params.id);
    res.json({ file });
  } catch (err) {
    log.error(`Slack file info error: ${err}`);
    res.status(500).json({ error: `Failed to get file info: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/files/:id/content — Proxy the file's binary content (bot token added server-side)
router.get('/files/:id/content', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { buffer, contentType, contentDisposition, contentLength } =
      await slackClient.fetchFileBytes(req.params.id);
    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.status(200).send(buffer);
  } catch (err) {
    log.error(`Slack file content error: ${err}`);
    res.status(500).json({ error: `Failed to fetch file content: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/files/:id/download — Server-side download to outputPath on the local filesystem
router.post('/files/:id/download', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { outputPath } = req.body as { outputPath?: string };
    if (!outputPath) {
      res.status(400).json({ error: 'outputPath is required' });
      return;
    }
    const result = await slackClient.downloadFile(req.params.id, outputPath);
    res.json({
      success: true,
      path: result.path,
      bytes: result.bytes,
      filename: result.filename,
      mimeType: result.mimeType,
    });
  } catch (err) {
    log.error(`Slack file download error: ${err}`);
    res.status(500).json({ error: `Failed to download file: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/reactions/add — Add an emoji reaction to a message
// Body: { channel, ts, name } — name is the Slack slug without colons (e.g. "eyes").
router.post('/reactions/add', async (req: Request, res: Response) => {
  try {
    const { channel, ts, name } = req.body as { channel?: string; ts?: string; name?: string };
    if (!channel || !ts || !name) {
      res.status(400).json({ error: 'channel, ts, and name are required' });
      return;
    }
    await slackClient.addReaction({ channel, ts, name });
    res.json({ success: true });
  } catch (err) {
    log.error(`Slack reactions.add error: ${err}`);
    res.status(500).json({ error: `Failed to add reaction: ${err instanceof Error ? err.message : err}` });
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
