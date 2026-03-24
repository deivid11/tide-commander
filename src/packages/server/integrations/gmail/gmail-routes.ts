/**
 * Gmail Routes
 * Express Router with endpoints for Gmail authentication, sending, reading, and approval checking.
 * Mounted at /api/email/ by the integration registry.
 */

import { Router, Request, Response } from 'express';
import * as gmailClient from './gmail-client.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('GmailRoutes');

const router = Router();

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

// GET /api/email/status — Get Gmail status
router.get('/status', (req: Request, res: Response) => {
  const status = gmailClient.getStatus();
  res.json(status);
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

export default router;
