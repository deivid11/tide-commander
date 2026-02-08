import React from 'react';
import { store } from '../../store';
import { ansiToHtml } from './utils';

interface BuildingLogsPanelProps {
  logs: string[];
  buildingId: string;
  logsContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function BuildingLogsPanel({ logs, buildingId, logsContainerRef }: BuildingLogsPanelProps) {
  return (
    <div className="form-section logs-section">
      <label className="form-label">
        Logs
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => store.clearBuildingLogs(buildingId)}
        >
          Clear
        </button>
      </label>
      <div className="logs-container" ref={logsContainerRef}>
        {logs.map((log, i) => (
          <pre key={i} className="log-entry">
            {ansiToHtml(log)}
          </pre>
        ))}
      </div>
    </div>
  );
}
