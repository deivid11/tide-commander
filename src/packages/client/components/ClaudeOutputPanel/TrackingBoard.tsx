import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent, AgentTrackingStatus } from '../../../shared/types';
import { useAgentsByTrackingStatus, useCustomAgentClassesArray, store } from '../../store';
import { getClassConfig } from '../../utils/classConfig';
import { formatIdleTime } from '../../utils/formatting';
import { apiUrl, authFetch } from '../../utils/storage';
import { useWorkspaceFilter, isAgentVisibleInWorkspace } from '../WorkspaceSwitcher';

interface TrackingBoardProps {
  activeAgentId: string;
  onSelectAgent: (agentId: string) => void;
}

type TrackingColumn = {
  key: AgentTrackingStatus;
  title: string;
  emptyLabel: string;
  toneClass: string;
};

const TRACKING_COLUMNS: TrackingColumn[] = [
  { key: 'working', title: 'Working', emptyLabel: 'No agents', toneClass: 'working' },
  { key: 'waiting-subordinates', title: 'Waiting Subordinates', emptyLabel: 'No agents', toneClass: 'waiting-subordinates' },
  { key: 'need-review', title: 'Need Review', emptyLabel: 'No agents', toneClass: 'need-review' },
  { key: 'blocked', title: 'Blocked', emptyLabel: 'No agents', toneClass: 'blocked' },
  { key: 'can-clear-context', title: 'Can Clear Context', emptyLabel: 'No agents', toneClass: 'can-clear-context' },
];

