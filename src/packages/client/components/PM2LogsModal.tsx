/**
 * PM2LogsModal - Real-time streaming log viewer for PM2-managed buildings
 * Thin wrapper around LogViewerModal that handles PM2 streaming lifecycle.
 */

import React, { useEffect, useMemo } from 'react';
import { store, useStore } from '../store';
import { LogViewerModal } from './LogViewerModal';
import type { LogLine } from './LogViewerModal';
import type { Building } from '../../shared/types';

interface PM2LogsModalProps {
  building: Building;
  isOpen: boolean;
  onClose: () => void;
}

export function PM2LogsModal({ building, isOpen, onClose }: PM2LogsModalProps) {
  const { streamingBuildingLogs, streamingBuildingIds } = useStore();
  const logs = streamingBuildingLogs.get(building.id) || '';
  const isStreaming = streamingBuildingIds.has(building.id);

  // Start streaming when modal opens
  useEffect(() => {
    if (isOpen && building.pm2?.enabled) {
      store.startLogStreaming(building.id, 200);
    }
    return () => {
      if (building.id) {
        store.stopLogStreaming(building.id);
      }
    };
  }, [isOpen, building.id, building.pm2?.enabled]);

  // Convert raw log string to LogLine[]
  const lines: LogLine[] = useMemo(() => {
    return logs.split('\n').map((text, i) => ({
      text,
      lineNumber: i + 1,
    }));
  }, [logs]);

  return (
    <LogViewerModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${building.name} - Logs`}
      icon="&#128196;"
      lines={lines}
      isStreaming={isStreaming}
      onClear={() => store.clearStreamingLogs(building.id)}
    />
  );
}
