/**
 * BossLogsModal - Real-time unified log viewer for Boss buildings
 *
 * Shows aggregated logs from all subordinate PM2-managed buildings
 * with color-coded source labels for each subordinate.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { store, useStore } from '../store';
import { ansiToHtml } from '../utils/ansiToHtml';
import type { Building } from '../../shared/types';

interface BossLogsModalProps {
  building: Building;
  isOpen: boolean;
  onClose: () => void;
}

// Generate a consistent color for each source name
function getSourceColor(name: string): string {
  const colors = [
    '#3498db', // blue
    '#2ecc71', // green
    '#9b59b6', // purple
    '#e67e22', // orange
    '#1abc9c', // teal
    '#e74c3c', // red
    '#f1c40f', // yellow
    '#00bcd4', // cyan
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function BossLogsModal({ building, isOpen, onClose }: BossLogsModalProps) {
  const { bossStreamingLogs, buildings } = useStore();
  const logs = bossStreamingLogs.get(building.id) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [lineWrap, setLineWrap] = useState(true);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isAutoScrollingRef = useRef(false);
  const lastLogsLengthRef = useRef(0);

  // Get subordinate buildings
  const subordinateIds = building.subordinateBuildingIds || [];
  const subordinates = subordinateIds
    .map(id => buildings.get(id))
    .filter((b): b is Building => b !== undefined);

  // Get unique source names for filter
  const sourceNames = useMemo(() => {
    const names = new Set<string>();
    logs.forEach(log => names.add(log.subordinateName));
    return Array.from(names);
  }, [logs]);

  // Filter logs based on search and source
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Filter by source
      if (selectedSource && log.subordinateName !== selectedSource) {
        return false;
      }
      // Filter by search query
      if (searchQuery && !log.chunk.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [logs, searchQuery, selectedSource]);

  // Start streaming when modal opens
  useEffect(() => {
    if (isOpen && subordinateIds.length > 0) {
      store.startBossLogStreaming(building.id);
    }

    return () => {
      if (building.id) {
        store.stopBossLogStreaming(building.id);
      }
    };
  }, [isOpen, building.id, subordinateIds.length]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current && logs.length > lastLogsLengthRef.current) {
      isAutoScrollingRef.current = true;
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
        // Reset flag after a short delay to allow scroll event to fire
        setTimeout(() => {
          isAutoScrollingRef.current = false;
        }, 50);
      });
    }
    lastLogsLengthRef.current = logs.length;
  }, [logs, autoScroll]);

  // Handle scroll - disable auto-scroll if user scrolls up
  const handleScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;

    const container = logsContainerRef.current;
    if (!container) return;

    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  }, [autoScroll]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close - stop propagation to prevent closing other modals (like Guake terminal)
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (showSearch) {
          setShowSearch(false);
        } else {
          onClose();
        }
        return;
      }

      // / to open search
      if (e.key === '/' && !showSearch) {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      // Ctrl+End to scroll to bottom
      if (e.ctrlKey && e.key === 'End') {
        e.preventDefault();
        setAutoScroll(true);
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
      }
    };

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, showSearch, onClose]);

  // Focus search input when shown
  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  if (!isOpen) return null;

  const hasPM2Subordinates = subordinates.some(s => s.pm2?.enabled);

  return (
    <div className="pm2-logs-modal-overlay" onClick={onClose}>
      <div className="pm2-logs-modal boss-logs-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="pm2-logs-modal-header">
          <div className="header-left">
            <span className="modal-icon">👑</span>
            <span className="modal-title">{building.name} - Unified Logs</span>
            <span className="streaming-indicator">
              <span className="pulse"></span>
              {subordinates.length} units
            </span>
          </div>
          <div className="header-right">
            <span className="line-count">{filteredLogs.length} entries</span>
            <button className="modal-close" onClick={onClose} title="Close (Esc)">
              &times;
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="pm2-logs-modal-toolbar">
          <div className="toolbar-left">
            <button
              className={`toolbar-btn ${showSearch ? 'active' : ''}`}
              onClick={() => setShowSearch(!showSearch)}
              title="Search (/)"
            >
              &#128269; Search
            </button>
            {sourceNames.length > 1 && (
              <select
                className="toolbar-btn source-filter"
                value={selectedSource || ''}
                onChange={e => setSelectedSource(e.target.value || null)}
              >
                <option value="">All Sources</option>
                {sourceNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            )}
            <button
              className={`toolbar-btn ${lineWrap ? 'active' : ''}`}
              onClick={() => setLineWrap(!lineWrap)}
              title="Toggle line wrap"
            >
              &#8629; Wrap
            </button>
          </div>
          <div className="toolbar-right">
            <button
              className={`toolbar-btn ${autoScroll ? 'active' : ''}`}
              onClick={() => {
                setAutoScroll(!autoScroll);
                if (!autoScroll && logsContainerRef.current) {
                  logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
                }
              }}
              title="Auto-scroll (Ctrl+End)"
            >
              &#8595; Auto-scroll
            </button>
            <button
              className="toolbar-btn danger"
              onClick={() => store.clearBossStreamingLogs(building.id)}
              title="Clear logs"
            >
              &#128465; Clear
            </button>
          </div>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="pm2-logs-search-bar">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setShowSearch(false);
                  setSearchQuery('');
                }
              }}
            />
            <span className="match-count">
              {searchQuery ? `${filteredLogs.length} matches` : ''}
            </span>
            <button className="search-close" onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
              &times;
            </button>
          </div>
        )}

        {/* Logs content */}
        <div
          ref={logsContainerRef}
          className={`pm2-logs-content ${lineWrap ? 'wrap' : 'nowrap'}`}
          onScroll={handleScroll}
        >
          {!hasPM2Subordinates ? (
            <div className="empty-state">
              No PM2-enabled subordinates. Add subordinate buildings with PM2 enabled to see unified logs.
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="empty-state">
              {logs.length === 0 ? 'Waiting for logs...' : 'No matching logs found'}
            </div>
          ) : (
            filteredLogs.map((log, i) => (
              <div key={i} className={`log-line boss-log-line ${log.isError ? 'error-line' : ''}`}>
                <span
                  className="boss-log-source"
                  style={{ color: getSourceColor(log.subordinateName) }}
                >
                  [{log.subordinateName}]
                </span>
                <span
                  className="line-content"
                  dangerouslySetInnerHTML={{ __html: ansiToHtml(log.chunk) }}
                />
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="pm2-logs-modal-footer">
          <div className="shortcut">
            <kbd>/</kbd>
            <span>Search</span>
          </div>
          <div className="shortcut">
            <kbd>Ctrl</kbd>+<kbd>End</kbd>
            <span>Jump to bottom</span>
          </div>
          <div className="shortcut">
            <kbd>Esc</kbd>
            <span>Close</span>
          </div>
          {selectedSource && (
            <div className="shortcut" style={{ marginLeft: 'auto' }}>
              <span>Filtered: {selectedSource}</span>
              <button
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: '0.5rem' }}
                onClick={() => setSelectedSource(null)}
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
