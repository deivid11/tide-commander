import React, { useState, useCallback } from 'react';
import { Agent, Building } from '@packages/shared/types';
import { TreeView } from './TreeView';
import { FilterOptions, StatusColor } from './types';
import styles from './sidebar-tree-view.module.scss';

interface SidebarTreeViewProps {
  agents: Map<string, Agent>;
  buildings: Map<string, Building>;
  selectedAgentIds: Set<string>;
  selectedBuildingIds: Set<string>;
  onSelectAgent: (agentId: string, multi: boolean) => void;
  onSelectBuilding: (buildingId: string, multi: boolean) => void;
  mode?: 'agents' | 'buildings' | 'both';
}

/**
 * Main sidebar tree view component with search and filter controls
 */
export const SidebarTreeView: React.FC<SidebarTreeViewProps> = ({
  agents,
  buildings,
  selectedAgentIds,
  selectedBuildingIds,
  onSelectAgent,
  onSelectBuilding,
  mode = 'both',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusColor | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<'agents' | 'buildings' | 'all'>('all');
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  const filters: FilterOptions = {
    searchQuery,
    statusFilter: statusFilter === 'all' ? undefined : statusFilter,
    typeFilter,
  };

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const handleStatusFilterChange = useCallback(
    (status: StatusColor | 'all') => {
      setStatusFilter(status);
    },
    []
  );

  const handleTypeFilterChange = useCallback(
    (type: 'agents' | 'buildings' | 'all') => {
      setTypeFilter(type);
    },
    []
  );

  const handleClearFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setTypeFilter('all');
  }, []);

  // Determine which mode to display based on typeFilter
  let displayMode = mode;
  if (typeFilter !== 'all') {
    displayMode = typeFilter as 'agents' | 'buildings';
  }

  const agentCount = agents.size;
  const buildingCount = buildings.size;

  return (
    <div className={styles['sidebar-tree-view']}>
      {/* Header */}
      <div className={styles['sidebar-tree-view__header']}>
        <h2 className={styles['sidebar-tree-view__title']}>Entities</h2>
        <button
          className={styles['sidebar-tree-view__filter-toggle']}
          onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
          aria-label="Toggle filters"
          title="Toggle filters"
        >
          ⚙️
        </button>
      </div>

      {/* Search Bar */}
      <div className={styles['sidebar-tree-view__search-container']}>
        <input
          type="text"
          className={styles['sidebar-tree-view__search-input']}
          placeholder="Search entities..."
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label="Search entities"
        />
        {searchQuery && (
          <button
            className={styles['sidebar-tree-view__search-clear']}
            onClick={handleClearSearch}
            aria-label="Clear search"
            tabIndex={-1}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter Panel */}
      {isFilterPanelOpen && (
        <div className={styles['sidebar-tree-view__filter-panel']}>
          {/* Status Filter */}
          <div className={styles['sidebar-tree-view__filter-group']}>
            <label className={styles['sidebar-tree-view__filter-label']}>
              Status:
            </label>
            <div className={styles['sidebar-tree-view__filter-buttons']}>
              {['all', 'healthy', 'working', 'error'].map((status) => (
                <button
                  key={status}
                  className={`${styles['sidebar-tree-view__filter-btn']} ${
                    statusFilter === status ? styles['sidebar-tree-view__filter-btn--active'] : ''
                  }`}
                  onClick={() =>
                    handleStatusFilterChange(status as StatusColor | 'all')
                  }
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Type Filter */}
          <div className={styles['sidebar-tree-view__filter-group']}>
            <label className={styles['sidebar-tree-view__filter-label']}>
              Type:
            </label>
            <div className={styles['sidebar-tree-view__filter-buttons']}>
              {['all', 'agents', 'buildings'].map((type) => (
                <button
                  key={type}
                  className={`${styles['sidebar-tree-view__filter-btn']} ${
                    typeFilter === type ? styles['sidebar-tree-view__filter-btn--active'] : ''
                  }`}
                  onClick={() =>
                    handleTypeFilterChange(type as 'agents' | 'buildings' | 'all')
                  }
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Clear Filters */}
          <button
            className={styles['sidebar-tree-view__clear-filters']}
            onClick={handleClearFilters}
          >
            Clear All Filters
          </button>
        </div>
      )}

      {/* Stats */}
      <div className={styles['sidebar-tree-view__stats']}>
        {(mode === 'both' || mode === 'agents') && (
          <div className={styles['sidebar-tree-view__stat']}>
            <span className={styles['sidebar-tree-view__stat-label']}>Agents:</span>
            <span className={styles['sidebar-tree-view__stat-value']}>{agentCount}</span>
          </div>
        )}
        {(mode === 'both' || mode === 'buildings') && (
          <div className={styles['sidebar-tree-view__stat']}>
            <span className={styles['sidebar-tree-view__stat-label']}>Buildings:</span>
            <span className={styles['sidebar-tree-view__stat-value']}>{buildingCount}</span>
          </div>
        )}
      </div>

      {/* Tree View */}
      <TreeView
        agents={agents}
        buildings={buildings}
        selectedAgentIds={selectedAgentIds}
        selectedBuildingIds={selectedBuildingIds}
        onSelectAgent={onSelectAgent}
        onSelectBuilding={onSelectBuilding}
        filters={filters}
        mode={displayMode}
      />
    </div>
  );
};

SidebarTreeView.displayName = 'SidebarTreeView';
