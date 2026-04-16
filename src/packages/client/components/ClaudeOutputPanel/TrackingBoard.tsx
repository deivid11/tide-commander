import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent, AgentTrackingStatus } from '../../../shared/types';
import { useAgentsByTrackingStatus, useAgentsWithUnseenOutput, useCustomAgentClassesArray, store } from '../../store';
import { getClassConfig } from '../../utils/classConfig';
import { formatIdleTime } from '../../utils/formatting';
import { apiUrl, authFetch } from '../../utils/storage';
import { useWorkspaceFilter, isAgentVisibleInWorkspace } from '../WorkspaceSwitcher';
import { AgentIcon } from '../AgentIcon';

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
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();
  const [clearingAgentIds, setClearingAgentIds] = useState<Set<string>>(new Set());
  const [pendingConfirmId, setPendingConfirmId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  const armConfirm = useCallback((id: string) => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
    }
    setPendingConfirmId(id);
    confirmTimerRef.current = setTimeout(() => {
      setPendingConfirmId((current) => (current === id ? null : current));
      confirmTimerRef.current = null;
    }, 3000);
  }, []);

  const clearConfirm = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setPendingConfirmId(null);
  }, []);

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
  const [clearingContextColumnKey, setClearingContextColumnKey] = useState<string | null>(null);

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

  const handleClearContextColumn = useCallback(async (columnKey: AgentTrackingStatus, agents: Agent[]) => {
    if (agents.length === 0) return;

    setClearingContextColumnKey(columnKey);
    setClearingAgentIds((prev) => {
      const next = new Set(prev);
      agents.forEach((agent) => next.add(agent.id));
      return next;
    });

    try {
      for (const agent of agents) {
        store.clearContext(agent.id);
        await clearTrackingStatus(agent.id);
      }
    } finally {
      setClearingContextColumnKey(null);
      setClearingAgentIds((prev) => {
        const next = new Set(prev);
        agents.forEach((agent) => next.delete(agent.id));
        return next;
      });
    }
  }, [clearTrackingStatus]);

  const handleClearContextAgent = useCallback(async (agent: Agent) => {
    setClearingAgentIds((prev) => new Set(prev).add(agent.id));

    try {
      store.clearContext(agent.id);
      await clearTrackingStatus(agent.id);
    } finally {
      setClearingAgentIds((prev) => {
        const next = new Set(prev);
        next.delete(agent.id);
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
            {column.agents.length > 0 && column.key === 'need-review' && (() => {
              const confirmId = `column-ctx:${column.key}`;
              const isPending = pendingConfirmId === confirmId;
              const isClearing = clearingContextColumnKey === column.key;
              return (
                <button
                  type="button"
                  className={`tracking-board-column-action tracking-board-column-action--context-bulk${isPending ? ' confirm-pending' : ''}`}
                  onClick={() => {
                    if (isClearing) return;
                    if (isPending) {
                      clearConfirm();
                      void handleClearContextColumn(column.key, column.agents);
                    } else {
                      armConfirm(confirmId);
                    }
                  }}
                  disabled={isClearing}
                  title={
                    isPending
                      ? 'Click again to confirm'
                      : `Clear context for all ${column.agents.length} agent${column.agents.length === 1 ? '' : 's'} in Need Review`
                  }
                  aria-label="Clear context for all agents in need review"
                >
                  {isClearing
                    ? 'Clearing…'
                    : isPending
                      ? 'Confirm?'
                      : `🧹 Ctx (${column.agents.length})`}
                </button>
              );
            })()}
            {column.agents.length > 0 && (() => {
              const isCanClearCtx = column.key === 'can-clear-context';
              const confirmId = `column:${column.key}`;
              const isPending = isCanClearCtx && pendingConfirmId === confirmId;
              const isClearing = clearingColumnKey === column.key;
              return (
                <button
                  type="button"
                  className={`tracking-board-column-action${isCanClearCtx ? ' tracking-board-column-action--context' : ''}${isPending ? ' confirm-pending' : ''}`}
                  onClick={() => {
                    if (isClearing) return;
                    if (isCanClearCtx) {
                      if (isPending) {
                        clearConfirm();
                        void handleClearColumn(column.key, column.agents);
                      } else {
                        armConfirm(confirmId);
                      }
                    } else {
                      void handleClearColumn(column.key, column.agents);
                    }
                  }}
                  disabled={isClearing}
                  title={
                    isPending
                      ? 'Click again to confirm'
                      : isCanClearCtx
                        ? 'Clear context and status for all agents'
                        : 'Clear status for all agents in this column'
                  }
                >
                  {isClearing
                    ? 'Clearing...'
                    : isPending
                      ? 'Confirm?'
                      : isCanClearCtx
                        ? `Clear All Context (${column.agents.length})`
                        : 'Clear all'}
                </button>
              );
            })()}
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
                  hasPendingRead={agentsWithUnseenOutput.has(agent.id)}
                  showClearContext={column.key === 'need-review' || column.key === 'blocked' || column.key === 'can-clear-context'}
                  isClearContextConfirming={pendingConfirmId === `agent-ctx:${agent.id}`}
                  onSelectAgent={onSelectAgent}
                  onClearStatus={handleClearStatus}
                  onClearContext={handleClearContextAgent}
                  onArmClearContext={() => armConfirm(`agent-ctx:${agent.id}`)}
                  onCancelClearContextConfirm={clearConfirm}
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
  hasPendingRead: boolean;
  showClearContext: boolean;
  isClearContextConfirming: boolean;
  onSelectAgent: (agentId: string) => void;
  onClearStatus: (agent: Agent) => void;
  onClearContext: (agent: Agent) => void;
  onArmClearContext: () => void;
  onCancelClearContextConfirm: () => void;
  timeLabel: string;
}

function TrackingBoardCard({
  agent,
  isActive,
  isClearing,
  hasPendingRead,
  showClearContext,
  isClearContextConfirming,
  onSelectAgent,
  onClearStatus,
  onClearContext,
  onArmClearContext,
  onCancelClearContextConfirm,
  timeLabel,
}: TrackingBoardCardProps) {
  const customClasses = useCustomAgentClassesArray();
  const classConfig = getClassConfig(agent.class, customClasses);
  const hasCustomIcon = !!classConfig.iconPath;

  return (
    <article
      className={`tracking-board-card${isActive ? ' active' : ''}${hasPendingRead ? ' unread' : ''}`}
      onClick={() => onSelectAgent(agent.id)}
      title={agent.trackingStatusDetail || agent.taskLabel || agent.name}
    >
      <div
        className={`tracking-board-card-avatar${hasCustomIcon ? '' : ' emoji'}`}
        style={hasCustomIcon ? undefined : { backgroundColor: classConfig.color ? `${classConfig.color}22` : undefined }}
      >
        <AgentIcon agent={agent} size="100%" customClasses={customClasses} />
      </div>

      <div className="tracking-board-card-content">
        <div className="tracking-board-card-header">
          <span className="tracking-board-card-name">{agent.name}</span>
          {hasPendingRead && (
            <span className="tracking-board-card-pending-read" title="Pending read" aria-label="Unread output">!</span>
          )}
          <span className="tracking-board-card-time">{timeLabel}</span>
          {showClearContext && (
            <button
              type="button"
              className={`tracking-board-card-clear-context${isClearContextConfirming ? ' confirm-pending' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                if (isClearing) return;
                if (isClearContextConfirming) {
                  onCancelClearContextConfirm();
                  void onClearContext(agent);
                } else {
                  onArmClearContext();
                }
              }}
              disabled={isClearing}
              title={isClearContextConfirming ? 'Click again to confirm' : `Clear context for ${agent.name}`}
              aria-label={`Clear context for ${agent.name}`}
            >
              {isClearContextConfirming ? '?' : '🧹'}
            </button>
          )}
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
      </div>
    </article>
  );
}
