import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Building } from '../../../shared/types';

interface TerminalConfigPanelProps {
  terminalShell: string;
  setTerminalShell: (v: string) => void;
  terminalPort: string;
  setTerminalPort: (v: string) => void;
  terminalSaveSession: boolean;
  setTerminalSaveSession: (v: boolean) => void;
  terminalArgs: string;
  setTerminalArgs: (v: string) => void;
  isEditMode: boolean;
  building: Building | null;
  handleCommand: (cmd: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs') => void;
  onOpenTerminal?: (url: string) => void;
  onOpenBelow?: (buildingId: string) => void;
}

const SHELL_OPTIONS = [
  { value: '', label: 'Default ($SHELL)' },
  { value: '/bin/bash', label: 'Bash' },
  { value: '/bin/zsh', label: 'Zsh' },
  { value: '/usr/bin/fish', label: 'Fish' },
  { value: '/bin/sh', label: 'sh' },
];

export function TerminalConfigPanel({
  terminalShell,
  setTerminalShell,
  terminalPort,
  setTerminalPort,
  terminalSaveSession,
  setTerminalSaveSession,
  terminalArgs,
  setTerminalArgs,
  isEditMode,
  building,
  handleCommand,
  onOpenTerminal,
  onOpenBelow,
}: TerminalConfigPanelProps) {
  const { t } = useTranslation(['config']);
  const isRunning = building?.status === 'running';
  const terminalStatus = building?.terminalStatus;

  return (
    <>
      <div className="form-section">
        <label className="form-label">{t('config:buildings.terminalConfig', { defaultValue: 'Terminal Configuration' })}</label>

        <div className="form-row">
          <div className="form-field">
            <label className="form-sublabel">{t('config:buildings.terminalShell', { defaultValue: 'Shell' })}</label>
            <select
              className="form-input"
              value={terminalShell}
              onChange={(e) => setTerminalShell(e.target.value)}
            >
              {SHELL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label className="form-sublabel">{t('config:buildings.terminalPort', { defaultValue: 'Port' })}</label>
            <input
              type="number"
              className="form-input"
              value={terminalPort}
              onChange={(e) => setTerminalPort(e.target.value)}
              placeholder="Auto"
              min={1024}
              max={65535}
            />
          </div>
        </div>

        <div className="form-row" style={{ marginTop: '8px' }}>
          <label className="form-checkbox-label">
            <input
              type="checkbox"
              checked={terminalSaveSession}
              onChange={(e) => setTerminalSaveSession(e.target.checked)}
            />
            <span>{t('config:buildings.terminalSaveSession', { defaultValue: 'Persist session (tmux)' })}</span>
          </label>
        </div>

        <div style={{ marginTop: '8px' }}>
          <label className="form-sublabel">{t('config:buildings.terminalArgs', { defaultValue: 'Extra ttyd args' })}</label>
          <input
            type="text"
            className="form-input"
            value={terminalArgs}
            onChange={(e) => setTerminalArgs(e.target.value)}
            placeholder="--client-option titleFixed=Terminal"
          />
          <div className="form-hint">
            Additional command-line arguments passed to ttyd
          </div>
        </div>
      </div>

      {/* Runtime status & controls (edit mode only) */}
      {isEditMode && building && (
        <div className="form-section">
          <label className="form-label">{t('config:buildings.terminalControls', { defaultValue: 'Terminal Controls' })}</label>

          {terminalStatus && (
            <div className="building-runtime-info">
              <div className="runtime-row">
                <span className="runtime-label">Proxy</span>
                <span className="runtime-value" style={{ color: '#4a9eff' }}>
                  {terminalStatus.url}
                </span>
              </div>
              <div className="runtime-row">
                <span className="runtime-label">PID</span>
                <span className="runtime-value">{terminalStatus.pid}</span>
              </div>
              <div className="runtime-row">
                <span className="runtime-label">Port</span>
                <span className="runtime-value">{terminalStatus.port}</span>
              </div>
              {terminalStatus.tmuxSession && (
                <div className="runtime-row">
                  <span className="runtime-label">Session</span>
                  <span className="runtime-value">{terminalStatus.tmuxSession}</span>
                </div>
              )}
            </div>
          )}

          <div className="building-actions" style={{ marginTop: '8px' }}>
            {!isRunning && (
              <button type="button" className="btn btn-sm btn-success" onClick={() => handleCommand('start')}>
                ▶ Start
              </button>
            )}
            {isRunning && (
              <>
                <button type="button" className="btn btn-sm btn-warning" onClick={() => handleCommand('restart')}>
                  🔄 Restart
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => handleCommand('stop')}>
                  ⏹ Stop
                </button>
                {terminalStatus?.url && (
                  <>
                    {onOpenTerminal && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => onOpenTerminal(terminalStatus.url!)}
                      >
                        🖥 Modal
                      </button>
                    )}
                    {onOpenBelow && building && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => onOpenBelow(building.id)}
                      >
                        ⬇ Below
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
