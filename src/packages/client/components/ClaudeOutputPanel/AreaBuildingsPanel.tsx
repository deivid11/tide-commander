/**
 * AreaBuildingsPanel - Shows buildings inside the selected agent's area.
 *
 * Displayed as a side panel inside the guake terminal, similar to GuakeGitPanel.
 * Matches buildings to the active agent's area by position.
 */

import React, { useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useBuildings, useAreas } from '../../store';
import { BUILDING_TYPES } from '../../../shared/building-types';
import type { Building, BuildingStatus } from '../../../shared/building-types';
import type { DrawingArea } from '../../../shared/types';
import { ContextMenu } from '../ContextMenu';
import type { ContextMenuAction } from '../ContextMenu';

interface AreaBuildingsPanelProps {
  agentId: string;
  onClose: () => void;
}

const STATUS_ICONS: Record<BuildingStatus, string> = {
  running: '🟢',
  stopped: '⚫',
  error: '🔴',
  unknown: '❓',
  starting: '🟡',
  stopping: '🟠',
};

interface BuildingContextMenuState {
  buildingId: string;
  position: { x: number; y: number };
}

export function AreaBuildingsPanel({ agentId, onClose }: AreaBuildingsPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const buildings = useBuildings();
  const areas = useAreas();
  const [contextMenu, setContextMenu] = useState<BuildingContextMenuState | null>(null);

  // Find the area for the active agent
  const agentArea: DrawingArea | null = useMemo(() => {
    return store.getAreaForAgent(agentId);
  }, [agentId, areas]);

  // Find all buildings whose positions fall within the agent's area
  const areaBuildings = useMemo((): Building[] => {
    if (!agentArea) return [];
    const result: Building[] = [];
    for (const building of buildings.values()) {
      if (store.isPositionInArea(building.position, agentArea)) {
        result.push(building);
      }
    }
    // Sort: running first, then by name
    result.sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }, [agentArea, buildings]);

  const handleBuildingClick = useCallback((buildingId: string) => {
    store.selectBuilding(buildingId);
    // Dispatch event so App.tsx can open the appropriate viewer (database panel, PM2 logs, etc.)
    window.dispatchEvent(new CustomEvent('tide:building-action', { detail: { buildingId } }));
  }, []);

  const handleCommand = useCallback((buildingId: string, command: 'start' | 'stop' | 'restart') => {
    store.sendBuildingCommand(buildingId, command);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, buildingId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ buildingId, position: { x: e.clientX, y: e.clientY } });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Compute a position inside the area for new buildings
  const getAreaPosition = useCallback((): { x: number; z: number } => {
    if (!agentArea) return { x: 0, z: 0 };
    // Place near center with a small random offset to avoid stacking
    const offset = () => (Math.random() - 0.5) * 2;
    return {
      x: agentArea.center.x + offset(),
      z: agentArea.center.z + offset(),
    };
  }, [agentArea]);

  const handleAddBuilding = useCallback(() => {
    if (!agentArea) return;
    const position = getAreaPosition();
    // Dispatch event to open building config modal in create mode with position
    window.dispatchEvent(new CustomEvent('tide:building-create', { detail: { position } }));
  }, [agentArea, getAreaPosition]);

  // Build context menu actions for a building
  const contextMenuActions = useMemo((): ContextMenuAction[] => {
    if (!contextMenu) return [];
    const building = store.getState().buildings.get(contextMenu.buildingId);
    if (!building) return [];

    const actions: ContextMenuAction[] = [];
    const isRunnable = building.type === 'server' || building.type === 'docker';
    const isRunning = building.status === 'running';
    const isBoss = building.type === 'boss';

    // Open / View action
    actions.push({
      id: 'open',
      label: building.type === 'database' ? 'Open Database' :
             building.type === 'folder' ? 'Open Folder' :
             building.type === 'boss' ? 'View Boss Logs' :
             (building.type === 'server' && building.pm2?.enabled) ? 'View PM2 Logs' :
             'Open',
      icon: building.type === 'database' ? '🗄️' :
            building.type === 'folder' ? '📁' :
            '👁️',
      onClick: () => handleBuildingClick(building.id),
    });

    // Start / Stop / Restart for runnable buildings
    if (isRunnable) {
      if (!isRunning) {
        actions.push({
          id: 'start',
          label: 'Start',
          icon: '▶',
          onClick: () => store.sendBuildingCommand(building.id, 'start'),
        });
      }
      if (isRunning) {
        actions.push({
          id: 'restart',
          label: 'Restart',
          icon: '🔄',
          onClick: () => store.sendBuildingCommand(building.id, 'restart'),
        });
        actions.push({
          id: 'stop',
          label: 'Stop',
          icon: '⏹',
          onClick: () => store.sendBuildingCommand(building.id, 'stop'),
        });
      }
    }

    // Boss building: start/stop all subordinates
    if (isBoss && building.subordinateBuildingIds && building.subordinateBuildingIds.length > 0) {
      actions.push({
        id: 'start-all',
        label: 'Start All Subordinates',
        icon: '🚀',
        onClick: () => {
          for (const subId of building.subordinateBuildingIds!) {
            store.sendBuildingCommand(subId, 'start');
          }
        },
      });
      actions.push({
        id: 'stop-all',
        label: 'Stop All Subordinates',
        icon: '⏸️',
        onClick: () => {
          for (const subId of building.subordinateBuildingIds!) {
            store.sendBuildingCommand(subId, 'stop');
          }
        },
      });
      actions.push({
        id: 'restart-all',
        label: 'Restart All Subordinates',
        icon: '♻️',
        onClick: () => {
          for (const subId of building.subordinateBuildingIds!) {
            store.sendBuildingCommand(subId, 'restart');
          }
        },
      });
    }

    // Health check
    if (isRunnable) {
      actions.push({
        id: 'health-check',
        label: 'Health Check',
        icon: '🩺',
        onClick: () => store.sendBuildingCommand(building.id, 'healthCheck'),
      });
    }

    // Divider before edit/delete
    actions.push({
      id: 'divider-edit',
      label: '',
      divider: true,
      onClick: () => {},
    });

    // Edit building
    actions.push({
      id: 'edit',
      label: 'Edit Building',
      icon: '✏️',
      onClick: () => {
        window.dispatchEvent(new CustomEvent('tide:building-edit', { detail: { buildingId: building.id } }));
      },
    });

    // Clone building (within the same area)
    actions.push({
      id: 'clone',
      label: 'Clone Building',
      icon: '📋',
      onClick: () => {
        const pos = getAreaPosition();
        store.createBuilding({
          name: `${building.name} (Copy)`,
          type: building.type,
          style: building.style,
          color: building.color,
          scale: building.scale,
          position: pos,
          cwd: building.cwd,
          folderPath: building.folderPath,
          commands: building.commands,
          pm2: building.pm2,
          docker: building.docker,
          database: building.database,
          urls: building.urls,
          subordinateBuildingIds: building.subordinateBuildingIds,
        });
      },
    });

    // Open URLs (if building has URLs)
    if (building.urls && building.urls.length > 0) {
      for (const link of building.urls) {
        actions.push({
          id: `url-${link.label}`,
          label: link.label,
          icon: '🔗',
          onClick: () => window.open(link.url, '_blank', 'noopener,noreferrer'),
        });
      }
    }

    // Divider before danger
    actions.push({
      id: 'divider-danger',
      label: '',
      divider: true,
      onClick: () => {},
    });

    // Delete building
    actions.push({
      id: 'delete',
      label: 'Delete Building',
      icon: '🗑️',
      danger: true,
      onClick: () => store.deleteBuilding(building.id),
    });

    return actions;
  }, [contextMenu, buildings, handleBuildingClick, getAreaPosition]);

  return (
    <div className="guake-buildings-panel">
      <div className="guake-buildings-header">
        <div className="guake-buildings-title">
          <span className="guake-buildings-icon">🏗️</span>
          <span>{agentArea?.name || t('terminal:buildings.title', { defaultValue: 'Buildings' })}</span>
          <span className="guake-buildings-count">{areaBuildings.length}</span>
        </div>
        <div className="guake-buildings-header-actions">
          {agentArea && (
            <button
              className="guake-buildings-add"
              onClick={handleAddBuilding}
              title="Add building to area"
            >
              +
            </button>
          )}
          <button className="guake-buildings-close" onClick={onClose} title={t('common:buttons.close')}>✕</button>
        </div>
      </div>

      <div className="guake-buildings-body">
        {!agentArea ? (
          <div className="guake-buildings-empty">
            {t('terminal:buildings.noArea', { defaultValue: 'Agent is not in an area' })}
          </div>
        ) : areaBuildings.length === 0 ? (
          <div className="guake-buildings-empty">
            {t('terminal:buildings.noBuildings', { defaultValue: 'No buildings in this area' })}
          </div>
        ) : (
          areaBuildings.map((building) => {
            const typeConfig = BUILDING_TYPES[building.type];
            const statusIcon = STATUS_ICONS[building.status] || '❓';
            const isRunnable = building.type === 'server' || building.type === 'docker';
            const isRunning = building.status === 'running';

            return (
              <div
                key={building.id}
                className={`guake-building-item ${building.status}`}
                onClick={() => handleBuildingClick(building.id)}
                onContextMenu={(e) => handleContextMenu(e, building.id)}
              >
                <div className="guake-building-row">
                  <span className="guake-building-type-icon" title={typeConfig.description}>
                    {typeConfig.icon}
                  </span>
                  <span className="guake-building-name">{building.name}</span>
                  <span className="guake-building-status" title={building.status}>
                    {statusIcon}
                  </span>
                </div>

                {/* PM2 status info */}
                {building.pm2Status && (
                  <div className="guake-building-detail">
                    <span className="detail-label">PM2</span>
                    <span className="detail-value">{building.pm2Status.status}</span>
                    {building.pm2Status.memory !== undefined && (
                      <span className="detail-value">{Math.round(building.pm2Status.memory / 1024 / 1024)}MB</span>
                    )}
                  </div>
                )}

                {/* Docker status info */}
                {building.dockerStatus && (
                  <div className="guake-building-detail">
                    <span className="detail-label">Docker</span>
                    <span className="detail-value">{building.dockerStatus.status}</span>
                  </div>
                )}

                {/* URLs */}
                {building.urls && building.urls.length > 0 && (
                  <div className="guake-building-urls">
                    {building.urls.map((link, i) => (
                      <a
                        key={i}
                        className="guake-building-link"
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        🔗 {link.label}
                      </a>
                    ))}
                  </div>
                )}

                {/* Quick actions for runnable buildings */}
                {isRunnable && (
                  <div className="guake-building-actions">
                    {!isRunning && (
                      <button
                        className="guake-building-action start"
                        onClick={(e) => { e.stopPropagation(); handleCommand(building.id, 'start'); }}
                        title="Start"
                      >
                        ▶
                      </button>
                    )}
                    {isRunning && (
                      <>
                        <button
                          className="guake-building-action restart"
                          onClick={(e) => { e.stopPropagation(); handleCommand(building.id, 'restart'); }}
                          title="Restart"
                        >
                          🔄
                        </button>
                        <button
                          className="guake-building-action stop"
                          onClick={(e) => { e.stopPropagation(); handleCommand(building.id, 'stop'); }}
                          title="Stop"
                        >
                          ⏹
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Context menu for building actions */}
      <ContextMenu
        isOpen={contextMenu !== null}
        position={contextMenu?.position || { x: 0, y: 0 }}
        worldPosition={{ x: 0, z: 0 }}
        actions={contextMenuActions}
        onClose={closeContextMenu}
      />
    </div>
  );
}
