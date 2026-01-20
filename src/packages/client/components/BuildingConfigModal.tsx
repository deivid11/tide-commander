import React, { useState, useEffect, useRef } from 'react';
import { store, useStore } from '../store';
import {
  BUILDING_TYPES,
  BUILDING_STYLES,
  type Building,
  type BuildingType,
  type BuildingStyle,
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

export function BuildingConfigModal({
  isOpen,
  onClose,
  buildingId,
  initialPosition,
}: BuildingConfigModalProps) {
  const { buildings, buildingLogs } = useStore();
  const building = buildingId ? buildings.get(buildingId) : null;
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

  const nameInputRef = useRef<HTMLInputElement>(null);
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
      commands: {
        start: startCmd || undefined,
        stop: stopCmd || undefined,
        restart: restartCmd || undefined,
        healthCheck: healthCheckCmd || undefined,
        logs: logsCmd || undefined,
      },
      urls: urls.length > 0 ? urls : undefined,
    };

    if (isEditMode && buildingId) {
      store.updateBuilding(buildingId, buildingData);
    } else {
      store.createBuilding(buildingData as Omit<Building, 'id' | 'createdAt' | 'status'>);
    }

    onClose();
  };

  const handleDelete = () => {
    if (buildingId && confirm('Delete this building?')) {
      store.deleteBuilding(buildingId);
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
              <label className="form-label">Working Directory</label>
              <input
                type="text"
                className="form-input"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
              />
            </div>

            {/* Commands Section (for server type) */}
            {type === 'server' && (
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
                      {log}
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
    </div>
  );
}
