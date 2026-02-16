/**
 * DockerLogsModal - Real-time streaming log viewer for Docker-managed buildings
 * Thin wrapper around LogViewerModal that handles Docker streaming lifecycle.
 */

import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useStore } from '../store';
import { LogViewerModal } from './LogViewerModal';
import type { LogLine } from './LogViewerModal';
import type { Building } from '../../shared/types';

interface DockerLogsModalProps {
  building: Building;
  isOpen: boolean;
  onClose: () => void;
}

export function DockerLogsModal({ building, isOpen, onClose }: DockerLogsModalProps) {
  const { t } = useTranslation(['terminal']);
  const { streamingBuildingLogs, streamingBuildingIds } = useStore();
  const logs = streamingBuildingLogs.get(building.id) || '';
  const isStreaming = streamingBuildingIds.has(building.id);

  // Start streaming when modal opens
  useEffect(() => {
    if (isOpen && building.docker?.enabled) {
      store.startLogStreaming(building.id, 200);
    }
    return () => {
      if (building.id) {
        store.stopLogStreaming(building.id);
      }
    };
  }, [isOpen, building.id, building.docker?.enabled]);

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
      title={`${building.name} - ${t('terminal:logs.dockerLogs')}`}
      icon="&#128051;" // whale emoji
      lines={lines}
      isStreaming={isStreaming}
      onClear={() => store.clearStreamingLogs(building.id)}
    />
  );
}
