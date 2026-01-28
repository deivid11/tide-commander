import React, { useState, useRef, useCallback } from 'react';
import { store, useStore } from '../store';
import type { Building } from '../../shared/types';
import { BUILDING_STATUS_COLORS } from '../utils/colors';

interface BuildingActionPopupProps {
  building: Building;
  screenPos: { x: number; y: number };
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenLogsModal?: () => void;
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

// ANSI color code to CSS color mapping
const ANSI_COLORS: Record<number, string> = {
  30: '#1a1a1a', // black
  31: '#e74c3c', // red
  32: '#2ecc71', // green
  33: '#f39c12', // yellow
  34: '#3498db', // blue
  35: '#9b59b6', // magenta
  36: '#00bcd4', // cyan
  37: '#ecf0f1', // white
  90: '#7f8c8d', // bright black (gray)
  91: '#ff6b6b', // bright red
  92: '#4ade80', // bright green
  93: '#fbbf24', // bright yellow
  94: '#60a5fa', // bright blue
  95: '#c084fc', // bright magenta
  96: '#22d3ee', // bright cyan
  97: '#ffffff', // bright white
};

// Convert ANSI escape codes to HTML spans with colors
function ansiToHtml(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // eslint-disable-next-line no-control-regex
  const regex = /\x1B\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | null = null;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const textPart = text.slice(lastIndex, match.index);
      if (currentColor) {
        parts.push(<span key={parts.length} style={{ color: currentColor }}>{textPart}</span>);
      } else {
        parts.push(textPart);
      }
    }

    // Parse the escape sequence
    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0 || code === 39) {
        currentColor = null; // Reset
      } else if (ANSI_COLORS[code]) {
        currentColor = ANSI_COLORS[code];
      }
    }

    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const textPart = text.slice(lastIndex);
    if (currentColor) {
      parts.push(<span key={parts.length} style={{ color: currentColor }}>{textPart}</span>);
    } else {
      parts.push(textPart);
    }
  }

  return parts.length > 0 ? parts : [text];
}

