import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['terminal', 'common']);
  return (
    <div className="form-section boss-building-section">
      <label className="form-label">
        {t('terminal:building.managedBuildings')}
        <HelpTooltip
          text={t('terminal:building.helpManagedBuildings')}
          title={t('terminal:building.managedBuildings')}
          position="top"
          size="sm"
        />
      </label>
      <div className="form-hint">
        {t('terminal:building.managedBuildingsHint')}
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
            {t('terminal:building.noManageableBuildings')}
          </div>
        )}
      </div>

      {/* Boss Building Actions (edit mode only) */}
      {isEditMode && subordinateBuildingIds.length > 0 && (
        <div className="boss-building-actions">
          <div className="boss-actions-header">
            {t('terminal:building.bulkActions')}
            <HelpTooltip
              text={t('terminal:building.helpBulkActions')}
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
              {t('terminal:building.startAll')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => store.sendBossBuildingCommand(buildingId!, 'stop_all')}
            >
              {t('terminal:building.stopAll')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-warning"
              onClick={() => store.sendBossBuildingCommand(buildingId!, 'restart_all')}
            >
              {t('terminal:building.restartAll')}
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
              {showBossLogs ? t('terminal:building.hideLogs') : t('terminal:building.unifiedLogs')}
            </button>
          </div>

          {/* Status overview of managed buildings */}
          <div className="boss-subordinates-status">
            <div className="boss-status-header">{t('terminal:building.statusOverview')}</div>
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
            {t('terminal:building.unifiedLogs')}
            <HelpTooltip
              text={t('terminal:building.helpUnifiedLogs')}
              position="top"
              size="sm"
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => store.clearBossStreamingLogs(buildingId!)}
            >
              {t('common:buttons.clear')}
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
              <div className="boss-logs-empty">{t('terminal:building.waitingForLogs')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
