import React from 'react';
import type { DrawingArea } from '../../../shared/types';

interface AreaItemProps {
  area: DrawingArea;
  isSelected: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function AreaItem({ area, isSelected, onClick, onDelete }: AreaItemProps) {
  const agentCount = area.assignedAgentIds.length;
  const typeLabel = area.type === 'rectangle' ? 'Rect' : 'Circle';

  return (
    <div className={`area-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div className="area-color-dot" style={{ backgroundColor: area.color }} />
      <div className="area-info">
        <div className="area-name">{area.name}</div>
        <div className="area-meta">
          {typeLabel} {agentCount > 0 && `• ${agentCount} agent${agentCount > 1 ? 's' : ''}`}
        </div>
      </div>
      <button className="area-delete-btn" onClick={onDelete} title="Delete area">
        &times;
      </button>
    </div>
  );
}
