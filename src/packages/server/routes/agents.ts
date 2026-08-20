/**
 * Agent Routes
 * REST API endpoints for agent management
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { agentService, runtimeService, bossMessageService, skillService } from '../services/index.js';
import { getClaudeProjectDir, loadAreas, saveAreas } from '../data/index.js';
import { loadSession } from '../claude/session-loader.js';
import { getAllCustomClasses } from '../services/custom-class-service.js';
// Session listing is done inline for performance
import { createLogger } from '../utils/logger.js';
import { withAgentContext } from '../utils/log-context.js';
import { truncateOrEmpty } from '../utils/string.js';
import { buildCustomAgentConfig, expandFileMentions } from '../websocket/handlers/command-handler.js';
import { clearDelegation, getBossForSubordinate } from '../websocket/handlers/boss-response-handler.js';
import { OpencodeBackend } from '../opencode/backend.js';
import { getPiModelCatalog, getPiModelCatalogFetchedAt } from '../pi/model-catalog.js';
import {
  createTransferredSession,
  isSessionTransferTarget,
  removeTransferredSession,
  SessionTransferError,
  type CreatedTransfer,
} from '../services/session-transfer-service.js';
import { getSystemPrompt, setSystemPrompt, clearSystemPrompt, isEchoPromptEnabled, setEchoPromptEnabled, getCodexBinaryPath, setCodexBinaryPath, isTmuxModeEnabled, setTmuxModeEnabled, isInteractiveModeEnabled, setInteractiveModeEnabled, isCodexAppServerModeEnabled, setCodexAppServerModeEnabled, isOpencodeServerModeEnabled, setOpencodeServerModeEnabled, isPiRpcModeEnabled, setPiRpcModeEnabled } from '../services/system-prompt-service.js';
import { markInstructionsDirtyForAll } from '../services/instruction-refresh.js';
import { startAgentTerminal, stopAgentTerminal } from '../services/agent-terminal-service.js';
import { buildClaudeUsageByAgentSummary, buildClaudeUsageByDaySummary, buildClaudeUsageSnapshot } from '../services/claude-usage-service.js';
import { getBackgroundTasksForAgent } from '../services/background-tasks.js';
import { buildGrokUsageSnapshot } from '../services/grok-usage-service.js';
import { buildCodexUsageSnapshot } from '../services/codex-usage-service.js';
import { buildPiSubscriptionUsageSnapshot } from '../services/pi-subscription-usage-service.js';
import { buildOpencodeUsageSnapshot } from '../services/opencode-usage-service.js';
import { getBackupStatus, setBackupEnabled } from '../services/backup-service.js';
import type { Agent, AgentProvider, ClaudeEffort, CodexConfig, ServerMessage, SessionTransferMode, SessionTransferSummary } from '../../shared/types.js';
import { CLAUDE_MODELS, GROK_MODELS, providerDisplayName } from '../../shared/types.js';

const log = createLogger('Routes');

const router = Router();

router.param('id', (req, _res, next, id) => {
  withAgentContext(typeof id === 'string' ? id : undefined, () => next());
});

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

// GET /api/agents/opencode/models - List opencode CLI models
// NOTE: Defined BEFORE /:id routes so "opencode" is not parsed as an agent id.
interface OpencodeModelsCache {
  models: string[];
  fetchedAt: number;
  source: 'cli' | 'fallback';
}
let opencodeModelsCache: OpencodeModelsCache | null = null;
const OPENCODE_MODELS_TTL_MS = 60 * 60 * 1000; // 1 hour

router.get('/opencode/models', async (req: Request, res: Response) => {
  const refresh = req.query.refresh === 'true' || req.query.refresh === '1';
  const now = Date.now();

  if (!refresh && opencodeModelsCache && now - opencodeModelsCache.fetchedAt < OPENCODE_MODELS_TTL_MS) {
    res.json({
      models: opencodeModelsCache.models,
      source: opencodeModelsCache.source,
      cached: true,
      fetchedAt: opencodeModelsCache.fetchedAt,
    });
    return;
  }

  try {
    const opencodeExe = new OpencodeBackend().getExecutablePath();
    const args = refresh ? ['models', '--refresh'] : ['models'];
    const result = await runCommandWithTimeout(opencodeExe, args, 15000);

    const models = result.output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes('/'));

    if (models.length === 0) {
      res.status(502).json({
        error: 'opencode CLI returned no models',
        stderr: result.errorOutput || undefined,
        exitCode: result.exitCode,
      });
      return;
    }

    opencodeModelsCache = { models, fetchedAt: now, source: 'cli' };
    // `opencode serve` keeps the Models.dev catalog in memory for its entire
    // lifetime. Refreshing the CLI cache alone can therefore show a new model
    // in the picker while the persistent daemon still rejects it. Invalidate
    // the daemon too; active turns defer this safely until they finish.
    const daemonReload = refresh
      ? runtimeService.requestOpencodeModelCatalogReload()
      : undefined;
    res.json({ models, source: 'cli', cached: false, fetchedAt: now, daemonReload });
  } catch (err: any) {
    log.error(' opencode models fetch failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to run opencode CLI' });
  }
});

// GET /api/agents/pi/models - List Pi CLI models and their authoritative
// context windows (providers with credentials only). Defined before /:id so
// "pi" is not parsed as an agent id.
router.get('/pi/models', async (req: Request, res: Response) => {
  const refresh = req.query.refresh === 'true' || req.query.refresh === '1';
  const previousFetchedAt = getPiModelCatalogFetchedAt();

  try {
    const modelDetails = await getPiModelCatalog(refresh);
    const fetchedAt = getPiModelCatalogFetchedAt() || Date.now();
    res.json({
      models: modelDetails.map((entry) => entry.id),
      modelDetails,
      source: 'cli',
      cached: !refresh && previousFetchedAt === fetchedAt,
      fetchedAt,
    });
  } catch (err: any) {
    log.error(' pi models fetch failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to run pi CLI' });
  }
});

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

// GET /api/agents/usage-by-agent - Claude JSONL usage totals grouped by agent
//
// This mirrors the incident-analysis accounting: assistant messages are
// deduped by Claude requestId and total tokens include input, cache creation,
// cache read, and output tokens.
router.get('/usage-by-agent', async (req: Request, res: Response) => {
  try {
    const agents = agentService.getAllAgents();
    const summary = await buildClaudeUsageByAgentSummary(agents, {
      since: req.query.since,
      until: req.query.until,
    });
    res.json(summary);
  } catch (err: any) {
    log.error(' Failed to build usage-by-agent summary:', err);
    res.status(500).json({ error: err?.message ?? 'Failed to build usage summary' });
  }
});

// GET /api/agents/usage-by-day - Claude JSONL usage totals grouped by local day
router.get('/usage-by-day', async (req: Request, res: Response) => {
  try {
    const agents = agentService.getAllAgents();
    const summary = await buildClaudeUsageByDaySummary(agents, {
      since: req.query.since,
      until: req.query.until,
      days: req.query.days,
    });
    res.json(summary);
  } catch (err: any) {
    log.error(' Failed to build usage-by-day summary:', err);
    res.status(500).json({ error: err?.message ?? 'Failed to build daily usage summary' });
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

// GET /api/agents/:id/background-tasks - Active background tasks (backgrounded
// Bash / async subagents) currently tracked for this agent.
router.get('/:id/background-tasks', (req: Request<{ id: string }>, res: Response) => {
  const agent = agentService.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.json({ agentId: agent.id, tasks: getBackgroundTasksForAgent(agent.id) });
});

// GET /api/agents/:id/background-tasks/:key/output?tail=<bytes> - Live tail of a
// background task's output file. `key` is the task's registry key (toolUseId or
// taskId); the file path comes from the registry (parsed from the CLI's launch
// stub) or is derived from the agent's session: <tmp>/claude-<uid>/*/<sessionId>/tasks/<taskId>.output.
router.get('/:id/background-tasks/:key/output', (req: Request<{ id: string; key: string }>, res: Response) => {
  try {
    const agent = agentService.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    const task = getBackgroundTasksForAgent(agent.id).find(
      (t) => t.key === req.params.key || t.taskId === req.params.key || t.toolUseId === req.params.key
    );
    if (!task) {
      res.status(404).json({ error: 'Background task not found (it may have finished)' });
      return;
    }

    // Resolve the output file: prefer the stub-reported path, else derive it
    // from the session. Both must land inside the CLI's task-output tree.
    const tasksDirRoot = path.join(os.tmpdir(), `claude-${typeof process.getuid === 'function' ? process.getuid() : 0}`);
    let outputFile = task.outputFile;
    if (!outputFile && task.taskId && agent.sessionId && /^[\w-]+$/.test(task.taskId)) {
      try {
        for (const projectSlug of fs.readdirSync(tasksDirRoot)) {
          const candidate = path.join(tasksDirRoot, projectSlug, agent.sessionId, 'tasks', `${task.taskId}.output`);
          if (fs.existsSync(candidate)) {
            outputFile = candidate;
            break;
          }
        }
      } catch { /* tmp dir absent — treated as no output below */ }
    }
    if (!outputFile) {
      res.json({ agentId: agent.id, key: task.key, exists: false, content: '', size: 0 });
      return;
    }
    // Containment check: only files inside the CLI task-output tree are readable.
    const resolved = path.resolve(outputFile);
    if (!resolved.startsWith(tasksDirRoot + path.sep) || !resolved.endsWith('.output') || !resolved.includes(`${path.sep}tasks${path.sep}`)) {
      res.status(400).json({ error: 'Output file outside the task-output directory' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.json({ agentId: agent.id, key: task.key, exists: false, content: '', size: 0, outputFile: resolved });
      return;
    }

    const tailBytes = Math.min(Math.max(Number(req.query.tail) || 4000, 256), 65536);
    const stat = fs.statSync(resolved);
    const start = Math.max(0, stat.size - tailBytes);
    const fd = fs.openSync(resolved, 'r');
    let content: string;
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      content = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    // A mid-file start almost always lands inside a line — drop the partial one.
    if (start > 0) {
      const firstNewline = content.indexOf('\n');
      if (firstNewline !== -1) content = content.slice(firstNewline + 1);
    }

    res.json({
      agentId: agent.id,
      key: task.key,
      exists: true,
      content,
      size: stat.size,
      truncated: start > 0,
      mtimeMs: stat.mtimeMs,
      outputFile: resolved,
    });
  } catch (err: any) {
    log.error(' Failed to tail background task output:', err);
    res.status(500).json({ error: err?.message || 'Failed to read task output' });
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

// POST /api/agents/bulk/change-model - Change model for multiple agents.
// Pi sessions are provider-neutral and are preserved across model providers.
router.post('/bulk/change-model', async (req: Request, res: Response) => {
  try {
    const { agentIds, provider, model, effort } = req.body as {
      agentIds?: string[];
      provider?: 'claude' | 'codex' | 'opencode' | 'grok' | 'pi';
      model?: string;
      effort?: string | null;
    };

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'agentIds must be a non-empty array of strings' });
      return;
    }
    if (typeof provider !== 'string' || typeof model !== 'string') {
      res.status(400).json({ error: 'provider and model are required strings' });
      return;
    }

    let sanitized: string | undefined;
    if (provider === 'claude') {
      sanitized = agentService.sanitizeModelForProvider('claude', model);
    } else if (provider === 'codex') {
      sanitized = agentService.sanitizeCodexModel(model);
    } else if (provider === 'opencode') {
      sanitized = agentService.sanitizeOpencodeModel(model);
    } else if (provider === 'grok') {
      sanitized = agentService.sanitizeGrokModel(model);
    } else if (provider === 'pi') {
      sanitized = agentService.sanitizePiModel(model);
    }

    if (!sanitized) {
      res.status(400).json({ error: `Invalid model "${model}" for provider "${provider}"` });
      return;
    }

    // Effort is Claude/Grok/Pi. `null` means "clear back to default"; undefined means "leave unchanged".
    const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xHigh', 'max']);
    let effortUpdate: { set: true; value: string | undefined } | { set: false } = { set: false };
    if (effort !== undefined && (provider === 'claude' || provider === 'grok' || provider === 'pi')) {
      if (effort === null) {
        effortUpdate = { set: true, value: undefined };
      } else if (typeof effort === 'string' && VALID_EFFORTS.has(effort)) {
        effortUpdate = { set: true, value: effort };
      } else {
        res.status(400).json({ error: `Invalid effort "${effort}" — expected one of: low, medium, high, xHigh, max, or null` });
        return;
      }
    }

    const changed: string[] = [];
    const failed: string[] = [];

    for (const agentId of agentIds) {
      try {
        const agent = agentService.getAgent(agentId);
        if (!agent || (agent.provider ?? 'claude') !== provider) {
          failed.push(agentId);
          continue;
        }

        if (provider === 'pi') {
          const switchedInPlace = await runtimeService.switchAgentModel(
            agentId,
            sanitized,
            effortUpdate.set ? effortUpdate.value : agent.effort,
          );
          if (!switchedInPlace && runtimeService.isAgentRunning(agentId)) {
            // Pi single-shot mode cannot switch live, but the same Pi session
            // can resume on the selected provider/model after this stop.
            await runtimeService.stopAgent(agentId);
          }
        } else {
          await runtimeService.stopAgent(agentId);
        }

        const modelUpdates: Record<string, unknown> = provider === 'pi'
          ? {
              status: 'idle',
              currentTask: undefined,
              currentTool: undefined,
              contextStats: undefined,
            }
          : {
              status: 'idle',
              currentTask: undefined,
              currentTool: undefined,
              sessionId: undefined,
              tokensUsed: 0,
              contextUsed: 0,
              contextStats: undefined,
            };
        if (provider === 'claude') modelUpdates.model = sanitized;
        else if (provider === 'codex') modelUpdates.codexModel = sanitized;
        else if (provider === 'opencode') modelUpdates.opencodeModel = sanitized;
        else if (provider === 'grok') modelUpdates.grokModel = sanitized;
        else if (provider === 'pi') {
          modelUpdates.piModel = sanitized;
          modelUpdates.piModelProvider = sanitized?.includes('/')
            ? sanitized.slice(0, sanitized.indexOf('/')).trim().toLowerCase() || undefined
            : undefined;
          const piContextLimit = await agentService.resolvePiModelContextLimit(sanitized);
          if (piContextLimit) {
            modelUpdates.contextLimit = piContextLimit;
            modelUpdates.contextStats = undefined;
          }
        }

        if (effortUpdate.set) modelUpdates.effort = effortUpdate.value;

        agentService.updateAgent(agentId, modelUpdates);
        changed.push(agentId);
      } catch (err) {
        log.error(` Bulk change-model failed for agent ${agentId}:`, err);
        failed.push(agentId);
      }
    }

    const effortLabel = effortUpdate.set ? ` effort=${effortUpdate.value ?? 'default'}` : '';
    log.log(`Bulk change-model: ${changed.length} changed to ${provider}:${sanitized}${effortLabel}, ${failed.length} failed`);
    res.json({ changed, failed });
  } catch (err: any) {
    log.error(' Bulk change-model failed:', err);
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

// Normalize body { skillId?: string; skillIds?: string[] } into a deduped array.
// Accepts the legacy single-skill form so older callers keep working.
function normalizeSkillIds(body: { skillId?: unknown; skillIds?: unknown }): string[] | null {
  const list: string[] = [];
  if (Array.isArray(body.skillIds)) {
    for (const id of body.skillIds) {
      if (typeof id === 'string' && id) list.push(id);
    }
  }
  if (typeof body.skillId === 'string' && body.skillId) list.push(body.skillId);
  const deduped = Array.from(new Set(list));
  return deduped.length > 0 ? deduped : null;
}

// POST /api/agents/bulk/skills/add - Assign one or more skills to multiple agents (idempotent)
router.post('/bulk/skills/add', (req: Request, res: Response) => {
  try {
    const { agentIds } = req.body as { agentIds?: string[] };
    const skillIds = normalizeSkillIds(req.body ?? {});

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'agentIds must be a non-empty array of strings' });
      return;
    }
    if (!skillIds) {
      res.status(400).json({ error: 'skillIds (or legacy skillId) is required' });
      return;
    }

    for (const sid of skillIds) {
      if (!skillService.getSkill(sid)) {
        res.status(404).json({ error: `Skill not found: ${sid}` });
        return;
      }
    }

    const results: { skillId: string; skillName: string; updated: string[]; alreadyHad: string[]; failed: string[] }[] = [];
    for (const sid of skillIds) {
      const updated: string[] = [];
      const alreadyHad: string[] = [];
      const failed: string[] = [];
      const initialSkill = skillService.getSkill(sid)!;
      for (const agentId of agentIds) {
        try {
          const agent = agentService.getAgent(agentId);
          if (!agent) {
            failed.push(agentId);
            continue;
          }
          // Re-fetch on each iteration: assignSkillToAgent replaces the skill object
          // in the Map, so a captured outer reference goes stale.
          const current = skillService.getSkill(sid);
          const alreadyAssigned = current?.assignedAgentIds.includes(agentId) ?? false;
          const result = skillService.assignSkillToAgent(sid, agentId);
          if (!result) {
            failed.push(agentId);
            continue;
          }
          if (alreadyAssigned) alreadyHad.push(agentId);
          else updated.push(agentId);
        } catch (err) {
          log.error(` Bulk add-skill failed for agent ${agentId} / skill ${sid}:`, err);
          failed.push(agentId);
        }
      }
      log.log(`Bulk add-skill ${initialSkill.name}: ${updated.length} added, ${alreadyHad.length} already had, ${failed.length} failed`);
      results.push({ skillId: sid, skillName: initialSkill.name, updated, alreadyHad, failed });
    }

    // Legacy flat shape (kept for single-skill callers) + new shape.
    const legacy = results.length === 1
      ? { skillId: results[0].skillId, updated: results[0].updated, alreadyHad: results[0].alreadyHad, failed: results[0].failed }
      : {};
    res.json({ skillIds, results, ...legacy });
  } catch (err: any) {
    log.error(' Bulk add-skill failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents/bulk/skills/remove - Unassign one or more skills from multiple agents (idempotent)
router.post('/bulk/skills/remove', (req: Request, res: Response) => {
  try {
    const { agentIds } = req.body as { agentIds?: string[] };
    const skillIds = normalizeSkillIds(req.body ?? {});

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'agentIds must be a non-empty array of strings' });
      return;
    }
    if (!skillIds) {
      res.status(400).json({ error: 'skillIds (or legacy skillId) is required' });
      return;
    }

    for (const sid of skillIds) {
      if (!skillService.getSkill(sid)) {
        res.status(404).json({ error: `Skill not found: ${sid}` });
        return;
      }
    }

    const results: { skillId: string; skillName: string; updated: string[]; didNotHave: string[]; failed: string[] }[] = [];
    for (const sid of skillIds) {
      const updated: string[] = [];
      const didNotHave: string[] = [];
      const failed: string[] = [];
      const initialSkill = skillService.getSkill(sid)!;
      for (const agentId of agentIds) {
        try {
          const agent = agentService.getAgent(agentId);
          if (!agent) {
            failed.push(agentId);
            continue;
          }
          const current = skillService.getSkill(sid);
          const wasAssigned = current?.assignedAgentIds.includes(agentId) ?? false;
          const result = skillService.unassignSkillFromAgent(sid, agentId);
          if (!result) {
            failed.push(agentId);
            continue;
          }
          if (wasAssigned) updated.push(agentId);
          else didNotHave.push(agentId);
        } catch (err) {
          log.error(` Bulk remove-skill failed for agent ${agentId} / skill ${sid}:`, err);
          failed.push(agentId);
        }
      }
      log.log(`Bulk remove-skill ${initialSkill.name}: ${updated.length} removed, ${didNotHave.length} didn't have, ${failed.length} failed`);
      results.push({ skillId: sid, skillName: initialSkill.name, updated, didNotHave, failed });
    }

    const legacy = results.length === 1
      ? { skillId: results[0].skillId, updated: results[0].updated, didNotHave: results[0].didNotHave, failed: results[0].failed }
      : {};
    res.json({ skillIds, results, ...legacy });
  } catch (err: any) {
    log.error(' Bulk remove-skill failed:', err);
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

// GET /api/agents/tracking-statuses - List all non-null tracking statuses
// NOTE: This must be defined BEFORE /:id routes to prevent being interpreted as an ID
router.get('/tracking-statuses', (_req: Request, res: Response) => {
  const trackingStatuses = agentService
    .getAllAgents()
    .filter(agent => agent.trackingStatus != null)
    .map(agent => ({
      agentId: agent.id,
      agentName: agent.name,
      trackingStatus: agent.trackingStatus,
      trackingStatusDetail: agent.trackingStatusDetail,
      trackingStatusTimestamp: agent.trackingStatusTimestamp,
    }));

  res.json(trackingStatuses);
});

// POST /api/agents/:id/convert-runtime - Migrate an agent to another harness
// (Claude ⇄ Codex ⇄ Grok ⇄ Pi ⇄ OpenCode). When the target has a writable
// session store, the source conversation is copied into a NEW native session
// for that runtime and the agent is switched atomically. The source session
// stays untouched and archived for rollback via the session history.
const AGENT_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex', 'opencode', 'grok', 'pi'];
const CLAUDE_EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'xHigh', 'max']);
const DEFAULT_CONTEXT_LIMITS: Record<AgentProvider, number> = {
  claude: 200_000,
  codex: 258_400,
  opencode: 200_000,
  grok: 500_000,
  pi: 200_000,
};

interface ResolvedTarget {
  provider: AgentProvider;
  model?: string;
  contextLimit: number;
  /** Agent fields that select the model on the target runtime. */
  modelUpdates: Partial<Agent>;
}

/**
 * Validate the requested target model for `provider` and derive its context
 * window plus the agent fields that carry it. Returns an HTTP error tuple when
 * the model is not usable on that runtime.
 */
async function resolveTargetModel(
  provider: AgentProvider,
  rawModel: unknown,
  agent: Agent,
): Promise<ResolvedTarget | { status: number; error: string }> {
  const model = typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : undefined;
  switch (provider) {
    case 'claude': {
      const claudeModel = model
        ? agentService.sanitizeModelForProvider('claude', model)
        : agentService.sanitizeModelForProvider('claude', agent.model);
      if (model && !claudeModel) {
        return { status: 400, error: `Unknown Claude model: ${model}` };
      }
      const contextLimit = claudeModel ? CLAUDE_MODELS[claudeModel]?.contextWindow ?? DEFAULT_CONTEXT_LIMITS.claude : DEFAULT_CONTEXT_LIMITS.claude;
      return {
        provider,
        model: claudeModel,
        contextLimit,
        modelUpdates: claudeModel ? { model: claudeModel } : {},
      };
    }
    case 'codex': {
      const codexModel = agentService.sanitizeCodexModel(model) ?? agent.codexModel;
      return {
        provider,
        model: codexModel,
        contextLimit: DEFAULT_CONTEXT_LIMITS.codex,
        modelUpdates: codexModel ? { codexModel } : {},
      };
    }
    case 'grok': {
      const grokModel = agentService.sanitizeGrokModel(model) ?? agent.grokModel;
      return {
        provider,
        model: grokModel,
        contextLimit: (grokModel && GROK_MODELS[grokModel]?.contextWindow) || DEFAULT_CONTEXT_LIMITS.grok,
        modelUpdates: grokModel ? { grokModel } : {},
      };
    }
    case 'opencode': {
      const opencodeModel = agentService.sanitizeOpencodeModel(model) ?? agent.opencodeModel;
      return {
        provider,
        model: opencodeModel,
        contextLimit: DEFAULT_CONTEXT_LIMITS.opencode,
        modelUpdates: opencodeModel ? { opencodeModel } : {},
      };
    }
    case 'pi': {
      const piModel = agentService.sanitizePiModel(model);
      let contextLimit = DEFAULT_CONTEXT_LIMITS.pi;
      if (piModel) {
        try {
          const entry = (await getPiModelCatalog()).find((candidate) => candidate.id === piModel);
          if (!entry) {
            return { status: 400, error: `Pi model is unavailable or has no configured credentials: ${piModel}` };
          }
          contextLimit = entry.contextWindow;
        } catch (err: any) {
          return { status: 503, error: err?.message || 'Could not validate the target Pi model' };
        }
      }
      const piModelProvider = piModel?.includes('/')
        ? piModel.slice(0, piModel.indexOf('/')).trim().toLowerCase() || undefined
        : undefined;
      return {
        provider,
        model: piModel,
        contextLimit,
        modelUpdates: { piModel, piModelProvider },
      };
    }
    default:
      return { status: 400, error: `Unsupported target runtime: ${String(provider)}` };
  }
}

async function handleConvertRuntime(
  req: Request<{ id: string }>,
  res: Response,
  body: {
    targetProvider?: unknown;
    mode?: unknown;
    model?: unknown;
    effort?: unknown;
    stopActive?: unknown;
    codexConfig?: unknown;
  },
): Promise<void> {
  const agent = agentService.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const sourceProvider: AgentProvider = agent.provider ?? 'claude';
  const targetProvider = body.targetProvider;
  if (typeof targetProvider !== 'string' || !AGENT_PROVIDERS.includes(targetProvider as AgentProvider)) {
    res.status(400).json({ error: `targetProvider must be one of ${AGENT_PROVIDERS.join(', ')}` });
    return;
  }
  const target = targetProvider as AgentProvider;
  if (target === sourceProvider) {
    res.status(400).json({ error: `Agent already runs on ${providerDisplayName(target)}.` });
    return;
  }

  const transferMode: SessionTransferMode = (body.mode as SessionTransferMode | undefined) ?? 'smart';
  if (transferMode !== 'smart' && transferMode !== 'full' && transferMode !== 'fresh') {
    res.status(400).json({ error: 'mode must be smart, full, or fresh' });
    return;
  }
  if (transferMode !== 'fresh' && !isSessionTransferTarget(target)) {
    res.status(422).json({
      error: `${providerDisplayName(target)} sessions cannot be written by Commander yet. Choose Fresh Start.`,
      code: 'target-unsupported',
    });
    return;
  }
  if (body.model !== undefined && body.model !== null && typeof body.model !== 'string') {
    res.status(400).json({ error: 'model must be a string' });
    return;
  }

  const effort = body.effort;
  if (effort !== undefined && effort !== null && (typeof effort !== 'string' || !CLAUDE_EFFORTS.has(effort))) {
    res.status(400).json({ error: 'effort must be low, medium, high, xHigh, max, null, or omitted' });
    return;
  }
  const targetSupportsEffort = target === 'claude' || target === 'grok' || target === 'pi';
  const targetEffort: ClaudeEffort | undefined = !targetSupportsEffort
    ? agent.effort
    : effort === null
      ? undefined
      : typeof effort === 'string' ? (effort as ClaudeEffort) : agent.effort;

  const codexConfig = body.codexConfig;
  if (codexConfig !== undefined && (codexConfig === null || typeof codexConfig !== 'object' || Array.isArray(codexConfig))) {
    res.status(400).json({ error: 'codexConfig must be an object' });
    return;
  }

  const resolved = await resolveTargetModel(target, body.model, agent);
  if ('error' in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  const hasActiveTask = agent.status === 'working'
    || agent.status === 'waiting'
    || agent.status === 'waiting_permission'
    || agent.status === 'orphaned';
  const hasLiveRuntime = runtimeService.isAgentRunning(agent.id);
  if (hasActiveTask && body.stopActive !== true) {
    res.status(409).json({
      error: 'Agent is active. Confirm “stop the active task” before converting.',
      code: 'agent-active',
    });
    return;
  }

  const sourceSessionId = agent.sessionId;
  let created: CreatedTransfer | undefined;
  try {
    // Native CLI processes commonly remain alive while their agent is idle so
    // they can accept another prompt. Stop that resident runtime as part of the
    // handoff, but only require confirmation when an actual task is active.
    if (hasLiveRuntime || hasActiveTask) await runtimeService.stopAgent(agent.id);

    if (transferMode !== 'fresh') {
      created = await createTransferredSession(agent, {
        targetProvider: target as Parameters<typeof createTransferredSession>[1]['targetProvider'],
        mode: transferMode,
        contextLimit: resolved.contextLimit,
        targetModel: resolved.model,
      });
    }

    // Refuse to overwrite a session/provider that changed while the snapshot
    // was being prepared. The newly-created target session is safe to remove
    // because it has not yet been attached to the agent.
    const latest = agentService.getAgent(agent.id);
    if (!latest || latest.provider !== sourceProvider || latest.sessionId !== sourceSessionId) {
      if (created) removeTransferredSession(created);
      res.status(409).json({ error: 'The source agent changed during conversion. Nothing was switched.' });
      return;
    }

    agentService.archiveCurrentSession(agent.id);
    const updated = agentService.updateAgent(agent.id, {
      provider: target,
      sessionId: created?.sessionId,
      forkSourceSessionId: undefined,
      ...resolved.modelUpdates,
      ...(target !== 'pi' ? { piModelProvider: undefined } : {}),
      ...(target === 'codex' && codexConfig ? { codexConfig: codexConfig as CodexConfig } : {}),
      effort: targetEffort,
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      isDetached: false,
      lastError: undefined,
      tokensUsed: 0,
      contextUsed: created?.summary.estimatedTokens ?? 0,
      contextLimit: resolved.contextLimit,
      contextStats: undefined,
    }, false);
    if (!updated) {
      if (created) removeTransferredSession(created);
      res.status(404).json({ error: 'Agent disappeared during conversion. Nothing was switched.' });
      return;
    }

    const transfer: SessionTransferSummary = created?.summary ?? {
      sourceProvider,
      targetProvider: target,
      sourceSessionId,
      targetSessionId: undefined,
      mode: 'fresh',
      sourceMessageCount: 0,
      importedTurnCount: 0,
      droppedTurnCount: 0,
      droppedToolResultBodies: 0,
      estimatedTokens: 0,
      contextLimit: resolved.contextLimit,
      warnings: sourceSessionId ? [`The ${providerDisplayName(sourceProvider)} session was archived without importing its conversation.`] : [],
    };

    log.log(
      `Converted agent ${agent.name} from ${sourceProvider} to ${target}` +
      (created ? ` (${created.summary.importedTurnCount} turns → ${created.sessionId})` : ' (fresh start)')
    );
    res.json({ agent: updated, transfer });
  } catch (err: any) {
    if (created) removeTransferredSession(created);
    log.error(`Failed to convert agent ${agent.name} to ${target}:`, err);
    if (err instanceof SessionTransferError) {
      const status = err.code === 'source-provider-mismatch' ? 409 : 422;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: err?.message || `Failed to convert session to ${providerDisplayName(target)}` });
  }
}

router.post('/:id/convert-runtime', async (req: Request<{ id: string }>, res: Response) => {
  await handleConvertRuntime(req, res, (req.body ?? {}) as Parameters<typeof handleConvertRuntime>[2]);
});

// Backward-compatible alias for the original Pi-only endpoint.
router.post('/:id/convert-to-pi', async (req: Request<{ id: string }>, res: Response) => {
  const body = (req.body ?? {}) as { piModel?: unknown; model?: unknown } & Record<string, unknown>;
  await handleConvertRuntime(req, res, {
    ...body,
    targetProvider: 'pi',
    model: body.model ?? body.piModel,
  });
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

  const existing = agentService.getAgent(req.params.id);
  if (safeUpdates.provider && existing && safeUpdates.provider !== (existing.provider ?? 'claude') && existing.sessionId) {
    res.status(409).json({
      error: `Use POST /api/agents/${req.params.id}/convert-runtime so Commander migrates the ${providerDisplayName(existing.provider)} session instead of resuming it on ${providerDisplayName(safeUpdates.provider)}.`,
      code: 'use-convert-runtime',
    });
    return;
  }

  if ('trackingStatus' in safeUpdates) {
    safeUpdates.trackingStatusTimestamp = safeUpdates.trackingStatus == null ? undefined : Date.now();
    if (safeUpdates.trackingStatus == null && !('trackingStatusDetail' in safeUpdates)) {
      safeUpdates.trackingStatusDetail = undefined;
    }
  }

  const updated = agentService.updateAgent(req.params.id, safeUpdates);

  if (!updated) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Slim response: agents PATCH this endpoint several times per turn (taskLabel, trackingStatus),
  // and returning the full agent — which includes multi-KB `lastAssignedTask`/`currentTask` strings —
  // bloated agent context. Full agent state is already broadcast to clients via the WS `agent_updated`
  // channel, so the response only needs to confirm the fields an agent typically cares about.
  res.json({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    trackingStatus: updated.trackingStatus,
    trackingStatusDetail: updated.trackingStatusDetail,
    taskLabel: updated.taskLabel,
    lastActivity: updated.lastActivity,
    isBoss: updated.isBoss,
    ok: true,
  });
});

// ============================================================================
// Agent Memory Routes — per-agent persistent notes injected into system prompt
// ============================================================================

// GET /api/agents/:id/memory - Read the agent's current memory string
router.get('/:id/memory', (req: Request<{ id: string }>, res: Response) => {
  const agent = agentService.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  const memory = typeof agent.memory === 'string' ? agent.memory : '';
  res.json({ memory, length: memory.length });
});

// PATCH /api/agents/:id/memory - Replace the agent's memory (full replace).
// Body: { memory: string }
router.patch('/:id/memory', (req: Request<{ id: string }>, res: Response) => {
  const { memory } = req.body as { memory?: unknown };
  if (typeof memory !== 'string') {
    res.status(400).json({ error: 'memory must be a string' });
    return;
  }

  const updated = agentService.updateAgent(req.params.id, { memory }, false);
  if (!updated) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  log.log(`Agent ${updated.name} (${updated.id}): memory updated (${memory.length} chars)`);
  res.json({ ok: true, id: updated.id, length: memory.length });
});

// DELETE /api/agents/:id/memory - Clear the agent's memory
router.delete('/:id/memory', (req: Request<{ id: string }>, res: Response) => {
  const updated = agentService.updateAgent(req.params.id, { memory: '' }, false);
  if (!updated) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  log.log(`Agent ${updated.name} (${updated.id}): memory cleared`);
  res.json({ ok: true, id: updated.id });
});

// GET /api/agents/:id/queue - Snapshot of the server-side mid-run message
// queue (messages awaiting delivery once the agent's current turn ends).
// Positional: each entry's `index` is only valid against THIS snapshot.
router.get('/:id/queue', (req: Request<{ id: string }>, res: Response) => {
  const agent = agentService.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  const messages = runtimeService.getQueuedMessagesForAgent(req.params.id);
  res.json({ messages: messages.map((text, index) => ({ index, text })) });
});

// DELETE /api/agents/:id/queue/:index - Remove one queued message. Body:
// { text } — must match the entry at `index` (guards against a queue that
// drained/mutated since the caller's snapshot; on mismatch → 409, refetch).
router.delete('/:id/queue/:index', (req: Request<{ id: string; index: string }>, res: Response) => {
  const agent = agentService.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  const index = Number.parseInt(req.params.index, 10);
  const { text } = (req.body ?? {}) as { text?: unknown };
  if (!Number.isInteger(index) || index < 0 || typeof text !== 'string') {
    res.status(400).json({ error: 'index must be a non-negative integer and text a string' });
    return;
  }
  const removed = runtimeService.removeQueuedMessageForAgent(req.params.id, index, text);
  if (!removed) {
    res.status(409).json({ error: 'Queue changed since snapshot — refetch', removed: false });
    return;
  }
  log.log(`Agent ${agent.name} (${agent.id}): queued message ${index} removed via API`);
  res.json({ removed: true });
});

// POST /api/agents/:id/terminal - Start (or reuse) a ttyd attached to the
// agent's interactive-TUI tmux session (Classic TUI view). Returns the proxy URL.
router.post('/:id/terminal', async (req: Request<{ id: string }>, res: Response) => {
  const agent = agentService.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  if (!isInteractiveModeEnabled()) {
    res.status(400).json({ error: 'Interactive mode is not enabled' });
    return;
  }
  try {
    const result = await startAgentTerminal(req.params.id);
    if (!result.success) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.json({ url: result.url });
  } catch (err: any) {
    log.error(' Failed to start agent terminal:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/agents/:id/terminal - Stop the agent's ttyd viewer (the tmux
// session is left running).
router.delete('/:id/terminal', (req: Request<{ id: string }>, res: Response) => {
  stopAgentTerminal(req.params.id);
  res.json({ ok: true });
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

// GET /api/agents/:id/usage - provider usage snapshot for a single agent
//
// Claude: local agent stats + Anthropic OAuth rate-limit gauges (CLI `/usage`).
// Grok: local agent stats + CLI chat-proxy billing/credit gauges (CLI `/usage`).
// Pi/OpenCode: limits resolved from the selected model's underlying provider.
router.get('/:id/usage', async (req: Request<{ id: string }>, res: Response) => {
  const agent = agentService.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  const provider = agent.provider ?? 'claude';
  if (provider !== 'claude' && provider !== 'grok' && provider !== 'codex' && provider !== 'pi' && provider !== 'opencode') {
    res.status(400).json({
      error: 'Usage data is unavailable for this agent provider',
      provider,
    });
    return;
  }
  try {
    const snapshot =
      provider === 'pi'
        ? await buildPiSubscriptionUsageSnapshot(agent)
        : provider === 'opencode'
          ? await buildOpencodeUsageSnapshot(agent)
        : provider === 'codex'
          ? await buildCodexUsageSnapshot(agent)
          : provider === 'grok'
            ? await buildGrokUsageSnapshot(agent)
            : await buildClaudeUsageSnapshot(agent);
    res.json(snapshot);
  } catch (err: any) {
    log.error(`Failed to build ${provider} usage snapshot:`, err);
    res.status(500).json({ error: err?.message ?? 'Failed to build usage snapshot' });
  }
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

// GET /api/agents/:id/injected-prompt - Get the full prompt injected into this agent
router.get('/:id/injected-prompt', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { buildInjectedPromptForAgent } = await import('../services/prompt-inspection-service.js');
    const prompt = await buildInjectedPromptForAgent(req.params.id);
    if (prompt === null) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({ prompt });
  } catch (err: any) {
    log.error(' Failed to build injected prompt:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:id/session-history - Get archived session history for an agent
router.get('/:id/session-history', (_req: Request<{ id: string }>, res: Response) => {
  try {
    const entries = agentService.getAgentSessionHistory(_req.params.id);
    res.json({ entries });
  } catch (err: any) {
    log.error(' Failed to load session history:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:id/session-preview/:sessionId - Preview messages from an archived session
router.get('/:id/session-preview/:sessionId', async (req: Request<{ id: string; sessionId: string }>, res: Response) => {
  try {
    const agent = agentService.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 30;
    const history = await loadSession(agent.cwd, req.params.sessionId, limit, 0);
    if (!history) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ messages: history.messages, totalCount: history.totalCount });
  } catch (err: any) {
    log.error(' Failed to load session preview:', err);
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

// GET /api/agents/:id/files?q=search — list files/folders in agent cwd for @ mention autocomplete
router.get('/:id/files', (req: Request<{ id: string }>, res: Response) => {
  const { q = '' } = req.query as { q?: string };
  const agent = agentService.getAgent(req.params.id);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const cwd = agent.cwd;
  const query = String(q).toLowerCase().trim();
  const IGNORED = new Set([
    '.git', 'node_modules', 'dist', '.next', '__pycache__', '.cache',
    'coverage', '.claude', '.idea', '.vscode', 'build', 'out', '.turbo', '.nx',
  ]);

  const results: Array<{ path: string; name: string; type: 'file' | 'dir' }> = [];
  const MAX_RESULTS = 60;
  const MAX_DEPTH = 6;

  // Walk the whole tree (bounded by depth + ignored dirs). We can't early-exit
  // on result count here: depth-first traversal would saturate the cap with
  // deep matches in alphabetically-earlier siblings (e.g. q=src filling up
  // with android/app/src/... before ever visiting the root-level src/),
  // hiding the shallow match the user almost certainly wanted.
  function walk(dir: string, relBase: string, depth: number) {
    if (depth > MAX_DEPTH) return;
    let entries: import('fs').Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (!query || entry.name.toLowerCase().includes(query) || relPath.toLowerCase().includes(query)) {
        results.push({ path: relPath, name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' });
      }
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath, depth + 1);
      }
    }
  }

  walk(cwd, '', 0);

  // Sort by relevance, then slice to the cap. Priority:
  //   1. Exact (case-insensitive) name match — definitively what they typed.
  //   2. Name starts with the query — stronger than a midline substring.
  //   3. Directories before files at the same rank.
  //   4. Shallower paths first — root-level matches before nested namesakes.
  //   5. Alphabetical by path as a stable tie-break.
  const depthOf = (p: string) => p.split('/').length;
  results.sort((a, b) => {
    if (query) {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aExact = aName === query;
      const bExact = bName === query;
      if (aExact !== bExact) return aExact ? -1 : 1;
      const aStarts = aName.startsWith(query);
      const bStarts = bName.startsWith(query);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
    }
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    const da = depthOf(a.path);
    const db = depthOf(b.path);
    if (da !== db) return da - db;
    return a.path.localeCompare(b.path);
  });

  res.json({ files: results.slice(0, MAX_RESULTS) });
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

    const expandedMessage = await expandFileMentions(message, agent.cwd);

    // Handle boss agents with their special context building
    if (agent.isBoss || agent.class === 'boss') {
      const { message: bossMessage, systemPrompt } = await bossMessageService.buildBossMessage(agentId, expandedMessage);
      await runtimeService.sendCommand(agentId, bossMessage, systemPrompt);
    } else {
      // Regular agents get custom agent config (identity header, class instructions, skills)
      const customAgentConfig = buildCustomAgentConfig(agentId, agent.class);
      await runtimeService.sendCommand(agentId, expandedMessage, undefined, undefined, customAgentConfig);
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

// POST /api/agents/:id/collapse-context — Dispatch provider-native context
// compaction to the agent's runner. Pi uses its RPC compact control command;
// TUI-backed providers use /compact. Plain /message is only a chat prompt and
// cannot invoke harness control commands.
//
// Body (optional):
//   { "waitForIdle": true }  — if the agent is currently busy, queue the
//     /compact and fire it automatically the first time the agent goes idle.
//     The main use case is the SAME agent calling this from inside its own
//     turn (e.g. end-of-flow cron step) — by definition still `working` when
//     the request lands. Default false keeps the existing 409-busy behavior.
router.post('/:id/collapse-context', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const agentId = req.params.id;
    const body = (req.body ?? {}) as { waitForIdle?: boolean };
    const waitForIdle = body.waitForIdle === true;
    const result = await runtimeService.collapseAgentContext(agentId, { waitForIdle });
    switch (result.status) {
      case 'collapse-initiated':
        log.log(`API collapse-context dispatched for agent ${agentId}`);
        res.status(200).json({ success: true, agentId, status: 'collapse-initiated' });
        return;
      case 'queued':
        log.log(`API collapse-context queued for agent ${agentId} (waiting for idle)`);
        res.status(200).json({ success: true, agentId, status: 'queued' });
        return;
      case 'not-found':
        res.status(404).json({ success: false, agentId, status: 'not-found', error: `Agent not found: ${agentId}` });
        return;
      case 'busy':
        res.status(409).json({ success: false, agentId, status: 'busy', currentStatus: result.currentStatus, error: 'Cannot collapse context while agent is busy' });
        return;
      case 'error':
        log.error(` Failed to collapse context for ${agentId}: ${result.error}`);
        res.status(500).json({ success: false, agentId, status: 'error', error: result.error });
        return;
    }
  } catch (err: any) {
    log.error(' Failed to collapse context (route):', err);
    res.status(500).json({ error: err?.message || 'Failed to collapse context' });
  }
});

// POST /api/agents/:id/simulate-model-fallback - Render a model swap without waiting for one.
//
// The API decides server-side whether to substitute a model, so no prompt can
// force a real fallback on demand. This drives the same code path a real one
// takes (terminal row + header chip + activity) so the UI can be verified.
// Simulation only — the agent keeps running on whatever model it always was.
router.post('/:id/simulate-model-fallback', (req: Request<{ id: string }>, res: Response) => {
  try {
    const agentId = req.params.id;
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent not found: ${agentId}` });
      return;
    }

    const body = (req.body ?? {}) as { requestedModel?: string; servedModel?: string };
    const requestedModel = body.requestedModel || agent.model || 'claude-fable-5';
    const servedModel = body.servedModel || 'claude-opus-4-8';

    const emitted = runtimeService.simulateModelFallback(agentId, requestedModel, servedModel);
    log.log(`API simulate-model-fallback for ${agentId}: ${requestedModel} -> ${servedModel} (emitted=${emitted})`);
    res.json({ success: true, agentId, requestedModel, servedModel, emitted, simulated: true });
  } catch (err: any) {
    log.error(' Failed to simulate model fallback:', err);
    res.status(500).json({ error: err?.message || 'Failed to simulate model fallback' });
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

    // Try active delegation tracking first, fall back to agent.bossId if delegation has cleared
    const delegation = getBossForSubordinate(subordinateId);
    const resolvedBossId = delegation?.bossId || agent.bossId;
    const taskStatus = status || 'completed';
    const success = taskStatus === 'completed';

    if (!resolvedBossId) {
      log.log(`Agent ${agent.name} reported task ${taskStatus} but has no boss association. Accepting and logging: "${(summary || '').slice(0, 120)}"`);
      res.status(200).json({
        success: true,
        subordinateId: agent.id,
        subordinateName: agent.name,
        bossId: null,
        bossName: null,
        taskStatus,
        accepted: true,
        forwarded: false,
        reason: 'No active delegation and no recorded boss — report logged only.',
      });
      return;
    }

    const bossAgent = agentService.getAgent(resolvedBossId);
    const bossName = bossAgent?.name || resolvedBossId;
    const taskDescription = delegation?.taskDescription || '(no active delegation record — original task unknown)';

    log.log(`Agent ${agent.name} reporting task ${taskStatus} to boss ${bossName}${delegation ? '' : ' (via fallback bossId, delegation already cleared)'}: "${(summary || '').slice(0, 80)}"`);

    // 1. Broadcast agent_task_completed to update the progress indicator on the client
    if (broadcastFn) {
      broadcastFn({
        type: 'agent_task_completed',
        payload: {
          bossId: resolvedBossId,
          subordinateId,
          success,
        },
      } as any);
    }

    // 2. Clear the active delegation tracking (no-op if already cleared)
    clearDelegation(subordinateId);

    // 3. Send a message to the boss so it knows the task finished and can decide next steps.
    // If the boss agent is no longer available, accept the report without failing.
    let forwarded = false;
    if (bossAgent) {
      // Truncate the original task description: the boss already issued the
      // delegation and has it in its own conversation history; replaying it
      // verbatim wastes tokens and can blow past line-length limits in the
      // CLI's stream-json input. A short label is enough to disambiguate
      // which delegation this report refers to.
      const taskLabel = truncateOrEmpty(taskDescription, 160);
      const reportMessage = `[TASK REPORT from ${agent.name} (${subordinateId})]\n\nStatus: ${taskStatus === 'completed' ? 'COMPLETED' : 'FAILED'}\nOriginal task: ${taskLabel}\n${summary ? `\nSummary: ${summary}` : ''}\n\nYou may review the result, give follow-up instructions, or dismiss this agent's progress indicator.`;

      try {
        if (bossAgent.isBoss || bossAgent.class === 'boss') {
          const { message: bossMessage, systemPrompt } = await bossMessageService.buildBossMessage(resolvedBossId, reportMessage);
          await runtimeService.sendCommand(resolvedBossId, bossMessage, systemPrompt);
        } else {
          await runtimeService.sendCommand(resolvedBossId, reportMessage);
        }
        forwarded = true;
      } catch (forwardErr: any) {
        log.error(` Failed to forward task report to boss ${bossName}, accepting report anyway:`, forwardErr);
      }
    } else {
      log.log(` Boss agent ${resolvedBossId} not found — accepting report without forwarding.`);
    }

    res.status(200).json({
      success: true,
      subordinateId: agent.id,
      subordinateName: agent.name,
      bossId: resolvedBossId,
      bossName,
      taskStatus,
      accepted: true,
      forwarded,
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

    // The global system prompt is part of the injected instruction block. Claude
    // re-applies it on every resume, but the stdin backends (OpenCode/Codex) skip
    // that block on resume — flag every agent so the change reaches live sessions.
    markInstructionsDirtyForAll(agentService.getAllAgents().map(a => a.id));

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

    // Same as the update path: flag every agent so the stdin backends drop the
    // now-removed system prompt from their next resumed turn.
    markInstructionsDirtyForAll(agentService.getAllAgents().map(a => a.id));

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

// GET /api/system-settings/interactive-mode - Get experimental interactive-TUI mode setting
router.get('/system-settings/interactive-mode', (_req: Request, res: Response) => {
  try {
    const enabled = isInteractiveModeEnabled();
    res.json({ enabled });
  } catch (err: any) {
    log.error(' Failed to get interactive mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/interactive-mode - Update experimental interactive-TUI mode setting
router.post('/system-settings/interactive-mode', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    setInteractiveModeEnabled(enabled);
    log.log(` Interactive mode setting updated: enabled=${enabled}`);
    res.json({ success: true, enabled });
  } catch (err: any) {
    log.error(' Failed to set interactive mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-settings/codex-app-server-mode - Get experimental Codex app-server (streaming) mode setting
router.get('/system-settings/codex-app-server-mode', (_req: Request, res: Response) => {
  try {
    const enabled = isCodexAppServerModeEnabled();
    res.json({ enabled });
  } catch (err: any) {
    log.error(' Failed to get codex app-server mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/codex-app-server-mode - Update experimental Codex app-server (streaming) mode setting
router.post('/system-settings/codex-app-server-mode', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    setCodexAppServerModeEnabled(enabled);
    log.log(` Codex app-server mode setting updated: enabled=${enabled}`);
    res.json({ success: true, enabled });
  } catch (err: any) {
    log.error(' Failed to set codex app-server mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-settings/opencode-server-mode - Get experimental OpenCode server (streaming) mode setting
router.get('/system-settings/opencode-server-mode', (_req: Request, res: Response) => {
  try {
    const enabled = isOpencodeServerModeEnabled();
    res.json({ enabled });
  } catch (err: any) {
    log.error(' Failed to get opencode server mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/opencode-server-mode - Update experimental OpenCode server (streaming) mode setting
router.post('/system-settings/opencode-server-mode', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    setOpencodeServerModeEnabled(enabled);
    log.log(` OpenCode server mode setting updated: enabled=${enabled}`);
    res.json({ success: true, enabled });
  } catch (err: any) {
    log.error(' Failed to set opencode server mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-settings/pi-rpc-mode - Get Pi RPC (mid-turn steering) mode setting
router.get('/system-settings/pi-rpc-mode', (_req: Request, res: Response) => {
  try {
    const enabled = isPiRpcModeEnabled();
    res.json({ enabled });
  } catch (err: any) {
    log.error(' Failed to get pi RPC mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/pi-rpc-mode - Update Pi RPC (mid-turn steering) mode setting
router.post('/system-settings/pi-rpc-mode', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    setPiRpcModeEnabled(enabled);
    log.log(` Pi RPC mode setting updated: enabled=${enabled}`);
    res.json({ success: true, enabled });
  } catch (err: any) {
    log.error(' Failed to set pi RPC mode setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-settings/backup - Get hourly backup scheduler status
router.get('/system-settings/backup', (_req: Request, res: Response) => {
  try {
    res.json(getBackupStatus());
  } catch (err: any) {
    log.error(' Failed to get backup status:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-settings/backup - Enable or disable the hourly backup scheduler
router.post('/system-settings/backup', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    const status = setBackupEnabled(enabled);
    res.json({ success: true, ...status });
  } catch (err: any) {
    log.error(' Failed to set backup enabled:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