export function TrackingBoard({ activeAgentId, onSelectAgent }: TrackingBoardProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [activeWorkspace] = useWorkspaceFilter();
  const groupedAgents = useAgentsByTrackingStatus();
  const [clearingAgentIds, setClearingAgentIds] = useState<Set<string>>(new Set());

  const columns = useMemo(() => {
    return TRACKING_COLUMNS.map((column) => {
      const visibleAgents = groupedAgents[column.key]
        .filter((agent) => {
          if (!activeWorkspace) return true;
          const area = store.getAreaForAgent(agent.id);
          return isAgentVisibleInWorkspace(area?.id ?? null);
        })
        .sort((a, b) => (b.trackingStatusTimestamp || 0) - (a.trackingStatusTimestamp || 0));

      return { ...column, agents: visibleAgents };
    });
  }, [activeWorkspace, groupedAgents]);

  const clearTrackingStatus = useCallback(async (agentId: string) => {
    try {
      const response = await authFetch(apiUrl(`/api/agents/${agentId}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trackingStatus: null }),
      });

      if (!response.ok) {
        throw new Error(`Failed to clear tracking status: ${response.statusText}`);
      }

      const updatedAgent = store.getState().agents.get(agentId);
      if (updatedAgent) {
        store.updateAgent({
          ...updatedAgent,
          trackingStatus: null,
          trackingStatusDetail: undefined,
          trackingStatusTimestamp: undefined,
        });
      }
    } catch (error) {
      console.error('Failed to clear tracking status', error);
    }
  }, []);

  const handleClearStatus = useCallback(async (agent: Agent) => {
    setClearingAgentIds((prev) => new Set(prev).add(agent.id));

    try {
      await clearTrackingStatus(agent.id);
    } finally {
      setClearingAgentIds((prev) => {
        const next = new Set(prev);
        next.delete(agent.id);
        return next;
      });
    }
  }, [clearTrackingStatus]);

  const [clearingColumnKey, setClearingColumnKey] = useState<string | null>(null);

  const handleClearColumn = useCallback(async (columnKey: AgentTrackingStatus, agents: Agent[]) => {
    if (agents.length === 0) return;

    setClearingColumnKey(columnKey);
    setClearingAgentIds((prev) => {
      const next = new Set(prev);
      agents.forEach((agent) => next.add(agent.id));
      return next;
    });

    try {
      for (const agent of agents) {
        if (columnKey === 'can-clear-context') {
          store.clearContext(agent.id);
        }
        await clearTrackingStatus(agent.id);
      }
    } finally {
      setClearingColumnKey(null);
      setClearingAgentIds((prev) => {
        const next = new Set(prev);
        agents.forEach((agent) => next.delete(agent.id));
        return next;
      });
    }
  }, [clearTrackingStatus]);

  return (
    <div className="tracking-board">
      {columns.map((column) => (
        <section key={column.key} className={`tracking-board-column tracking-board-column--${column.toneClass}`}>
          <header className="tracking-board-column-header">
            <span className="tracking-board-column-indicator" />
            <span className="tracking-board-column-title">{column.title}</span>
            {column.agents.length > 0 && (
              <button
                type="button"
                className={`tracking-board-column-action${column.key === 'can-clear-context' ? ' tracking-board-column-action--context' : ''}`}
                onClick={() => void handleClearColumn(column.key, column.agents)}
                disabled={clearingColumnKey === column.key}
                title={column.key === 'can-clear-context' ? 'Clear context and status for all agents' : 'Clear status for all agents in this column'}
              >
                {clearingColumnKey === column.key
                  ? 'Clearing...'
                  : column.key === 'can-clear-context'
                    ? `Clear All (${column.agents.length})`
                    : 'Clear all'}
              </button>
            )}
            <span className="tracking-board-column-count">{column.agents.length}</span>
          </header>

          <div className="tracking-board-column-body">
            {column.agents.length === 0 ? (
              <div className="tracking-board-empty">{column.emptyLabel}</div>
            ) : (
              column.agents.map((agent) => (
                <TrackingBoardCard
                  key={agent.id}
                  agent={agent}
                  isActive={agent.id === activeAgentId}
                  isClearing={clearingAgentIds.has(agent.id)}
                  onSelectAgent={onSelectAgent}
                  onClearStatus={handleClearStatus}
                  timeLabel={agent.trackingStatusTimestamp ? formatIdleTime(agent.trackingStatusTimestamp) : t('common:time.justNow', { defaultValue: 'just now' })}
                />
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

interface TrackingBoardCardProps {
  agent: Agent;
  isActive: boolean;
  isClearing: boolean;
  onSelectAgent: (agentId: string) => void;
  onClearStatus: (agent: Agent) => void;
  timeLabel: string;
}

function TrackingBoardCard({
  agent,
  isActive,
  isClearing,
  onSelectAgent,
  onClearStatus,
  timeLabel,
}: TrackingBoardCardProps) {
  const customClasses = useCustomAgentClassesArray();
  const classConfig = getClassConfig(agent.class, customClasses);

  return (
    <article
      className={`tracking-board-card${isActive ? ' active' : ''}`}
      onClick={() => onSelectAgent(agent.id)}
      title={agent.trackingStatusDetail || agent.taskLabel || agent.name}
    >
      <div className="tracking-board-card-header">
        <div className="tracking-board-card-identity">
          <span
            className="tracking-board-card-class-icon"
            style={{ color: classConfig.color }}
            aria-hidden="true"
          >
            {classConfig.icon}
          </span>
          <span className="tracking-board-card-name">{agent.name}</span>
        </div>

        <button
          type="button"
          className="tracking-board-card-clear"
          onClick={(event) => {
            event.stopPropagation();
            void onClearStatus(agent);
          }}
          disabled={isClearing}
          title="Clear tracking status"
          aria-label="Clear tracking status"
        >
          ×
        </button>
      </div>

      {agent.taskLabel && (
        <div className="tracking-board-card-task" title={agent.taskLabel}>
          {agent.taskLabel}
        </div>
      )}

      <div className="tracking-board-card-detail">
        {agent.trackingStatusDetail || agent.currentTask || 'No detail provided'}
      </div>

      <div className="tracking-board-card-footer">
        <span className="tracking-board-card-class">{agent.class}</span>
        <span className="tracking-board-card-time">{timeLabel}</span>
      </div>
    </article>
  );
}
