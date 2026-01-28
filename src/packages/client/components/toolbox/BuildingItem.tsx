import React from 'react';
import type { Building } from '../../../shared/types';
import { BUILDING_TYPES } from '../../../shared/types';
import { BUILDING_STATUS_COLORS } from '../../utils/colors';

interface BuildingItemProps {
  building: Building;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
}

export function BuildingItem({ building, isSelected, onClick, onEdit }: BuildingItemProps) {
  const typeInfo = BUILDING_TYPES[building.type];

  // Get auto-detected ports from PM2 status polling
  const displayPorts = building.pm2Status?.ports || [];

  const handlePortClick = (e: React.MouseEvent, port: number) => {
    e.stopPropagation();
    window.open(`http://localhost:${port}`, '_blank');
  };

  return (
    <div className={`building-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div
        className="building-status-dot"
        style={{ backgroundColor: BUILDING_STATUS_COLORS[building.status] }}
        title={building.status}
      />
      <div className="building-icon">{typeInfo.icon}</div>
      <div className="building-info">
        <div className="building-name">{building.name}</div>
        <div className="building-meta">
          {building.type}
          {displayPorts.length > 0 && (
            <span className="building-ports">
              {displayPorts.map(port => (
                <a
                  key={port}
                  href={`http://localhost:${port}`}
                  className="building-port-link"
                  onClick={(e) => handlePortClick(e, port)}
                  title={`Open :${port}`}
                >
                  :{port}
                </a>
              ))}
            </span>
          )}
        </div>
      </div>
      <button
        className="building-edit-btn"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Edit building"
      >
        ⚙
      </button>
    </div>
  );
}
