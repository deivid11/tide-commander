/**
 * Slack Routes
 * Express Router with endpoints for Slack messaging, channels, users, and connection management.
 * Mounted at /api/slack/ by the integration registry.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as slackClient from './slack-client.js';
import { loadConfig, getConfigValues, setConfigValues, DEFAULT_INSTANCE_ID, instanceSecretKey } from './slack-config.js';
import {
  getInstance,
  removeInstance as unloadInstance,
} from './slack-instance.js';
import {
  listInstanceMetas,
  getInstanceMeta,
  hasInstance,
  addInstance,
  renameInstance,
  removeInstance as removeInstanceMeta,
  validateInstanceId,
} from './slack-instance-manifest.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SlackRoutes');

const router = Router();

/**
 * Pick the instance id from the request. Order of precedence:
 *   1. ?instance=<id> query param
 *   2. body.instanceId (POST/PATCH only)
 *   3. 'default'
 * Returns null + writes a 404 if the requested id isn't in the manifest.
 */
function resolveInstanceIdOr404(req: Request, res: Response): string | null {
  const fromQuery = (req.query.instance as string | undefined)?.trim();
  const body = (req.body ?? {}) as { instanceId?: string };
  const fromBody = typeof body.instanceId === 'string' ? body.instanceId.trim() : undefined;
  const id = fromQuery || fromBody || DEFAULT_INSTANCE_ID;
  if (!hasInstance(id)) {
    res.status(404).json({ error: `Slack instance "${id}" not found` });
    return null;
  }
  return id;
}

function svc(req: Request, res: Response): { id: string; inst: ReturnType<typeof getInstance> } | null {
  const id = resolveInstanceIdOr404(req, res);
  if (!id) return null;
  return { id, inst: getInstance(id) };
}

// ─── /instances CRUD ───

// GET /api/slack/instances — list all instances + their config + status
router.get('/instances', (req: Request, res: Response) => {
  void req;
  const metas = listInstanceMetas();
  const result = metas.map((meta) => {
    const inst = getInstance(meta.id);
    return {
      id: meta.id,
      label: meta.label,
      createdAt: meta.createdAt,
      status: inst.getStatus(),
      config: loadConfig(meta.id),
    };
  });
  res.json({ instances: result });
});