export function BuildingActionPopup({ building, screenPos, onClose, onOpenSettings, onOpenLogsModal }: BuildingActionPopupProps) {
  const [showLogs, setShowLogs] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; popupX: number; popupY: number } | null>(null);

  const { buildingLogs } = useStore();
  const logs = store.getBuildingLogs(building.id);
  const isPM2 = building.pm2?.enabled;

  // Handle drag start on header
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const currentX = dragOffset ? dragOffset.x : 0;
    const currentY = dragOffset ? dragOffset.y : 0;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      popupX: currentX,
      popupY: currentY,
    };
    setIsDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const deltaX = moveEvent.clientX - dragStartRef.current.mouseX;
      const deltaY = moveEvent.clientY - dragStartRef.current.mouseY;
      setDragOffset({
        x: dragStartRef.current.popupX + deltaX,
        y: dragStartRef.current.popupY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [dragOffset]);

  const handleCommand = (cmd: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs') => {
    if (cmd === 'logs') {
      // For PM2 buildings, open the dedicated logs modal
      if (isPM2 && onOpenLogsModal) {
        onOpenLogsModal();
        return;
      }
      // For non-PM2 buildings, use the inline logs view
      store.sendBuildingCommand(building.id, cmd);
      setShowLogs(true);
    } else {
      store.sendBuildingCommand(building.id, cmd);
    }
  };

  const handleOpenUrl = (port?: number) => {
    if (port) {
      window.open(`http://localhost:${port}`, '_blank');
    }
  };

  // Get auto-detected ports from PM2 status polling
  const allPorts = building.pm2Status?.ports || [];

  // Check if commands are available
  const canStart = isPM2 ? !!building.pm2?.script : !!building.commands?.start;
  const canStop = isPM2 ? !!building.pm2?.script : !!building.commands?.stop;
  const canRestart = isPM2 ? !!building.pm2?.script : !!building.commands?.restart;

  // Calculate base position
  let baseX = screenPos.x + 20;
  let baseY = screenPos.y - 80;

  // Ensure popup stays within viewport (only for initial position)
  const maxWidth = 280;
  const maxHeight = showLogs ? 400 : 250;
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

  // Apply drag offset
  const popupStyle: React.CSSProperties = {
    position: 'fixed',
    left: baseX + (dragOffset?.x || 0),
    top: baseY + (dragOffset?.y || 0),
    zIndex: 1000,
    cursor: isDragging ? 'grabbing' : undefined,
  };

  return (
    <div
      className="building-action-popup"
      style={popupStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header - draggable */}
      <div
        className={`building-popup-header ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleDragStart}
      >
        <span className="building-popup-name">{building.name}</span>
        {allPorts.length > 0 && (
          <span className="building-popup-ports">
            {allPorts.map((port, i) => (
              <a
                key={port}
                href={`http://localhost:${port}`}
                className="building-popup-port-link"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleOpenUrl(port);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title={`Open http://localhost:${port}`}
              >
                :{port}
              </a>
            ))}
          </span>
        )}
        <span
          className="building-popup-status"
          style={{ backgroundColor: BUILDING_STATUS_COLORS[building.status] }}
        >
          {building.status}
        </span>
        <button className="building-popup-close" onClick={onClose}>x</button>
      </div>

      {/* PM2 Status */}
      {isPM2 && building.pm2Status && (
        <div className="building-popup-metrics">
          <span className="metric">
            <span className="label">PID</span>
            <span className="value">{building.pm2Status.pid || '-'}</span>
          </span>
          <span className="metric">
            <span className="label">CPU</span>
            <span className="value">{building.pm2Status.cpu?.toFixed(1) || '0'}%</span>
          </span>
          <span className="metric">
            <span className="label">MEM</span>
            <span className="value">{formatBytes(building.pm2Status.memory || 0)}</span>
          </span>
          {building.pm2Status.restarts !== undefined && building.pm2Status.restarts > 0 && (
            <span className="metric">
              <span className="label">RST</span>
              <span className="value">{building.pm2Status.restarts}</span>
            </span>
          )}
          {building.pm2Status.uptime && (
            <span className="metric">
              <span className="label">UP</span>
              <span className="value">{formatUptime(building.pm2Status.uptime)}</span>
            </span>
          )}
        </div>
      )}

      {/* Error display */}
      {(building.lastError || (isPM2 && building.pm2Status?.status === 'errored')) && (
        <div className="building-popup-error">
          {building.lastError || 'Process failed to start'}
          {isPM2 && building.pm2Status?.restarts && building.pm2Status.restarts > 5 && (
            <span className="error-hint"> - Check logs or configuration</span>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="building-popup-actions">
        <button
          className="action-btn start"
          onClick={() => handleCommand('start')}
          disabled={!canStart || building.status === 'running' || building.status === 'starting'}
          title={canStart ? 'Start' : 'No start command configured'}
        >
          <span className="icon">&#9654;</span>
          Start
        </button>
        <button
          className="action-btn stop"
          onClick={() => handleCommand('stop')}
          disabled={!canStop || building.status === 'stopped' || building.status === 'stopping'}
          title={canStop ? 'Stop' : 'No stop command configured'}
        >
          <span className="icon">&#9632;</span>
          Stop
        </button>
        <button
          className="action-btn restart"
          onClick={() => handleCommand('restart')}
          disabled={!canRestart}
          title={canRestart ? 'Restart' : 'No restart command configured'}
        >
          <span className="icon">&#8634;</span>
          Restart
        </button>
        <button
          className="action-btn logs"
          onClick={() => handleCommand('logs')}
          title="View logs"
        >
          <span className="icon">&#128196;</span>
          Logs
        </button>
        {allPorts.length === 1 && (
          <button
            className="action-btn open-url"
            onClick={() => handleOpenUrl(allPorts[0])}
            title={`Open http://localhost:${allPorts[0]}`}
          >
            <span className="icon">&#128279;</span>
            Open
          </button>
        )}
        {allPorts.length > 1 && (
          <div className="action-btn-group">
            <span className="action-btn-label">Open:</span>
            {allPorts.map(port => (
              <button
                key={port}
                className="action-btn open-url port-btn"
                onClick={() => handleOpenUrl(port)}
                title={`Open http://localhost:${port}`}
              >
                :{port}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Logs display */}
      {showLogs && logs.length > 0 && (
        <div className="building-popup-logs">
          <div className="logs-header">
            <span>Logs</span>
            <button onClick={() => store.clearBuildingLogs(building.id)}>Clear</button>
          </div>
          <div className="logs-content">
            {logs.slice(-50).map((log, i) => (
              <pre key={i}>{ansiToHtml(log)}</pre>
            ))}
          </div>
        </div>
      )}

      {/* Settings link */}
      <button className="building-popup-settings" onClick={onOpenSettings}>
        Full Settings
      </button>
    </div>
  );
}
