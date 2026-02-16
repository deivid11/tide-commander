/**
 * MultiAgentPanel - View for multiple selected agents
 * Shows aggregate stats and list of selected agents
 */

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useCustomAgentClassesArray } from '../../store';
import { formatNumber } from '../../utils/formatting';
import { getClassConfig } from '../../utils/classConfig';
import type { Agent } from '../../../shared/types';
import type { MultiAgentPanelProps } from './types';

// ============================================================================
// MultiAgentPanel Component
// ============================================================================

export const MultiAgentPanel = memo(function MultiAgentPanel({ agents }: MultiAgentPanelProps) {
  const { t } = useTranslation(['common']);
  const customClasses = useCustomAgentClassesArray();
  const totalTokens = agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const workingCount = agents.filter((a) => a.status === 'working').length;

  return (
    <div className="unit-panel">
      <div className="unit-panel-header">
        <div className="unit-class-icon" style={{ background: '#4a9eff20' }}>
          👥
        </div>
        <div>
          <div className="unit-name">{t('multiAgent.agentsSelected', { count: agents.length })}</div>
          <div className="unit-status">{t('multiAgent.groupSelection')}</div>
        </div>
      </div>

      <div className="unit-stats">
        <div className="unit-stat">
          <div className="unit-stat-label">{t('multiAgent.totalTokens')}</div>
          <div className="unit-stat-value">{formatNumber(totalTokens)}</div>
        </div>
        <div className="unit-stat">
          <div className="unit-stat-label">{t('multiAgent.working')}</div>
          <div className="unit-stat-value">{workingCount}</div>
        </div>
      </div>

      <div style={{ padding: '8px 0', maxHeight: 100, overflowY: 'auto' }}>
        {agents.map((a) => (
          <MultiAgentListItem key={a.id} agent={a} customClasses={customClasses} />
        ))}
      </div>

      <div className="unit-actions">
        <button className="unit-action-btn" onClick={() => store.deselectAll()}>
          {t('buttons.deselectAll')}
        </button>
      </div>
    </div>
  );
});

// ============================================================================
// MultiAgentListItem Component
// ============================================================================

interface MultiAgentListItemProps {
  agent: Agent;
  customClasses: ReturnType<typeof useCustomAgentClassesArray>;
}

const MultiAgentListItem = memo(function MultiAgentListItem({
  agent,
  customClasses,
}: MultiAgentListItemProps) {
  const cfg = getClassConfig(agent.class, customClasses);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 0',
        fontSize: 12,
      }}
    >
      <span>{cfg.icon}</span>
      <span style={{ flex: 1 }}>{agent.name}</span>
      <span style={{ color: 'var(--text-secondary)' }}>{agent.status}</span>
    </div>
  );
});

export { MultiAgentListItem };
