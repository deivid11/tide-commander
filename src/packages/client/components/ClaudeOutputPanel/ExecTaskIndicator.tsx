/**
 * ExecTaskIndicator - Shows streaming output from long-running commands
 * executed via /api/exec endpoint
 */

import React, { useState, useEffect, useRef } from 'react';
import type { ExecTask } from '../../../shared/types';
import { ansiToHtml } from '../../utils/ansiToHtml';
import { store } from '../../store';

interface ExecTaskIndicatorProps {
  task: ExecTask;
  defaultExpanded?: boolean;
  onClose?: (taskId: string) => void;
  onStop?: (taskId: string) => void;
}

export function ExecTaskIndicator({
  task,
  defaultExpanded = true,
  onClose,
  onStop,
}: ExecTaskIndicatorProps) {
  // Track user-initiated collapse state
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [stopping, setStopping] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-expand when running
  const isExpanded = userCollapsed !== null
    ? !userCollapsed
    : (task.status === 'running' || defaultExpanded);

  // Auto-dismiss completed tasks after 10 seconds
  useEffect(() => {
    if (task.status !== 'running') {
      const timer = setTimeout(() => {
        store.removeExecTask(task.taskId);
      }, 10000); // 10 seconds after completion
      return () => clearTimeout(timer);
    }
  }, [task.status, task.taskId]);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (outputRef.current && isExpanded) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [task.output, isExpanded]);

  const statusColors: Record<string, string> = {
    running: '#4a9eff',
    completed: '#22c55e',
    failed: '#ef4444',
  };

  const statusIcons: Record<string, string> = {
    running: '⏳',
    completed: '✅',
    failed: '❌',
  };

  // Truncate command for compact view
  const truncatedCommand =
    task.command.length > 60
      ? task.command.slice(0, 60) + '...'
      : task.command;

  // Calculate elapsed time
  const getElapsedTime = () => {
    const endTime = task.completedAt || Date.now();
    const elapsed = Math.floor((endTime - task.startedAt) / 1000);
    if (elapsed < 60) return `${elapsed}s`;
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}m ${seconds}s`;
  };

  const handleToggle = () => {
    setUserCollapsed(isExpanded);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.(task.taskId);
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (stopping) return;
    setStopping(true);
    const success = await store.stopExecTask(task.taskId);
    if (!success) {
      setStopping(false);
    }
    onStop?.(task.taskId);
  };

  return (
    <div
      className={`exec-task-indicator status-${task.status} ${isExpanded ? 'expanded' : 'collapsed'}`}
    >
      <div className="exec-task-header" onClick={handleToggle}>
        <span className="exec-task-status-icon" style={{ color: statusColors[task.status] }}>
          {statusIcons[task.status]}
        </span>
        <span className="exec-task-command" title={task.command}>
          $ {truncatedCommand}
        </span>
        <span className="exec-task-elapsed">{getElapsedTime()}</span>
        <span className="exec-task-toggle">{isExpanded ? '▼' : '▶'}</span>
        {task.status === 'running' ? (
          <button
            className="exec-task-stop"
            onClick={handleStop}
            title="Stop task"
            disabled={stopping}
          >
            {stopping ? '...' : '■'}
          </button>
        ) : (
          <button className="exec-task-close" onClick={handleClose} title="Dismiss">
            ×
          </button>
        )}
      </div>
      {isExpanded && (
        <div className="exec-task-expanded">
          <div
            ref={outputRef}
            className="exec-task-output"
          >
            {task.output.length === 0 ? (
              <div className="exec-task-output-empty">Running...</div>
            ) : (
              task.output.map((line, index) => {
                const isStderr = line.startsWith('[stderr]');
                const cleanLine = line.replace(/^\[stderr\] /, '');
                return (
                  <div
                    key={index}
                    className={`exec-task-output-line ${isStderr ? 'stderr' : ''}`}
                    dangerouslySetInnerHTML={{ __html: ansiToHtml(cleanLine) }}
                  />
                );
              })
            )}
          </div>
          {task.status !== 'running' && task.exitCode !== null && (
            <div className={`exec-task-exit-code ${task.exitCode === 0 ? 'success' : 'error'}`}>
              Exit code: {task.exitCode}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ExecTasksContainer - Container for all exec tasks for an agent
 */
interface ExecTasksContainerProps {
  tasks: ExecTask[];
  onClearCompleted?: () => void;
  onDismiss?: (taskId: string) => void;
}

export function ExecTasksContainer({
  tasks,
  onClearCompleted,
  onDismiss,
}: ExecTasksContainerProps) {
  if (tasks.length === 0) {
    return null;
  }

  const runningCount = tasks.filter(t => t.status === 'running').length;
  const completedCount = tasks.filter(t => t.status !== 'running').length;

  return (
    <div className="exec-tasks-container">
      <div className="exec-tasks-header">
        <span className="exec-tasks-icon">🖥️</span>
        <span className="exec-tasks-title">Running Tasks</span>
        {runningCount > 0 && (
          <span className="exec-tasks-count running">({runningCount} running)</span>
        )}
        {completedCount > 0 && onClearCompleted && (
          <button className="exec-tasks-clear" onClick={onClearCompleted}>
            Clear completed
          </button>
        )}
      </div>
      <div className="exec-tasks-list">
        {tasks.map((task) => (
          <ExecTaskIndicator
            key={task.taskId}
            task={task}
            defaultExpanded={task.status === 'running'}
            onClose={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}
