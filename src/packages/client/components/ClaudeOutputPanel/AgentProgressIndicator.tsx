/**
 * AgentProgressIndicator - Shows a collapsible header indicating agent is working on a task
 * Used in boss terminal to show when subordinates are executing delegated tasks
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentTaskProgress } from '../../store/types';
import type { ClaudeOutput } from '../../store';
import type { EditData } from './types';
import { useFilteredOutputs } from '../shared/useFilteredOutputs';
import { OutputLine } from './OutputLine';

interface AgentProgressIndicatorProps {
  progress: AgentTaskProgress;
  defaultExpanded?: boolean;
  onAgentClick?: (agentId: string) => void;
  onDismiss?: (agentId: string) => void;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
}

export function AgentProgressIndicator({
  progress,
  defaultExpanded: _defaultExpanded = false,
  onAgentClick,
  onDismiss,
  onFileClick,
  onBashClick,
}: AgentProgressIndicatorProps) {
  // Track user-initiated collapse state separately from status-based default
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);

  // Auto-expand when working, but respect user's manual collapse
  // When status changes to completed/failed, keep expanded to show "finished" state
  const prevStatusRef = useRef(progress.status);
  const isExpanded = userCollapsed !== null
    ? !userCollapsed
    : (progress.status === 'working' || progress.status === 'completed' || progress.status === 'failed');

  // Reset user collapse preference when status changes (e.g., new task starts)
  useEffect(() => {
    if (prevStatusRef.current !== progress.status) {
      // If transitioning from working to completed/failed, auto-expand to show result
      if (prevStatusRef.current === 'working' && (progress.status === 'completed' || progress.status === 'failed')) {
        setUserCollapsed(false);
      }
      prevStatusRef.current = progress.status;
    }
  }, [progress.status]);

  const statusColors: Record<string, string> = {
    working: '#4a9eff',
    completed: '#22c55e',
    failed: '#ef4444',
  };

  const statusIcons: Record<string, string> = {
    working: '⚙️',
    completed: '✅',
    failed: '❌',
  };

  const { t } = useTranslation(['tools']);
  const statusText: Record<string, string> = {
    working: t('tools:progress.workingOn'),
    completed: t('tools:progress.taskFinished'),
    failed: t('tools:progress.taskFailed'),
  };

  // Truncate task description for compact view
  const truncatedTask =
    progress.taskDescription.length > 80
      ? progress.taskDescription.slice(0, 80) + '...'
      : progress.taskDescription;

  // Calculate elapsed time
  const getElapsedTime = () => {
    const endTime = progress.completedAt || Date.now();
    const elapsed = Math.floor((endTime - progress.startedAt) / 1000);
    if (elapsed < 60) return `${elapsed}s`;
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}m ${seconds}s`;
  };

  const handleToggle = () => {
    setUserCollapsed(isExpanded);
  };

  return (
    <div
      className={`agent-progress-indicator status-${progress.status} ${isExpanded ? 'expanded' : 'collapsed'}`}
    >
      <div className="agent-progress-header" onClick={handleToggle}>
        <span className="agent-progress-status-icon" style={{ color: statusColors[progress.status] }}>
          {statusIcons[progress.status]}
        </span>
        <span
          className="agent-progress-agent-name"
          onClick={(e) => {
            if (onAgentClick) {
              e.stopPropagation();
              onAgentClick(progress.agentId);
            }
          }}
        >
          {progress.agentName}
        </span>
        <span className="agent-progress-status-text" style={{ color: statusColors[progress.status] }}>
          {statusText[progress.status]}
        </span>
        <span className="agent-progress-elapsed">{getElapsedTime()}</span>
        {onDismiss && (
          <span
            className="agent-progress-dismiss"
            title="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(progress.agentId);
            }}
          >
            ×
          </span>
        )}
        <span className="agent-progress-toggle">{isExpanded ? '▼' : '▶'}</span>
      </div>
      {!isExpanded && <div className="agent-progress-task-preview">{truncatedTask}</div>}
      {isExpanded && (
        <div className="agent-progress-expanded">
          <div className="agent-progress-task-full">{progress.taskDescription}</div>
          {progress.output.length > 0 && (
            <div className="agent-progress-output-section">
              <AgentProgressOutput
                output={progress.output}
                agentId={progress.agentId}
                maxHeight={200}
                onFileClick={onFileClick}
                onBashClick={onBashClick}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * AgentProgressOutput - Scrollable view of streaming output from agent
 * Uses the same "simple" view mode filtering as the main GuakeTerminal
 */
interface AgentProgressOutputProps {
  output: ClaudeOutput[];
  agentId: string;
  maxHeight?: number;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
}

export function AgentProgressOutput({ output, agentId, maxHeight = 200, onFileClick, onBashClick }: AgentProgressOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Output objects already come as ClaudeOutput with full tool metadata
  const outputObjects = output;

  // Apply "simple" view mode filtering (same as GuakeTerminal)
  const filteredOutputs = useFilteredOutputs({
    outputs: outputObjects,
    viewMode: 'simple',
  });

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredOutputs]);

  if (filteredOutputs.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="agent-progress-output"
      style={{ maxHeight: `${maxHeight}px` }}
    >
      {filteredOutputs.map((outputObj, index) => (
        <OutputLine
          key={`progress-${index}`}
          output={outputObj}
          agentId={agentId}
          onFileClick={onFileClick}
          onBashClick={onBashClick}
        />
      ))}
    </div>
  );
}
