/**
 * GuakeTaskBanner — a slim strip under the terminal header showing what the
 * selected agent is working on RIGHT NOW.
 *
 * Source priority:
 *   1. the in-progress TodoWrite item (its `activeForm`, e.g. "Adding shared
 *      types…") plus a done/total progress badge, when the agent has a live
 *      task list (agent.latestTodos);
 *   2. the agent's tracking detail (the <=80-char "what I'm doing" line);
 *   3. the short task label / last task.
 *
 * Only rendered while the agent is actively `working`, so it disappears the
 * moment the turn ends (latestTodos is cleared server-side on idle anyway).
 */

import { memo } from 'react';
import { Icon } from '../Icon';
import { ActivityGlyph } from '../shared/ActivityGlyph';
import type { Agent } from '../../../shared/types';
import { renameAgentRequestPreview } from '../../plugins/rename-agent/renameAgentRequest';

interface CurrentTask {
  text: string;
  progress?: { done: number; total: number };
}

/** Resolve the best "current task" line for an agent (null = nothing to show). */
function pickCurrentTask(agent: Agent): CurrentTask | null {
  const todos = agent.latestTodos;
  if (todos && todos.length > 0) {
    const inProgress = todos.find((t) => t.status === 'in_progress');
    if (inProgress) {
      return {
        text: inProgress.activeForm || inProgress.content,
        progress: {
          done: todos.filter((t) => t.status === 'completed').length,
          total: todos.length,
        },
      };
    }
  }
  const fallback = agent.trackingStatusDetail || agent.taskLabel || agent.currentTask;
  if (!fallback) return null;
  return { text: renameAgentRequestPreview(fallback) || fallback };
}

export const GuakeTaskBanner = memo(function GuakeTaskBanner({
  agent,
  onClick,
}: {
  agent: Agent;
  onClick?: () => void;
}) {
  if (agent.status !== 'working') return null;
  const task = pickCurrentTask(agent);
  if (!task) return null;

  return (
    <button
      type="button"
      className="guake-task-banner"
      onClick={onClick}
      title={onClick ? `${task.text}\n\n(click for the task board)` : task.text}
    >
      <ActivityGlyph animated size={12} className="guake-task-banner-spinner" />
      <span className="guake-task-banner-label">Working on</span>
      <span className="guake-task-banner-text">{task.text}</span>
      {task.progress && task.progress.total > 1 && (
        <span className="guake-task-banner-progress" title={`${task.progress.done} of ${task.progress.total} tasks done`}>
          {task.progress.done}/{task.progress.total}
        </span>
      )}
      {onClick && (
        <span className="guake-task-banner-hint" aria-hidden="true">
          <Icon name="list-checks" size={13} />
        </span>
      )}
    </button>
  );
});
