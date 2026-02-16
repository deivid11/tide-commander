import React, { useState, useRef, useCallback, useMemo, memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useStore } from '../store';
import type { Building } from '../../shared/types';
import { BUILDING_STATUS_COLORS } from '../utils/colors';

interface BossBuildingActionPopupProps {
  building: Building;
  screenPos: { x: number; y: number };
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenLogsModal: () => void;
  onOpenUrlInModal?: (url: string) => void;
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format uptime to human readable
function formatUptime(startTime: number): string {
  const now = Date.now();
  const diff = now - startTime;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const BossBuildingActionPopup = memo(function BossBuildingActionPopup({ building, screenPos, onClose, onOpenSettings, onOpenLogsModal, onOpenUrlInModal }: BossBuildingActionPopupProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; popupX: number; popupY: number } | null>(null);
  // Use ref to track current dragOffset to avoid recreating listeners
  const dragOffsetRef = useRef(dragOffset);
  dragOffsetRef.current = dragOffset;

  const { buildings } = useStore();

  // Get subordinate buildings
  const subordinateIds = building.subordinateBuildingIds || [];
  const subordinates = subordinateIds
    .map(id => buildings.get(id))
    .filter((b): b is Building => b !== undefined);

  // Stable mouse move handler using ref
  const handleMouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const handleMouseUpRef = useRef<(() => void) | null>(null);

  // Handle drag start on header - stable callback
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const currentX = dragOffsetRef.current ? dragOffsetRef.current.x : 0;
    const currentY = dragOffsetRef.current ? dragOffsetRef.current.y : 0;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      popupX: currentX,
      popupY: currentY,
    };
    setIsDragging(true);

    handleMouseMoveRef.current = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const deltaX = moveEvent.clientX - dragStartRef.current.mouseX;
      const deltaY = moveEvent.clientY - dragStartRef.current.mouseY;
      setDragOffset({
        x: dragStartRef.current.popupX + deltaX,
        y: dragStartRef.current.popupY + deltaY,
      });
    };

