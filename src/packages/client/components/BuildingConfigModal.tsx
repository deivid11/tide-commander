import React, { useState, useEffect, useRef } from 'react';
import { store, useStore, useDockerContainersList, useDockerComposeProjectsList } from '../store';
import {
  BUILDING_TYPES,
  BUILDING_STYLES,
  PM2_INTERPRETERS,
  DATABASE_ENGINES,
  DOCKER_RESTART_POLICIES,
  DOCKER_PULL_POLICIES,
  type Building,
  type BuildingType,
  type BuildingStyle,
  type PM2Interpreter,
  type DatabaseEngine,
  type DatabaseConnection,
  type DatabaseConfig,
  type DockerRestartPolicy,
  type DockerPullPolicy,
  type ExistingDockerContainer,
} from '../../shared/types';
import { BUILDING_STATUS_COLORS } from '../utils/colors';
import { STORAGE_KEYS, getStorageString } from '../utils/storage';
import { HelpTooltip } from './shared/Tooltip';
import { FolderInput } from './shared/FolderInput';
import { useModalClose } from '../hooks';

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
  const dockerContainersList = useDockerContainersList();
  const dockerComposeProjectsList = useDockerComposeProjectsList();
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

  // Docker state
  const [dockerMode, setDockerMode] = useState<'container' | 'compose' | 'existing'>('container');
  const [selectedExistingContainer, setSelectedExistingContainer] = useState<string>('');
  const [dockerImage, setDockerImage] = useState('');
  const [dockerContainerName, setDockerContainerName] = useState('');
  const [dockerPorts, setDockerPorts] = useState<string[]>([]);
  const [dockerVolumes, setDockerVolumes] = useState<string[]>([]);
  const [dockerEnv, setDockerEnv] = useState('');  // KEY=value format, one per line
  const [dockerNetwork, setDockerNetwork] = useState('');
  const [dockerCommand, setDockerCommand] = useState('');
  const [dockerRestart, setDockerRestart] = useState<DockerRestartPolicy>('unless-stopped');
  const [dockerPull, setDockerPull] = useState<DockerPullPolicy>('missing');
  const [dockerComposePath, setDockerComposePath] = useState('');
  const [dockerComposeProject, setDockerComposeProject] = useState('');
  const [dockerComposeServices, setDockerComposeServices] = useState('');

  // Boss building state
  const [subordinateBuildingIds, setSubordinateBuildingIds] = useState<string[]>([]);
  const [showBossLogs, setShowBossLogs] = useState(false);

  // Database state
  const [dbConnections, setDbConnections] = useState<DatabaseConnection[]>([]);
  const [activeDbConnectionId, setActiveDbConnectionId] = useState<string | undefined>(undefined);

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
        // Docker fields
        setDockerMode(building.docker?.mode || 'container');
        // For existing mode, use containerName as the selected container
        setSelectedExistingContainer(building.docker?.mode === 'existing' ? (building.docker?.containerName || '') : '');
        setDockerImage(building.docker?.image || '');
        setDockerContainerName(building.docker?.containerName || '');
        setDockerPorts(building.docker?.ports || []);
        setDockerVolumes(building.docker?.volumes || []);
        setDockerEnv(building.docker?.env
          ? Object.entries(building.docker.env).map(([k, v]) => `${k}=${v}`).join('\n')
          : '');
        setDockerNetwork(building.docker?.network || '');
        setDockerCommand(building.docker?.command || '');
        setDockerRestart(building.docker?.restart || 'unless-stopped');
        setDockerPull(building.docker?.pull || 'missing');
        setDockerComposePath(building.docker?.composePath || '');
        setDockerComposeProject(building.docker?.composeProject || '');
        setDockerComposeServices(building.docker?.services?.join(', ') || '');
        // Boss building fields
        setSubordinateBuildingIds(building.subordinateBuildingIds || []);
        // Database fields
        setDbConnections(building.database?.connections || []);
        setActiveDbConnectionId(building.database?.activeConnectionId);
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
        // Docker fields
        setDockerMode('container');
        setSelectedExistingContainer('');
        setDockerImage('');
        setDockerContainerName('');
        setDockerPorts([]);
        setDockerVolumes([]);
        setDockerEnv('');
        setDockerNetwork('');
        setDockerCommand('');
        setDockerRestart('unless-stopped');
        setDockerPull('missing');
        setDockerComposePath('');
        setDockerComposeProject('');
        setDockerComposeServices('');
        // Boss building fields
        setSubordinateBuildingIds([]);
        // Database fields
        setDbConnections([]);
        setActiveDbConnectionId(undefined);
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

  // Request Docker containers list when Docker type is selected or mode changes to "existing"
  useEffect(() => {
    if (type === 'docker' && dockerMode === 'existing') {
      store.requestDockerContainersList();
    }
  }, [type, dockerMode]);

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
      docker: type === 'docker' ? {
        enabled: true,
        mode: dockerMode,
        image: dockerMode === 'container' ? dockerImage : undefined,
        containerName: dockerMode === 'container' && dockerContainerName
          ? dockerContainerName
          : (dockerMode === 'existing' && selectedExistingContainer ? selectedExistingContainer : undefined),
        ports: dockerMode === 'container' && dockerPorts.length > 0 ? dockerPorts : undefined,
        volumes: dockerMode === 'container' && dockerVolumes.length > 0 ? dockerVolumes : undefined,
        env: dockerEnv.trim() ? Object.fromEntries(
          dockerEnv.trim().split('\n')
            .map(line => line.trim())
            .filter(line => line && line.includes('='))
            .map(line => {
              const idx = line.indexOf('=');
              return [line.slice(0, idx), line.slice(idx + 1)];
            })
        ) : undefined,
        network: dockerMode === 'container' && dockerNetwork ? dockerNetwork : undefined,
        command: dockerMode === 'container' && dockerCommand ? dockerCommand : undefined,
        restart: dockerMode === 'container' ? dockerRestart : undefined,
        pull: dockerMode !== 'existing' ? dockerPull : undefined,
        composePath: dockerMode === 'compose' && dockerComposePath ? dockerComposePath : undefined,
        composeProject: dockerMode === 'compose' && dockerComposeProject ? dockerComposeProject : undefined,
        services: dockerMode === 'compose' && dockerComposeServices
          ? dockerComposeServices.split(',').map(s => s.trim()).filter(s => s)
          : undefined,
      } : undefined,
      urls: urls.length > 0 ? urls : undefined,
      scale: scale !== 1.0 ? scale : undefined,
      subordinateBuildingIds: type === 'boss' && subordinateBuildingIds.length > 0 ? subordinateBuildingIds : undefined,
      database: type === 'database' && dbConnections.length > 0 ? {
        connections: dbConnections,
        activeConnectionId: activeDbConnectionId,
      } : undefined,
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

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  if (!isOpen) return null;

  const logs = buildingId ? store.getBuildingLogs(buildingId) : [];

  return (
    <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div className="modal building-config-modal">
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
              <FolderInput
                value={cwd}
                onChange={setCwd}
                placeholder="/path/to/project"
                className="form-input"
                directoriesOnly={true}
              />
            </div>

            {/* Folder Path Section (for folder type) */}
            {type === 'folder' && (
              <div className="form-section">
                <label className="form-label">Folder Path</label>
                <FolderInput
                  value={folderPath}
                  onChange={setFolderPath}
                  placeholder="/path/to/folder"
                  className="form-input"
                  directoriesOnly={true}
                />
                <div className="form-hint">
                  Click this building to open the file explorer at this path
                </div>
              </div>
            )}

            {/* Boss Building Section */}
            {type === 'boss' && (
              <div className="form-section boss-building-section">
                <label className="form-label">
                  Managed Buildings
                  <HelpTooltip
                    text="Boss buildings can control multiple subordinate buildings. Use this to group related services and manage them together."
                    title="Managed Buildings"
                    position="top"
                    size="sm"
                  />
                </label>
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
                    <div className="boss-actions-header">
                      Bulk Actions
                      <HelpTooltip
                        text="Execute commands on all managed buildings simultaneously. Useful for starting or restarting your entire stack."
                        position="top"
                        size="sm"
                      />
                    </div>
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
                      <HelpTooltip
                        text="Aggregated real-time logs from all managed buildings. Each line shows which building the log came from."
                        position="top"
                        size="sm"
                      />
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

            {/* Database Configuration Section */}
            {type === 'database' && (
              <div className="form-section database-config-section">
                <label className="form-label">
                  Database Connections
                  <HelpTooltip
                    text="Configure connections to MySQL or PostgreSQL databases. You can add multiple connections and switch between them."
                    title="Database Connections"
                    position="top"
                    size="sm"
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-add"
                    onClick={() => {
                      const newConn: DatabaseConnection = {
                        id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        name: `Connection ${dbConnections.length + 1}`,
                        engine: 'mysql',
                        host: 'localhost',
                        port: 3306,
                        username: 'root',
                      };
                      setDbConnections([...dbConnections, newConn]);
                      if (!activeDbConnectionId) {
                        setActiveDbConnectionId(newConn.id);
                      }
                    }}
                  >
                    + Add Connection
                  </button>
                </label>

                {dbConnections.length === 0 && (
                  <div className="form-hint">
                    Add a database connection to get started. You can connect to MySQL or PostgreSQL databases.
                  </div>
                )}

                {dbConnections.map((conn, index) => (
                  <div key={conn.id} className="db-connection-card">
                    <div className="db-connection-header">
                      <label className="db-connection-active">
                        <input
                          type="radio"
                          name="activeConnection"
                          checked={activeDbConnectionId === conn.id}
                          onChange={() => setActiveDbConnectionId(conn.id)}
                        />
                        Default
                        <HelpTooltip
                          text="The default connection is used when opening the database panel."
                          position="top"
                          size="sm"
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          const newConns = dbConnections.filter(c => c.id !== conn.id);
                          setDbConnections(newConns);
                          if (activeDbConnectionId === conn.id && newConns.length > 0) {
                            setActiveDbConnectionId(newConns[0].id);
                          } else if (newConns.length === 0) {
                            setActiveDbConnectionId(undefined);
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="db-connection-row">
                      <div className="db-field">
                        <label>Name</label>
                        <input
                          type="text"
                          className="form-input"
                          value={conn.name}
                          onChange={(e) => {
                            const newConns = [...dbConnections];
                            newConns[index] = { ...conn, name: e.target.value };
                            setDbConnections(newConns);
                          }}
                          placeholder="My Database"
                        />
                      </div>
                      <div className="db-field db-field--small">
                        <label>Engine</label>
                        <select
                          className="form-input form-select"
                          value={conn.engine}
                          onChange={(e) => {
                            const engine = e.target.value as DatabaseEngine;
                            const newConns = [...dbConnections];
                            newConns[index] = {
                              ...conn,
                              engine,
                              port: DATABASE_ENGINES[engine].defaultPort,
                            };
                            setDbConnections(newConns);
                          }}
                        >
                          {(Object.keys(DATABASE_ENGINES) as DatabaseEngine[]).map((eng) => (
                            <option key={eng} value={eng}>
                              {DATABASE_ENGINES[eng].icon} {DATABASE_ENGINES[eng].label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="db-connection-row">
                      <div className="db-field db-field--grow">
                        <label>Host</label>
                        <input
                          type="text"
                          className="form-input"
                          value={conn.host}
                          onChange={(e) => {
                            const newConns = [...dbConnections];
                            newConns[index] = { ...conn, host: e.target.value };
                            setDbConnections(newConns);
                          }}
                          placeholder="localhost"
                        />
                      </div>
                      <div className="db-field db-field--small">
                        <label>Port</label>
                        <input
                          type="number"
                          className="form-input"
                          value={conn.port}
                          onChange={(e) => {
                            const newConns = [...dbConnections];
                            newConns[index] = { ...conn, port: parseInt(e.target.value) || DATABASE_ENGINES[conn.engine].defaultPort };
                            setDbConnections(newConns);
                          }}
                        />
                      </div>
                    </div>

                    <div className="db-connection-row">
                      <div className="db-field">
                        <label>Username</label>
                        <input
                          type="text"
                          className="form-input"
                          value={conn.username}
                          onChange={(e) => {
                            const newConns = [...dbConnections];
                            newConns[index] = { ...conn, username: e.target.value };
                            setDbConnections(newConns);
                          }}
                          placeholder="root"
                        />
                      </div>
                      <div className="db-field">
                        <label>Password</label>
                        <input
                          type="password"
                          className="form-input"
                          value={conn.password || ''}
                          onChange={(e) => {
                            const newConns = [...dbConnections];
                            newConns[index] = { ...conn, password: e.target.value || undefined };
                            setDbConnections(newConns);
                          }}
                          placeholder="Optional"
                        />
                      </div>
                    </div>

                    <div className="db-connection-row">
                      <div className="db-field db-field--grow">
                        <label>Default Database</label>
                        <input
                          type="text"
                          className="form-input"
                          value={conn.database || ''}
                          onChange={(e) => {
                            const newConns = [...dbConnections];
                            newConns[index] = { ...conn, database: e.target.value || undefined };
                            setDbConnections(newConns);
                          }}
                          placeholder="Optional - select after connecting"
                        />
                      </div>
                      <div className="db-field db-field--small">
                        <label>
                          SSL
                          <HelpTooltip
                            text="Enable encrypted SSL/TLS connection. Required for most cloud-hosted databases and recommended for production."
                            position="top"
                            size="sm"
                          />
                        </label>
                        <label className="toggle-switch toggle-switch--small">
                          <input
                            type="checkbox"
                            checked={conn.ssl || false}
                            onChange={(e) => {
                              const newConns = [...dbConnections];
                              newConns[index] = { ...conn, ssl: e.target.checked };
                              setDbConnections(newConns);
                            }}
                          />
                          <span className="toggle-track">
                            <span className="toggle-thumb" />
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                ))}

                {dbConnections.length > 0 && (
                  <div className="form-hint">
                    After saving, open the database panel to run queries and explore your data.
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
            )}

            {/* Docker Configuration Section */}
            {type === 'docker' && (
              <div className="form-section docker-config-section">
                <label className="form-label">Docker Configuration</label>

                {/* Mode selector */}
                <div className="docker-mode-selector">
                  <label className={`docker-mode-option ${dockerMode === 'container' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="dockerMode"
                      value="container"
                      checked={dockerMode === 'container'}
                      onChange={() => setDockerMode('container')}
                    />
                    <span className="docker-mode-icon">&#128230;</span>
                    <span className="docker-mode-label">Container</span>
                    <span className="docker-mode-desc">Create a new container</span>
                  </label>
                  <label className={`docker-mode-option ${dockerMode === 'compose' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="dockerMode"
                      value="compose"
                      checked={dockerMode === 'compose'}
                      onChange={() => setDockerMode('compose')}
                    />
                    <span className="docker-mode-icon">&#128736;</span>
                    <span className="docker-mode-label">Compose</span>
                    <span className="docker-mode-desc">Manage multiple services</span>
                  </label>
                  <label className={`docker-mode-option ${dockerMode === 'existing' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="dockerMode"
                      value="existing"
                      checked={dockerMode === 'existing'}
                      onChange={() => setDockerMode('existing')}
                    />
                    <span className="docker-mode-icon">&#128270;</span>
                    <span className="docker-mode-label">Existing</span>
                    <span className="docker-mode-desc">Adopt existing container</span>
                  </label>
                </div>

                {/* Container Mode Fields */}
                {dockerMode === 'container' && (
                  <>
                    <div className="command-row">
                      <span className="command-label">
                        Image:
                        <HelpTooltip
                          text="Docker image to run, e.g., nginx:latest, redis:alpine, my-app:v1"
                          title="Image"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <input
                        type="text"
                        className="form-input"
                        value={dockerImage}
                        onChange={(e) => setDockerImage(e.target.value)}
                        placeholder="nginx:latest"
                        required
                      />
                    </div>

                    <div className="command-row">
                      <span className="command-label">
                        Container Name:
                        <HelpTooltip
                          text="Custom name for the container. If empty, auto-generated based on building name."
                          title="Container Name"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <input
                        type="text"
                        className="form-input"
                        value={dockerContainerName}
                        onChange={(e) => setDockerContainerName(e.target.value)}
                        placeholder="Auto-generated (tc-{name}-{id})"
                      />
                    </div>

                    <div className="command-row">
                      <span className="command-label">
                        Command:
                        <HelpTooltip
                          text="Override the default container command. Leave empty to use image's CMD."
                          title="Command Override"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <input
                        type="text"
                        className="form-input"
                        value={dockerCommand}
                        onChange={(e) => setDockerCommand(e.target.value)}
                        placeholder="Optional command override"
                      />
                    </div>

                    {/* Ports */}
                    <div className="form-section docker-ports-section">
                      <label className="form-label">
                        Port Mappings
                        <button
                          type="button"
                          className="btn btn-sm btn-add"
                          onClick={() => setDockerPorts([...dockerPorts, ''])}
                        >
                          + Add
                        </button>
                      </label>
                      {dockerPorts.map((port, index) => (
                        <div key={index} className="docker-mapping-row">
                          <input
                            type="text"
                            className="form-input"
                            value={port}
                            onChange={(e) => {
                              const newPorts = [...dockerPorts];
                              newPorts[index] = e.target.value;
                              setDockerPorts(newPorts);
                            }}
                            placeholder="8080:80 or 3000"
                          />
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => setDockerPorts(dockerPorts.filter((_, i) => i !== index))}
                          >
                            x
                          </button>
                        </div>
                      ))}
                      {dockerPorts.length === 0 && (
                        <div className="form-hint">
                          Format: host:container (e.g., 8080:80) or same port (e.g., 3000)
                        </div>
                      )}
                    </div>

                    {/* Volumes */}
                    <div className="form-section docker-volumes-section">
                      <label className="form-label">
                        Volume Mounts
                        <button
                          type="button"
                          className="btn btn-sm btn-add"
                          onClick={() => setDockerVolumes([...dockerVolumes, ''])}
                        >
                          + Add
                        </button>
                      </label>
                      {dockerVolumes.map((volume, index) => (
                        <div key={index} className="docker-mapping-row">
                          <input
                            type="text"
                            className="form-input"
                            value={volume}
                            onChange={(e) => {
                              const newVolumes = [...dockerVolumes];
                              newVolumes[index] = e.target.value;
                              setDockerVolumes(newVolumes);
                            }}
                            placeholder="./data:/app/data or /host/path:/container/path"
                          />
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => setDockerVolumes(dockerVolumes.filter((_, i) => i !== index))}
                          >
                            x
                          </button>
                        </div>
                      ))}
                      {dockerVolumes.length === 0 && (
                        <div className="form-hint">
                          Format: host_path:container_path (relative paths resolved from working directory)
                        </div>
                      )}
                    </div>

                    <div className="command-row">
                      <span className="command-label">
                        Network:
                        <HelpTooltip
                          text="Docker network to connect to. Leave empty for default bridge network."
                          title="Network"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <input
                        type="text"
                        className="form-input"
                        value={dockerNetwork}
                        onChange={(e) => setDockerNetwork(e.target.value)}
                        placeholder="bridge (default)"
                      />
                    </div>

                    <div className="command-row">
                      <span className="command-label">
                        Restart Policy:
                        <HelpTooltip
                          text="When should Docker restart the container automatically?"
                          title="Restart Policy"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <select
                        className="form-input form-select"
                        value={dockerRestart}
                        onChange={(e) => setDockerRestart(e.target.value as DockerRestartPolicy)}
                      >
                        {(Object.keys(DOCKER_RESTART_POLICIES) as DockerRestartPolicy[]).map((policy) => (
                          <option key={policy} value={policy}>
                            {DOCKER_RESTART_POLICIES[policy].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {/* Compose Mode Fields */}
                {dockerMode === 'compose' && (
                  <>
                    <div className="command-row">
                      <span className="command-label">
                        Compose File:
                        <HelpTooltip
                          text="Path to docker-compose.yml file, relative to working directory."
                          title="Compose File"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <FolderInput
                        value={dockerComposePath}
                        onChange={setDockerComposePath}
                        placeholder="docker-compose.yml"
                        className="form-input"
                        directoriesOnly={false}
                      />
                    </div>

                    <div className="command-row">
                      <span className="command-label">
                        Project Name:
                        <HelpTooltip
                          text="Override the compose project name. Leave empty for auto-generated name."
                          title="Project Name"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <input
                        type="text"
                        className="form-input"
                        value={dockerComposeProject}
                        onChange={(e) => setDockerComposeProject(e.target.value)}
                        placeholder="Auto-generated"
                      />
                    </div>

                    <div className="command-row">
                      <span className="command-label">
                        Services:
                        <HelpTooltip
                          text="Specific services to manage (comma-separated). Leave empty for all services."
                          title="Services"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <input
                        type="text"
                        className="form-input"
                        value={dockerComposeServices}
                        onChange={(e) => setDockerComposeServices(e.target.value)}
                        placeholder="All services (or: api, db, redis)"
                      />
                    </div>
                  </>
                )}

                {/* Existing Mode Fields */}
                {dockerMode === 'existing' && (
                  <div className="docker-existing-section">
                    <div className="command-row">
                      <span className="command-label">
                        Select Container:
                        <HelpTooltip
                          text="Choose an existing Docker container to monitor and control. The container will not be deleted when removing the building."
                          title="Existing Container"
                          position="top"
                          size="sm"
                        />
                      </span>
                      <div className="docker-existing-select-wrapper">
                        <select
                          className="form-input form-select"
                          value={selectedExistingContainer}
                          onChange={(e) => setSelectedExistingContainer(e.target.value)}
                          required={dockerMode === 'existing'}
                        >
                          <option value="">Select a container...</option>
                          {dockerContainersList.map((container: ExistingDockerContainer) => (
                            <option key={container.id} value={container.name}>
                              {container.name} ({container.image}) - {container.state}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => store.requestDockerContainersList()}
                          title="Refresh container list"
                        >
                          &#8635;
                        </button>
                      </div>
                    </div>
                    {dockerContainersList.length === 0 && (
                      <div className="form-hint docker-existing-hint">
                        No containers found. Make sure Docker is running and you have containers available.
                      </div>
                    )}
                    {selectedExistingContainer && (
                      <div className="docker-existing-info">
                        {(() => {
                          const container = dockerContainersList.find(c => c.name === selectedExistingContainer);
                          if (!container) return null;
                          return (
                            <>
                              <div className="docker-existing-info-row">
                                <span className="docker-existing-info-label">Image:</span>
                                <span className="docker-existing-info-value">{container.image}</span>
                              </div>
                              <div className="docker-existing-info-row">
                                <span className="docker-existing-info-label">Status:</span>
                                <span className={`docker-existing-info-value docker-status-${container.status}`}>
                                  {container.state}
                                </span>
                              </div>
                              <div className="docker-existing-info-row">
                                <span className="docker-existing-info-label">ID:</span>
                                <span className="docker-existing-info-value">{container.id.slice(0, 12)}</span>
                              </div>
                              {container.ports.length > 0 && (
                                <div className="docker-existing-info-row">
                                  <span className="docker-existing-info-label">Ports:</span>
                                  <span className="docker-existing-info-value">
                                    {container.ports.map(p => `${p.host}:${p.container}/${p.protocol}`).join(', ')}
                                  </span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                    <div className="form-hint">
                      Note: Existing containers will not be deleted when you remove this building.
                    </div>
                  </div>
                )}

                {/* Common Options */}
                {dockerMode !== 'existing' && (
                <>
                <div className="command-row">
                  <span className="command-label">
                    Pull Policy:
                    <HelpTooltip
                      text="When to pull images: always, only if missing, or never."
                      title="Pull Policy"
                      position="top"
                      size="sm"
                    />
                  </span>
                  <select
                    className="form-input form-select"
                    value={dockerPull}
                    onChange={(e) => setDockerPull(e.target.value as DockerPullPolicy)}
                  >
                    {(Object.keys(DOCKER_PULL_POLICIES) as DockerPullPolicy[]).map((policy) => (
                      <option key={policy} value={policy}>
                        {DOCKER_PULL_POLICIES[policy].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="command-row env-row">
                  <span className="command-label">
                    Environment:
                    <HelpTooltip
                      text="Environment variables in KEY=value format, one per line."
                      title="Environment Variables"
                      position="top"
                      size="sm"
                    />
                  </span>
                  <textarea
                    className="form-input form-textarea"
                    value={dockerEnv}
                    onChange={(e) => setDockerEnv(e.target.value)}
                    placeholder="KEY=value&#10;DATABASE_URL=postgres://...&#10;NODE_ENV=production"
                    rows={3}
                  />
                </div>
                </>
                )}

                {/* Docker Status Display */}
                {isEditMode && building?.dockerStatus && (
                  <div className="docker-status-display">
                    <div className="docker-status-row">
                      <span className="docker-metric">
                        <span className="docker-metric-label">ID</span>
                        <span className="docker-metric-value">{building.dockerStatus.containerId || '-'}</span>
                      </span>
                      <span className="docker-metric">
                        <span className="docker-metric-label">Status</span>
                        <span className="docker-metric-value">{building.dockerStatus.status || '-'}</span>
                      </span>
                      {building.dockerStatus.health && building.dockerStatus.health !== 'none' && (
                        <span className="docker-metric">
                          <span className="docker-metric-label">Health</span>
                          <span className="docker-metric-value">{building.dockerStatus.health}</span>
                        </span>
                      )}
                      {building.dockerStatus.cpu !== undefined && (
                        <span className="docker-metric">
                          <span className="docker-metric-label">CPU</span>
                          <span className="docker-metric-value">{building.dockerStatus.cpu.toFixed(1)}%</span>
                        </span>
                      )}
                      {building.dockerStatus.memory !== undefined && (
                        <span className="docker-metric">
                          <span className="docker-metric-label">MEM</span>
                          <span className="docker-metric-value">
                            {formatBytes(building.dockerStatus.memory)}
                            {building.dockerStatus.memoryLimit ? ` / ${formatBytes(building.dockerStatus.memoryLimit)}` : ''}
                          </span>
                        </span>
                      )}
                    </div>
                    {building.dockerStatus.ports && building.dockerStatus.ports.length > 0 && (
                      <div className="docker-ports-row">
                        <span className="docker-metric-label">Ports:</span>
                        {building.dockerStatus.ports.map((p, i) => (
                          <a
                            key={i}
                            href={`http://localhost:${p.host}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="docker-port-link"
                          >
                            {p.host}:{p.container}/{p.protocol}
                          </a>
                        ))}
                      </div>
                    )}
                    {/* Compose services status */}
                    {building.dockerStatus.services && building.dockerStatus.services.length > 0 && (
                      <div className="docker-services-status">
                        <span className="docker-metric-label">Services:</span>
                        <div className="docker-services-grid">
                          {building.dockerStatus.services.map((svc, i) => (
                            <div key={i} className="docker-service-item">
                              <span
                                className="docker-service-indicator"
                                style={{ backgroundColor: svc.status === 'running' ? '#4ade80' : '#f87171' }}
                              />
                              <span className="docker-service-name">{svc.name}</span>
                              <span className="docker-service-status">{svc.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Docker Action Buttons */}
                {isEditMode && (
                  <div className="docker-actions">
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
