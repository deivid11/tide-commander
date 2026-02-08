import React from 'react';
import { HelpTooltip } from '../shared/Tooltip';

interface ServerCommandsPanelProps {
  startCmd: string;
  setStartCmd: (v: string) => void;
  stopCmd: string;
  setStopCmd: (v: string) => void;
  restartCmd: string;
  setRestartCmd: (v: string) => void;
  healthCheckCmd: string;
  setHealthCheckCmd: (v: string) => void;
  logsCmd: string;
  setLogsCmd: (v: string) => void;
  isEditMode: boolean;
  handleCommand: (cmd: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs') => void;
}

export function ServerCommandsPanel({
  startCmd,
  setStartCmd,
  stopCmd,
  setStopCmd,
  restartCmd,
  setRestartCmd,
  healthCheckCmd,
  setHealthCheckCmd,
  logsCmd,
  setLogsCmd,
  isEditMode,
  handleCommand,
}: ServerCommandsPanelProps) {
  return (
    <div className="form-section commands-section">
      <label className="form-label">
        Commands
        <HelpTooltip
          text="Shell commands to control this server. Commands run in the working directory. Leave empty if not needed."
          title="Server Commands"
          position="top"
          size="sm"
        />
      </label>
      <div className="command-inputs">
        <div className="command-row">
          <span className="command-label">
            Start:
            <HelpTooltip
              text="Command to start the server process. The process runs in the background."
              position="top"
              size="sm"
            />
          </span>
          <input
            type="text"
            className="form-input"
            value={startCmd}
            onChange={(e) => setStartCmd(e.target.value)}
            placeholder="npm run dev"
          />
          {isEditMode && (
            <button
              type="button"
              className="btn btn-sm btn-success"
              onClick={() => handleCommand('start')}
              disabled={!startCmd}
            >
              Run
            </button>
          )}
        </div>
        <div className="command-row">
          <span className="command-label">
            Stop:
            <HelpTooltip
              text="Command to stop the server. Use pkill, kill, or a graceful shutdown command."
              position="top"
              size="sm"
            />
          </span>
          <input
            type="text"
            className="form-input"
            value={stopCmd}
            onChange={(e) => setStopCmd(e.target.value)}
            placeholder="pkill -f 'npm run dev'"
          />
          {isEditMode && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => handleCommand('stop')}
              disabled={!stopCmd}
            >
              Run
            </button>
          )}
        </div>
        <div className="command-row">
          <span className="command-label">
            Restart:
            <HelpTooltip
              text="Command to restart the server. Can be a dedicated restart command or a stop-then-start sequence."
              position="top"
              size="sm"
            />
          </span>
          <input
            type="text"
            className="form-input"
            value={restartCmd}
            onChange={(e) => setRestartCmd(e.target.value)}
            placeholder="npm run restart"
          />
          {isEditMode && (
            <button
              type="button"
              className="btn btn-sm btn-warning"
              onClick={() => handleCommand('restart')}
              disabled={!restartCmd}
            >
              Run
            </button>
          )}
        </div>
        <div className="command-row">
          <span className="command-label">
            Health Check:
            <HelpTooltip
              text="Command to verify the server is running. Returns exit code 0 if healthy. Used for status monitoring."
              position="top"
              size="sm"
            />
          </span>
          <input
            type="text"
            className="form-input"
            value={healthCheckCmd}
            onChange={(e) => setHealthCheckCmd(e.target.value)}
            placeholder="curl -s http://localhost:3000/health"
          />
          {isEditMode && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleCommand('healthCheck')}
              disabled={!healthCheckCmd}
            >
              Check
            </button>
          )}
        </div>
        <div className="command-row">
          <span className="command-label">
            Logs:
            <HelpTooltip
              text="Command to fetch recent logs. Output appears in the logs section below."
              position="top"
              size="sm"
            />
          </span>
          <input
            type="text"
            className="form-input"
            value={logsCmd}
            onChange={(e) => setLogsCmd(e.target.value)}
            placeholder="tail -n 100 /var/log/app.log"
          />
          {isEditMode && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleCommand('logs')}
            >
              Fetch
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
