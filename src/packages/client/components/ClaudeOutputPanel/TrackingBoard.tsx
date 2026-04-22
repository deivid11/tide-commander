import React, { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent, AgentTrackingStatus } from '../../../shared/types';
import { useAgentsByTrackingStatus, useAgentsWithUnseenOutput, useAreas, useCustomAgentClassesArray, useAgentCompacting, store } from '../../store';
import { getClassConfig } from '../../utils/classConfig';
import { formatIdleTime } from '../../utils/formatting';
import { apiUrl, authFetch } from '../../utils/storage';
import { useWorkspaceFilter, isAgentVisibleInWorkspace } from '../WorkspaceSwitcher';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';
import { useTwoClickConfirm } from '../../hooks';

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

type AgentWithArea = {
  agent: Agent;
  areaName: string | null;
  areaColor: string | null;
};

const TRACKING_COLUMNS: TrackingColumn[] = [
  { key: 'writing', title: 'Writing', emptyLabel: 'No agents', toneClass: 'writing' },
  { key: 'working', title: 'Working', emptyLabel: 'No agents', toneClass: 'working' },
  { key: 'waiting-subordinates', title: 'Waiting Subordinates', emptyLabel: 'No agents', toneClass: 'waiting-subordinates' },
  { key: 'need-review', title: 'Need Review', emptyLabel: 'No agents', toneClass: 'need-review' },
  { key: 'blocked', title: 'Blocked', emptyLabel: 'No agents', toneClass: 'blocked' },
  { key: 'can-clear-context', title: 'Can Clear Context', emptyLabel: 'No agents', toneClass: 'can-clear-context' },
];

