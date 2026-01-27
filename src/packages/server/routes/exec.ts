/**
 * Exec Routes
 * REST API endpoints for executing commands with streaming output
 *
 * Agents can execute long-running commands via HTTP POST requests.
 * Output is streamed to clients via WebSocket in real-time.
 */

import { Router, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { agentService } from '../services/index.js';
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
      res.status(400).json({
        error: 'Missing required fields: agentId, command'
      });
      return;
    }

    // Get agent info
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent not found: ${agentId}` });
      return;
    }

    // Use provided cwd or agent's cwd
    const workingDir = cwd || agent.cwd;

    // Generate task ID
    const taskId = generateId();

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

    // Spawn the process
    const childProcess = spawn('bash', ['-c', command], {
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
    res.status(500).json({ error: err.message });
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

export default router;
