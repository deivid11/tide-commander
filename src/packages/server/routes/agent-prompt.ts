/**
 * Agent Prompt Routes
 *
 * MCP perm-prompt bridge endpoints:
 *  - POST /api/agent-prompt          MCP server enqueues a request; blocks until UI responds
 *  - POST /api/agent-prompt/:id/respond  UI submits the user's answer
 *  - GET  /api/agent-prompt/pending  list pending prompts (debug / reconnect)
 */

import { Router, Request, Response } from 'express';
import * as agentPromptService from '../services/agent-prompt-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AgentPromptRoutes');
const router = Router();

router.post('/agent-prompt', async (req: Request, res: Response) => {
  try {
    const { id, agentId, tool, input } = req.body || {};
    if (!id || !agentId || !tool) {
      res.status(400).json({ error: 'Missing required fields: id, agentId, tool' });
      return;
    }
    if (tool !== 'AskUserQuestion' && tool !== 'ExitPlanMode') {
      res.status(400).json({ error: `Unsupported tool: ${tool}` });
      return;
    }

    const response = await agentPromptService.createPrompt({
      id, agentId, tool,
      input: input || {},
    });
    res.json(response);
  } catch (err: any) {
    log.error('Prompt request error:', err);
    res.status(500).json({ requestId: req.body?.id, approved: false, reason: `Server error: ${err?.message ?? err}` });
  }
});

router.post('/agent-prompt/:id/respond', (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;
  const { approved, answers, reason } = req.body || {};
  if (typeof approved !== 'boolean') {
    res.status(400).json({ error: 'approved (boolean) is required' });
    return;
  }
  const ok = agentPromptService.respondToPrompt({ requestId: id, approved, answers, reason });
  if (!ok) {
    res.status(404).json({ error: 'No pending prompt with that id' });
    return;
  }
  res.json({ ok: true });
});

router.get('/agent-prompt/pending', (req: Request, res: Response) => {
  const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
  const prompts = agentId
    ? agentPromptService.getPendingPromptsForAgent(agentId)
    : agentPromptService.getPendingPrompts();
  res.json(prompts);
});

export default router;
