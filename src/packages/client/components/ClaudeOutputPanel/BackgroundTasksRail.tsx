/**
 * BackgroundTasksRail - live indicators for the CLI's background work.
 *
 * A small stack of pulsing dots pinned to the bottom-right of the chat
 * viewport (below the prompt-marker rail's centered dot stack), one per
 * ACTIVE background task of the agent: Bash commands running with
 * run_in_background, slow Bash commands promoted to the background at their
 * timeout, and async Task/Agent launches. Hovering (or tapping) the dots
 * expands a panel showing each task's description/command, ticking elapsed
 * time, and its live output:
 *   - Commander exec calls (curl to /api/exec) are matched to their streaming
 *     ExecTask in the store — the panel shows that live stream directly.
 *   - Plain Bash tasks tail their /tmp task output file via the server.
 * Rendered by VirtualizedOutputList inside a sticky, zero-height anchor,
 * exactly like PromptMarkersRail.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentBackgroundTask, ExecTask } from '../../../shared/types';
import { store, useBackgroundTasksForAgent, useExecTasks } from '../../store';
import { fetchBackgroundTaskOutput } from '../../api/background-tasks';
import { ansiToHtml } from '../../utils/ansiToHtml';

interface BackgroundTasksRailProps {
  agentId: string;
  /** The .guake-output scroll container, for viewport-height tracking. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

// Mirror PromptMarkersRail's grace period when crossing to the panel.
const CLOSE_DELAY_MS = 150;
const OUTPUT_POLL_MS = 1500;
const OUTPUT_TAIL_BYTES = 2048;
const OUTPUT_MAX_LINES = 14;
const EDGE_PADDING = 12;

function formatElapsed(startedAt: number, now: number): string {
  const totalSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m ${totalSec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function taskTitle(task: AgentBackgroundTask): string {
  if (task.description) return task.description;
  if (task.command) return task.command;
  if (task.toolName === 'Task' || task.toolName === 'Agent') return 'Async subagent';
  return 'Background task';
}

/**
 * Match a backgrounded Commander-exec curl to its streaming ExecTask. The
 * curl body carries the inner command (JSON-escaped), so a running exec task
 * whose command appears in the curl — or, failing that, the youngest exec
 * task started around the bg task's launch — is the one it spawned.
 */