// POST /api/slack/instances — create a new instance
router.post('/instances', (req: Request, res: Response) => {
  try {
    const { id, label } = req.body as { id?: string; label?: string };
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    const validationErr = validateInstanceId(id);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }
    const meta = addInstance(id, label || id);
    // Force-create + wire the SlackInstance so subsequent calls (PATCH /:id,
    // POST /:id/connect) can call reconnect() immediately.
    const inst = getInstance(meta.id);
    ensureInstanceWired(inst);
    res.json({ instance: meta });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/slack/instances/:id — single instance status + config
router.get('/instances/:id', (req: Request<{ id: string }>, res: Response) => {
  const meta = getInstanceMeta(req.params.id);
  if (!meta) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }
  const inst = getInstance(req.params.id);
  res.json({
    instance: meta,
    status: inst.getStatus(),
    config: loadConfig(req.params.id),
  });
});

// PATCH /api/slack/instances/:id — rename + apply per-instance config / secrets, then reconnect
router.patch('/instances/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const meta = getInstanceMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }
    const body = (req.body ?? {}) as { label?: string; values?: Record<string, unknown> };

    if (typeof body.label === 'string') {
      renameInstance(req.params.id, body.label);
    }

    if (body.values && typeof body.values === 'object') {
      // The integration context owns the secret store. We expose it via a
      // tiny helper exported from index.ts… but to keep this route file
      // self-contained, we accept that secrets routing happens through
      // setConfigValues which reads ctx.secrets indirectly via the same
      // pattern slackPlugin.setConfig uses. Inline secret setter:
      const secrets = getRequestSecrets(req);
      if (!secrets) {
        res.status(500).json({ error: 'Slack integration not initialized' });
        return;
      }
      await setConfigValues(body.values, secrets, req.params.id);
    }

    // Reconnect this instance with its new config / secrets.
    const inst = getInstance(req.params.id);
    ensureInstanceWired(inst);
    const updated = loadConfig(req.params.id);
    const secrets = getRequestSecrets(req);
    const botToken = secrets?.get(instanceSecretKey('SLACK_BOT_TOKEN', req.params.id));
    if (updated.enabled && botToken) {
      try {
        await inst.reconnect();
      } catch (e) {
        log.error(`Slack[${req.params.id}] reconnect failed: ${e instanceof Error ? e.message : e}`);
      }
    } else if (!updated.enabled && inst.isConnected()) {
      await inst.disconnect();
    }

    res.json({
      instance: getInstanceMeta(req.params.id),
      status: inst.getStatus(),
      config: loadConfig(req.params.id),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /api/slack/instances/:id — remove instance (manifest + config + connection)
router.delete('/instances/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    if (req.params.id === DEFAULT_INSTANCE_ID) {
      res.status(400).json({ error: 'Cannot delete the default instance' });
      return;
    }
    if (!getInstanceMeta(req.params.id)) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }
    await unloadInstance(req.params.id);
    removeInstanceMeta(req.params.id);
    // We deliberately do NOT delete secrets here — the secret store has no
    // enumerate API and clients can overwrite the per-instance keys via
    // PATCH if they want them gone. The keys do nothing without a manifest
    // entry.
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/slack/instances/:id/values — config values shaped for the UI form
router.get('/instances/:id/values', (req: Request<{ id: string }>, res: Response) => {
  const meta = getInstanceMeta(req.params.id);
  if (!meta) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }
  const secrets = getRequestSecrets(req);
  if (!secrets) {
    res.status(500).json({ error: 'Slack integration not initialized' });
    return;
  }
  res.json({ values: getConfigValues(secrets, req.params.id) });
});

// ─── Integration-context reference ───
//
// Set by slack/index.ts at integration init. We hold the full ctx here so
// that route handlers which create new instances at runtime can wire the
// per-instance context (otherwise reconnect() throws "not initialized").

interface SecretStore {
  get: (k: string) => string | undefined;
  set: (k: string, v: string) => void;
}

interface SlackRoutesIntegrationContext {
  secrets: SecretStore;
  // Subset we use; kept loose to avoid importing the full IntegrationContext.
}

let ctxRef: SlackRoutesIntegrationContext | null = null;

export function setIntegrationContextForRoutes(ctx: SlackRoutesIntegrationContext | null): void {
  ctxRef = ctx;
}

/** Back-compat alias for older imports — same store, accessed via ctxRef now. */
export function setSecretStoreForRoutes(store: SecretStore | null): void {
  ctxRef = store ? { secrets: store } : null;
}

function getRequestSecrets(_req: Request): SecretStore | null {
  return ctxRef?.secrets ?? null;
}

/**
 * Ensure a SlackInstance has its integration context wired. Call this any
 * time we create a new instance at runtime (POST /instances) so reconnect
 * doesn't throw "not initialized" before the next server boot.
 */
function ensureInstanceWired(inst: ReturnType<typeof getInstance>): void {
  if (ctxRef) {
    // setContext is idempotent; safe to call repeatedly.
    (inst as unknown as { setContext: (c: unknown) => void }).setContext(ctxRef);
  }
}



// 50 MB cap matches other integrations (docx). Slack's own limit is higher but this keeps memory sane.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/slack/send — Send a message
router.post('/send', async (req: Request, res: Response) => {
  try {
    const handle = svc(req, res);
    if (!handle) return;
    const { channel, text, threadTs, agentId, workflowInstanceId } = req.body;
    if (!channel || !text) {
      res.status(400).json({ error: 'channel and text are required' });
      return;
    }

    const result = await handle.inst.sendMessage({ channel, text, threadTs, agentId, workflowInstanceId });
    res.json({ success: true, ts: result.ts, channel: result.channel, instanceId: handle.id });
  } catch (err) {
    log.error(`Slack send error: ${err}`);
    res.status(500).json({ error: `Failed to send message: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/messages — Read channel messages
router.get('/messages', async (req: Request, res: Response) => {
  try {
    const handle = svc(req, res);
    if (!handle) return;
    const channel = req.query.channel as string;
    if (!channel) {
      res.status(400).json({ error: 'channel query param is required' });
      return;
    }

    const messages = await handle.inst.getChannelMessages({
      channel,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      oldest: req.query.oldest as string | undefined,
      latest: req.query.latest as string | undefined,
    });

    res.json({ messages, instanceId: handle.id });
  } catch (err) {
    log.error(`Slack messages error: ${err}`);
    res.status(500).json({ error: `Failed to read messages: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/slack/thread — Read thread replies
router.get('/thread', async (req: Request, res: Response) => {
  try {
    const handle = svc(req, res);
    if (!handle) return;
    const channel = req.query.channel as string;
    const threadTs = req.query.threadTs as string;
    if (!channel || !threadTs) {
      res.status(400).json({ error: 'channel and threadTs query params are required' });
      return;
    }

    const messages = await handle.inst.getThreadReplies({
      channel,
      threadTs,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });

    res.json({ messages, instanceId: handle.id });
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
router.get('/channels', async (req: Request, res: Response) => {
  try {
    const handle = svc(req, res);
    if (!handle) return;
    const channels = await handle.inst.listChannels();
    res.json({ channels, instanceId: handle.id });
  } catch (err) {
    log.error(`Slack channels error: ${err}`);
    res.status(500).json({ error: `Failed to list channels: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/channels/join — Join a channel
router.post('/channels/join', async (req: Request, res: Response) => {
  try {
    const handle = svc(req, res);
    if (!handle) return;
    const { channel } = req.body;
    if (!channel) {
      res.status(400).json({ error: 'channel is required' });
      return;
    }

    const result = await handle.inst.joinChannel(channel);
    res.json({ success: true, channel: result, instanceId: handle.id });
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
    const handle = svc(req, res);
    if (!handle) return;
    const { userId, text, agentId, workflowInstanceId } = req.body;
    if (!userId || !text) {
      res.status(400).json({ error: 'userId and text are required' });
      return;
    }

    const result = await handle.inst.sendDm({ userId, text, agentId, workflowInstanceId });
    res.json({ success: true, ts: result.ts, channel: result.channel, instanceId: handle.id });
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
// Body: { channel, ts, name } — name is the Slack slug without colons (e.g. "white_check_mark").
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

// GET /api/slack/status — Get connection status (per-instance via ?instance=)
router.get('/status', (req: Request, res: Response) => {
  const handle = svc(req, res);
  if (!handle) return;
  const config = loadConfig(handle.id);
  res.json({ ...config, instanceId: handle.id });
});

// POST /api/slack/connect — Manually trigger connection
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const handle = svc(req, res);
    if (!handle) return;
    await handle.inst.reconnect();
    res.json({ success: true, status: loadConfig(handle.id), instanceId: handle.id });
  } catch (err) {
    log.error(`Slack connect error: ${err}`);
    res.status(500).json({ error: `Failed to connect: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/slack/disconnect — Manually disconnect
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const handle = svc(req, res);
    if (!handle) return;
    await handle.inst.disconnect();
    res.json({ success: true, status: loadConfig(handle.id), instanceId: handle.id });
  } catch (err) {
    log.error(`Slack disconnect error: ${err}`);
    res.status(500).json({ error: `Failed to disconnect: ${err instanceof Error ? err.message : err}` });
  }
});

export default router;
