import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Building } from '@shared/types';
import { getStatusColor, getBuildingTypeIcon } from './utils';

interface BuildingPillsProps {
  buildings: Map<string, Building>;
  onSelectBuilding?: (buildingId: string) => void;
}

export const BuildingPills: React.FC<BuildingPillsProps> = ({
  buildings,
  onSelectBuilding,
}) => {
  const { t } = useTranslation(['dashboard']);
  const buildingArray = useMemo(
    () => Array.from(buildings.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [buildings],
  );

  return (
    <div className="dashboard-view__buildings">
      <div className="dashboard-view__buildings-header">
        <span className="dashboard-view__buildings-title">{t('buildings.title')}</span>
        <span className="dashboard-view__buildings-count">{buildingArray.length}</span>
      </div>
      <div className="dashboard-view__buildings-row">
        {buildingArray.map((building) => {
          const statusColor = getStatusColor(building.status);
          const icon = getBuildingTypeIcon(building.type);
          return (
            <button
              key={building.id}
              className={`dash-pill dash-pill--${statusColor}`}
              onClick={() => onSelectBuilding?.(building.id)}
              title={`${building.name} (${building.type}) - ${building.status}`}
            >
              <span className="dash-pill__icon">{icon}</span>
              <span className="dash-pill__name">{building.name}</span>
              <span className={`dash-pill__dot dash-pill__dot--${statusColor}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
};

BuildingPills.displayName = 'BuildingPills';