function findLinkedExecTask(task: AgentBackgroundTask, execTasks: ExecTask[]): ExecTask | undefined {
  if (!task.command || !task.command.includes('/api/exec')) return undefined;
  const running = execTasks.filter((t) => t.status === 'running');
  const byCommand = running.find(
    (t) => t.command && (task.command!.includes(t.command) || task.command!.includes(JSON.stringify(t.command).slice(1, -1)))
  );
  if (byCommand) return byCommand;
  return running
    .filter((t) => t.startedAt >= task.startedAt - 20_000)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Live output of one task: linked exec stream when available, else file tail. */
function TaskOutputTail({ agentId, task, linkedExec }: {
  agentId: string;
  task: AgentBackgroundTask;
  linkedExec?: ExecTask;
}) {
  const [output, setOutput] = useState<string | null>(null);
  const [exists, setExists] = useState(true);
  const preRef = useRef<HTMLPreElement | null>(null);
  const isSubagent = task.toolName === 'Task' || task.toolName === 'Agent';

  useEffect(() => {
    // Exec-linked tasks stream via the store — no polling needed. Async
    // subagents have no .output file — their stream is already rendered in
    // the conversation.
    if (linkedExec || isSubagent) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const result = await fetchBackgroundTaskOutput(agentId, task.key, OUTPUT_TAIL_BYTES);
        if (cancelled) return;
        setExists(result.exists);
        if (result.exists) {
          const lines = result.content.split('\n');
          setOutput(lines.slice(-OUTPUT_MAX_LINES).join('\n').trimEnd());
        }
      } catch {
        // Task likely completed between renders — the rail will drop it on the
        // next background_tasks_update; keep the last output until then.
      }
      if (!cancelled) timer = setTimeout(poll, OUTPUT_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agentId, task.key, isSubagent, !!linkedExec]);

  // Follow the tail as new output arrives (either source).
  const linkedLineCount = linkedExec?.output.length ?? 0;
  useEffect(() => {
    const pre = preRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, [output, linkedLineCount]);

  if (linkedExec) {
    const lines = linkedExec.output.slice(-OUTPUT_MAX_LINES);
    return (
      <pre className="bg-task-output" ref={preRef}>
        {lines.length === 0
          ? '(waiting for output…)'
          : lines.map((line, idx) => (
            <div key={idx} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
          ))}
      </pre>
    );
  }
  if (isSubagent) {
    return <div className="bg-task-output-note">Async subagent — its activity streams in the conversation.</div>;
  }
  if (!exists) {
    return <div className="bg-task-output-note">No output yet…</div>;
  }
  if (output === null) {
    return <div className="bg-task-output-note">Loading output…</div>;
  }
  return (
    <pre className="bg-task-output" ref={preRef}>{output || '(no output yet)'}</pre>
  );
}

export function BackgroundTasksRail({ agentId, scrollContainerRef }: BackgroundTasksRailProps) {
  const tasks = useBackgroundTasksForAgent(agentId);
  const execTasks = useExecTasks(agentId);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [viewportHeight, setViewportHeight] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the scroll container's inner height so the rail can pin its dots to
  // the BOTTOM of the visible pane (same pattern as PromptMarkersRail).
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    setViewportHeight(container.clientHeight);
    const observer = new ResizeObserver(() => {
      setViewportHeight(container.clientHeight);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  const openPanel = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Tick the elapsed timers while the panel is open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  // Close the panel when the last task finishes (the dots disappear with it).
  useEffect(() => {
    if (tasks.length === 0) setOpen(false);
  }, [tasks.length]);

  if (tasks.length === 0 || viewportHeight === 0) return null;

  return (
    <div className="bg-tasks-rail" style={{ height: viewportHeight }}>
      <button
        type="button"
        className="bg-tasks-dots"
        style={{ bottom: EDGE_PADDING }}
        aria-label={`${tasks.length} background task${tasks.length === 1 ? '' : 's'} running`}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        {tasks.map((task) => (
          <span key={task.key} className="bg-task-dot" />
        ))}
      </button>
      {open && (
        <div
          className="bg-tasks-panel"
          style={{ bottom: EDGE_PADDING, maxHeight: Math.max(120, viewportHeight - EDGE_PADDING * 2) }}
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
        >
          <div className="bg-tasks-panel-header">
            Background tasks
            <span className="bg-tasks-panel-count">{tasks.length}</span>
          </div>
          {tasks.map((task) => {
            const linkedExec = findLinkedExecTask(task, execTasks);
            return (
              <div key={task.key} className="bg-task-item">
                <div className="bg-task-item-header">
                  <span className="bg-task-dot" />
                  <span className="bg-task-title" title={task.command || taskTitle(task)}>
                    {linkedExec ? (linkedExec.command || taskTitle(task)) : taskTitle(task)}
                  </span>
                  {linkedExec && <span className="bg-task-exec-badge">exec</span>}
                  <span className="bg-task-elapsed">{formatElapsed(task.startedAt, now)}</span>
                  {linkedExec && (
                    <button
                      className="bg-task-stop"
                      title="Stop this exec"
                      onClick={(e) => { e.stopPropagation(); void store.stopExecTask(linkedExec.taskId); }}
                    >
                      ■
                    </button>
                  )}
                </div>
                {!linkedExec && task.description && task.command && (
                  <div className="bg-task-command" title={task.command}>{task.command}</div>
                )}
                <TaskOutputTail agentId={agentId} task={task} linkedExec={linkedExec} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default BackgroundTasksRail;
