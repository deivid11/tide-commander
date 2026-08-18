/**
 * Exec Tasks Store Module
 *
 * Manages state for streaming command execution tasks.
 * These are long-running commands executed via /api/exec endpoint
 * with real-time output streaming via WebSocket.
 */

import type { ExecTask } from '../../shared/types';
import { TerminalRenderer } from '../../shared/terminal-render';
import { apiUrl, authFetch } from '../utils/storage';
import { serverNow } from './outputs';
import type { StoreState } from './types';

// Per-task PTY replay state (non-serializable — lives outside the store).
// PTY tasks stream raw terminal output (in-place redraws, ANSI); the renderer
// turns each chunk into the current screen text so cards update in place.
const ptyRenderers = new Map<string, TerminalRenderer>();

// Cap what the card keeps, matching the legacy line cap.
const MAX_OUTPUT_LINES = 500;

export interface ExecTaskActions {
  // Task lifecycle
  handleExecTaskStarted(
    taskId: string,
    agentId: string,
    agentName: string,
    command: string,
    cwd: string,
    pty?: boolean,
    /** Server-stamped start (ms). Falls back to the skew-corrected server clock. */
    startedAt?: number,
    /** tool_use id of the Bash call that issued the curl (server-paired). */
    toolUseId?: string
  ): void;
  handleExecTaskOutput(taskId: string, agentId: string, output: string, isError?: boolean): void;
  handleExecTaskCompleted(taskId: string, agentId: string, exitCode: number | null, success: boolean, completedAt?: number): void;

  // Task control
  stopExecTask(taskId: string): Promise<boolean>;

  // Getters
  getExecTasks(agentId: string): ExecTask[];
  getAllExecTasks(): ExecTask[];
  getExecTask(taskId: string): ExecTask | undefined;

  // Cleanup
  clearCompletedExecTasks(agentId: string): void;
  clearAllExecTasks(agentId: string): void;
  removeExecTask(taskId: string): void;
}

export function createExecTaskActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void
): ExecTaskActions {
  return {
    handleExecTaskStarted(
      taskId: string,
      agentId: string,
      agentName: string,
      command: string,
      cwd: string,
      pty?: boolean,
      startedAt?: number,
      toolUseId?: string
    ): void {
      setState((state) => {
        const task: ExecTask = {
          taskId,
          agentId,
          agentName,
          command,
          cwd,
          status: 'running',
          output: [],
          // SERVER time domain, like the terminal rows it gets matched against
          // (a device clock ahead/behind the server would miss the row's
          // time window — the row itself is server-stamped).
          startedAt: startedAt ?? serverNow(),
          pty,
          toolUseId,
        };

        if (!state.execTasks) {
          state.execTasks = new Map();
        }

        if (pty) {
          ptyRenderers.set(taskId, new TerminalRenderer());
        }

        // Store task by taskId for quick lookup
        state.execTasks.set(taskId, task);
      });
      notify();
    },

    handleExecTaskOutput(taskId: string, agentId: string, output: string, isError?: boolean): void {
      setState((state) => {
        const task = state.execTasks?.get(taskId);
        if (!task) return;

        // PTY stream: replay through the renderer so progress bars / spinners
        // update IN PLACE instead of appending every redraw as a new line.
        const renderer = task.pty ? ptyRenderers.get(taskId) : undefined;
        if (renderer) {
          renderer.write(output);
          const rendered = renderer.getLines();
          const newOutput = rendered.length > MAX_OUTPUT_LINES
            ? rendered.slice(-MAX_OUTPUT_LINES)
            : rendered;
          state.execTasks!.set(taskId, { ...task, output: newOutput });
          return;
        }

        // Legacy pipe stream: append lines (stderr tagged).
        // Build new output array (immutable update for selector change detection)
        const lines = output.split('\n');
        const newOutput = [...task.output];
        for (const line of lines) {
          if (line.length > 0) {
            newOutput.push(isError ? `[stderr] ${line}` : line);
          }
        }
        // Keep only the last 500 lines to avoid memory issues
        if (newOutput.length > MAX_OUTPUT_LINES) {
          newOutput.splice(0, newOutput.length - MAX_OUTPUT_LINES);
        }
        // Create new task object so shallowArrayEqual in useExecTasks detects the change
        state.execTasks!.set(taskId, { ...task, output: newOutput });
      });
      notify();
    },

    handleExecTaskCompleted(
      taskId: string,
      agentId: string,
      exitCode: number | null,
      success: boolean,
      completedAt?: number
    ): void {
      ptyRenderers.delete(taskId);
      setState((state) => {
        const task = state.execTasks?.get(taskId);
        if (task) {
          task.status = success ? 'completed' : 'failed';
          task.exitCode = exitCode;
          task.completedAt = completedAt ?? serverNow();
        }
      });
      notify();
    },

    async stopExecTask(taskId: string): Promise<boolean> {
      try {
        // authFetch + apiUrl: a bare fetch('/api/…') has no auth token — with
        // auth enabled the DELETE 401'd silently and the button did nothing.
        const response = await authFetch(apiUrl(`/api/exec/tasks/${taskId}`), {
          method: 'DELETE',
        });
        // 200 = the server is killing the tree. 404 = the task is already gone
        // server-side (it finished, or completion was lost to a WS drop) — the
        // card is stale, so resolve it too instead of leaving it spinning
        // forever. Any other status is a real failure the button can't fix.
        const resolvedLocally = response.ok || response.status === 404;
        if (resolvedLocally) {
          const stoppedByUser = response.ok;
          setState((state) => {
            const task = state.execTasks?.get(taskId);
            if (task && task.status === 'running') {
              task.status = 'failed';
              task.exitCode = -15; // SIGTERM exit code
              task.completedAt = Date.now();
              task.output.push(stoppedByUser ? '[Task stopped by user]' : '[Task already ended]');
            }
          });
          notify();
        }
        return resolvedLocally;
      } catch (err) {
        console.error('Failed to stop exec task:', err);
        return false;
      }
    },

    getExecTasks(agentId: string): ExecTask[] {
      const state = getState();
      if (!state.execTasks) return [];
      return Array.from(state.execTasks.values()).filter((t) => t.agentId === agentId);
    },

    getAllExecTasks(): ExecTask[] {
      const state = getState();
      if (!state.execTasks) return [];
      return Array.from(state.execTasks.values());
    },

    getExecTask(taskId: string): ExecTask | undefined {
      const state = getState();
      return state.execTasks?.get(taskId);
    },

    clearCompletedExecTasks(agentId: string): void {
      setState((state) => {
        if (!state.execTasks) return;
        for (const [taskId, task] of state.execTasks.entries()) {
          if (task.agentId === agentId && task.status !== 'running') {
            state.execTasks.delete(taskId);
            ptyRenderers.delete(taskId);
          }
        }
      });
      notify();
    },

    clearAllExecTasks(agentId: string): void {
      setState((state) => {
        if (!state.execTasks) return;
        for (const [taskId, task] of state.execTasks.entries()) {
          if (task.agentId === agentId) {
            state.execTasks.delete(taskId);
            ptyRenderers.delete(taskId);
          }
        }
      });
      notify();
    },

    removeExecTask(taskId: string): void {
      ptyRenderers.delete(taskId);
      setState((state) => {
        if (!state.execTasks) return;
        state.execTasks.delete(taskId);
      });
      notify();
    },
  };
}
