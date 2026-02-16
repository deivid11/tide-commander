import React from 'react';
import { useTranslation } from 'react-i18next';
import { store, useAreas } from '../store';
import type { DrawingArea } from '../../shared/types';

interface RestoreArchivedAreaModalProps {
  isOpen: boolean;
  restorePosition: { x: number; z: number } | null;
  onClose: () => void;
  onRestored?: () => void; // Callback to sync scene after restore
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

export function RestoreArchivedAreaModal({
  isOpen,
  restorePosition,
  onClose,
  onRestored,
}: RestoreArchivedAreaModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const areas = useAreas();
  const archivedAreas = Array.from(areas.values()).filter((a) => a.archived === true);

  const handleRestore = (areaId: string, toOriginal: boolean) => {
    const newCenter = toOriginal ? undefined : restorePosition || undefined;
    store.restoreArchivedArea(areaId, newCenter);
    onRestored?.();
    onClose();
  };

  const handleRestoreAll = () => {
    for (const area of archivedAreas) {
      store.restoreArchivedArea(area.id);
    }
    onRestored?.();
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`modal-overlay ${isOpen ? 'visible' : ''}`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal restore-archived-modal">
        <div className="modal-header">
          <span className="header-icon">📦</span>
          {t('terminal:areas.restoreArchivedZone')}
        </div>

        <div className="modal-body restore-archived-body">
          {archivedAreas.length === 0 ? (
            <div className="archived-empty">{t('terminal:areas.noArchivedZones')}</div>
          ) : (
            <>
              <p className="restore-info">
                {t('terminal:areas.restoreInfo')}
              </p>
              <div className="archived-list">
                {archivedAreas.map((area) => (
                  <ArchivedAreaItem
                    key={area.id}
                    area={area}
                    onRestoreHere={() => handleRestore(area.id, false)}
                    onRestoreOriginal={() => handleRestore(area.id, true)}
                    hasRestorePosition={!!restorePosition}
                  />
                ))}
              </div>
              {archivedAreas.length > 1 && (
                <div className="restore-all-section">
                  <button className="btn btn-secondary" onClick={handleRestoreAll}>
                    {t('terminal:areas.restoreAllOriginal')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common:buttons.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ArchivedAreaItemProps {
  area: DrawingArea;
  onRestoreHere: () => void;
  onRestoreOriginal: () => void;
  hasRestorePosition: boolean;
}

function ArchivedAreaItem({
  area,
  onRestoreHere,
  onRestoreOriginal,
  hasRestorePosition,
}: ArchivedAreaItemProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const agentCount = area.assignedAgentIds.length;
  const dirCount = area.directories.length;

  return (
    <div className="archived-item">
      <div className="archived-item-color" style={{ backgroundColor: area.color }} />
      <div className="archived-item-info">
        <div className="archived-item-name">{area.name}</div>
        <div className="archived-item-meta">
          <span className="archived-item-type">{area.type}</span>
          {agentCount > 0 && (
            <span className="archived-item-agents">
              {t('terminal:areas.agentCount', { count: agentCount })}
            </span>
          )}
          {dirCount > 0 && (
            <span className="archived-item-dirs">
              {t('terminal:areas.folderCount', { count: dirCount })}
            </span>
          )}
          {area.archivedAt && (
            <span className="archived-item-time">{formatRelativeTime(area.archivedAt)}</span>
          )}
        </div>
      </div>
      <div className="archived-item-actions">
        {hasRestorePosition && (
          <button className="btn btn-small btn-primary" onClick={onRestoreHere} title={t('terminal:areas.placeAtClickedPosition')}>
            {t('terminal:areas.restoreHere')}
          </button>
        )}
        <button className="btn btn-small" onClick={onRestoreOriginal} title={t('terminal:areas.restoreToOriginal')}>
          {hasRestorePosition ? t('terminal:areas.original') : t('terminal:areas.restore')}
        </button>
      </div>
    </div>
  );
}