export const TrackingBoard = memo(function TrackingBoard({ activeAgentId, onSelectAgent }: TrackingBoardProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [activeWorkspace] = useWorkspaceFilter();
  const groupedAgents = useAgentsByTrackingStatus();
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();
  const areas = useAreas();
  const [clearingAgentIds, setClearingAgentIds] = useState<Set<string>>(new Set());
  const { isPending: isConfirmPending, arm: armConfirm, cancel: clearConfirm } = useTwoClickConfirm();
  const justNowLabel = t('common:time.justNow', { defaultValue: 'just now' });

  const columns = useMemo(() => {
    return TRACKING_COLUMNS.map((column) => {
      const visibleAgents: AgentWithArea[] = groupedAgents[column.key]
        .map<AgentWithArea & { areaId: string | null }>((agent) => {
          const area = store.getAreaForAgent(agent.id);
          return {
            agent,
            areaName: area?.name ?? null,
            areaColor: area?.color ?? null,
            areaId: area?.id ?? null,
          };
        })
        .filter(({ areaId }) => activeWorkspace ? isAgentVisibleInWorkspace(areaId) : true)
        .sort((a, b) => (b.agent.trackingStatusTimestamp || 0) - (a.agent.trackingStatusTimestamp || 0))
        .map(({ agent, areaName, areaColor }) => ({ agent, areaName, areaColor }));

      return { ...column, agents: visibleAgents };
    });
    // `areas` is a dep (not used directly) so assignments re-resolve when areas change.
  }, [activeWorkspace, groupedAgents, areas]);

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
            {column.agents.length > 0 && (column.key === 'need-review' || column.key === 'can-clear-context') && (() => {
              const confirmId = `column-ctx:${column.key}`;
              const isPending = isConfirmPending(confirmId);
              const isClearing = clearingContextColumnKey === column.key;
              return (
                <button
                  type="button"
                  className={`tracking-board-column-action tracking-board-column-action--context-bulk${isPending ? ' confirm-pending' : ''}`}
                  onClick={() => {
                    if (isClearing) return;
                    if (isPending) {
                      clearConfirm();
                      void handleClearContextColumn(column.key, column.agents.map((entry) => entry.agent));
                    } else {
                      armConfirm(confirmId);
                    }
                  }}
                  disabled={isClearing}
                  title={
                    isPending
                      ? 'Click again to confirm'
                      : `Clear context for all ${column.agents.length} agent${column.agents.length === 1 ? '' : 's'}`
                  }
                  aria-label="Clear context for all agents in this column"
                >
                  {isClearing
                    ? 'Clearing…'
                    : isPending
                      ? 'Confirm?'
                      : <><Icon name="clear" size={12} /> Ctx ({column.agents.length})</>}
                </button>
              );
            })()}
            {column.agents.length > 0 && (() => {
              const isClearing = clearingColumnKey === column.key;
              return (
                <button
                  type="button"
                  className="tracking-board-column-action"
                  onClick={() => {
                    if (isClearing) return;
                    void handleClearColumn(column.key, column.agents.map((entry) => entry.agent));
                  }}
                  disabled={isClearing}
                  title="Clear status for all agents in this column"
                >
                  {isClearing ? 'Clearing...' : 'Clear all'}
                </button>
              );
            })()}
            <span className="tracking-board-column-count">{column.agents.length}</span>
          </header>

          <div className="tracking-board-column-body">
            {column.agents.length === 0 ? (
              <div className="tracking-board-empty">{column.emptyLabel}</div>
            ) : (
              column.agents.map(({ agent, areaName, areaColor }) => (
                <TrackingBoardCard
                  key={agent.id}
                  agent={agent}
                  areaName={areaName}
                  areaColor={areaColor}
                  isActive={agent.id === activeAgentId}
                  isClearing={clearingAgentIds.has(agent.id)}
                  hasPendingRead={agentsWithUnseenOutput.has(agent.id)}
                  showClearContext={column.key === 'need-review' || column.key === 'blocked' || column.key === 'can-clear-context'}
                  isClearContextConfirming={isConfirmPending(`agent-ctx:${agent.id}`)}
                  onSelectAgent={onSelectAgent}
                  onClearStatus={handleClearStatus}
                  onClearContext={handleClearContextAgent}
                  onArmClearContext={armConfirm}
                  onCancelClearContextConfirm={clearConfirm}
                  timeLabel={agent.trackingStatusTimestamp ? formatIdleTime(agent.trackingStatusTimestamp) : justNowLabel}
                />
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
});

interface TrackingBoardCardProps {
  agent: Agent;
  areaName: string | null;
  areaColor: string | null;
  isActive: boolean;
  isClearing: boolean;
  hasPendingRead: boolean;
  showClearContext: boolean;
  isClearContextConfirming: boolean;
  onSelectAgent: (agentId: string) => void;
  onClearStatus: (agent: Agent) => void;
  onClearContext: (agent: Agent) => void;
  onArmClearContext: (confirmId: string) => void;
  onCancelClearContextConfirm: () => void;
  timeLabel: string;
}

const TrackingBoardCard = memo(function TrackingBoardCard({
  agent,
  areaName,
  areaColor,
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
  const isCompacting = useAgentCompacting(agent.id);
  const hasCustomIcon = !!classConfig.iconPath;

  return (
    <article
      className={`tracking-board-card${isActive ? ' active' : ''}${hasPendingRead ? ' unread' : ''}${isCompacting ? ' compacting' : ''}`}
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
          <span className="tracking-board-card-name">
            {agent.name}
            {areaName && (
              <span
                className="tracking-board-card-area"
                title={areaName}
                style={areaColor ? {
                  color: areaColor,
                  borderColor: `color-mix(in srgb, ${areaColor} 55%, transparent)`,
                  background: `color-mix(in srgb, ${areaColor} 18%, transparent)`,
                } : undefined}
              >
                {areaName}
              </span>
            )}
          </span>
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
                  onArmClearContext(`agent-ctx:${agent.id}`);
                }
              }}
              disabled={isClearing}
              title={isClearContextConfirming ? 'Click again to confirm' : `Clear context for ${agent.name}`}
              aria-label={`Clear context for ${agent.name}`}
            >
              {isClearContextConfirming ? '?' : <Icon name="clear" size={12} />}
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
          {agent.trackingStatus === 'writing' && (
            <span className="tracking-board-typing" aria-label="Writing">
              <span className="tracking-board-typing-dot" />
              <span className="tracking-board-typing-dot" />
              <span className="tracking-board-typing-dot" />
            </span>
          )}
          {agent.trackingStatusDetail || agent.currentTask || 'No detail provided'}
        </div>
      </div>
    </article>
  );
});
