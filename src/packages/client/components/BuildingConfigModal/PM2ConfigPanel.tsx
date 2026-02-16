import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  PM2_INTERPRETERS,
  type PM2Interpreter,
  type Building,
} from '../../../shared/types';
import { HelpTooltip } from '../shared/Tooltip';
import { formatBytes, formatUptime } from './utils';

interface PM2ConfigPanelProps {
  usePM2: boolean;
  pm2Script: string;
  setPm2Script: (v: string) => void;
  pm2Args: string;
  setPm2Args: (v: string) => void;
  pm2Interpreter: PM2Interpreter;
  setPm2Interpreter: (v: PM2Interpreter) => void;
  pm2InterpreterArgs: string;
  setPm2InterpreterArgs: (v: string) => void;
  pm2Env: string;
  setPm2Env: (v: string) => void;
  isEditMode: boolean;
  building: Building | null;
  handleCommand: (cmd: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs') => void;
}

export function PM2ToggleSection({ usePM2, setUsePM2 }: { usePM2: boolean; setUsePM2: (v: boolean) => void }) {
  const { t } = useTranslation(['terminal']);
  return (
    <div className="form-section pm2-toggle-section">
      <label className="toggle-switch">
        <input
          type="checkbox"
          className="toggle-input"
          checked={usePM2}
          onChange={(e) => setUsePM2(e.target.checked)}
        />
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
        <span className="toggle-label">
          <span className="pm2-badge">PM2</span>
          {t('terminal:building.usePM2')}
        </span>
      </label>
      <div className="form-hint">
        {t('terminal:building.pm2Hint')}
      </div>
    </div>
  );
}

export function PM2ConfigPanel({
  usePM2,
  pm2Script,
  setPm2Script,
  pm2Args,
  setPm2Args,
  pm2Interpreter,
  setPm2Interpreter,
  pm2InterpreterArgs,
  setPm2InterpreterArgs,
  pm2Env,
  setPm2Env,
  isEditMode,
  building,
  handleCommand,
}: PM2ConfigPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  if (!usePM2) return null;

  return (
    <div className="form-section pm2-config-section">
      <label className="form-label">{t('terminal:building.pm2Configuration')}</label>

      <div className="command-row">
        <span className="command-label">
          {t('terminal:building.pm2Script')}
          <HelpTooltip
            text={t('terminal:building.helpPm2Script')}
            title={t('terminal:building.pm2Script')}
            position="top"
            size="sm"
          />
        </span>
        <input
          type="text"
          className="form-input"
          value={pm2Script}
          onChange={(e) => setPm2Script(e.target.value)}
          placeholder="npm, java, python, ./app.js"
          required={usePM2}
        />
      </div>

      <div className="command-row">
        <span className="command-label">
          {t('terminal:building.pm2Arguments')}
          <HelpTooltip
            text={t('terminal:building.helpPm2Arguments')}
            title={t('terminal:building.pm2Arguments')}
            position="top"
            size="sm"
          />
        </span>
        <input
          type="text"
          className="form-input"
          value={pm2Args}
          onChange={(e) => setPm2Args(e.target.value)}
          placeholder="run dev, -jar app.jar, app.py"
        />
      </div>

      <div className="command-row">
        <span className="command-label">
          {t('terminal:building.pm2Interpreter')}
          <HelpTooltip
            text={t('terminal:building.helpPm2Interpreter')}
            title={t('terminal:building.pm2Interpreter')}
            position="top"
            size="sm"
          />
        </span>
        <select
          className="form-input form-select"
          value={pm2Interpreter}
          onChange={(e) => setPm2Interpreter(e.target.value as PM2Interpreter)}
        >
          {(Object.keys(PM2_INTERPRETERS) as PM2Interpreter[]).map((interp) => (
            <option key={interp} value={interp}>
              {PM2_INTERPRETERS[interp].label}
            </option>
          ))}
        </select>
      </div>

      <div className="command-row">
        <span className="command-label">
          {t('terminal:building.pm2InterpArgs')}
          <HelpTooltip
            text={t('terminal:building.helpPm2InterpArgs')}
            title={t('terminal:building.pm2InterpArgs')}
            position="top"
            size="sm"
          />
        </span>
        <input
          type="text"
          className="form-input"
          value={pm2InterpreterArgs}
          onChange={(e) => setPm2InterpreterArgs(e.target.value)}
          placeholder="-jar (for Java)"
        />
      </div>

      <div className="command-row env-row">
        <span className="command-label">
          {t('terminal:building.pm2Environment')}
          <HelpTooltip
            text={t('terminal:building.helpPm2Environment')}
            title={t('terminal:building.pm2Environment')}
            position="top"
            size="sm"
          />
        </span>
        <textarea
          className="form-input form-textarea"
          value={pm2Env}
          onChange={(e) => setPm2Env(e.target.value)}
          placeholder="KEY=value&#10;SERVER_PORT=7201&#10;NODE_ENV=production"
          rows={3}
        />
      </div>

      <div className="pm2-examples">
        <details>
          <summary>{t('terminal:building.pm2Examples')}</summary>
          <div className="pm2-examples-content">
            <div className="pm2-example">
              <strong>Node.js:</strong> Script: <code>npm</code>, Args: <code>run dev</code>
            </div>
            <div className="pm2-example">
              <strong>Symfony:</strong> Script: <code>symfony</code>, Args: <code>serve --no-daemon</code>, Interpreter: <code>None</code>
            </div>
            <div className="pm2-example">
              <strong>Java JAR:</strong> Script: <code>app.jar</code>, Interpreter: <code>Java</code>, Interp. Args: <code>-jar</code>
            </div>
            <div className="pm2-example">
              <strong>Python:</strong> Script: <code>app.py</code>, Interpreter: <code>Python 3</code>
            </div>
          </div>
        </details>
      </div>

      {/* PM2 Status Display */}
      {isEditMode && building?.pm2Status && (
        <div className="pm2-status-display">
          <div className="pm2-status-row">
            <span className="pm2-metric">
              <span className="pm2-metric-label">PID</span>
              <span className="pm2-metric-value">{building.pm2Status.pid || '-'}</span>
            </span>
            <span className="pm2-metric">
              <span className="pm2-metric-label">CPU</span>
              <span className="pm2-metric-value">{building.pm2Status.cpu?.toFixed(1) || '0'}%</span>
            </span>
            <span className="pm2-metric">
              <span className="pm2-metric-label">MEM</span>
              <span className="pm2-metric-value">{formatBytes(building.pm2Status.memory || 0)}</span>
            </span>
            <span className="pm2-metric">
              <span className="pm2-metric-label">Restarts</span>
              <span className="pm2-metric-value">{building.pm2Status.restarts || 0}</span>
            </span>
            {building.pm2Status.uptime && (
              <span className="pm2-metric">
                <span className="pm2-metric-label">Uptime</span>
                <span className="pm2-metric-value">{formatUptime(building.pm2Status.uptime)}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* PM2 Action Buttons */}
      {isEditMode && (
        <div className="pm2-actions">
          <button
            type="button"
            className="btn btn-sm btn-success"
            onClick={() => handleCommand('start')}
          >
            {t('common:buttons.start')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => handleCommand('stop')}
          >
            {t('common:buttons.stop')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-warning"
            onClick={() => handleCommand('restart')}
          >
            {t('terminal:buildingAction.restart')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => handleCommand('logs')}
          >
            {t('terminal:logs.title')}
          </button>
        </div>
      )}
    </div>
  );
}
