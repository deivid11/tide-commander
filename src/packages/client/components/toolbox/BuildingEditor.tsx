import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['config', 'common']);
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
            <span className="building-editor-info-label">{t('common:labels.type')}</span>
            <span className="building-editor-info-value">{building.type}</span>
          </div>
          <div className="building-editor-info-item">
            <span className="building-editor-info-label">{t('config:buildings.style')}</span>
            <span className="building-editor-info-value">{styleInfo.label}</span>
          </div>
          {building.cwd && (
            <div className="building-editor-info-item building-editor-info-wide">
              <span className="building-editor-info-label">{t('config:buildings.directory')}</span>
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
          <div className="building-editor-section-title">{t('config:buildings.actions')}</div>
          <div className="building-editor-actions">
            <button
              className="building-editor-action-btn start"
              onClick={() => handleCommand('start')}
              disabled={!building.commands?.start || building.status === 'running'}
              title={building.commands?.start || t('config:buildings.noStartCommand')}
            >
              ▶ {t('common:buttons.start')}
            </button>
            <button
              className="building-editor-action-btn stop"
              onClick={() => handleCommand('stop')}
              disabled={!building.commands?.stop || building.status === 'stopped'}
              title={building.commands?.stop || t('config:buildings.noStopCommand')}
            >
              ■ {t('common:buttons.stop')}
            </button>
            <button
              className="building-editor-action-btn restart"
              onClick={() => handleCommand('restart')}
              disabled={!building.commands?.restart}
              title={building.commands?.restart || t('config:buildings.noRestartCommand')}
            >
              ⟳ {t('common:buttons.retry')}
            </button>
            <button
              className="building-editor-action-btn health"
              onClick={() => handleCommand('healthCheck')}
              disabled={!building.commands?.healthCheck}
              title={building.commands?.healthCheck || t('config:buildings.noHealthCheck')}
            >
              ♥ Health
            </button>
          </div>
        </div>
      )}

      {/* URLs/Links */}
      {building.urls && building.urls.length > 0 && (
        <div className="building-editor-section">
          <div className="building-editor-section-title">{t('config:buildings.links')}</div>
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
            {t('config:buildings.recentLogs')}
            <button
              className="building-editor-clear-logs"
              onClick={() => store.clearBuildingLogs(building.id)}
              title={t('common:buttons.clear')}
            >
              {t('common:buttons.clear')}
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
          ⚙ {t('config:buildings.fullSettings')}
        </button>
      </div>
    </div>
  );
}
