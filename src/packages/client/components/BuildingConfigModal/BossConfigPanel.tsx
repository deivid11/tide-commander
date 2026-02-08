import React from 'react';
import {
  BUILDING_TYPES,
  type Building,
} from '../../../shared/types';
import { store } from '../../store';
import { BUILDING_STATUS_COLORS } from '../../utils/colors';
import { HelpTooltip } from '../shared/Tooltip';
import { ansiToHtml } from './utils';

interface BossConfigPanelProps {
  buildings: Map<string, Building>;
  buildingId: string | null | undefined;
  subordinateBuildingIds: string[];
  setSubordinateBuildingIds: (v: string[]) => void;
  isEditMode: boolean;
  showBossLogs: boolean;
  setShowBossLogs: (v: boolean) => void;
  currentBossLogs: { subordinateName: string; chunk: string }[];
  bossLogsContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function BossConfigPanel({
  buildings,
  buildingId,
  subordinateBuildingIds,
  setSubordinateBuildingIds,
  isEditMode,
  showBossLogs,
  setShowBossLogs,
  currentBossLogs,
  bossLogsContainerRef,
}: BossConfigPanelProps) {
  return (
    <div className="form-section boss-building-section">
      <label className="form-label">
        Managed Buildings
        <HelpTooltip
          text="Boss buildings can control multiple subordinate buildings. Use this to group related services and manage them together."
          title="Managed Buildings"
          position="top"
          size="sm"
        />
      </label>
      <div className="form-hint">
        Select buildings this boss will control. You can start, stop, or restart all managed buildings at once.
      </div>
      <div className="subordinate-buildings-list">
        {Array.from(buildings.values())
          .filter(b => b.id !== buildingId && b.type !== 'boss' && b.type !== 'link' && b.type !== 'folder')
          .map(b => (
            <label key={b.id} className="subordinate-building-item">
              <input
                type="checkbox"
                checked={subordinateBuildingIds.includes(b.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSubordinateBuildingIds([...subordinateBuildingIds, b.id]);
                  } else {
                    setSubordinateBuildingIds(subordinateBuildingIds.filter(id => id !== b.id));
                  }
                }}
              />
              <span className="subordinate-building-icon">{BUILDING_TYPES[b.type].icon}</span>
              <span className="subordinate-building-name">{b.name}</span>
              <span
                className="subordinate-building-status"
                style={{ backgroundColor: BUILDING_STATUS_COLORS[b.status] }}
              />
            </label>
          ))}
        {Array.from(buildings.values()).filter(b => b.id !== buildingId && b.type !== 'boss' && b.type !== 'link' && b.type !== 'folder').length === 0 && (
          <div className="form-hint no-buildings-hint">
            No manageable buildings available. Create server, database, docker, or monitor buildings first.
          </div>
        )}
      </div>

      {/* Boss Building Actions (edit mode only) */}
      {isEditMode && subordinateBuildingIds.length > 0 && (
        <div className="boss-building-actions">
          <div className="boss-actions-header">
            Bulk Actions
            <HelpTooltip
              text="Execute commands on all managed buildings simultaneously. Useful for starting or restarting your entire stack."
              position="top"
              size="sm"
            />
          </div>
          <div className="boss-actions-row">
            <button
              type="button"
              className="btn btn-sm btn-success"
              onClick={() => store.sendBossBuildingCommand(buildingId!, 'start_all')}
            >
              Start All
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => store.sendBossBuildingCommand(buildingId!, 'stop_all')}
            >
              Stop All
            </button>
            <button
              type="button"
              className="btn btn-sm btn-warning"
              onClick={() => store.sendBossBuildingCommand(buildingId!, 'restart_all')}
            >
              Restart All
            </button>
            <button
              type="button"
              className={`btn btn-sm ${showBossLogs ? 'btn-primary' : ''}`}
              onClick={() => {
                if (showBossLogs) {
                  store.stopBossLogStreaming(buildingId!);
                  setShowBossLogs(false);
                } else {
                  store.startBossLogStreaming(buildingId!);
                  setShowBossLogs(true);
                }
              }}
            >
              {showBossLogs ? 'Hide Logs' : 'Unified Logs'}
            </button>
          </div>

          {/* Status overview of managed buildings */}
          <div className="boss-subordinates-status">
            <div className="boss-status-header">Status Overview</div>
            <div className="boss-status-grid">
              {subordinateBuildingIds.map(id => {
                const sub = buildings.get(id);
                if (!sub) return null;
                return (
                  <div key={id} className="boss-status-item">
                    <span
                      className="boss-status-indicator"
                      style={{ backgroundColor: BUILDING_STATUS_COLORS[sub.status] }}
                    />
                    <span className="boss-status-name">{sub.name}</span>
                    <span className="boss-status-label">{sub.status}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Unified Logs Display */}
      {isEditMode && showBossLogs && (
        <div className="form-section boss-logs-section">
          <label className="form-label">
            Unified Logs
            <HelpTooltip
              text="Aggregated real-time logs from all managed buildings. Each line shows which building the log came from."
              position="top"
              size="sm"
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => store.clearBossStreamingLogs(buildingId!)}
            >
              Clear
            </button>
          </label>
          <div className="boss-logs-container" ref={bossLogsContainerRef}>
            {currentBossLogs.map((entry, i) => (
              <div key={i} className="boss-log-entry">
                <span className="boss-log-source">[{entry.subordinateName}]</span>
                <span className="boss-log-content">{ansiToHtml(entry.chunk)}</span>
              </div>
            ))}
            {currentBossLogs.length === 0 && (
              <div className="boss-logs-empty">Waiting for logs...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
