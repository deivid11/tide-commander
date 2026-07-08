/**
 * HTTP Request Tests Routes (IntelliJ-style .http files)
 *
 * REST API for the "http" building: scan a folder for .http files and fire
 * individual requests. Runs are synchronous — a single HTTP request resolves
 * quickly (60s server-side timeout), so no runId/WebSocket plumbing is needed.
 */

import { Router, Request, Response } from 'express';
import { httpRequestsService } from '../services/index.js';
import { createLogger, generateId } from '../utils/index.js';
import { saveHttpRun, loadHttpRun, loadHttpRunSummaries } from '../data/index.js';
import type { HttpRunRequestBody, ServerMessage, StoredHttpRun } from '../../shared/types.js';

const log = createLogger('HttpRequestsRoute');

const router = Router();

// Store for broadcasting via WebSocket (wired from the websocket handler).
let broadcastFn: ((message: ServerMessage) => void) | null = null;
export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}
function broadcast(message: ServerMessage): void {
  broadcastFn?.(message);
}

/**
 * POST /api/http-requests/scan - Parse every .http/.rest file under a folder.
 * Body: { path: string }
 */
router.post('/scan', (req: Request, res: Response) => {
  const { path: targetPath } = req.body as { path?: string };
  if (!targetPath) {
    res.status(400).json({ error: 'Missing required field: path' });
    return;
  }
  if (!httpRequestsService.isSafeFolder(targetPath)) {
    res.status(400).json({ error: 'Refusing to scan folders outside your home directory.' });
    return;
  }
  res.json(httpRequestsService.scanFolder(targetPath));
});

/**
 * POST /api/http-requests/run - Execute one request from a .http file.
 * Body: { path, relFile, requestIndex, env? } — responds with HttpRunResult
 * once the request completes (or fails / times out).
 */
router.post('/run', async (req: Request, res: Response) => {
  const { path: targetPath, relFile, requestIndex, env, agentId } = req.body as Partial<HttpRunRequestBody> & {
    agentId?: string;
  };
  if (!targetPath || !relFile || typeof requestIndex !== 'number') {
    res.status(400).json({ error: 'Missing required fields: path, relFile, requestIndex' });
    return;
  }
  if (!httpRequestsService.isSafeFolder(targetPath)) {
    res.status(400).json({ error: 'Refusing to run requests outside your home directory.' });
    return;
  }
  const startAgentId = typeof agentId === 'string' && agentId ? agentId : undefined;
  const runId = generateId();
  try {
    // Announce the run when an agent fired it, so its terminal shows a live
    // inline card immediately (spinner → result), like test runs.
    if (startAgentId) {
      const item = httpRequestsService.peekRequest(targetPath, relFile, requestIndex);
      broadcast({
        type: 'http_run_started',
        payload: {
          runId,
          agentId: startAgentId,
          folder: targetPath,
          relFile,
          requestIndex,
          requestName: item?.name || `${relFile}#${requestIndex}`,
          method: item?.method || 'GET',
          url: item?.url || '',
          env,
        },
      } as ServerMessage);
    }

    const result = await httpRequestsService.executeRequest(targetPath, relFile, requestIndex, env);
    log.log(
      `${result.request.method} ${result.request.url} → ` +
        (result.ok ? `${result.status} in ${result.timeMs}ms` : `error: ${result.error}`),
    );

    // Persist to history (best-effort — the response never waits on failures
    // beyond the synchronous write).
    const stored: StoredHttpRun = {
      runId,
      folder: targetPath,
      relFile,
      requestIndex,
      requestName: result.requestName || `${result.request.method} ${result.request.url}`,
      method: result.request.method,
      url: result.request.url,
      env,
      ok: result.ok,
      status: result.status,
      timeMs: result.timeMs,
      sizeBytes: result.sizeBytes,
      error: result.error,
      finishedAt: Date.now(),
      result,
    };
    saveHttpRun(stored);

    if (startAgentId) {
      broadcast({
        type: 'http_run_completed',
        payload: { runId, agentId: startAgentId, result },
      } as ServerMessage);
    }

    res.json({ ...result, runId });
  } catch (err: any) {
    // Close the inline card on hard failures too (parse error, missing file).
    if (startAgentId) {
      broadcast({
        type: 'http_run_completed',
        payload: {
          runId,
          agentId: startAgentId,
          result: {
            ok: false,
            request: { method: 'GET', url: '', headers: [] },
            timeMs: 0,
            error: err?.message || 'Failed to run request',
          },
        },
      } as ServerMessage);
    }
    res.status(400).json({ error: err?.message || 'Failed to run request' });
  }
});

/**
 * GET /api/http-requests/history - Recent executed requests (newest first).
 * Query: ?folder=<abs path> scopes to one building's folder; ?limit=N (default
 * 50, max 200). Summaries only — fetch /runs/:runId for the full detail.
 */
router.get('/history', (req: Request, res: Response) => {
  const raw = parseInt(req.query.limit as string, 10);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
  const folder = typeof req.query.folder === 'string' && req.query.folder ? req.query.folder : undefined;
  res.json({ runs: loadHttpRunSummaries(limit, folder) });
});

/**
 * GET /api/http-requests/runs/:runId - Full stored run (request + response).
 */
router.get('/runs/:runId', (req: Request, res: Response) => {
  const run = loadHttpRun(req.params.runId as string);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(run);
});

export default router;
