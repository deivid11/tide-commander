/**
 * Agent Routes
 * REST API endpoints for agent management
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { agentService, runtimeService, bossMessageService } from '../services/index.js';
import { getClaudeProjectDir, loadAreas, saveAreas } from '../data/index.js';
import { getAllCustomClasses } from '../services/custom-class-service.js';
// Session listing is done inline for performance
import { createLogger } from '../utils/logger.js';
import { buildCustomAgentConfig } from '../websocket/handlers/command-handler.js';
import { clearDelegation, getBossForSubordinate } from '../websocket/handlers/boss-response-handler.js';
import { getSystemPrompt, setSystemPrompt, clearSystemPrompt, isEchoPromptEnabled, setEchoPromptEnabled, getCodexBinaryPath, setCodexBinaryPath, isTmuxModeEnabled, setTmuxModeEnabled } from '../services/system-prompt-service.js';
import type { ServerMessage } from '../../shared/types.js';

const log = createLogger('Routes');

const router = Router();

// Store for broadcasting via WebSocket
let broadcastFn: ((message: ServerMessage) => void) | null = null;

/**
 * Set the broadcast function for sending messages to all WebSocket clients
 */
export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

interface ProcessCommandResult {
  exitCode: number | null;
  output: string;
  errorOutput: string;
}

function runCommandWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd?: string
): Promise<ProcessCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      const output = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const errorOutput = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (timedOut) {
        resolve({
          exitCode: code,
          output,
          errorOutput: errorOutput || `Command timed out after ${timeoutMs}ms`,
        });
        return;
      }

      resolve({
        exitCode: code,
        output,
        errorOutput,
      });
    });
  });
}

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
    await runtimeService.syncAllAgentStatus();

    const agents = agentService.getAllAgents();

    // Return lightweight status
    const statuses = agents.map((agent) => ({
      id: agent.id,
      status: agent.status,
      currentTask: agent.currentTask,
      currentTool: agent.currentTool,
      isProcessRunning: runtimeService.isAgentRunning(agent.id),
    }));

    res.json(statuses);
  } catch (err: any) {
    log.error(' Failed to get agent status:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:id/process-output - Get `witr --pid` output for this agent process
router.get('/:id/process-output', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const agentId = req.params.id;
    const agent = agentService.getAgent(agentId);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const processInfo = await runtimeService.getAgentRuntimeProcessInfo(agentId);
    if (!processInfo.pid) {
      res.status(404).json({ error: 'No running process found for agent' });
      return;
    }

    const result = await runCommandWithTimeout('witr', ['--pid', String(processInfo.pid)], 8000, agent.cwd);

    res.json({
      agentId,
      pid: processInfo.pid,
      source: processInfo.source,
      command: `witr --pid ${processInfo.pid}`,
      exitCode: result.exitCode,
      output: result.output,
      errorOutput: result.errorOutput,
      fetchedAt: Date.now(),
    });
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      res.status(501).json({ error: 'witr command not found on server' });
      return;
    }

    log.error(' Failed to fetch agent process output:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch process output' });
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

// ============================================================================
// Bulk Operations Routes
// NOTE: Must be defined BEFORE /:id routes to prevent "bulk" being interpreted as an ID
// ============================================================================

// POST /api/agents/bulk/delete - Delete multiple agents by IDs
router.post('/bulk/delete', async (req: Request, res: Response) => {
  try {
    const { agentIds } = req.body as { agentIds?: string[] };

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'agentIds must be a non-empty array of strings' });
      return;
    }

    const deleted: string[] = [];
    const failed: string[] = [];

    for (const agentId of agentIds) {
      try {
        const agent = agentService.getAgent(agentId);
        if (!agent) {
          failed.push(agentId);
          continue;
        }
        await runtimeService.stopAgent(agentId);
        const success = agentService.deleteAgent(agentId);
        if (success) {
          deleted.push(agentId);
        } else {
          failed.push(agentId);
        }
      } catch (err) {
        log.error(` Bulk delete failed for agent ${agentId}:`, err);
        failed.push(agentId);
      }
    }

    log.log(`Bulk delete: ${deleted.length} deleted, ${failed.length} failed`);
    res.json({ deleted, failed });
  } catch (err: any) {
    log.error(' Bulk delete failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents/bulk/stop - Stop multiple agents
router.post('/bulk/stop', async (req: Request, res: Response) => {
  try {
    const { agentIds } = req.body as { agentIds?: string[] };

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'agentIds must be a non-empty array of strings' });
      return;
    }

    const stopped: string[] = [];
    const failed: string[] = [];

    for (const agentId of agentIds) {
      try {
        const agent = agentService.getAgent(agentId);
        if (!agent) {
          failed.push(agentId);
          continue;
        }
        await runtimeService.stopAgent(agentId);
        agentService.updateAgent(agentId, {
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
        });
        stopped.push(agentId);
      } catch (err) {
        log.error(` Bulk stop failed for agent ${agentId}:`, err);
        failed.push(agentId);
      }
    }

    log.log(`Bulk stop: ${stopped.length} stopped, ${failed.length} failed`);
    res.json({ stopped, failed });
  } catch (err: any) {
    log.error(' Bulk stop failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents/bulk/clear-context - Clear context/reset session for multiple agents
router.post('/bulk/clear-context', async (req: Request, res: Response) => {
  try {
    const { agentIds } = req.body as { agentIds?: string[] };

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'agentIds must be a non-empty array of strings' });
      return;
    }

    const cleared: string[] = [];
    const failed: string[] = [];

    for (const agentId of agentIds) {
      try {
        const agent = agentService.getAgent(agentId);
        if (!agent) {
          failed.push(agentId);
          continue;
        }
        await runtimeService.stopAgent(agentId);
        agentService.updateAgent(agentId, {
          status: 'idle',
          currentTask: undefined,
          taskLabel: undefined,
          currentTool: undefined,
          lastAssignedTask: undefined,
          lastAssignedTaskTime: undefined,
          sessionId: undefined,
          tokensUsed: 0,
          contextUsed: 0,
          contextStats: undefined,
        });
        cleared.push(agentId);
      } catch (err) {
        log.error(` Bulk clear-context failed for agent ${agentId}:`, err);
        failed.push(agentId);
      }
    }

    log.log(`Bulk clear-context: ${cleared.length} cleared, ${failed.length} failed`);
    res.json({ cleared, failed });
  } catch (err: any) {
    log.error(' Bulk clear-context failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents/bulk/move-area - Move multiple agents to an area
router.post('/bulk/move-area', async (req: Request, res: Response) => {
  try {
    const { agentIds, areaId } = req.body as { agentIds?: string[]; areaId?: string | null };

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'agentIds must be a non-empty array of strings' });
      return;
    }

    const areas = loadAreas();
    const moved: string[] = [];
    const failed: string[] = [];

    for (const agentId of agentIds) {
      try {
        const agent = agentService.getAgent(agentId);
        if (!agent) {
          failed.push(agentId);
          continue;
        }

        // Remove agent from all areas first
        for (const area of areas) {
          area.assignedAgentIds = area.assignedAgentIds.filter(id => id !== agentId);
        }

        // Add to target area if specified
        if (areaId) {
          const targetArea = areas.find(a => a.id === areaId);
          if (!targetArea) {
            failed.push(agentId);
            continue;
          }
          if (!targetArea.assignedAgentIds.includes(agentId)) {
            targetArea.assignedAgentIds.push(agentId);
          }
        }

        moved.push(agentId);
      } catch (err) {
        log.error(` Bulk move-area failed for agent ${agentId}:`, err);
        failed.push(agentId);
      }
    }

    // Save areas once after all moves
    if (moved.length > 0) {
      saveAreas(areas);
    }

    log.log(`Bulk move-area: ${moved.length} moved to ${areaId || 'none'}, ${failed.length} failed`);
    res.json({ moved, failed });
  } catch (err: any) {
    log.error(' Bulk move-area failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/bulk/filters - Return available filter values
router.get('/bulk/filters', (_req: Request, res: Response) => {
  try {
    const agents = agentService.getAllAgents();
    const areas = loadAreas();
    const customClasses = getAllCustomClasses();

    // Collect unique statuses from agents
    const statuses = [...new Set(agents.map(a => a.status))];

    // Collect unique providers
    const providers = [...new Set(agents.map(a => a.provider))];

    // Collect unique models
    const models = [...new Set(agents.map(a => a.model).filter(Boolean))] as string[];

    // Collect all classes (built-in + custom)
    const builtInClasses = ['scout', 'builder', 'debugger', 'architect', 'warrior', 'support', 'boss'];
    const customClassIds = customClasses.map(c => c.id);
    const classes = [...new Set([...builtInClasses, ...customClassIds, ...agents.map(a => a.class)])];

    res.json({
      statuses,
      areas: areas.map(a => ({ id: a.id, name: a.name })),
      providers,
      models,
      classes,
    });
  } catch (err: any) {
    log.error(' Failed to get bulk filters:', err);
    res.status(500).json({ error: err.message });
  }
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
    const includeSubagents = req.query.includeSubagents !== 'false'; // default true
    const subagentEntriesLimit = parseInt(req.query.subagentEntriesLimit as string) || 200;
    const result = await agentService.getAgentHistory(req.params.id, limit, offset, includeSubagents, subagentEntriesLimit);

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
      await runtimeService.sendCommand(agentId, bossMessage, systemPrompt);
    } else {
      // Regular agents get custom agent config (identity header, class instructions, skills)
      const customAgentConfig = buildCustomAgentConfig(agentId, agent.class);
      await runtimeService.sendCommand(agentId, message, undefined, undefined, customAgentConfig);
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

// POST /api/agents/:id/report-task - Subordinate reports task completion to its boss
router.post('/:id/report-task', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const subordinateId = req.params.id;
    const { summary, status } = req.body as { summary?: string; status?: 'completed' | 'failed' };

    const agent = agentService.getAgent(subordinateId);
    if (!agent) {
      res.status(404).json({ error: `Agent not found: ${subordinateId}` });
      return;
    }

    // Find the boss for this subordinate (via active delegation tracking)
    const delegation = getBossForSubordinate(subordinateId);
    if (!delegation) {
      res.status(400).json({ error: `No active delegation found for agent ${agent.name}. Not currently working under a boss.` });
      return;
    }

    const bossAgent = agentService.getAgent(delegation.bossId);
    const bossName = bossAgent?.name || delegation.bossId;
    const taskStatus = status || 'completed';
    const success = taskStatus === 'completed';

    log.log(`Agent ${agent.name} reporting task ${taskStatus} to boss ${bossName}: "${(summary || '').slice(0, 80)}"`);

    // 1. Broadcast agent_task_completed to update the progress indicator on the client
    if (broadcastFn) {
      broadcastFn({
        type: 'agent_task_completed',
        payload: {
          bossId: delegation.bossId,
          subordinateId,
          success,
        },
      } as any);
    }

    // 2. Clear the active delegation tracking
    clearDelegation(subordinateId);

    // 3. Send a message to the boss so it knows the task finished and can decide next steps
    const reportMessage = `[TASK REPORT from ${agent.name} (${subordinateId})]\n\nStatus: ${taskStatus === 'completed' ? 'COMPLETED' : 'FAILED'}\nOriginal task: ${delegation.taskDescription}\n${summary ? `\nSummary: ${summary}` : ''}\n\nYou may review the result, give follow-up instructions, or dismiss this agent's progress indicator.`;

    if (bossAgent?.isBoss || bossAgent?.class === 'boss') {
      const { message: bossMessage, systemPrompt } = await bossMessageService.buildBossMessage(delegation.bossId, reportMessage);
      await runtimeService.sendCommand(delegation.bossId, bossMessage, systemPrompt);
    } else {
      await runtimeService.sendCommand(delegation.bossId, reportMessage);
    }

    res.status(200).json({
      success: true,
      subordinateId: agent.id,
      subordinateName: agent.name,
      bossId: delegation.bossId,
      bossName,
      taskStatus,
    });
  } catch (err: any) {
    log.error(' Failed to report task to boss:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// System Settings Routes
// ============================================================================

// GET /api/system-settings/prompt - Get the current system prompt
router.get('/system-settings/prompt', (_req: Request, res: Response) => {
  try {
    const prompt = getSystemPrompt();
    res.json({ prompt });
  } catch (err: any) {
    log.error(' Failed to get system prompt:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/prompt - Update the system prompt
router.post('/system-settings/prompt', (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;

    if (typeof prompt !== 'string') {
      res.status(400).json({ error: 'Prompt must be a string' });
      return;
    }

    setSystemPrompt(prompt);

    log.log(` System prompt updated (${prompt.length} chars)`);

    res.json({
      success: true,
      message: 'System prompt updated successfully',
      length: prompt.length
    });
  } catch (err: any) {
    log.error(' Failed to set system prompt:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/system-settings/prompt - Clear the system prompt
router.delete('/system-settings/prompt', (_req: Request, res: Response) => {
  try {
    clearSystemPrompt();

    log.log(` System prompt cleared`);

    res.json({
      success: true,
      message: 'System prompt cleared successfully'
    });
  } catch (err: any) {
    log.error(' Failed to clear system prompt:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-settings/echo-prompt - Get echo prompt setting
router.get('/system-settings/echo-prompt', (_req: Request, res: Response) => {
  try {
    const enabled = isEchoPromptEnabled();
    res.json({ enabled });
  } catch (err: any) {
    log.error(' Failed to get echo prompt setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/echo-prompt - Update echo prompt setting
router.post('/system-settings/echo-prompt', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    setEchoPromptEnabled(enabled);
    log.log(` Echo prompt setting updated: enabled=${enabled}`);
    res.json({ success: true, enabled });
  } catch (err: any) {
    log.error(' Failed to set echo prompt setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-settings/codex-binary - Get the codex binary path
router.get('/system-settings/codex-binary', (_req: Request, res: Response) => {
  try {
    const binaryPath = getCodexBinaryPath();
    res.json({ path: binaryPath });
  } catch (err: any) {
    log.error(' Failed to get codex binary path:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/codex-binary - Set the codex binary path
router.post('/system-settings/codex-binary', (req: Request, res: Response) => {
  try {
    const { path: binaryPath } = req.body;
    if (typeof binaryPath !== 'string') {
      res.status(400).json({ error: 'path must be a string' });
      return;
    }
    setCodexBinaryPath(binaryPath);
    log.log(` Codex binary path updated: ${binaryPath || '(cleared)'}`);
    res.json({ success: true, path: binaryPath });
  } catch (err: any) {
    log.error(' Failed to set codex binary path:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-settings/tmux-mode - Get tmux mode setting
router.get('/system-settings/tmux-mode', (_req: Request, res: Response) => {
  try {
    const enabled = isTmuxModeEnabled();
    res.json({ enabled });
  } catch (err: any) {
    log.error(' Failed to get tmux mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/tmux-mode - Update tmux mode setting
router.post('/system-settings/tmux-mode', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    setTmuxModeEnabled(enabled);
    log.log(` Tmux mode setting updated: enabled=${enabled}`);
    res.json({ success: true, enabled });
  } catch (err: any) {
    log.error(' Failed to set tmux mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
