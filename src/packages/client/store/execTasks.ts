/**
 * Exec Tasks Store Module
 *
 * Manages state for streaming command execution tasks.
 * These are long-running commands executed via /api/exec endpoint
 * with real-time output streaming via WebSocket.
 */

import type { ExecTask } from '../../shared/types';
import type { StoreState } from './types';

export interface ExecTaskActions {
  // Task lifecycle
  handleExecTaskStarted(
    taskId: string,
    agentId: string,
    agentName: string,
    command: string,
    cwd: string
  ): void;
  handleExecTaskOutput(taskId: string, agentId: string, output: string, isError?: boolean): void;
  handleExecTaskCompleted(taskId: string, agentId: string, exitCode: number | null, success: boolean): void;

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
      cwd: string
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
          startedAt: Date.now(),
        };

        if (!state.execTasks) {
          state.execTasks = new Map();
        }

        // Store task by taskId for quick lookup
        state.execTasks.set(taskId, task);
      });
      notify();
    },

    handleExecTaskOutput(taskId: string, agentId: string, output: string, isError?: boolean): void {
      setState((state) => {
        const task = state.execTasks?.get(taskId);
        if (task) {
          // Split output into lines and add to the output array
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.length > 0) {
              task.output.push(isError ? `[stderr] ${line}` : line);
            }
          }
          // Keep only the last 500 lines to avoid memory issues
          if (task.output.length > 500) {
            task.output = task.output.slice(-500);
          }
        }
      });
      notify();
    },

    handleExecTaskCompleted(
      taskId: string,
      agentId: string,
      exitCode: number | null,
      success: boolean
    ): void {
      setState((state) => {
        const task = state.execTasks?.get(taskId);
        if (task) {
          task.status = success ? 'completed' : 'failed';
          task.exitCode = exitCode;
          task.completedAt = Date.now();
        }
      });
      notify();
    },

    async stopExecTask(taskId: string): Promise<boolean> {
      try {
        const response = await fetch(`/api/exec/tasks/${taskId}`, {
          method: 'DELETE',
        });
        if (response.ok) {
          // Mark the task as failed/stopped in local state immediately
          // (Server will also broadcast exec_task_completed event)
          setState((state) => {
            const task = state.execTasks?.get(taskId);
            if (task && task.status === 'running') {
              task.status = 'failed';
              task.exitCode = -15; // SIGTERM exit code
              task.completedAt = Date.now();
              task.output.push('[Task stopped by user]');
            }
          });
          notify();
          return true;
        }
        return false;
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
          }
        }
      });
      notify();
    },

    removeExecTask(taskId: string): void {
      setState((state) => {
        if (!state.execTasks) return;
        state.execTasks.delete(taskId);
      });
      notify();
    },
  };
}
