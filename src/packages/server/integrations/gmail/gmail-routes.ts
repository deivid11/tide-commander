/**
 * Gmail Routes
 * Express Router with endpoints for Gmail authentication, sending, reading, and approval checking.
 * Mounted at /api/email/ by the integration registry.
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as gmailClient from './gmail-client.js';
import {
  GmailAttachmentNotAuthenticatedError,
  GmailAttachmentNotFoundError,
  GmailAttachmentTooLargeError,
} from './gmail-client.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('GmailRoutes');

const router = Router();

const SAVE_PATH_WHITELIST = ['/home/riven/obsidian', '/home/riven/d', '/tmp'];

function sanitizeFilename(name: string): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/[/\\]/.test(trimmed)) return null;
  if (/[\x00-\x1f]/.test(trimmed)) return null;
  const cleaned = trimmed.slice(0, 200);
  return cleaned.length > 0 ? cleaned : null;
}

function isWithinWhitelist(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  return SAVE_PATH_WHITELIST.some((root) => {
    const rootResolved = path.resolve(root);
    return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
  });
}

function buildContentDisposition(filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/"/g, "'")
    .slice(0, 200) || 'attachment';
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

// POST /api/email/send — Send an email
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { to, cc, bcc, subject, body, bodyText, attachments, threadId, inReplyTo, agentId, workflowInstanceId } = req.body;

    if (!to || !subject || !body) {
      res.status(400).json({ error: 'to, subject, and body are required' });
      return;
    }

    const result = await gmailClient.sendEmail({
      to: Array.isArray(to) ? to : [to],
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      subject,
      body,
      bodyText,
      attachments,
      threadId,
      inReplyTo,
      agentId,
      workflowInstanceId,
    });

    res.json({ success: true, messageId: result.messageId, threadId: result.threadId });
  } catch (err) {
    log.error(`Gmail send error: ${err}`);
    res.status(500).json({ error: `Failed to send email: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/email/recent — Get recent emails
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const query = req.query.query as string | undefined;
    const maxResults = req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : 10;
    const after = req.query.after ? parseInt(req.query.after as string, 10) : undefined;

    const messages = await gmailClient.getRecentMessages({
      query,
      maxResults,
      after,
    });

    res.json({ messages });
  } catch (err) {
    log.error(`Gmail read error: ${err}`);
    res.status(500).json({ error: `Failed to read emails: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/email/thread/:threadId — Get thread messages
router.get('/thread/:threadId', async (req: Request, res: Response) => {
  try {
    const threadId = typeof req.params.threadId === 'string' ? req.params.threadId : '';
    if (!threadId) {
      res.status(400).json({ error: 'threadId is required' });
      return;
    }

    const thread = await gmailClient.getThread(threadId);
    res.json(thread);
  } catch (err) {
    log.error(`Gmail thread read error: ${err}`);
    res.status(500).json({ error: `Failed to read thread: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/email/check-approvals — Check approval status in a thread
router.post('/check-approvals', async (req: Request, res: Response) => {
  try {
    const { threadId, requiredApprovers, approvalKeywords, minApprovals, workflowInstanceId } = req.body;

    if (!threadId || !requiredApprovers) {
      res.status(400).json({ error: 'threadId and requiredApprovers are required' });
      return;
    }

    const approversArray = Array.isArray(requiredApprovers) ? requiredApprovers : [requiredApprovers as string];
    const minApprovalsNum = typeof minApprovals === 'number' ? minApprovals : approversArray.length;
    const status = await gmailClient.checkApprovals({
      threadId,
      requiredApprovers: approversArray,
      approvalKeywords,
      minApprovals: minApprovalsNum,
      workflowInstanceId,
    });

    res.json(status);
  } catch (err) {
    log.error(`Gmail approval check error: ${err}`);
    res.status(500).json({ error: `Failed to check approvals: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/email/status — Get Gmail status.
// `?probe=1` forces a live refresh_token exchange against Google instead of reusing
// the cached verdict — the settings UI uses it to verify the token on open, so a
// revoked token can't keep rendering as "Connected". No-op in service-account mode.
router.get('/status', async (req: Request, res: Response) => {
  if (req.query.probe === '1' || req.query.probe === 'true') {
    await gmailClient.probeToken();
  }
  res.json(gmailClient.getStatus());
});

// GET /api/email/auth/url — Get OAuth authorization URL
router.get('/auth/url', (req: Request, res: Response) => {
  try {
    const currentConfig = gmailClient.getConfig();
    if (currentConfig.authMethod === 'service_account') {
      res.status(400).json({ error: 'OAuth flow is not used with service account authentication. Configure service account JSON and impersonate email instead.' });
      return;
    }
    const authUrl = gmailClient.getAuthUrl();
    res.json({ url: authUrl });
  } catch (err) {
    log.error(`Failed to get auth URL: ${err}`);
    res.status(500).json({ error: `Failed to get auth URL: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/email/auth/callback — Handle OAuth callback from Google
// This endpoint receives a GET request from Google's OAuth service with the authorization code
// It bypasses authentication because it's a public redirect from an external provider
router.get('/auth/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;

    // Check if the user denied consent
    if (error) {
      const errorDescription = req.query.error_description as string | undefined;
      log.warn(`OAuth consent denied: ${error} - ${errorDescription}`);
      const errorMsg = errorDescription || error;
      res.send(`
        <html>
          <head><title>Gmail Authorization Failed</title></head>
          <body>
            <h1>Authorization Denied</h1>
            <p>You denied access to your Gmail account: ${errorMsg}</p>
            <p><a href="/">Return to the app</a></p>
          </body>
        </html>
      `);
      return;
    }

    if (!code) {
      res.status(400).send('Missing authorization code');
      return;
    }

    log.log(`Gmail OAuth callback received, processing code...`);
    await gmailClient.handleAuthCallback(code);
    log.log('Gmail OAuth callback completed successfully');

    // Return HTML that notifies the user and/or closes the window
    res.send(`
      <html>
        <head>
          <title>Gmail Authorization Successful</title>
          <script>
            // Try to close the window if it was opened as a popup
            if (window.opener) {
              window.opener.postMessage({ type: 'gmail-auth-success' }, '*');
              setTimeout(() => window.close(), 1000);
            } else {
              // Otherwise redirect to the app
              setTimeout(() => { window.location.href = '/?gmail-auth=success'; }, 2000);
            }
          </script>
        </head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>Gmail Authorization Successful!</h1>
          <p>Your Gmail account has been connected.</p>
          <p>Closing this window or redirecting you to the app...</p>
        </body>
      </html>
    `);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`Gmail auth callback error: ${errorMsg}`, err);
    res.status(500).send(`
      <html>
        <head><title>Gmail Authorization Failed</title></head>
        <body style="font-family: sans-serif; padding: 40px;">
          <h1>Authorization Failed</h1>
          <p><strong>Error:</strong> ${errorMsg}</p>
          <p><a href="/">Return to the app and try again</a></p>
        </body>
      </html>
    `);
  }
});

// POST /api/email/polling/start — Start email polling
router.post('/polling/start', (req: Request, res: Response) => {
  try {
    const { intervalMs } = req.body;
    gmailClient.startPolling(intervalMs);
    res.json({ success: true, message: 'Email polling started' });
  } catch (err) {
    log.error(`Failed to start polling: ${err}`);
    res.status(500).json({ error: `Failed to start polling: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/email/polling/stop — Stop email polling
router.post('/polling/stop', (req: Request, res: Response) => {
  try {
    gmailClient.stopPolling();
    res.json({ success: true, message: 'Email polling stopped' });
  } catch (err) {
    log.error(`Failed to stop polling: ${err}`);
    res.status(500).json({ error: `Failed to stop polling: ${err instanceof Error ? err.message : err}` });
  }
});

router.get(
  '/messages/:messageId/parts',
  async (req: Request<{ messageId: string }>, res: Response) => {
    const messageId = (req.params.messageId ?? '').trim();
    if (!messageId) {
      res.status(400).json({ error: 'invalid messageId' });
      return;
    }
    try {
      const dump = await gmailClient.dumpGmailMessageParts(messageId);
      if (!dump) {
        res.status(404).json({ error: 'message not found' });
        return;
      }
      res.json(dump);
    } catch (err) {
      if (err instanceof GmailAttachmentNotAuthenticatedError) {
        res.status(503).json({ error: 'Gmail not authenticated' });
        return;
      }
      log.error(`Gmail message parts dump error: ${err}`);
      res.status(500).json({ error: 'failed to dump message' });
    }
  },
);

router.post(
  '/messages/:messageId/attachments/:attachmentId/download',
  async (req: Request<{ messageId: string; attachmentId: string }>, res: Response) => {
    const messageId = (req.params.messageId ?? '').trim();
    const attachmentId = (req.params.attachmentId ?? '').trim();
    if (!messageId) {
      res.status(400).json({ error: 'invalid messageId' });
      return;
    }
    if (!attachmentId) {
      res.status(400).json({ error: 'invalid attachmentId' });
      return;
    }

    const savePathRaw = typeof req.query.savePath === 'string' ? req.query.savePath : undefined;
    const filenameOverrideRaw = typeof req.query.filename === 'string' ? req.query.filename : undefined;

    let filenameOverride: string | null = null;
    if (filenameOverrideRaw !== undefined) {
      filenameOverride = sanitizeFilename(filenameOverrideRaw);
      if (!filenameOverride) {
        res.status(400).json({ error: 'invalid filename' });
        return;
      }
    }

    let resolvedSavePath: string | null = null;
    if (savePathRaw) {
      if (!path.isAbsolute(savePathRaw)) {
        res.status(400).json({ error: 'savePath outside whitelist' });
        return;
      }
      resolvedSavePath = path.resolve(savePathRaw);
      if (!isWithinWhitelist(resolvedSavePath)) {
        res.status(400).json({ error: 'savePath outside whitelist' });
        return;
      }
    }

    try {
      const part = await gmailClient.resolveGmailAttachmentPart(
        messageId,
        attachmentId,
        filenameOverrideRaw,
      );
      if (!part) {
        res.status(404).json({ error: 'attachment not found' });
        return;
      }

      const resolvedMime = part.mimeType || 'application/octet-stream';
      const metaFilename = sanitizeFilename(part.filename) ?? 'attachment';
      const resolvedFilename = filenameOverride ?? metaFilename;

      const { buffer, size } = await gmailClient.fetchGmailAttachmentBuffer(messageId, part.realAttachmentId);

      if (!resolvedSavePath) {
        res.setHeader('Content-Type', resolvedMime);
        res.setHeader('Content-Disposition', buildContentDisposition(resolvedFilename));
        res.setHeader('Content-Length', String(size));
        res.status(200).send(buffer);
        return;
      }

      let targetPath: string;
      let targetDir: string;
      let isDir = false;
      try {
        const st = await fsp.stat(resolvedSavePath);
        isDir = st.isDirectory();
      } catch {
        const raw = savePathRaw ?? '';
        isDir = raw.endsWith('/') || raw.endsWith(path.sep);
      }

      if (isDir) {
        targetDir = resolvedSavePath;
        targetPath = path.join(resolvedSavePath, resolvedFilename);
      } else {
        const baseFromPath = path.basename(resolvedSavePath);
        const safeBase = filenameOverride ?? sanitizeFilename(baseFromPath);
        if (!safeBase) {
          res.status(400).json({ error: 'invalid filename' });
          return;
        }
        targetDir = path.dirname(resolvedSavePath);
        targetPath = path.join(targetDir, safeBase);
      }

      if (!isWithinWhitelist(targetPath) || !isWithinWhitelist(targetDir)) {
        res.status(400).json({ error: 'savePath outside whitelist' });
        return;
      }

      try {
        await fsp.mkdir(targetDir, { recursive: true });
        await fsp.writeFile(targetPath, buffer);
      } catch (err) {
        log.error(`Gmail attachment write failed for ${targetPath}: ${err}`);
        res.status(500).json({ error: 'failed to write attachment' });
        return;
      }

      res.json({ ok: true, path: targetPath, size });
    } catch (err) {
      if (err instanceof GmailAttachmentNotAuthenticatedError) {
        res.status(503).json({ error: 'Gmail not authenticated' });
        return;
      }
      if (err instanceof GmailAttachmentNotFoundError) {
        res.status(404).json({ error: 'attachment not found' });
        return;
      }
      if (err instanceof GmailAttachmentTooLargeError) {
        res.status(413).json({ error: 'attachment too large' });
        return;
      }
      log.error(`Gmail attachment download error: ${err}`);
      res.status(500).json({ error: 'failed to download attachment' });
    }
  },
);

export default router;
