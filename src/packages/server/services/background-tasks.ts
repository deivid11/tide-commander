/**
 * Background-task registry — live visibility of the CLI's background work.
 *
 * The Claude CLI runs work that outlives a single tool call: Bash commands
 * launched with run_in_background, slow Bash commands promoted to the
 * background at their timeout, and async Task/Agent launches. The CLI
 * announces them via `task_started` system events / launch-stub tool_results
 * and resolves them with a <task-notification>. This registry tracks the
 * ACTIVE set per agent (with the command/description and output-file path
 * when known) so clients can render live "background work" indicators and
 * tail the task's output file while it runs.
 *
 * Distinct from pendingBackgroundTasks in runtime-subagents.ts: that set only
 * guards the idle flip at step_complete (and is deliberately resolved by any
 * tool_result). This registry is presentation state — it must survive the
 * launch stub and only drop a task on its real completion.
 */

import type { AgentBackgroundTask } from '../../shared/types.js';
import type { RuntimeEvent } from '../runtime/index.js';

// Metadata remembered from tool_start events so a later task_started (which
// only carries ids) can name the task. Bounded FIFO — entries for tools that
// never become background tasks just age out.
const TOOL_META_LIMIT = 200;
const toolMetaByUseId = new Map<string, { toolName?: string; command?: string; description?: string }>();

// agentId -> key (toolUseId, falling back to taskId) -> task
const activeTasks = new Map<string, Map<string, AgentBackgroundTask>>();

type ChangeListener = (agentId: string) => void;
const changeListeners = new Set<ChangeListener>();

export function onBackgroundTasksChanged(listener: ChangeListener): void {
  changeListeners.add(listener);
}

function notifyChanged(agentId: string): void {
  for (const listener of changeListeners) {
    listener(agentId);
  }
}

/** Remember what a tool invocation was, keyed by its tool_use id. */
export function noteToolStart(event: RuntimeEvent): void {
  if (!event.toolUseId || event.parentToolUseId) return;
  const input = event.toolInput || {};
  toolMetaByUseId.set(event.toolUseId, {
    toolName: event.toolName,
    command: typeof input.command === 'string' ? input.command : undefined,
    description:
      (typeof input.description === 'string' ? input.description : undefined)
      || event.subagentDescription
      || event.subagentName,
  });
  // FIFO eviction (Map preserves insertion order)
  if (toolMetaByUseId.size > TOOL_META_LIMIT) {
    const oldest = toolMetaByUseId.keys().next().value;
    if (oldest !== undefined) toolMetaByUseId.delete(oldest);
  }
}

// The two shapes of the CLI's Bash background launch stub:
//   "Command running in background with ID: <id>. Output is being written to: <path>."
//   "Command did not complete within its <N>s timeout and was moved to the
//    background (ID: <id>). Output is being written to: <path>."
const BASH_STUB_ID_RE = /Command (?:running in background with ID:\s*|did not complete within its \d+s timeout and was moved to the background \(ID:\s*)([\w-]+)/;
const BASH_STUB_FILE_RE = /Output is being written to: (\S+?\.output)/;

/** Parse a Bash tool_result that is a background launch stub, not a real result. */
export function parseBashBackgroundStub(output: string | undefined): { taskId: string; outputFile?: string } | null {
  if (!output) return null;
  const idMatch = BASH_STUB_ID_RE.exec(output);
  if (!idMatch) return null;
  return {
    taskId: idMatch[1],
    outputFile: BASH_STUB_FILE_RE.exec(output)?.[1],
  };
}

function tasksFor(agentId: string): Map<string, AgentBackgroundTask> {
  let tasks = activeTasks.get(agentId);
  if (!tasks) {
    tasks = new Map();
    activeTasks.set(agentId, tasks);
  }
  return tasks;
}

/**
 * Upsert a background task. Registration fires from up to two sources per task
 * (the launch-stub tool_result and the task_started system event, in either
 * order) — merging by key keeps them a single entry.
 */
export function registerBackgroundTask(
  agentId: string,
  info: { toolUseId?: string; taskId?: string; outputFile?: string }
): void {
  const key = info.toolUseId || info.taskId;
  if (!key) return;
  const tasks = tasksFor(agentId);
  // A task_started may key by toolUseId while a stub-only registration keyed by
  // taskId (or vice versa) — match on either id before creating a new entry.
  let existing = tasks.get(key);
  if (!existing) {
    for (const task of tasks.values()) {
      if (
        (info.toolUseId && task.toolUseId === info.toolUseId)
        || (info.taskId && task.taskId === info.taskId)
      ) {
        existing = task;
        break;
      }
    }
  }
  const meta = info.toolUseId ? toolMetaByUseId.get(info.toolUseId) : undefined;
  if (existing) {
    existing.taskId = info.taskId ?? existing.taskId;
    existing.toolUseId = info.toolUseId ?? existing.toolUseId;
    existing.outputFile = info.outputFile ?? existing.outputFile;
    if (meta) {
      existing.toolName = existing.toolName ?? meta.toolName;
      existing.command = existing.command ?? meta.command;
      existing.description = existing.description ?? meta.description;
    }
  } else {
    tasks.set(key, {
      agentId,
      key,
      taskId: info.taskId,
      toolUseId: info.toolUseId,
      outputFile: info.outputFile,
      toolName: meta?.toolName,
      command: meta?.command,
      description: meta?.description,
      startedAt: Date.now(),
    });
  }
  notifyChanged(agentId);
}

/** Remove a finished task (matched by toolUseId or taskId). Returns true if one was removed. */
export function completeBackgroundTask(
  agentId: string,
  ids: { toolUseId?: string; taskId?: string }
): boolean {
  const tasks = activeTasks.get(agentId);
  if (!tasks) return false;
  for (const [key, task] of tasks) {
    if (
      (ids.toolUseId && task.toolUseId === ids.toolUseId)
      || (ids.taskId && task.taskId === ids.taskId)
    ) {
      tasks.delete(key);
      if (tasks.size === 0) activeTasks.delete(agentId);
      notifyChanged(agentId);
      return true;
    }
  }
  return false;
}

/** Drop every task for an agent (its CLI process died — the tasks died with it). */
export function clearBackgroundTasks(agentId: string): void {
  if (activeTasks.delete(agentId)) {
    notifyChanged(agentId);
  }
}

export function getBackgroundTasksForAgent(agentId: string): AgentBackgroundTask[] {
  return Array.from(activeTasks.get(agentId)?.values() ?? []);
}

/** Agent ids that currently have at least one active background task. */
export function getAgentIdsWithBackgroundTasks(): string[] {
  return Array.from(activeTasks.keys());
}

export function resetBackgroundTaskStateForTests(): void {
  activeTasks.clear();
  toolMetaByUseId.clear();
  changeListeners.clear();
}
