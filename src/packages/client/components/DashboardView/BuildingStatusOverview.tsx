import React, { useMemo } from 'react';
import { Building } from '@packages/shared/types';
import { BuildingCardData, DashboardFilters } from './types';
import {
  buildBuildingCardData,
  getStatusColor,
  getBuildingTypeIcon,
  formatTime,
  filterBuildings,
} from './utils';
import styles from './dashboard-view.module.scss';

interface BuildingStatusOverviewProps {
  buildings: Map<string, Building>;
  filters: DashboardFilters;
  selectedBuildingIds: Set<string>;
  onSelectBuilding: (buildingId: string) => void;
  onOpenBuildingDetails?: (buildingId: string) => void;
}

/**
 * Individual building card
 */
const BuildingCard = React.memo(
  ({
    cardData,
    isSelected,
    onSelect,
    onOpenDetails,
  }: {
    cardData: BuildingCardData;
    isSelected: boolean;
    onSelect: () => void;
    onOpenDetails?: () => void;
  }) => {
    const statusColor = getStatusColor(cardData.building.status);
    const icon = getBuildingTypeIcon(cardData.building.type);

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
              <h3 className={styles['dashboard-card__title']}>{cardData.building.name}</h3>
              <p className={styles['dashboard-card__subtitle']}>
                {cardData.building.type} • ID: {cardData.building.id.slice(0, 8)}
              </p>
            </div>
          </div>
          <div className={styles['dashboard-card__status-badge']}>
            <span
              className={`${styles['dashboard-card__status-dot']} ${styles[`dashboard-card__status-dot--${statusColor}`]}`}
            />
            <span className={styles['dashboard-card__status-text']}>{cardData.building.status}</span>
          </div>
        </div>

        {/* Card Body */}
        <div className={styles['dashboard-card__body']}>
          {/* Building Stats */}
          <div className={styles['dashboard-card__stats']}>
            <div className={styles['dashboard-card__stat']}>
              <span className={styles['dashboard-card__stat-label']}>Status</span>
              <span className={styles['dashboard-card__stat-value']}>
                {cardData.building.status}
              </span>
            </div>

            {/* Health Check */}
            {cardData.lastHealthCheck && (
              <div className={styles['dashboard-card__stat']}>
                <span className={styles['dashboard-card__stat-label']}>Last Check</span>
                <span className={styles['dashboard-card__stat-value']}>
                  {formatTime(cardData.lastHealthCheck)}
                </span>
              </div>
            )}

            {/* Subordinate Count */}
            {cardData.subordinateCount > 0 && (
              <div className={styles['dashboard-card__stat']}>
                <span className={styles['dashboard-card__stat-label']}>Subordinates</span>
                <span className={styles['dashboard-card__stat-value']}>
                  {cardData.subordinateHealthy}/{cardData.subordinateCount}
                </span>
              </div>
            )}

            {/* Building Type Specific Info */}
            {cardData.building.type === 'server' && cardData.building.pm2?.enabled && (
              <div className={styles['dashboard-card__stat']}>
                <span className={styles['dashboard-card__stat-label']}>PM2</span>
                <span className={styles['dashboard-card__stat-value']}>
                  {cardData.building.pm2.name || 'Enabled'}
                </span>
              </div>
            )}

            {cardData.building.type === 'docker' && (
              <div className={styles['dashboard-card__stat']}>
                <span className={styles['dashboard-card__stat-label']}>Container</span>
                <span className={styles['dashboard-card__stat-value']}>
                  {cardData.building.docker?.containerName ? 'Active' : 'Configured'}
                </span>
              </div>
            )}

            {cardData.building.type === 'folder' && (
              <div className={styles['dashboard-card__stat']}>
                <span className={styles['dashboard-card__stat-label']}>Path</span>
                <span className={styles['dashboard-card__stat-value']}>
                  {cardData.building.folderPath?.split('/').pop() || 'N/A'}
                </span>
              </div>
            )}
          </div>

          {/* Error Message */}
          {cardData.hasError && cardData.building.lastError && (
            <div className={styles['dashboard-card__error-message']}>
              ⚠️ {cardData.building.lastError}
            </div>
          )}
        </div>

        {/* Card Footer - Actions */}
        {onOpenDetails && (
          <div className={styles['dashboard-card__footer']}>
            <button
              className={styles['dashboard-card__action-btn']}
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetails();
              }}
              title="View building details"
            >
              📊 Details
            </button>
          </div>
        )}
      </div>
    );
  }
);

BuildingCard.displayName = 'BuildingCard';

/**
 * Main Building Status Overview component
 */
export const BuildingStatusOverview: React.FC<BuildingStatusOverviewProps> = ({
  buildings,
  filters,
  selectedBuildingIds,
  onSelectBuilding,
  onOpenBuildingDetails,
}) => {
  // Build and filter building cards
  const buildingCards = useMemo(() => {
    const buildingArray = Array.from(buildings.values());
    const filtered = filterBuildings(buildingArray, filters);

    return filtered
      .sort((a, b) => {
        // Sort by: errors first, then starting/stopping, then running
        const statusOrder: Record<string, number> = {
          error: 0,
          stopped: 0,
          starting: 1,
          stopping: 1,
          running: 2,
        };
        const orderA = statusOrder[a.status] ?? 3;
        const orderB = statusOrder[b.status] ?? 3;

        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      })
      .map((building) => ({
        building,
        cardData: buildBuildingCardData(building, buildings),
      }));
  }, [buildings, filters]);

  // Group buildings by type
  const groupedBuildings = useMemo(() => {
    const groups: Record<string, typeof buildingCards> = {};

    buildingCards.forEach((item) => {
      const type = item.building.type;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(item);
    });

    return groups;
  }, [buildingCards]);

  const buildingTypes = Object.keys(groupedBuildings).sort();

  return (
    <div className={styles['building-status-overview']}>
      <div className={styles['building-status-overview__header']}>
        <h2 className={styles['building-status-overview__title']}>
          Building Status ({buildingCards.length} {buildingCards.length === 1 ? 'building' : 'buildings'})
        </h2>
      </div>

      {buildingCards.length === 0 ? (
        <div className={styles['building-status-overview__empty']}>
          <p>No buildings match the current filters</p>
        </div>
      ) : (
        <>
          {buildingTypes.map((buildingType) => (
            <div key={buildingType} className={styles['building-status-overview__section']}>
              <h3 className={styles['building-status-overview__section-title']}>
                {buildingType.charAt(0).toUpperCase() + buildingType.slice(1)}
                <span className={styles['building-status-overview__count']}>
                  {groupedBuildings[buildingType].length}
                </span>
              </h3>
              <div className={styles['building-status-overview__grid']}>
                {groupedBuildings[buildingType].map(({ building, cardData }) => (
                  <BuildingCard
                    key={building.id}
                    cardData={cardData}
                    isSelected={selectedBuildingIds.has(building.id)}
                    onSelect={() => onSelectBuilding(building.id)}
                    onOpenDetails={
                      onOpenBuildingDetails ? () => onOpenBuildingDetails(building.id) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

BuildingStatusOverview.displayName = 'BuildingStatusOverview';
