import React, { useState, useRef, useCallback, useMemo, memo, useEffect } from 'react';
import { store, useDatabaseState } from '../store';
import type { Building } from '../../shared/types';

interface DatabaseBuildingActionPopupProps {
  building: Building;
  screenPos: { x: number; y: number };
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenDatabasePanel: () => void;
}

export const DatabaseBuildingActionPopup = memo(function DatabaseBuildingActionPopup({
  building,
  screenPos,
  onClose,
  onOpenSettings,
  onOpenDatabasePanel,
}: DatabaseBuildingActionPopupProps) {
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; popupX: number; popupY: number } | null>(null);
  // Use ref to track current dragOffset to avoid recreating listeners
  const dragOffsetRef = useRef(dragOffset);
  dragOffsetRef.current = dragOffset;

  const dbState = useDatabaseState(building.id);
  const connections = building.database?.connections ?? [];

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

  // Test a specific connection
  const handleTestConnection = (connectionId: string) => {
    store.testDatabaseConnection(building.id, connectionId);
  };

  // Get connection status
  const getConnectionStatus = (connectionId: string) => {
    return dbState.connectionStatus.get(connectionId);
  };

  // Memoize popup style calculation
  const popupStyle = useMemo((): React.CSSProperties => {
    const maxWidth = 320;
    const maxHeight = 300;
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
      className="building-action-popup database-building-popup"
      style={popupStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header - draggable */}
      <div
        className={`building-popup-header database-header ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleDragStart}
      >
        <span className="database-icon">🗄️</span>
        <span className="building-popup-name">{building.name}</span>
        <span className="connection-count">{connections.length} conn</span>
        <button className="building-popup-close" onClick={onClose}>x</button>
      </div>

      {/* Connection List */}
      {connections.length > 0 ? (
        <div className="database-connection-list">
          {connections.map(conn => {
            const status = getConnectionStatus(conn.id);
            return (
              <div key={conn.id} className="database-connection-item">
                <span className="conn-engine">
                  {conn.engine === 'mysql' ? '🐬' : '🐘'}
                </span>
                <span className="conn-name">{conn.name}</span>
                <span className="conn-host">{conn.host}:{conn.port}</span>
                {status && (
                  <span className={`conn-status ${status.connected ? 'connected' : 'disconnected'}`}>
                    {status.connected ? '●' : '○'}
                  </span>
                )}
                <button
                  className="conn-test-btn"
                  onClick={() => handleTestConnection(conn.id)}
                  title="Test connection"
                >
                  ↻
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="database-no-connections">
          <p>No connections configured</p>
          <p className="hint">Click Settings to add a database connection</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="building-popup-actions database-actions">
        <button
          className="action-btn query"
          onClick={onOpenDatabasePanel}
          disabled={connections.length === 0}
          title="Open database explorer"
        >
          <span className="icon">⌨</span>
          Query
        </button>
        <button
          className="action-btn test-all"
          onClick={() => connections.forEach(c => handleTestConnection(c.id))}
          disabled={connections.length === 0}
          title="Test all connections"
        >
          <span className="icon">↻</span>
          Test All
        </button>
      </div>

      {/* Settings link */}
      <button className="building-popup-settings" onClick={onOpenSettings}>
        Settings
      </button>
    </div>
  );
});
