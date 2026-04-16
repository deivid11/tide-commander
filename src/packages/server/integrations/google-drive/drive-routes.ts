/**
 * Google Drive Routes
 * Express Router with CRUD endpoints for Drive files and folders.
 * Mounted at /api/drive/ by the integration registry.
 */

import { Router, Request, Response } from 'express';
import * as driveClient from './drive-client.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('DriveRoutes');

const router = Router();

// ─── Files ───

// GET /api/drive/files — List files
router.get('/files', async (req: Request, res: Response) => {
  try {
    const result = await driveClient.listFiles({
      folderId: req.query.folderId as string | undefined,
      query: req.query.query as string | undefined,
      mimeType: req.query.mimeType as string | undefined,
      maxResults: req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : undefined,
      pageToken: req.query.pageToken as string | undefined,
      orderBy: req.query.orderBy as string | undefined,
      trashed: req.query.trashed === 'true',
      driveId: req.query.driveId as string | undefined,
      includeItemsFromAllDrives: req.query.includeItemsFromAllDrives === 'true',
    });

    res.json(result);
  } catch (err) {
    log.error(`Drive list files error: ${err}`);
    res.status(500).json({ error: `Failed to list files: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/drive/files/:fileId — Get file metadata
router.get('/files/:fileId', async (req: Request<{ fileId: string }>, res: Response) => {
  try {
    const file = await driveClient.getFile(req.params.fileId);
    res.json({ file });
  } catch (err) {
    log.error(`Drive get file error: ${err}`);
    res.status(500).json({ error: `Failed to get file: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/drive/files/:fileId/content — Read file content
router.get('/files/:fileId/content', async (req: Request<{ fileId: string }>, res: Response) => {
  try {
    const exportMimeType = req.query.exportAs as string | undefined;
    const result = await driveClient.getFileContent(req.params.fileId, exportMimeType);
    res.json(result);
  } catch (err) {
    log.error(`Drive read file content error: ${err}`);
    res.status(500).json({ error: `Failed to read file content: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/drive/files — Create a new file
router.post('/files', async (req: Request, res: Response) => {
  try {
    const { name, content, mimeType, folderId, description, agentId, workflowInstanceId } = req.body;

    if (!name || content === undefined) {
      res.status(400).json({ error: 'name and content are required' });
      return;
    }

    const file = await driveClient.createFile({
      name,
      content,
      mimeType,
      folderId,
      description,
      agentId,
      workflowInstanceId,
    });

    res.json({ file });
  } catch (err) {
    log.error(`Drive create file error: ${err}`);
    res.status(500).json({ error: `Failed to create file: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/drive/files/:fileId/copy — Copy a file (typically from a template)
router.post('/files/:fileId/copy', async (req: Request<{ fileId: string }>, res: Response) => {
  try {
    const { name, folderId, description, agentId, workflowInstanceId } = req.body || {};

    const file = await driveClient.copyFile({
      sourceFileId: req.params.fileId,
      name,
      folderId,
      description,
      agentId,
      workflowInstanceId,
    });

    res.json({ file });
  } catch (err) {
    log.error(`Drive copy file error: ${err}`);
    res.status(500).json({ error: `Failed to copy file: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/drive/files/:fileId/move — Move a file to a different folder (cross-drive supported)
router.post('/files/:fileId/move', async (req: Request<{ fileId: string }>, res: Response) => {
  try {
    const { folderId, removeFromFolderIds, agentId, workflowInstanceId } = req.body || {};

    if (!folderId) {
      res.status(400).json({ error: 'folderId is required' });
      return;
    }

    const file = await driveClient.moveFile(req.params.fileId, {
      folderId,
      removeFromFolderIds,
      agentId,
      workflowInstanceId,
    });

    res.json({ file });
  } catch (err) {
    log.error(`Drive move file error: ${err}`);
    res.status(500).json({ error: `Failed to move file: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/drive/files/:fileId/replace-text — Find/replace text inside a Google Doc (preserves formatting)
router.post('/files/:fileId/replace-text', async (req: Request<{ fileId: string }>, res: Response) => {
  try {
    const { replacements, appendText, agentId, workflowInstanceId } = req.body || {};

    if (!Array.isArray(replacements) && !appendText) {
      res.status(400).json({ error: 'replacements (array) or appendText (string) is required' });
      return;
    }

    const result = await driveClient.replaceTextInDoc(req.params.fileId, {
      replacements: Array.isArray(replacements) ? replacements : [],
      appendText,
      agentId,
      workflowInstanceId,
    });

    res.json(result);
  } catch (err) {
    log.error(`Drive replace-text error: ${err}`);
    res.status(500).json({ error: `Failed to replace text in doc: ${err instanceof Error ? err.message : err}` });
  }
});

// PATCH /api/drive/files/:fileId — Update a file (content, name, or both)
router.patch('/files/:fileId', async (req: Request<{ fileId: string }>, res: Response) => {
  try {
    const file = await driveClient.updateFile(req.params.fileId, req.body);
    res.json({ file });
  } catch (err) {
    log.error(`Drive update file error: ${err}`);
    res.status(500).json({ error: `Failed to update file: ${err instanceof Error ? err.message : err}` });
  }
});

// DELETE /api/drive/files/:fileId — Delete a file
router.delete('/files/:fileId', async (req: Request<{ fileId: string }>, res: Response) => {
  try {
    await driveClient.deleteFile(req.params.fileId, {
      agentId: req.body?.agentId,
      workflowInstanceId: req.body?.workflowInstanceId,
    });
    res.json({ success: true });
  } catch (err) {
    log.error(`Drive delete file error: ${err}`);
    res.status(500).json({ error: `Failed to delete file: ${err instanceof Error ? err.message : err}` });
  }
});

// ─── Google Docs API ───
// Direct passthrough to the Docs API (documents.create / get / batchUpdate).
// Use these for native Google Docs when you need full-fidelity access (styles,
// structure, inline objects) that Drive's export can't give you.

// POST /api/drive/docs — Create a blank Google Doc with a title
router.post('/docs', async (req: Request, res: Response) => {
  try {
    const { title, agentId, workflowInstanceId } = req.body || {};

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const file = await driveClient.createDocument({ title, agentId, workflowInstanceId });
    res.json({ file });
  } catch (err) {
    log.error(`Docs create error: ${err}`);
    res.status(500).json({ error: `Failed to create document: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/drive/docs/:docId — Get the full structured document
router.get('/docs/:docId', async (req: Request<{ docId: string }>, res: Response) => {
  try {
    const document = await driveClient.getDocument(req.params.docId);
    res.json({ document });
  } catch (err) {
    log.error(`Docs get error: ${err}`);
    res.status(500).json({ error: `Failed to get document: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/drive/docs/:docId/batch-update — Generic Docs batchUpdate passthrough
router.post('/docs/:docId/batch-update', async (req: Request<{ docId: string }>, res: Response) => {
  try {
    const { requests, writeControl, agentId, workflowInstanceId } = req.body || {};

    if (!Array.isArray(requests) || requests.length === 0) {
      res.status(400).json({ error: 'requests (non-empty array) is required' });
      return;
    }

    const result = await driveClient.batchUpdateDocument(req.params.docId, {
      requests,
      writeControl,
      agentId,
      workflowInstanceId,
    });

    res.json(result);
  } catch (err) {
    log.error(`Docs batch-update error: ${err}`);
    res.status(500).json({ error: `Failed to batch-update document: ${err instanceof Error ? err.message : err}` });
  }
});

// ─── Folders ───

// POST /api/drive/folders — Create a folder
router.post('/folders', async (req: Request, res: Response) => {
  try {
    const { name, parentFolderId, agentId, workflowInstanceId } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const folder = await driveClient.createFolder(name, parentFolderId, {
      agentId,
      workflowInstanceId,
    });

    res.json({ folder });
  } catch (err) {
    log.error(`Drive create folder error: ${err}`);
    res.status(500).json({ error: `Failed to create folder: ${err instanceof Error ? err.message : err}` });
  }
});

// ─── Shared Drives (Team Drives) ───

// GET /api/drive/drives — List Shared Drives the user has access to
router.get('/drives', async (req: Request, res: Response) => {
  try {
    const result = await driveClient.listSharedDrives({
      maxResults: req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : undefined,
      pageToken: req.query.pageToken as string | undefined,
      query: req.query.q as string | undefined,
      useDomainAdminAccess: req.query.useDomainAdminAccess === 'true',
    });

    res.json(result);
  } catch (err) {
    log.error(`Drive list shared drives error: ${err}`);
    res.status(500).json({ error: `Failed to list shared drives: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/drive/drives/:driveId — Get metadata for a Shared Drive
router.get('/drives/:driveId', async (req: Request<{ driveId: string }>, res: Response) => {
  try {
    const drive = await driveClient.getSharedDrive(req.params.driveId);
    res.json({ drive });
  } catch (err) {
    log.error(`Drive get shared drive error: ${err}`);
    res.status(500).json({ error: `Failed to get shared drive: ${err instanceof Error ? err.message : err}` });
  }
});

// ─── Search ───

// GET /api/drive/search — Full-text search across files
router.get('/search', async (req: Request, res: Response) => {
  try {
    const queryText = req.query.q as string | undefined;
    if (!queryText) {
      res.status(400).json({ error: 'q (search query) is required' });
      return;
    }

    const maxResults = req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : undefined;
    const files = await driveClient.searchFiles(queryText, maxResults);

    res.json({ files });
  } catch (err) {
    log.error(`Drive search error: ${err}`);
    res.status(500).json({ error: `Failed to search files: ${err instanceof Error ? err.message : err}` });
  }
});

// ─── Status & Auth ───

// GET /api/drive/status — Get Google Drive auth status
router.get('/status', (_req: Request, res: Response) => {
  const status = driveClient.getStatus();
  res.json(status);
});

// GET /api/drive/auth/url — Get OAuth authorization URL
router.get('/auth/url', (_req: Request, res: Response) => {
  try {
    const authUrl = driveClient.getAuthUrl();
    res.json({ url: authUrl });
  } catch (err) {
    log.error(`Failed to get drive auth URL: ${err}`);
    res.status(500).json({ error: `Failed to get auth URL: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/drive/auth/callback — Handle OAuth callback from Google
router.get('/auth/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      const errorDescription = req.query.error_description as string | undefined;
      log.warn(`OAuth consent denied: ${error} - ${errorDescription}`);
      const errorMsg = errorDescription || error;
      res.send(`
        <html>
          <head><title>Drive Authorization Failed</title></head>
          <body>
            <h1>Authorization Denied</h1>
            <p>You denied access to your Google Drive: ${errorMsg}</p>
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

    log.log(`Google Drive OAuth callback received, processing code...`);
    await driveClient.handleAuthCallback(code);
    log.log('Google Drive OAuth callback completed successfully');

    res.send(`
      <html>
        <head>
          <title>Drive Authorization Successful</title>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'drive-auth-success' }, '*');
              setTimeout(() => window.close(), 1000);
            } else {
              setTimeout(() => { window.location.href = '/?drive-auth=success'; }, 2000);
            }
          </script>
        </head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>Drive Authorization Successful!</h1>
          <p>Your Google Drive has been connected.</p>
          <p>Closing this window or redirecting you to the app...</p>
        </body>
      </html>
    `);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`Google Drive auth callback error: ${errorMsg}`, err);
    res.status(500).send(`
      <html>
        <head><title>Drive Authorization Failed</title></head>
        <body style="font-family: sans-serif; padding: 40px;">
          <h1>Authorization Failed</h1>
          <p><strong>Error:</strong> ${errorMsg}</p>
          <p><a href="/">Return to the app and try again</a></p>
        </body>
      </html>
    `);
  }
});

export default router;
