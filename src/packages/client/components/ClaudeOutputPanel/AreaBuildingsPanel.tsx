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

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

/** Format uptime from start timestamp to human-readable duration */
function formatUptime(startTs: number): string {
  const seconds = Math.floor((Date.now() - startTs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

/** Shorten a filesystem path for display */
function shortenPath(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join('/')}`;
}

/** Format port list */
function formatPorts(ports: number[]): string {
  return ports.map(p => `:${p}`).join(' ');
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
    const isRunnable = building.type === 'server' || building.type === 'docker' || building.type === 'terminal';
    const isRunning = building.status === 'running';
    const isBoss = building.type === 'boss';

    // Open / View action
    actions.push({
      id: 'open',
      label: building.type === 'database' ? 'Open Database' :
             building.type === 'folder' ? 'Open Folder' :
             building.type === 'boss' ? 'View Boss Logs' :
             building.type === 'terminal' ? 'Open Terminal' :
             (building.type === 'server' && building.pm2?.enabled) ? 'View PM2 Logs' :
             'Open',
      icon: building.type === 'database' ? '🗄️' :
            building.type === 'folder' ? '📁' :
            building.type === 'terminal' ? '💻' :
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
          terminal: building.terminal,
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

  /** Render type-specific detail rows for a building */
  const renderBuildingDetails = useCallback((building: Building) => {
    const details: React.ReactNode[] = [];

    // -- PM2 runtime details (server with PM2) --
    if (building.pm2Status) {
      const pm2 = building.pm2Status;
      const parts: React.ReactNode[] = [];
      if (pm2.status) parts.push(<span key="st" className="detail-value">{pm2.status}</span>);
      if (pm2.memory !== undefined) parts.push(<span key="mem" className="detail-value">{formatBytes(pm2.memory)}</span>);
      if (pm2.cpu !== undefined) parts.push(<span key="cpu" className="detail-value">{pm2.cpu.toFixed(1)}%</span>);
      if (pm2.uptime) parts.push(<span key="up" className="detail-value detail-dim">{formatUptime(pm2.uptime)}</span>);
      if (parts.length > 0) {
        details.push(
          <div key="pm2" className="guake-building-detail">
            <span className="detail-label">PM2</span>
            {parts}
          </div>
        );
      }
      // Ports
      if (pm2.ports && pm2.ports.length > 0) {
        details.push(
          <div key="pm2-ports" className="guake-building-detail">
            <span className="detail-label">Ports</span>
            <span className="detail-value detail-ports">{formatPorts(pm2.ports)}</span>
          </div>
        );
      }
      // Restarts (only if > 0)
      if (pm2.restarts && pm2.restarts > 0) {
        details.push(
          <div key="pm2-restarts" className="guake-building-detail">
            <span className="detail-label">Restarts</span>
            <span className="detail-value detail-warn">{pm2.restarts}</span>
          </div>
        );
      }
    }

    // -- Docker runtime details --
    if (building.dockerStatus) {
      const docker = building.dockerStatus;
      const parts: React.ReactNode[] = [];
      if (docker.status) parts.push(<span key="st" className="detail-value">{docker.status}</span>);
      if (docker.health && docker.health !== 'none') {
        const healthClass = docker.health === 'healthy' ? 'detail-ok' : docker.health === 'unhealthy' ? 'detail-err' : '';
        parts.push(<span key="h" className={`detail-value ${healthClass}`}>{docker.health}</span>);
      }
      if (docker.memory !== undefined) {
        const memStr = docker.memoryLimit
          ? `${formatBytes(docker.memory)}/${formatBytes(docker.memoryLimit)}`
          : formatBytes(docker.memory);
        parts.push(<span key="mem" className="detail-value">{memStr}</span>);
      }
      if (docker.cpu !== undefined) parts.push(<span key="cpu" className="detail-value">{docker.cpu.toFixed(1)}%</span>);
      if (parts.length > 0) {
        details.push(
          <div key="docker" className="guake-building-detail">
            <span className="detail-label">Docker</span>
            {parts}
          </div>
        );
      }
      // Docker image
      if (docker.image) {
        details.push(
          <div key="docker-img" className="guake-building-detail">
            <span className="detail-label">Image</span>
            <span className="detail-value detail-mono">{docker.image}</span>
          </div>
        );
      }
      // Docker ports
      if (docker.ports && docker.ports.length > 0) {
        const portStr = docker.ports.map(p => `${p.host}:${p.container}`).join(' ');
        details.push(
          <div key="docker-ports" className="guake-building-detail">
            <span className="detail-label">Ports</span>
            <span className="detail-value detail-ports">{portStr}</span>
          </div>
        );
      }
      // Docker compose services
      if (docker.services && docker.services.length > 0) {
        details.push(
          <div key="docker-svc" className="guake-building-detail">
            <span className="detail-label">Services</span>
            <span className="detail-value">{docker.services.length} svc</span>
          </div>
        );
      }
    }

    // -- Database details --
    if (building.type === 'database' && building.database) {
      const db = building.database;
      const activeConn = db.activeConnectionId
        ? db.connections.find(c => c.id === db.activeConnectionId)
        : db.connections[0];
      if (activeConn) {
        details.push(
          <div key="db-conn" className="guake-building-detail">
            <span className="detail-label">{activeConn.engine.toUpperCase()}</span>
            <span className="detail-value detail-mono">{activeConn.host}:{activeConn.port}</span>
          </div>
        );
        if (db.activeDatabase || activeConn.database) {
          details.push(
            <div key="db-name" className="guake-building-detail">
              <span className="detail-label">DB</span>
              <span className="detail-value">{db.activeDatabase || activeConn.database}</span>
            </div>
          );
        }
      }
      if (db.connections.length > 1) {
        details.push(
          <div key="db-count" className="guake-building-detail">
            <span className="detail-label">Connections</span>
            <span className="detail-value">{db.connections.length}</span>
          </div>
        );
      }
    }

    // -- Boss building: subordinate summary --
    if (building.type === 'boss' && building.subordinateBuildingIds && building.subordinateBuildingIds.length > 0) {
      const subs = building.subordinateBuildingIds;
      let runningCount = 0;
      let errorCount = 0;
      for (const subId of subs) {
        const sub = buildings.get(subId);
        if (sub?.status === 'running') runningCount++;
        if (sub?.status === 'error') errorCount++;
      }
      const summaryParts: string[] = [];
      summaryParts.push(`${runningCount}/${subs.length} up`);
      if (errorCount > 0) summaryParts.push(`${errorCount} err`);
      details.push(
        <div key="boss-subs" className="guake-building-detail">
          <span className="detail-label">Subs</span>
          <span className={`detail-value ${errorCount > 0 ? 'detail-err' : runningCount === subs.length ? 'detail-ok' : ''}`}>
            {summaryParts.join(', ')}
          </span>
        </div>
      );
    }

    // -- Terminal runtime details --
    if (building.terminalStatus) {
      const term = building.terminalStatus;
      details.push(
        <div key="terminal" className="guake-building-detail">
          <span className="detail-label">Terminal</span>
          <span className="detail-value detail-ports">:{term.port}</span>
        </div>
      );
      if (term.tmuxSession) {
        details.push(
          <div key="terminal-session" className="guake-building-detail">
            <span className="detail-label">Session</span>
            <span className="detail-value detail-mono">{term.tmuxSession}</span>
          </div>
        );
      }
    }

    // -- Folder path & git changes --
    if (building.type === 'folder' && building.folderPath) {
      details.push(
        <div key="folder-path" className="guake-building-detail">
          <span className="detail-label">Path</span>
          <span className="detail-value detail-mono" title={building.folderPath}>{shortenPath(building.folderPath)}</span>
        </div>
      );
      if (building.gitChangesCount !== undefined && building.gitChangesCount > 0) {
        details.push(
          <div key="folder-git" className="guake-building-detail">
            <span className="detail-label">Git</span>
            <span className="detail-value detail-warn">{building.gitChangesCount} changes</span>
          </div>
        );
      }
    }

    // -- Working directory (for server/docker, only if no PM2/Docker status shown) --
    if (building.cwd && building.type !== 'folder' && !building.pm2Status && !building.dockerStatus) {
      details.push(
        <div key="cwd" className="guake-building-detail">
          <span className="detail-label">Dir</span>
          <span className="detail-value detail-mono" title={building.cwd}>{shortenPath(building.cwd)}</span>
        </div>
      );
    }

    // -- Last error --
    if (building.lastError && building.status === 'error') {
      details.push(
        <div key="error" className="guake-building-detail">
          <span className="detail-label detail-err">Err</span>
          <span className="detail-value detail-err detail-ellipsis" title={building.lastError}>
            {building.lastError.length > 40 ? building.lastError.slice(0, 40) + '...' : building.lastError}
          </span>
        </div>
      );
    }

    return details;
  }, [buildings]);

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
            const isRunnable = building.type === 'server' || building.type === 'docker' || building.type === 'terminal';
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

                {/* Rich detail rows */}
                {renderBuildingDetails(building)}

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
                        {building.type === 'terminal' && building.terminalStatus?.url && (
                          <button
                            className="guake-building-action terminal-below"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.dispatchEvent(new CustomEvent('tide:open-bottom-terminal', { detail: { buildingId: building.id } }));
                            }}
                            title="Open terminal below"
                          >
                            ⬇
                          </button>
                        )}
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
