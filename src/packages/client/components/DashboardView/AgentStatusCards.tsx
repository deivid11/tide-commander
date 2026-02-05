import React, { useMemo, useCallback } from 'react';
import { Agent } from '@packages/shared/types';
import { AgentCardData, DashboardFilters } from './types';
import {
  buildAgentCardData,
  getStatusColor,
  getAgentClassIcon,
  formatDuration,
  filterAgents,
  getTaskProgress,
} from './utils';
import styles from './dashboard-view.module.scss';

interface AgentStatusCardsProps {
  agents: Map<string, Agent>;
  filters: DashboardFilters;
  selectedAgentIds: Set<string>;
  onSelectAgent: (agentId: string) => void;
  onFocusAgent?: (agentId: string) => void;
  onKillAgent?: (agentId: string) => void;
}

/**
 * Agent status card for individual agent display
 */
const AgentCard = React.memo(
  ({
    cardData,
    isSelected,
    onSelect,
    onFocus,
    onKill,
  }: {
    cardData: AgentCardData;
    isSelected: boolean;
    onSelect: () => void;
    onFocus?: () => void;
    onKill?: () => void;
  }) => {
    const statusColor = getStatusColor(cardData.agent.status);
    const icon = getAgentClassIcon(cardData.agent.class);

    return (
      <div
        className={`${styles['dashboard-card']} ${styles[`dashboard-card--status-${statusColor}`]} ${
          isSelected ? styles['dashboard-card--selected'] : ''
        }`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onSelect();
          }
        }}
      >
        {/* Card Header */}
        <div className={styles['dashboard-card__header']}>
          <div className={styles['dashboard-card__title-section']}>
            <span className={styles['dashboard-card__icon']}>{icon}</span>
            <div className={styles['dashboard-card__title-info']}>
              <h3 className={styles['dashboard-card__title']}>{cardData.agent.name}</h3>
              <p className={styles['dashboard-card__subtitle']}>
                {cardData.agent.class} • ID: {cardData.agent.id.slice(0, 8)}
              </p>
            </div>
          </div>
          <div className={styles['dashboard-card__status-badge']}>
            <span
              className={`${styles['dashboard-card__status-dot']} ${styles[`dashboard-card__status-dot--${statusColor}`]}`}
            />
            <span className={styles['dashboard-card__status-text']}>{cardData.agent.status}</span>
          </div>
        </div>

        {/* Card Body */}
        <div className={styles['dashboard-card__body']}>
          {/* Task Progress */}
          {cardData.isWorking && (
            <div className={styles['dashboard-card__section']}>
              <div className={styles['dashboard-card__progress-container']}>
                <label className={styles['dashboard-card__label']}>Task Progress</label>
                <div className={styles['dashboard-card__progress-bar']}>
                  <div
                    className={styles['dashboard-card__progress-fill']}
                    style={{ width: `${cardData.taskProgress}%` }}
                  />
                </div>
                <span className={styles['dashboard-card__progress-text']}>
                  {cardData.taskProgress}%
                </span>
              </div>
              {cardData.currentTaskDescription && (
                <p className={styles['dashboard-card__task-description']}>
                  {cardData.currentTaskDescription}
                </p>
              )}
            </div>
          )}

          {/* Agent Stats */}
          <div className={styles['dashboard-card__stats']}>
            <div className={styles['dashboard-card__stat']}>
              <span className={styles['dashboard-card__stat-label']}>Status</span>
              <span className={styles['dashboard-card__stat-value']}>
                {cardData.agent.status}
              </span>
            </div>
            {cardData.subordinateCount > 0 && (
              <div className={styles['dashboard-card__stat']}>
                <span className={styles['dashboard-card__stat-label']}>Subordinates</span>
                <span className={styles['dashboard-card__stat-value']}>
                  {cardData.subordinateActive}/{cardData.subordinateCount}
                </span>
              </div>
            )}
            {cardData.agent.sessionId && (
              <div className={styles['dashboard-card__stat']}>
                <span className={styles['dashboard-card__stat-label']}>Session</span>
                <span className={styles['dashboard-card__stat-value']}>
                  {cardData.agent.sessionId.slice(0, 8)}
                </span>
              </div>
            )}
          </div>

          {/* Error Message */}
          {cardData.hasError && (
            <div className={styles['dashboard-card__error-message']}>
              ⚠️ Agent encountered an error
            </div>
          )}
        </div>

        {/* Card Footer - Actions */}
        <div className={styles['dashboard-card__footer']}>
          {onFocus && (
            <button
              className={styles['dashboard-card__action-btn']}
              onClick={(e) => {
                e.stopPropagation();
                onFocus();
              }}
              title="Focus agent in 3D view"
            >
              🎯 Focus
            </button>
          )}
          {onKill && (
            <button
              className={`${styles['dashboard-card__action-btn']} ${styles['dashboard-card__action-btn--danger']}`}
              onClick={(e) => {
                e.stopPropagation();
                onKill();
              }}
              title="Kill agent"
            >
              ❌ Kill
            </button>
          )}
        </div>
      </div>
    );
  }
);

