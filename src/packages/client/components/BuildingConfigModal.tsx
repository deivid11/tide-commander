import React, { useState, useEffect, useRef, useMemo } from 'react';
import { store, useStore } from '../store';
import {
  BUILDING_TYPES,
  BUILDING_STYLES,
  PM2_INTERPRETERS,
  type Building,
  type BuildingType,
  type BuildingStyle,
  type PM2Interpreter,
} from '../../shared/types';
import { BUILDING_STATUS_COLORS } from '../utils/colors';
import { STORAGE_KEYS, getStorageString } from '../utils/storage';

interface BuildingConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  buildingId?: string | null; // If provided, edit mode; otherwise create mode
  initialPosition?: { x: number; z: number };
}

// Preset colors for building customization
const BUILDING_COLORS = [
  { value: '', label: 'Default' },
  { value: '#2a2a3a', label: 'Dark Gray' },
  { value: '#3a2a2a', label: 'Dark Red' },
  { value: '#2a3a2a', label: 'Dark Green' },
  { value: '#2a2a4a', label: 'Dark Blue' },
  { value: '#3a3a2a', label: 'Dark Yellow' },
  { value: '#3a2a3a', label: 'Dark Purple' },
  { value: '#2a3a3a', label: 'Dark Cyan' },
  { value: '#4a3a3a', label: 'Warm Brown' },
  { value: '#3a4a4a', label: 'Cool Steel' },
];

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format uptime to human readable
function formatUptime(startTime: number): string {
  const now = Date.now();
  const diff = now - startTime;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ANSI color code to CSS color mapping
const ANSI_COLORS: Record<number, string> = {
  30: '#1a1a1a', 31: '#e74c3c', 32: '#2ecc71', 33: '#f39c12',
  34: '#3498db', 35: '#9b59b6', 36: '#00bcd4', 37: '#ecf0f1',
  90: '#7f8c8d', 91: '#ff6b6b', 92: '#4ade80', 93: '#fbbf24',
  94: '#60a5fa', 95: '#c084fc', 96: '#22d3ee', 97: '#ffffff',
};

// Convert ANSI escape codes to HTML spans with colors
function ansiToHtml(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // eslint-disable-next-line no-control-regex
  const regex = /\x1B\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | null = null;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textPart = text.slice(lastIndex, match.index);
      if (currentColor) {
        parts.push(<span key={parts.length} style={{ color: currentColor }}>{textPart}</span>);
      } else {
        parts.push(textPart);
      }
    }
    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0 || code === 39) currentColor = null;
      else if (ANSI_COLORS[code]) currentColor = ANSI_COLORS[code];
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const textPart = text.slice(lastIndex);
    if (currentColor) {
      parts.push(<span key={parts.length} style={{ color: currentColor }}>{textPart}</span>);
    } else {
      parts.push(textPart);
    }
  }
  return parts.length > 0 ? parts : [text];
}

// Delete confirmation modal
interface DeleteConfirmModalProps {
  buildingName: string;
  onClose: () => void;
  onConfirm: () => void;
}