    handleMouseUpRef.current = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      if (handleMouseMoveRef.current) {
        document.removeEventListener('mousemove', handleMouseMoveRef.current);
      }
      if (handleMouseUpRef.current) {
        document.removeEventListener('mouseup', handleMouseUpRef.current);
      }
    };

    document.addEventListener('mousemove', handleMouseMoveRef.current);
    document.addEventListener('mouseup', handleMouseUpRef.current);
  }, []); // No dependencies - uses refs for current values

  // Cleanup event listeners on unmount
  useEffect(() => {
    return () => {
      if (handleMouseMoveRef.current) {
        document.removeEventListener('mousemove', handleMouseMoveRef.current);
      }
      if (handleMouseUpRef.current) {
        document.removeEventListener('mouseup', handleMouseUpRef.current);
      }
    };
  }, []);

  const handleBossCommand = (cmd: 'start_all' | 'stop_all' | 'restart_all') => {
    store.sendBossBuildingCommand(building.id, cmd);
  };

  // Calculate status summary
  const statusCounts = subordinates.reduce((acc, sub) => {
    acc[sub.status] = (acc[sub.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Check if any subordinate has PM2 enabled
  const hasPM2Subordinates = subordinates.some(s => s.pm2?.enabled);

  const handleOpenUrl = (port: number, openInPiP?: boolean) => {
    const url = `http://localhost:${port}`;
    if (openInPiP && onOpenUrlInModal) {
      onOpenUrlInModal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  // Memoize popup style calculation
  const popupStyle = useMemo((): React.CSSProperties => {
    const maxWidth = 340;
    const maxHeight = 350;
    let baseX = screenPos.x + 20;
    let baseY = screenPos.y - 80;

    // Ensure popup stays within viewport (only for initial position)
    if (typeof window !== 'undefined' && !dragOffset) {
      if (screenPos.x + 20 + maxWidth > window.innerWidth) {
        baseX = screenPos.x - maxWidth - 20;
      }
      if (screenPos.y - 80 < 0) {
        baseY = 10;
      } else if (screenPos.y - 80 + maxHeight > window.innerHeight) {
        baseY = window.innerHeight - maxHeight - 10;
      }
    }

    return {
      position: 'fixed',
      left: baseX + (dragOffset?.x || 0),
      top: baseY + (dragOffset?.y || 0),
      zIndex: 1000,
      cursor: isDragging ? 'grabbing' : undefined,
    };
  }, [screenPos.x, screenPos.y, dragOffset, isDragging]);

  return (
    <div
      className="building-action-popup boss-building-popup"
      style={popupStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header - draggable */}
      <div
        className={`building-popup-header boss-header ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleDragStart}
      >
        <span className="boss-icon">👑</span>
        <span className="building-popup-name">{building.name}</span>
        <span className="subordinate-count">{t('terminal:building.unitsCount', { count: subordinates.length })}</span>
        <button className="building-popup-close" onClick={onClose}>x</button>
      </div>

      {/* Status Overview */}
      <div className="boss-status-overview">
        {Object.entries(statusCounts).map(([status, count]) => (
          <span
            key={status}
            className="status-badge"
            style={{ backgroundColor: BUILDING_STATUS_COLORS[status as keyof typeof BUILDING_STATUS_COLORS] || '#666' }}
          >
            {count} {status}
          </span>
        ))}
        {subordinates.length === 0 && (
          <span className="no-subordinates">{t('terminal:building.noSubordinates')}</span>
        )}
      </div>

      {/* Subordinate List */}
      {subordinates.length > 0 && (
        <div className="subordinate-list">
          {subordinates.map(sub => (
            <div key={sub.id} className="subordinate-item">
              <span
                className="sub-status-dot"
                style={{ backgroundColor: BUILDING_STATUS_COLORS[sub.status] }}
              />
              <span className="sub-name">{sub.name}</span>
              {sub.pm2Status?.ports && sub.pm2Status.ports.length > 0 && (
                <span className="sub-port">
                  {sub.pm2Status.ports.map((port) => (
                    <a
                      key={port}
                      href={`http://localhost:${port}`}
                      className="building-popup-port-link"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleOpenUrl(port, e.altKey);
                      }}
                      title={`Open http://localhost:${port} (Alt+Click for modal)`}
                    >
                      :{port}
                    </a>
                  ))}
                </span>
              )}
              {sub.pm2Status && (
                <span className="sub-metrics">
                  {sub.pm2Status.cpu?.toFixed(0)}% | {formatBytes(sub.pm2Status.memory || 0)}
                </span>
              )}
              {sub.pm2Status?.uptime && (
                <span className="sub-uptime">{formatUptime(sub.pm2Status.uptime)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bulk Action Buttons */}
      <div className="building-popup-actions boss-actions">
        <button
          className="action-btn start"
          onClick={() => handleBossCommand('start_all')}
          disabled={subordinates.length === 0}
          title={t('terminal:building.startAllSubs')}
        >
          <span className="icon">&#9654;</span>
          {t('terminal:building.startAll')}
        </button>
        <button
          className="action-btn stop"
          onClick={() => handleBossCommand('stop_all')}
          disabled={subordinates.length === 0}
          title={t('terminal:building.stopAllSubs')}
        >
          <span className="icon">&#9632;</span>
          {t('terminal:building.stopAll')}
        </button>
        <button
          className="action-btn restart"
          onClick={() => handleBossCommand('restart_all')}
          disabled={subordinates.length === 0}
          title={t('terminal:building.restartAllSubs')}
        >
          <span className="icon">&#8634;</span>
          {t('terminal:building.restartAll')}
        </button>
        {hasPM2Subordinates && (
          <button
            className="action-btn logs"
            onClick={onOpenLogsModal}
            title={t('terminal:building.viewUnifiedLogs')}
          >
            <span className="icon">&#128196;</span>
            {t('terminal:building.logs')}
          </button>
        )}
      </div>

      {/* Settings link */}
      <button className="building-popup-settings" onClick={onOpenSettings}>
        {t('terminal:building.fullSettings')}
      </button>
    </div>
  );
});
