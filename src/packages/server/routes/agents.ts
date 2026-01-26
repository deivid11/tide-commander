/**
 * Agent Routes
 * REST API endpoints for agent management
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { agentService, claudeService, bossMessageService } from '../services/index.js';
import { getClaudeProjectDir } from '../data/index.js';
// Session listing is done inline for performance
import { createLogger } from '../utils/logger.js';
import { buildCustomAgentConfig } from '../websocket/handlers/command-handler.js';

const log = createLogger('Routes');

const router = Router();

// GET /api/agents/claude-sessions - List all Claude Code sessions
// NOTE: This must be defined BEFORE /:id routes to prevent being interpreted as an ID
router.get('/claude-sessions', async (req: Request, res: Response) => {
  try {
    const cwd = req.query.cwd as string | undefined;
    const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

    interface SessionWithProject {
      sessionId: string;
      projectPath: string;
      lastModified: Date;
      messageCount: number;
      firstMessage?: string;
    }

    const allSessions: SessionWithProject[] = [];

    if (cwd) {
      // List sessions for specific directory - optimized for speed
      // Only read file metadata and first few KB to find first message
      const projectDir = path.join(os.homedir(), '.claude', 'projects');
      const encodedPath = cwd.replace(/\/+$/, '').replace(/[/_]/g, '-');
      const sessionDir = path.join(projectDir, encodedPath);

      if (fs.existsSync(sessionDir)) {
        const files = fs.readdirSync(sessionDir);

        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;

          const sessionId = file.replace('.jsonl', '');
          const filePath = path.join(sessionDir, file);

          try {
            const stats = fs.statSync(filePath);

            // Estimate message count from file size (avg ~500 bytes per message)
            const estimatedMessages = Math.max(1, Math.round(stats.size / 500));

            // Only read first 8KB to find first user message (much faster)
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(8192);
            const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
            fs.closeSync(fd);

            const chunk = buffer.toString('utf-8', 0, bytesRead);
            const lines = chunk.split('\n');

            let firstMessage: string | undefined;
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'user' && parsed.message?.content) {
                  const msg = typeof parsed.message.content === 'string'
                    ? parsed.message.content
                    : (Array.isArray(parsed.message.content) && parsed.message.content[0]?.text) || '';
                  firstMessage = msg.substring(0, 100);
                  break;
                }
              } catch {
                // Skip invalid/incomplete lines
              }
            }

            allSessions.push({
              sessionId,
              projectPath: cwd,
              lastModified: stats.mtime,
              messageCount: estimatedMessages,
              firstMessage,
            });
          } catch {
            // Skip files that can't be read
          }
        }

        // Sort by last modified, newest first
        allSessions.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
      }
    } else {
      // List all sessions across all projects
      if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
        const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);

        for (const encodedPath of projectDirs) {
          const projectDir = path.join(CLAUDE_PROJECTS_DIR, encodedPath);
          const stats = fs.statSync(projectDir);
          if (!stats.isDirectory()) continue;

          // Decode path: -home-user-project -> /home/user/project
          const decodedPath = encodedPath.replace(/^-/, '/').replace(/-/g, '/');

          const files = fs.readdirSync(projectDir);
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;

            const sessionId = file.replace('.jsonl', '');
            const filePath = path.join(projectDir, file);
            const fileStats = fs.statSync(filePath);

            // Count messages quickly
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());
            let messageCount = 0;
            let firstMessage: string | undefined;

            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'user' || parsed.type === 'assistant') {
                  messageCount++;
                  if (!firstMessage && parsed.type === 'user' && parsed.message?.content) {
                    const msg = typeof parsed.message.content === 'string'
                      ? parsed.message.content
                      : parsed.message.content[0]?.text || '';
                    firstMessage = msg.substring(0, 100);
                  }
                }
              } catch {
                // Skip invalid lines
              }
            }

            allSessions.push({
              sessionId,
              projectPath: decodedPath,
              lastModified: fileStats.mtime,
              messageCount,
              firstMessage,
            });
          }
        }

        // Sort by last modified, newest first
        allSessions.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
      }
    }

    // Return top 20 sessions
    res.json({ sessions: allSessions.slice(0, 20) });
  } catch (err: any) {
    log.error(' Failed to list Claude sessions:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/tool-history - Get tool history for all agents
// NOTE: This must be defined BEFORE /:id routes to prevent "tool-history" being interpreted as an ID
router.get('/tool-history', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const result = await agentService.getAllToolHistory(limit);
    res.json(result);
  } catch (err: any) {
    log.error(' Failed to load tool history:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/status - Get lightweight status for all agents (for polling)
// NOTE: Must be before /:id route
router.get('/status', async (_req: Request, res: Response) => {
  try {
    // Sync status before returning
    await claudeService.syncAllAgentStatus();

    const agents = agentService.getAllAgents();

    // Return lightweight status
    const statuses = agents.map((agent) => ({
      id: agent.id,
      status: agent.status,
      currentTask: agent.currentTask,
      currentTool: agent.currentTool,
      isProcessRunning: claudeService.isAgentRunning(agent.id),
    }));

    res.json(statuses);
  } catch (err: any) {
    log.error(' Failed to get agent status:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents - List all agents
router.get('/', (_req: Request, res: Response) => {
  const agents = agentService.getAllAgents();
  res.json(agents);
});

// GET /api/agents/simple - List all agents (ids and names only)
router.get('/simple', (_req: Request, res: Response) => {
  const agents = agentService.getAllAgents();
  res.json(agents.map(agent => ({ id: agent.id, name: agent.name })));
});

// POST /api/agents - Create new agent
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, class: agentClass, cwd, position } = req.body;

    if (!name || !agentClass || !cwd) {
      res.status(400).json({ error: 'Missing required fields: name, class, cwd' });
      return;
    }

    const agent = await agentService.createAgent(name, agentClass, cwd, position);
    res.status(201).json(agent);
  } catch (err: any) {
    log.error(' Failed to create agent:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:id - Get single agent
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const agent = agentService.getAgent(req.params.id);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.json(agent);
});

// PATCH /api/agents/:id - Update agent
router.patch('/:id', (req: Request<{ id: string }>, res: Response) => {
  // Protect sessionId from being accidentally cleared via API
  // Only allow explicit session management through dedicated endpoints
  const { sessionId, ...safeUpdates } = req.body;
  if (sessionId !== undefined) {
    log.warn(`API attempted to modify sessionId for agent ${req.params.id} - blocked`);
  }

  const updated = agentService.updateAgent(req.params.id, safeUpdates);

  if (!updated) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.json(updated);
});

// DELETE /api/agents/:id - Delete agent
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  const deleted = agentService.deleteAgent(req.params.id);

  if (!deleted) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.status(204).end();
});

// GET /api/agents/:id/sessions - List agent's sessions
router.get('/:id/sessions', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const result = await agentService.getAgentSessions(req.params.id);

    if (!result) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json(result);
  } catch (err: any) {
    log.error(' Failed to list sessions:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:id/history - Get conversation history
router.get('/:id/history', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await agentService.getAgentHistory(req.params.id, limit, offset);

    if (!result) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const agent = agentService.getAgent(req.params.id);
    res.json({
      ...result,
      claudeProjectDir: agent ? getClaudeProjectDir(agent.cwd) : null,
    });
  } catch (err: any) {
    log.error(' Failed to load history:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:id/search - Search conversation history
router.get('/:id/search', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!query) {
      res.status(400).json({ error: 'Query parameter "q" is required' });
      return;
    }

    const result = await agentService.searchAgentHistory(req.params.id, query, limit);

    if (!result) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json(result);
  } catch (err: any) {
    log.error(' Failed to search history:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents/:id/message - Send a message/command to an agent
router.post('/:id/message', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { message } = req.body;
    const agentId = req.params.id;

    if (!message) {
      res.status(400).json({ error: 'Missing required field: message' });
      return;
    }

    const agent = agentService.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent not found: ${agentId}` });
      return;
    }

    log.log(`API message to agent ${agent.name}: "${message.slice(0, 50)}${message.length > 50 ? '...' : ''}"`);

    // Handle boss agents with their special context building
    if (agent.isBoss || agent.class === 'boss') {
      const { message: bossMessage, systemPrompt } = await bossMessageService.buildBossMessage(agentId, message);
      await claudeService.sendCommand(agentId, bossMessage, systemPrompt);
    } else {
      // Regular agents get custom agent config (identity header, class instructions, skills)
      const customAgentConfig = buildCustomAgentConfig(agentId, agent.class);
      await claudeService.sendCommand(agentId, message, undefined, undefined, customAgentConfig);
    }

    res.status(200).json({
      success: true,
      agentId: agent.id,
      agentName: agent.name,
      message: 'Command sent successfully'
    });
  } catch (err: any) {
    log.error(' Failed to send message to agent:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
