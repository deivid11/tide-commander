import React from 'react';
import { useStore, store } from '../../store';
import type { Building } from '../../../shared/types';
import { BUILDING_TYPES, BUILDING_STYLES } from '../../../shared/types';
import { BUILDING_STATUS_COLORS } from '../../utils/colors';

interface BuildingEditorProps {
  building: Building;
  onClose: () => void;
  onOpenModal: () => void;
}

export function BuildingEditor({ building, onClose, onOpenModal }: BuildingEditorProps) {
  const { buildingLogs: _buildingLogs } = useStore();
  const logs = store.getBuildingLogs(building.id);
  const typeInfo = BUILDING_TYPES[building.type];
  const styleInfo = BUILDING_STYLES[building.style || 'server-rack'];

  const handleCommand = (cmd: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs') => {
    store.sendBuildingCommand(building.id, cmd);
  };

  const openUrl = (url: string) => {
    window.open(url, '_blank');
  };

  return (
    <div className="building-editor">
      <div className="building-editor-header">
        <div className="building-editor-title-row">
          <span className="building-editor-icon">{typeInfo.icon}</span>
          <span className="building-editor-title">{building.name}</span>
          <span
            className="building-editor-status"
            style={{ backgroundColor: BUILDING_STATUS_COLORS[building.status] }}
          >
            {building.status}
          </span>
        </div>
        <button className="building-editor-close" onClick={onClose}>&times;</button>
      </div>

      {/* Quick Info */}
      <div className="building-editor-section">
        <div className="building-editor-info-grid">
          <div className="building-editor-info-item">
            <span className="building-editor-info-label">Type</span>
            <span className="building-editor-info-value">{building.type}</span>
          </div>
          <div className="building-editor-info-item">
            <span className="building-editor-info-label">Style</span>
            <span className="building-editor-info-value">{styleInfo.label}</span>
          </div>
          {building.cwd && (
            <div className="building-editor-info-item building-editor-info-wide">
              <span className="building-editor-info-label">Directory</span>
              <span className="building-editor-info-value building-editor-cwd" title={building.cwd}>
                {building.cwd.split('/').pop() || building.cwd}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      {building.type === 'server' && (
        <div className="building-editor-section">
          <div className="building-editor-section-title">Actions</div>
          <div className="building-editor-actions">
            <button
              className="building-editor-action-btn start"
              onClick={() => handleCommand('start')}
              disabled={!building.commands?.start || building.status === 'running'}
              title={building.commands?.start || 'No start command'}
            >
              ▶ Start
            </button>
            <button
              className="building-editor-action-btn stop"
              onClick={() => handleCommand('stop')}
              disabled={!building.commands?.stop || building.status === 'stopped'}
              title={building.commands?.stop || 'No stop command'}
            >
              ■ Stop
            </button>
            <button
              className="building-editor-action-btn restart"
              onClick={() => handleCommand('restart')}
              disabled={!building.commands?.restart}
              title={building.commands?.restart || 'No restart command'}
            >
              ⟳ Restart
            </button>
            <button
              className="building-editor-action-btn health"
              onClick={() => handleCommand('healthCheck')}
              disabled={!building.commands?.healthCheck}
              title={building.commands?.healthCheck || 'No health check'}
            >
              ♥ Health
            </button>
          </div>
        </div>
      )}

      {/* URLs/Links */}
      {building.urls && building.urls.length > 0 && (
        <div className="building-editor-section">
          <div className="building-editor-section-title">Links</div>
          <div className="building-editor-links">
            {building.urls.map((url, idx) => (
              <button
                key={idx}
                className="building-editor-link"
                onClick={() => openUrl(url.url)}
                title={url.url}
              >
                🔗 {url.label || url.url}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent Logs */}
      {logs.length > 0 && (
        <div className="building-editor-section">
          <div className="building-editor-section-title">
            Recent Logs
            <button
              className="building-editor-clear-logs"
              onClick={() => store.clearBuildingLogs(building.id)}
              title="Clear logs"
            >
              Clear
            </button>
          </div>
          <div className="building-editor-logs">
            {logs.slice(-5).map((log, idx) => (
              <div key={idx} className="building-editor-log-entry">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Button */}
      <div className="building-editor-footer">
        <button className="building-editor-edit-btn" onClick={onOpenModal}>
          ⚙ Full Settings
        </button>
      </div>
    </div>
  );
}
