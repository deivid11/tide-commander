import React from 'react';
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
          Use PM2 Process Manager
        </span>
      </label>
      <div className="form-hint">
        PM2 keeps processes running after commander closes. Requires PM2 installed globally (npm i -g pm2).
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
  if (!usePM2) return null;

  return (
    <div className="form-section pm2-config-section">
      <label className="form-label">PM2 Configuration</label>

      <div className="command-row">
        <span className="command-label">
          Script:
          <HelpTooltip
            text="The application or command PM2 should run. Can be an executable (npm, java, python), a script file (app.js), or a binary."
            title="Script"
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
          Arguments:
          <HelpTooltip
            text="Command-line arguments passed to the script. For npm use 'run dev', for Java JARs the args come after the JAR file."
            title="Arguments"
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
          Interpreter:
          <HelpTooltip
            text="The runtime used to execute the script. Leave as 'Auto-detect' for most cases. Use 'None' when script is a direct executable."
            title="Interpreter"
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
          Interp. Args:
          <HelpTooltip
            text="Arguments passed to the interpreter itself, not the script. For Java use '-jar' to run JAR files. For Node use '--inspect' for debugging."
            title="Interpreter Arguments"
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
          Environment:
          <HelpTooltip
            text="Environment variables in KEY=value format, one per line. These are passed to the process on startup."
            title="Environment Variables"
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
          <summary>Configuration Examples</summary>
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
            Start
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => handleCommand('stop')}
          >
            Stop
          </button>
          <button
            type="button"
            className="btn btn-sm btn-warning"
            onClick={() => handleCommand('restart')}
          >
            Restart
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => handleCommand('logs')}
          >
            Logs
          </button>
        </div>
      )}
    </div>
  );
}
