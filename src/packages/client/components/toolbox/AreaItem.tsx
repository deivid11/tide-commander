import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DrawingArea } from '../../../shared/types';

interface AreaItemProps {
  area: DrawingArea;
  isSelected: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function AreaItem({ area, isSelected, onClick, onDelete }: AreaItemProps) {
  const { t } = useTranslation(['config', 'common']);
  const agentCount = area.assignedAgentIds.length;
  const typeLabel = area.type === 'rectangle' ? t('config:areas.rect') : t('config:areas.circle');

  return (
    <div className={`area-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div className="area-color-dot" style={{ backgroundColor: area.color }} />
      <div className="area-info">
        <div className="area-name">{area.name}</div>
        <div className="area-meta">
          {typeLabel} {agentCount > 0 && `• ${agentCount} ${agentCount > 1 ? t('common:labels.agents').toLowerCase() : t('common:labels.agent').toLowerCase()}`}
        </div>
      </div>
      <button className="area-delete-btn" onClick={onDelete} title={t('config:areas.deleteArea')}>
        &times;
      </button>
    </div>
  );
}
