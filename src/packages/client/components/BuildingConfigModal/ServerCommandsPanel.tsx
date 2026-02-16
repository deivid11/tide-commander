import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['terminal', 'common']);
  return (
    <div className="form-section commands-section">
      <label className="form-label">
        {t('terminal:building.commands')}
        <HelpTooltip
          text={t('terminal:building.helpCommands')}
          title={t('terminal:building.commands')}
          position="top"
          size="sm"
        />
      </label>
      <div className="command-inputs">
        <div className="command-row">
          <span className="command-label">
            {t('terminal:building.cmdStart')}
            <HelpTooltip
              text={t('terminal:building.helpCmdStart')}
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
              {t('common:buttons2.run')}
            </button>
          )}
        </div>
        <div className="command-row">
          <span className="command-label">
            {t('terminal:building.cmdStop')}
            <HelpTooltip
              text={t('terminal:building.helpCmdStop')}
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
              {t('common:buttons2.run')}
            </button>
          )}
        </div>
        <div className="command-row">
          <span className="command-label">
            {t('terminal:building.cmdRestart')}
            <HelpTooltip
              text={t('terminal:building.helpCmdRestart')}
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
              {t('common:buttons2.run')}
            </button>
          )}
        </div>
        <div className="command-row">
          <span className="command-label">
            {t('terminal:building.cmdHealthCheck')}
            <HelpTooltip
              text={t('terminal:building.helpCmdHealthCheck')}
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
              {t('terminal:building.check')}
            </button>
          )}
        </div>
        <div className="command-row">
          <span className="command-label">
            {t('terminal:building.cmdLogs')}
            <HelpTooltip
              text={t('terminal:building.helpCmdLogs')}
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
              {t('terminal:building.fetch')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
