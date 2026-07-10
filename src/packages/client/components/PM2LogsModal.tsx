/**
 * PM2LogsModal - Real-time streaming log viewer for PM2-managed buildings
 * Thin wrapper around LogViewerModal that handles PM2 streaming lifecycle.
 *
 * Adds, on top of the shared viewer:
 *  - Process controls (restart / stop) wired to POST /api/buildings/:id/command
 *    with success/error feedback; the new process status is reflected from the
 *    store as the backend broadcasts it.
 *  - Exposed listening ports + live process status in the header.
 *  - A proper loading state (handled by LogViewerModal) so the content area is
 *    never a blank black screen while the first logs arrive.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../store';
import { useStreamingBuildingLogs, useStreamingBuildingIds } from '../store/selectors';
import { LogViewerModal } from './LogViewerModal';
import type { LogLine } from './LogViewerModal';
import { apiUrl, authFetch } from '../utils/storage';
import type { Building } from '../../shared/types';

interface PM2LogsModalProps {
  building: Building;
  isOpen: boolean;
  onClose: () => void;
  /** Minimize — dock the logs as a compact bottom panel. */
  onMinimize?: () => void;
}

type ProcessCommand = 'restart' | 'stop';

export function PM2LogsModal({ building, isOpen, onClose, onMinimize }: PM2LogsModalProps) {
  const { t } = useTranslation(['terminal']);
  const streamingBuildingLogs = useStreamingBuildingLogs();
  const streamingBuildingIds = useStreamingBuildingIds();
  const logs = streamingBuildingLogs.get(building.id) || '';
  const isStreaming = streamingBuildingIds.has(building.id);

  const [actionPending, setActionPending] = useState<ProcessCommand | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Start streaming when modal opens
  // Server handles deduplication via stream generations to prevent duplicate logs
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

  // Auto-dismiss action feedback after a few seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Reset transient UI state when reopened for a different building
  useEffect(() => {
    setFeedback(null);
    setActionPending(null);
  }, [building.id, isOpen]);

  // Convert raw log string to LogLine[].
  // NOTE: ''.split('\n') === [''] (length 1), which previously rendered a single
  // blank line and made the content area look like a black screen while loading.
  // Returning [] for empty logs lets LogViewerModal show its loading/empty state.
  const lines: LogLine[] = useMemo(() => {
    if (!logs) return [];
    return logs.split('\n').map((text, i) => ({
      text,
      lineNumber: i + 1,
    }));
  }, [logs]);

  const runCommand = useCallback(async (command: ProcessCommand) => {
    setActionPending(command);
    setFeedback(null);
    try {
      const res = await authFetch(apiUrl(`/api/buildings/${building.id}/command`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await res.json().catch(() => ({} as { success?: boolean; error?: string }));
      if (res.ok && data?.success !== false) {
        setFeedback({
          kind: 'success',
          text: command === 'restart'
            ? t('terminal:logs.restartSuccess')
            : t('terminal:logs.stopSuccess'),
        });
      } else {
        setFeedback({ kind: 'error', text: data?.error || t('terminal:logs.actionFailed') });
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message || t('terminal:logs.actionFailed') });
    } finally {
      setActionPending(null);
    }
  }, [building.id, t]);

  // Live process status + exposed ports (kept fresh by the store's PM2 polling)
  const processStatus = building.pm2Status?.status || building.status;
  const ports = building.pm2Status?.ports ?? [];

  const headerInfo = (
    <>
      {processStatus && (
        <span className={`pm2-status-badge status-${processStatus}`} title={t('terminal:logs.status')}>
          {processStatus}
        </span>
      )}
      {ports.length > 0 ? (
        <span className="pm2-ports-badge" title={t('terminal:logs.ports')}>
          {t('terminal:logs.ports')}:
          {ports.map((port) => (
            <a
              key={port}
              className="pm2-port-link"
              href={`http://localhost:${port}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`http://localhost:${port}`}
              onClick={(e) => e.stopPropagation()}
            >
              {port}
            </a>
          ))}
        </span>
      ) : (
        <span className="pm2-ports-badge" title={t('terminal:logs.ports')}>
          {t('terminal:logs.noPorts')}
        </span>
      )}
    </>
  );

  const extraToolbar = (
    <span className="pm2-process-controls">
      <button
        className="toolbar-btn"
        onClick={() => runCommand('restart')}
        disabled={actionPending !== null}
        title={t('terminal:logs.restart')}
      >
        &#8635; {actionPending === 'restart' ? t('terminal:logs.restarting') : t('terminal:logs.restart')}
      </button>
      <button
        className="toolbar-btn danger"
        onClick={() => runCommand('stop')}
        disabled={actionPending !== null}
        title={t('terminal:logs.stop')}
      >
        &#9632; {actionPending === 'stop' ? t('terminal:logs.stopping') : t('terminal:logs.stop')}
      </button>
      {feedback && (
        <span className={`pm2-action-feedback ${feedback.kind}`} role="status">
          {feedback.text}
        </span>
      )}
    </span>
  );

  return (
    <LogViewerModal
      isOpen={isOpen}
      onClose={onClose}
      onMinimize={onMinimize}
      title={`${building.name} - ${t('terminal:logs.pm2Logs')}`}
      icon="&#128196;"
      lines={lines}
      isStreaming={isStreaming}
      isLoading={isOpen && building.pm2?.enabled === true && lines.length === 0}
      headerInfo={headerInfo}
      extraToolbar={extraToolbar}
      onClear={() => store.clearStreamingLogs(building.id)}
    />
  );
}
