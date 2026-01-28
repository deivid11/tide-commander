/**
 * BossLogsModal - Real-time unified log viewer for Boss buildings
 * Thin wrapper around LogViewerModal that handles boss streaming lifecycle
 * and adds source filtering.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { store, useStore } from '../store';
import { LogViewerModal } from './LogViewerModal';
import type { LogLine } from './LogViewerModal';
import type { Building } from '../../shared/types';

interface BossLogsModalProps {
  building: Building;
  isOpen: boolean;
  onClose: () => void;
}

// Generate a consistent color for each source name
function getSourceColor(name: string): string {
  const colors = [
    '#3498db', '#2ecc71', '#9b59b6', '#e67e22',
    '#1abc9c', '#e74c3c', '#f1c40f', '#00bcd4',
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
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const subordinateIds = building.subordinateBuildingIds || [];
  const subordinates = subordinateIds
    .map(id => buildings.get(id))
    .filter((b): b is Building => b !== undefined);

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

  // Get unique source names for filter
  const sourceNames = useMemo(() => {
    const names = new Set<string>();
    logs.forEach(log => names.add(log.subordinateName));
    return Array.from(names);
  }, [logs]);

  // Filter by source, then convert to LogLine[]
  const lines: LogLine[] = useMemo(() => {
    const filtered = selectedSource
      ? logs.filter(log => log.subordinateName === selectedSource)
      : logs;

    return filtered.map((log, i) => ({
      text: log.chunk,
      lineNumber: i + 1,
      sourceLabel: log.subordinateName,
      sourceColor: getSourceColor(log.subordinateName),
      isError: log.isError,
    }));
  }, [logs, selectedSource]);

  const hasPM2Subordinates = subordinates.some(s => s.pm2?.enabled);

  const sourceFilter = sourceNames.length > 1 ? (
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
  ) : undefined;

  const extraFooter = selectedSource ? (
    <div className="shortcut" style={{ marginLeft: 'auto' }}>
      <span>Filtered: {selectedSource}</span>
      <button
        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: '0.5rem' }}
        onClick={() => setSelectedSource(null)}
      >
        x
      </button>
    </div>
  ) : undefined;

  return (
    <LogViewerModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${building.name} - Unified Logs`}
      icon="&#128081;"
      lines={lines}
      isStreaming={subordinateIds.length > 0}
      streamingIndicatorLabel={`${subordinates.length} units`}
      onClear={() => store.clearBossStreamingLogs(building.id)}
      emptyMessage={
        !hasPM2Subordinates
          ? 'No PM2-enabled subordinates. Add subordinate buildings with PM2 enabled to see unified logs.'
          : logs.length === 0
            ? 'Waiting for logs...'
            : 'No matching logs found'
      }
      extraToolbar={sourceFilter}
      extraFooter={extraFooter}
      modalClassName="boss-logs-modal"
    />
  );
}