AgentCard.displayName = 'AgentCard';

/**
 * Main Agent Status Cards component - Memoized for performance
 */
const AgentStatusCardsComponent: React.FC<AgentStatusCardsProps> = ({
  agents,
  filters,
  selectedAgentIds,
  onSelectAgent,
  onFocusAgent,
  onKillAgent,
}) => {
  // Memoize handlers to prevent unnecessary re-renders
  const handleSelectAgent = useCallback((agentId: string) => {
    onSelectAgent(agentId);
  }, [onSelectAgent]);

  const handleFocusAgent = useCallback((agentId: string) => {
    onFocusAgent?.(agentId);
  }, [onFocusAgent]);

  const handleKillAgent = useCallback((agentId: string) => {
    onKillAgent?.(agentId);
  }, [onKillAgent]);

  // Build and filter agent cards
  const agentCards = useMemo(() => {
    const agentArray = Array.from(agents.values());
    const filtered = filterAgents(agentArray, filters);

    return filtered
      .sort((a, b) => {
        // Sort by: errors first, then working, then idle
        const statusOrder: Record<string, number> = {
          error: 0,
          offline: 0,
          orphaned: 0,
          working: 1,
          waiting: 1,
          waiting_permission: 1,
          idle: 2,
        };
        const orderA = statusOrder[a.status] ?? 3;
        const orderB = statusOrder[b.status] ?? 3;

        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      })
      .map((agent) => ({
        agent,
        cardData: buildAgentCardData(
          agent,
          agents,
          getTaskProgress(agent),
          `Working on task...`  // In real implementation, get actual task description
        ),
      }));
  }, [agents, filters]);

  return (
    <div className={styles['agent-status-cards']}>
      <div className={styles['agent-status-cards__header']}>
        <h2 className={styles['agent-status-cards__title']}>
          Agent Status ({agentCards.length} {agentCards.length === 1 ? 'agent' : 'agents'})
        </h2>
      </div>

      {agentCards.length === 0 ? (
        <div className={styles['agent-status-cards__empty']}>
          <p>No agents match the current filters</p>
        </div>
      ) : (
        <div className={styles['agent-status-cards__grid']}>
          {agentCards.map(({ agent, cardData }) => (
            <AgentCard
              key={agent.id}
              cardData={cardData}
              isSelected={selectedAgentIds.has(agent.id)}
              onSelect={() => handleSelectAgent(agent.id)}
              onFocus={onFocusAgent ? () => handleFocusAgent(agent.id) : undefined}
              onKill={onKillAgent ? () => handleKillAgent(agent.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const AgentStatusCards = React.memo(AgentStatusCardsComponent);
AgentStatusCards.displayName = 'AgentStatusCards';
