/**
 * Sessions Routes
 *
 * Cross-project (cwd-agnostic) session discovery and preview. Pairs with the
 * global Session Finder modal in the client. Restoring a session onto an agent
 * is still done over the WebSocket `restore_session` message, which now accepts
 * an optional `cwd` to support cross-project attach.
 */

import { Router, Request, Response } from 'express';
import {
  getSessionRestoreMetadata,
  listAllSessions,
  searchAllSessions,
  loadSession,
  loadSessionAroundMatch,
} from '../claude/session-loader.js';
import { findAgentIdBySessionId } from '../services/agent-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Routes');

const router = Router();

// GET /api/sessions/global?limit=200&includeMessageCount=false
router.get('/global', async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 200, 1000));
    const includeMessageCount = req.query.includeMessageCount === 'true';
    const sessions = await listAllSessions({ limit, includeMessageCount });
    res.json({
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        projectPath: s.projectPath,
        projectDir: s.projectDir,
        lastModified: s.lastModified.toISOString(),
        messageCount: s.messageCount,
        firstPrompt: s.firstPrompt,
        sizeBytes: s.sizeBytes,
        provider: s.provider,
        agentId: findAgentIdBySessionId(s.sessionId) ?? undefined,
      })),
    });
  } catch (err: any) {
    log.error(' Failed to list global sessions:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/search?q=...&limit=100&cwdFilter=...
router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    if (!q.trim()) {
      res.status(400).json({ error: 'Query parameter "q" is required' });
      return;
    }
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const cwdFilter = (req.query.cwdFilter as string) || undefined;
    const matches = await searchAllSessions(q, { limit, cwdFilter });
    res.json({
      query: q,
      matches: matches.map((m) => ({
        sessionId: m.sessionId,
        projectPath: m.projectPath,
        projectDir: m.projectDir,
        lastModified: m.lastModified.toISOString(),
        totalMatches: m.totalMatches,
        snippet: m.snippet,
        extracts: m.extracts,
        firstPrompt: m.firstPrompt,
        provider: m.provider,
        // Owner resolution includes archived session history, so a
        // conversation an agent held BEFORE rotating sessions still maps to
        // that agent in the client.
        agentId: findAgentIdBySessionId(m.sessionId) ?? undefined,
      })),
    });
  } catch (err: any) {
    log.error(' Failed to search global sessions:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/restore-metadata?cwd=...&sessionId=...
// Lightweight, on-demand settings lookup used before opening the new-agent modal.
router.get('/restore-metadata', (req: Request, res: Response) => {
  try {
    const cwd = (req.query.cwd as string) || '';
    const sessionId = (req.query.sessionId as string) || '';
    if (!cwd || !sessionId) {
      res.status(400).json({ error: 'Both "cwd" and "sessionId" query parameters are required' });
      return;
    }
    const metadata = getSessionRestoreMetadata(cwd, sessionId);
    if (!metadata) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(metadata);
  } catch (err: any) {
    log.error(' Failed to load session restore metadata:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/preview?cwd=...&sessionId=...&limit=30&q=...
// With `q`, the returned window is anchored on the most recent matching
// message instead of the tail, so the preview actually shows the hit.
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const cwd = (req.query.cwd as string) || '';
    const sessionId = (req.query.sessionId as string) || '';
    if (!cwd || !sessionId) {
      res.status(400).json({ error: 'Both "cwd" and "sessionId" query parameters are required' });
      return;
    }
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 30, 500));
    const q = ((req.query.q as string) || '').trim();
    const history = q
      ? await loadSessionAroundMatch(cwd, sessionId, limit, q)
      : await loadSession(cwd, sessionId, limit, 0);
    if (!history) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({
      sessionId: history.sessionId,
      cwd: history.cwd,
      messages: history.messages,
      totalCount: history.totalCount,
    });
  } catch (err: any) {
    log.error(' Failed to load session preview:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
