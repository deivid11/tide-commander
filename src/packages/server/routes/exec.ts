/**
 * Exec Routes
 * REST API endpoints for executing commands with streaming output
 *
 * Agents can execute long-running commands via HTTP POST requests.
 * Output is streamed to clients via WebSocket in real-time.
 */

import { Router, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { agentService, secretsService } from '../services/index.js';
import { createLogger, generateId } from '../utils/index.js';
import type { ServerMessage } from '../../shared/types.js';

const log = createLogger('Exec');

const router = Router();

// Store for broadcasting via WebSocket
let broadcastFn: ((message: ServerMessage) => void) | null = null;

// Track running tasks
interface RunningTask {
  id: string;
  agentId: string;
  command: string;
  process: ChildProcess;
  output: string[];
  startedAt: number;
}

const runningTasks = new Map<string, RunningTask>();

/**
 * Set the broadcast function for sending output to all clients
 */
export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

/**
 * Get all running tasks for an agent
 */
export function getRunningTasks(agentId: string): RunningTask[] {
  return Array.from(runningTasks.values()).filter(t => t.agentId === agentId);
}

/**
 * Kill a running task by ID
 */
export function killTask(taskId: string): boolean {
  const task = runningTasks.get(taskId);
  if (task) {
    try {
      task.process.kill('SIGTERM');
      return true;
    } catch (err) {
      log.error(`Failed to kill task ${taskId}:`, err);
      return false;
    }
  }
  return false;
}

/**
 * POST /api/exec - Execute a command with streaming output
 *
 * Body:
 * - agentId: string (required) - The ID of the agent executing the command
 * - command: string (required) - The command to execute
 * - cwd: string (optional) - Working directory (defaults to agent's cwd)
 *
 * This endpoint executes the command and streams output via WebSocket.
 * Returns the final output and exit code when the command completes.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { agentId, command, cwd } = req.body;

    // Validate required fields
    if (!agentId || !command) {
      log.error(`[Exec] Missing required fields. Body: ${JSON.stringify(req.body)}`);
      res.status(400).json({
        error: 'Missing required fields: agentId, command',
        received: req.body
      });
      return;
    }

    log.log(`[Exec] Received exec request for agent ${agentId}`);
    log.log(`[Exec] Command: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`);
    if (cwd) {
      log.log(`[Exec] CWD: ${cwd}`);
    }

    // Get agent info
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent not found: ${agentId}` });
      return;
    }

    // Use provided cwd or agent's cwd
    const workingDir = cwd || agent.cwd;

    // Replace secret placeholders in command (e.g., {{API_KEY}} -> actual value)
    const processedCommand = secretsService.replaceSecrets(command);

    // Generate task ID
    const taskId = generateId();

    // Log original command (not processed, to avoid leaking secrets in logs)
    log.log(`[${agent.name}] Executing: ${command} (task: ${taskId})`);

    // Broadcast task started
    if (broadcastFn) {
      broadcastFn({
        type: 'exec_task_started',
        payload: {
          taskId,
          agentId,
          agentName: agent.name,
          command,
          cwd: workingDir,
        },
      } as ServerMessage);
    }

    // Spawn the process with secrets replaced
    const childProcess = spawn('bash', ['-c', processedCommand], {
      cwd: workingDir,
      env: { ...process.env },
      shell: false,
    });

    // Track the task
    const task: RunningTask = {
      id: taskId,
      agentId,
      command,
      process: childProcess,
      output: [],
      startedAt: Date.now(),
    };
    runningTasks.set(taskId, task);

    // Collect output
    let fullOutput = '';
    let exitCode: number | null = null;

    // Stream stdout
    childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      fullOutput += text;
      task.output.push(text);

      // Broadcast output chunk
      if (broadcastFn) {
        broadcastFn({
          type: 'exec_task_output',
          payload: {
            taskId,
            agentId,
            output: text,
          },
        } as ServerMessage);
      }
    });

    // Stream stderr
    childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      fullOutput += text;
      task.output.push(text);

      // Broadcast output chunk (stderr too)
      if (broadcastFn) {
        broadcastFn({
          type: 'exec_task_output',
          payload: {
            taskId,
            agentId,
            output: text,
            isError: true,
          },
        } as ServerMessage);
      }
    });

    // Wait for process to complete
    await new Promise<void>((resolve) => {
      childProcess.on('close', (code) => {
        exitCode = code;
        resolve();
      });

      childProcess.on('error', (err) => {
        log.error(`[${agent.name}] Process error:`, err);
        fullOutput += `\nError: ${err.message}`;
        resolve();
      });
    });

    // Clean up task tracking
    runningTasks.delete(taskId);

    // Broadcast task completed
    if (broadcastFn) {
      broadcastFn({
        type: 'exec_task_completed',
        payload: {
          taskId,
          agentId,
          exitCode,
          success: exitCode === 0,
        },
      } as ServerMessage);
    }

    log.log(`[${agent.name}] Command completed with exit code ${exitCode}`);

    // Return final result to the caller (curl)
    res.status(200).json({
      success: exitCode === 0,
      taskId,
      exitCode,
      output: fullOutput,
      duration: Date.now() - task.startedAt,
    });
  } catch (err: any) {
    log.error('Failed to execute command:', err);
    log.error('Error details:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      syscall: err.syscall,
    });
    res.status(500).json({
      error: err.message,
      details: {
        code: err.code,
        syscall: err.syscall,
      }
    });
  }
});

/**
 * GET /api/exec/tasks/:agentId - List running tasks for an agent
 */
router.get('/tasks/:agentId', (req: Request, res: Response) => {
  const agentId = req.params.agentId as string;
  const tasks = getRunningTasks(agentId).map(t => ({
    id: t.id,
    command: t.command,
    startedAt: t.startedAt,
    outputLines: t.output.length,
  }));
  res.json({ tasks });
});

/**
 * DELETE /api/exec/tasks/:taskId - Kill a running task
 */
router.delete('/tasks/:taskId', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const killed = killTask(taskId);
  if (killed) {
    res.json({ success: true, message: `Task ${taskId} killed` });
  } else {
    res.status(404).json({ error: `Task not found: ${taskId}` });
  }
});

/**
 * POST /api/exec/generate-curl - Generate properly escaped curl command for shell execution
 *
 * This endpoint generates a curl command with proper escaping for Codex agents
 * that need to execute it through shell (zsh, bash, etc.)
 */
router.post('/generate-curl', (req: Request, res: Response) => {
  const { agentId, command, cwd } = req.body;

  if (!agentId || !command) {
    res.status(400).json({
      error: 'Missing required fields: agentId, command'
    });
    return;
  }

  // Build the JSON payload
  const payload: Record<string, string> = {
    agentId,
    command,
  };
  if (cwd) {
    payload.cwd = cwd;
  }

  // Escape the JSON payload properly for shell execution
  // Use single quotes around JSON and escape any single quotes inside
  const jsonStr = JSON.stringify(payload);
  const escapedJson = jsonStr.replace(/'/g, "'\\''");

  // Generate curl command using $'...' syntax (ANSI-C quoting)
  // This is more reliable across different shells
  const curlCommand = `curl -s -X POST http://localhost:5174/api/exec -H "Content-Type: application/json" -d '${escapedJson}'`;

  res.json({
    success: true,
    command: curlCommand,
    payload,
  });
});

export default router;