function DeleteConfirmModal({ buildingName, onClose, onConfirm }: DeleteConfirmModalProps) {
  return (
    <div className="modal-overlay visible" onClick={onClose}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">Delete Building</div>
        <div className="modal-body confirm-modal-body">
          <p>
            Delete <strong>{buildingName}</strong>?
          </p>
          <p className="confirm-modal-note">
            This will permanently remove the building and its configuration.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} autoFocus>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function BuildingConfigModal({
  isOpen,
  onClose,
  buildingId,
  initialPosition,
}: BuildingConfigModalProps) {
  const { buildings, buildingLogs, bossStreamingLogs } = useStore();
  const building = buildingId ? buildings.get(buildingId) : null;
  const currentBossLogs = buildingId ? (bossStreamingLogs.get(buildingId) || []) : [];
  const isEditMode = !!building;

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<BuildingType>('server');
  const [style, setStyle] = useState<BuildingStyle>('server-rack');
  const [color, setColor] = useState('');
  const [cwd, setCwd] = useState('');
  const [startCmd, setStartCmd] = useState('');
  const [stopCmd, setStopCmd] = useState('');
  const [restartCmd, setRestartCmd] = useState('');
  const [healthCheckCmd, setHealthCheckCmd] = useState('');
  const [logsCmd, setLogsCmd] = useState('');
  const [urls, setUrls] = useState<{ label: string; url: string }[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [scale, setScale] = useState(1.0);

  // PM2 state
  const [usePM2, setUsePM2] = useState(false);
  const [pm2Script, setPm2Script] = useState('');
  const [pm2Args, setPm2Args] = useState('');
  const [pm2Interpreter, setPm2Interpreter] = useState<PM2Interpreter>('');
  const [pm2InterpreterArgs, setPm2InterpreterArgs] = useState('');
  const [pm2Env, setPm2Env] = useState('');  // KEY=value format, one per line
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Boss building state
  const [subordinateBuildingIds, setSubordinateBuildingIds] = useState<string[]>([]);
  const [showBossLogs, setShowBossLogs] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const bossLogsContainerRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (building) {
        // Edit mode - populate from building
        setName(building.name);
        setType(building.type);
        setStyle(building.style || 'server-rack');
        setColor(building.color || '');
        setCwd(building.cwd || '');
        setStartCmd(building.commands?.start || '');
        setStopCmd(building.commands?.stop || '');
        setRestartCmd(building.commands?.restart || '');
        setHealthCheckCmd(building.commands?.healthCheck || '');
        setLogsCmd(building.commands?.logs || '');
        setUrls(building.urls || []);
        setFolderPath(building.folderPath || '');
        setScale(building.scale || 1.0);
        // PM2 fields
        setUsePM2(building.pm2?.enabled || false);
        setPm2Script(building.pm2?.script || '');
        setPm2Args(building.pm2?.args || '');
        setPm2Interpreter((building.pm2?.interpreter as PM2Interpreter) || '');
        setPm2InterpreterArgs(building.pm2?.interpreterArgs || '');
        // Convert env object to KEY=value lines
        setPm2Env(building.pm2?.env
          ? Object.entries(building.pm2.env).map(([k, v]) => `${k}=${v}`).join('\n')
          : '');
        // Boss building fields
        setSubordinateBuildingIds(building.subordinateBuildingIds || []);
      } else {
        // Create mode - reset
        setName('New Server');
        setType('server');
        setStyle('server-rack');
        setColor('');
        setCwd(getStorageString(STORAGE_KEYS.LAST_CWD));
        setStartCmd('');
        setStopCmd('');
        setRestartCmd('');
        setHealthCheckCmd('');
        setLogsCmd('');
        setUrls([]);
        setFolderPath('');
        setScale(1.0);
        // PM2 fields
        setUsePM2(false);
        setPm2Script('');
        setPm2Args('');
        setPm2Interpreter('');
        setPm2InterpreterArgs('');
        setPm2Env('');
        // Boss building fields
        setSubordinateBuildingIds([]);
      }

      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [isOpen, building]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [buildingLogs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const buildingData = {
      name,
      type,
      style,
      color: color || undefined,
      position: initialPosition || building?.position || { x: 0, z: 0 },
      cwd: cwd || undefined,
      folderPath: folderPath || undefined,
      commands: usePM2 ? undefined : {
        start: startCmd || undefined,
        stop: stopCmd || undefined,
        restart: restartCmd || undefined,
        healthCheck: healthCheckCmd || undefined,
        logs: logsCmd || undefined,
      },
      pm2: usePM2 ? {
        enabled: true,
        script: pm2Script,
        args: pm2Args || undefined,
        interpreter: pm2Interpreter || undefined,
        interpreterArgs: pm2InterpreterArgs || undefined,
        env: pm2Env.trim() ? Object.fromEntries(
          pm2Env.trim().split('\n')
            .map(line => line.trim())
            .filter(line => line && line.includes('='))
            .map(line => {
              const idx = line.indexOf('=');
              return [line.slice(0, idx), line.slice(idx + 1)];
            })
        ) : undefined,
      } : undefined,
      urls: urls.length > 0 ? urls : undefined,
      scale: scale !== 1.0 ? scale : undefined,
      subordinateBuildingIds: type === 'boss' && subordinateBuildingIds.length > 0 ? subordinateBuildingIds : undefined,
    };

    if (isEditMode && buildingId) {
      store.updateBuilding(buildingId, buildingData);
    } else {
      store.createBuilding(buildingData as Omit<Building, 'id' | 'createdAt' | 'status'>);
    }

    onClose();
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (buildingId) {
      store.deleteBuilding(buildingId);
      setShowDeleteConfirm(false);
      onClose();
    }
  };

  const handleCommand = (cmd: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs') => {
    if (buildingId) {
      store.sendBuildingCommand(buildingId, cmd);
      if (cmd === 'logs') {
        setShowLogs(true);
      }
    }
  };

  const addUrl = () => {
    setUrls([...urls, { label: '', url: '' }]);
  };

  const removeUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  const updateUrl = (index: number, field: 'label' | 'url', value: string) => {
    const newUrls = [...urls];
    newUrls[index] = { ...newUrls[index], [field]: value };
    setUrls(newUrls);
  };

  if (!isOpen) return null;

  const logs = buildingId ? store.getBuildingLogs(buildingId) : [];

  return (
    <div className="modal-overlay visible" onClick={onClose}>
      <div className="modal building-config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEditMode ? 'Edit Building' : 'Create Building'}</span>
          {isEditMode && building && (
            <span
              className="building-status-badge"
              style={{ backgroundColor: BUILDING_STATUS_COLORS[building.status] }}
            >
              {building.status}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Basic Info */}
            <div className="form-section">
              <label className="form-label">Name</label>
              <input
                ref={nameInputRef}
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Server"
                required
              />
            </div>

            <div className="form-section">
              <label className="form-label">Type</label>
              <div className="building-type-selector">
                {(Object.keys(BUILDING_TYPES) as BuildingType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`building-type-btn ${type === t ? 'active' : ''}`}
                    onClick={() => setType(t)}
                    title={BUILDING_TYPES[t].description}
                  >
                    <span className="building-type-icon">{BUILDING_TYPES[t].icon}</span>
                    <span className="building-type-name">{t}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-section">
              <label className="form-label">Visual Style</label>
              <div className="building-style-selector">
                {(Object.keys(BUILDING_STYLES) as BuildingStyle[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`building-style-btn ${style === s ? 'active' : ''}`}
                    onClick={() => setStyle(s)}
                    title={BUILDING_STYLES[s].description}
                  >
                    <span className="building-style-preview" data-style={s} />
                    <span className="building-style-name">{BUILDING_STYLES[s].label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-section">
              <label className="form-label">Color</label>
              <div className="building-color-selector">
                {BUILDING_COLORS.map((c) => (
                  <button
                    key={c.value || 'default'}
                    type="button"
                    className={`building-color-btn ${color === c.value ? 'active' : ''}`}
                    onClick={() => setColor(c.value)}
                    title={c.label}
                    style={c.value ? { backgroundColor: c.value } : undefined}
                  >
                    {!c.value && <span className="color-default-icon">⚙</span>}
                  </button>
                ))}
                <input
                  type="color"
                  className="building-color-picker"
                  value={color || '#2a2a3a'}
                  onChange={(e) => setColor(e.target.value)}
                  title="Custom color"
                />
              </div>
            </div>

            <div className="form-section">
              <label className="form-label">Size</label>
              <div className="building-size-control">
                <div className="size-slider-row">
                  <input
                    type="range"
                    className="size-slider"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.log(scale / 0.1) / Math.log(100) * 100}
                    onChange={(e) => {
                      const sliderValue = parseFloat(e.target.value);
                      const newScale = 0.1 * Math.pow(100, sliderValue / 100);
                      setScale(Math.round(newScale * 100) / 100);
                    }}
                  />
                  <span className="size-value">{scale.toFixed(2)}x</span>
                </div>
                <div className="size-presets">
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`size-preset-btn ${scale === preset ? 'active' : ''}`}
                      onClick={() => setScale(preset)}
                    >
                      {preset}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-section">
              <label className="form-label">Working Directory</label>
              <input
                type="text"
                className="form-input"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
              />
            </div>

            {/* Folder Path Section (for folder type) */}
            {type === 'folder' && (
              <div className="form-section">
                <label className="form-label">Folder Path</label>
                <input
                  type="text"
                  className="form-input"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/path/to/folder"
                  required
                />
                <div className="form-hint">
                  Click this building to open the file explorer at this path
                </div>
              </div>
            )}

            {/* Boss Building Section */}
            {type === 'boss' && (
              <div className="form-section boss-building-section">
                <label className="form-label">Managed Buildings</label>
                <div className="form-hint">
                  Select buildings this boss will control. You can start, stop, or restart all managed buildings at once.
                </div>
                <div className="subordinate-buildings-list">
                  {Array.from(buildings.values())
                    .filter(b => b.id !== buildingId && b.type !== 'boss' && b.type !== 'link' && b.type !== 'folder')
                    .map(b => (
                      <label key={b.id} className="subordinate-building-item">
                        <input
                          type="checkbox"
                          checked={subordinateBuildingIds.includes(b.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSubordinateBuildingIds([...subordinateBuildingIds, b.id]);
                            } else {
                              setSubordinateBuildingIds(subordinateBuildingIds.filter(id => id !== b.id));
                            }
                          }}
                        />
                        <span className="subordinate-building-icon">{BUILDING_TYPES[b.type].icon}</span>
                        <span className="subordinate-building-name">{b.name}</span>
                        <span
                          className="subordinate-building-status"
                          style={{ backgroundColor: BUILDING_STATUS_COLORS[b.status] }}
                        />
                      </label>
                    ))}
                  {Array.from(buildings.values()).filter(b => b.id !== buildingId && b.type !== 'boss' && b.type !== 'link' && b.type !== 'folder').length === 0 && (
                    <div className="form-hint no-buildings-hint">
                      No manageable buildings available. Create server, database, docker, or monitor buildings first.
                    </div>
                  )}
                </div>

                {/* Boss Building Actions (edit mode only) */}
                {isEditMode && subordinateBuildingIds.length > 0 && (
                  <div className="boss-building-actions">
                    <div className="boss-actions-header">Bulk Actions</div>
                    <div className="boss-actions-row">
                      <button
                        type="button"
                        className="btn btn-sm btn-success"
                        onClick={() => store.sendBossBuildingCommand(buildingId!, 'start_all')}
                      >
                        Start All
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => store.sendBossBuildingCommand(buildingId!, 'stop_all')}
                      >
                        Stop All
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-warning"
                        onClick={() => store.sendBossBuildingCommand(buildingId!, 'restart_all')}
                      >
                        Restart All
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${showBossLogs ? 'btn-primary' : ''}`}
                        onClick={() => {
                          if (showBossLogs) {
                            store.stopBossLogStreaming(buildingId!);
                            setShowBossLogs(false);
                          } else {
                            store.startBossLogStreaming(buildingId!);
                            setShowBossLogs(true);
                          }
                        }}
                      >
                        {showBossLogs ? 'Hide Logs' : 'Unified Logs'}
                      </button>
                    </div>

                    {/* Status overview of managed buildings */}
                    <div className="boss-subordinates-status">
                      <div className="boss-status-header">Status Overview</div>
                      <div className="boss-status-grid">
                        {subordinateBuildingIds.map(id => {
                          const sub = buildings.get(id);
                          if (!sub) return null;
                          return (
                            <div key={id} className="boss-status-item">
                              <span
                                className="boss-status-indicator"
                                style={{ backgroundColor: BUILDING_STATUS_COLORS[sub.status] }}
                              />
                              <span className="boss-status-name">{sub.name}</span>
                              <span className="boss-status-label">{sub.status}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Unified Logs Display */}
                {isEditMode && showBossLogs && (
                  <div className="form-section boss-logs-section">
                    <label className="form-label">
                      Unified Logs
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => store.clearBossStreamingLogs(buildingId!)}
                      >
                        Clear
                      </button>
                    </label>
                    <div className="boss-logs-container" ref={bossLogsContainerRef}>
                      {currentBossLogs.map((entry, i) => (
                        <div key={i} className="boss-log-entry">
                          <span className="boss-log-source">[{entry.subordinateName}]</span>
                          <span className="boss-log-content">{ansiToHtml(entry.chunk)}</span>
                        </div>
                      ))}
                      {currentBossLogs.length === 0 && (
                        <div className="boss-logs-empty">Waiting for logs...</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PM2 Toggle Section (for server type) */}
            {type === 'server' && (
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
            )}

            {/* PM2 Configuration Section */}
            {type === 'server' && usePM2 && (
              <div className="form-section pm2-config-section">
                <label className="form-label">PM2 Configuration</label>

                <div className="command-row">
                  <span className="command-label">Script:</span>
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
                  <span className="command-label">Arguments:</span>
                  <input
                    type="text"
                    className="form-input"
                    value={pm2Args}
                    onChange={(e) => setPm2Args(e.target.value)}
                    placeholder="run dev, -jar app.jar, app.py"
                  />
                </div>

                <div className="command-row">
                  <span className="command-label">Interpreter:</span>
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
                  <span className="command-label">Interp. Args:</span>
                  <input
                    type="text"
                    className="form-input"
                    value={pm2InterpreterArgs}
                    onChange={(e) => setPm2InterpreterArgs(e.target.value)}
                    placeholder="-jar (for Java)"
                  />
                </div>

                <div className="command-row env-row">
                  <span className="command-label">Environment:</span>
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
            )}

            {/* Commands Section (for server type, non-PM2) */}
            {type === 'server' && !usePM2 && (
              <div className="form-section commands-section">
                <label className="form-label">Commands</label>
                <div className="command-inputs">
                  <div className="command-row">
                    <span className="command-label">Start:</span>
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
                    <span className="command-label">Stop:</span>
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
                    <span className="command-label">Restart:</span>
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
                    <span className="command-label">Health Check:</span>
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
                    <span className="command-label">Logs:</span>
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
            )}

            {/* URLs Section */}
            <div className="form-section">
              <label className="form-label">
                Links
                <button type="button" className="btn btn-sm btn-add" onClick={addUrl}>
                  + Add
                </button>
              </label>
              {urls.map((url, index) => (
                <div key={index} className="url-row">
                  <input
                    type="text"
                    className="form-input url-label"
                    value={url.label}
                    onChange={(e) => updateUrl(index, 'label', e.target.value)}
                    placeholder="Label"
                  />
                  <input
                    type="text"
                    className="form-input url-value"
                    value={url.url}
                    onChange={(e) => updateUrl(index, 'url', e.target.value)}
                    placeholder="https://..."
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => removeUrl(index)}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            {/* Logs Display */}
            {isEditMode && showLogs && logs.length > 0 && (
              <div className="form-section logs-section">
                <label className="form-label">
                  Logs
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => store.clearBuildingLogs(buildingId!)}
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
            )}
          </div>

          <div className="modal-footer">
            {isEditMode && (
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                Delete
              </button>
            )}
            <div className="footer-spacer" />
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEditMode ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>

      {showDeleteConfirm && building && (
        <DeleteConfirmModal
          buildingName={building.name}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
