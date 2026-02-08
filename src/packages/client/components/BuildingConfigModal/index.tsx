import React, { useState, useEffect, useRef } from 'react';
import { store, useStore, useDockerContainersList } from '../../store';
import {
  BUILDING_TYPES,
  BUILDING_STYLES,
  type Building,
  type BuildingType,
  type BuildingStyle,
  type PM2Interpreter,
  type DatabaseConnection,
  type DockerRestartPolicy,
  type DockerPullPolicy,
} from '../../../shared/types';
import { BUILDING_STATUS_COLORS } from '../../utils/colors';
import { STORAGE_KEYS, getStorageString } from '../../utils/storage';
import { FolderInput } from '../shared/FolderInput';
import { useModalClose } from '../../hooks';
import { BUILDING_COLORS, DeleteConfirmModal } from './utils';
import { PM2ToggleSection, PM2ConfigPanel } from './PM2ConfigPanel';
import { DockerConfigPanel } from './DockerConfigPanel';
import { DatabaseConfigPanel } from './DatabaseConfigPanel';
import { BossConfigPanel } from './BossConfigPanel';
import { ServerCommandsPanel } from './ServerCommandsPanel';
import { BuildingLogsPanel } from './BuildingLogsPanel';

interface BuildingConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  buildingId?: string | null;
  initialPosition?: { x: number; z: number };
}

export function BuildingConfigModal({
  isOpen,
  onClose,
  buildingId,
  initialPosition,
}: BuildingConfigModalProps) {
  const { buildings, buildingLogs, bossStreamingLogs } = useStore();
  const dockerContainersList = useDockerContainersList();
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
  const [pm2Env, setPm2Env] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Docker state
  const [dockerMode, setDockerMode] = useState<'container' | 'compose' | 'existing'>('container');
  const [selectedExistingContainer, setSelectedExistingContainer] = useState<string>('');
  const [dockerImage, setDockerImage] = useState('');
  const [dockerContainerName, setDockerContainerName] = useState('');
  const [dockerPorts, setDockerPorts] = useState<string[]>([]);
  const [dockerVolumes, setDockerVolumes] = useState<string[]>([]);
  const [dockerEnv, setDockerEnv] = useState('');
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
        setUsePM2(building.pm2?.enabled || false);
        setPm2Script(building.pm2?.script || '');
        setPm2Args(building.pm2?.args || '');
        setPm2Interpreter((building.pm2?.interpreter as PM2Interpreter) || '');
        setPm2InterpreterArgs(building.pm2?.interpreterArgs || '');
        setPm2Env(building.pm2?.env
          ? Object.entries(building.pm2.env).map(([k, v]) => `${k}=${v}`).join('\n')
          : '');
        setDockerMode(building.docker?.mode || 'container');
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
        setSubordinateBuildingIds(building.subordinateBuildingIds || []);
        setDbConnections(building.database?.connections || []);
        setActiveDbConnectionId(building.database?.activeConnectionId);
      } else {
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
        setUsePM2(false);
        setPm2Script('');
        setPm2Args('');
        setPm2Interpreter('');
        setPm2InterpreterArgs('');
        setPm2Env('');
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
        setSubordinateBuildingIds([]);
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

  const parseEnvString = (envStr: string): Record<string, string> | undefined => {
    if (!envStr.trim()) return undefined;
    return Object.fromEntries(
      envStr.trim().split('\n')
        .map(line => line.trim())
        .filter(line => line && line.includes('='))
        .map(line => {
          const idx = line.indexOf('=');
          return [line.slice(0, idx), line.slice(idx + 1)];
        })
    );
  };

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
        env: parseEnvString(pm2Env),
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
        env: parseEnvString(dockerEnv),
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
              <BossConfigPanel
                buildings={buildings}
                buildingId={buildingId}
                subordinateBuildingIds={subordinateBuildingIds}
                setSubordinateBuildingIds={setSubordinateBuildingIds}
                isEditMode={isEditMode}
                showBossLogs={showBossLogs}
                setShowBossLogs={setShowBossLogs}
                currentBossLogs={currentBossLogs}
                bossLogsContainerRef={bossLogsContainerRef}
              />
            )}

            {/* Database Configuration Section */}
            {type === 'database' && (
              <DatabaseConfigPanel
                dbConnections={dbConnections}
                setDbConnections={setDbConnections}
                activeDbConnectionId={activeDbConnectionId}
                setActiveDbConnectionId={setActiveDbConnectionId}
              />
            )}

            {/* PM2 Toggle Section (for server type) */}
            {type === 'server' && (
              <PM2ToggleSection usePM2={usePM2} setUsePM2={setUsePM2} />
            )}

            {/* PM2 Configuration Section */}
            {type === 'server' && (
              <PM2ConfigPanel
                usePM2={usePM2}
                pm2Script={pm2Script}
                setPm2Script={setPm2Script}
                pm2Args={pm2Args}
                setPm2Args={setPm2Args}
                pm2Interpreter={pm2Interpreter}
                setPm2Interpreter={setPm2Interpreter}
                pm2InterpreterArgs={pm2InterpreterArgs}
                setPm2InterpreterArgs={setPm2InterpreterArgs}
                pm2Env={pm2Env}
                setPm2Env={setPm2Env}
                isEditMode={isEditMode}
                building={building ?? null}
                handleCommand={handleCommand}
              />
            )}

            {/* Docker Configuration Section */}
            {type === 'docker' && (
              <DockerConfigPanel
                dockerMode={dockerMode}
                setDockerMode={setDockerMode}
                dockerImage={dockerImage}
                setDockerImage={setDockerImage}
                dockerContainerName={dockerContainerName}
                setDockerContainerName={setDockerContainerName}
                dockerCommand={dockerCommand}
                setDockerCommand={setDockerCommand}
                dockerPorts={dockerPorts}
                setDockerPorts={setDockerPorts}
                dockerVolumes={dockerVolumes}
                setDockerVolumes={setDockerVolumes}
                dockerNetwork={dockerNetwork}
                setDockerNetwork={setDockerNetwork}
                dockerRestart={dockerRestart}
                setDockerRestart={setDockerRestart}
                dockerPull={dockerPull}
                setDockerPull={setDockerPull}
                dockerEnv={dockerEnv}
                setDockerEnv={setDockerEnv}
                dockerComposePath={dockerComposePath}
                setDockerComposePath={setDockerComposePath}
                dockerComposeProject={dockerComposeProject}
                setDockerComposeProject={setDockerComposeProject}
                dockerComposeServices={dockerComposeServices}
                setDockerComposeServices={setDockerComposeServices}
                selectedExistingContainer={selectedExistingContainer}
                setSelectedExistingContainer={setSelectedExistingContainer}
                dockerContainersList={dockerContainersList}
                isEditMode={isEditMode}
                building={building ?? null}
                handleCommand={handleCommand}
              />
            )}

            {/* Commands Section (for server type, non-PM2) */}
            {type === 'server' && !usePM2 && (
              <ServerCommandsPanel
                startCmd={startCmd}
                setStartCmd={setStartCmd}
                stopCmd={stopCmd}
                setStopCmd={setStopCmd}
                restartCmd={restartCmd}
                setRestartCmd={setRestartCmd}
                healthCheckCmd={healthCheckCmd}
                setHealthCheckCmd={setHealthCheckCmd}
                logsCmd={logsCmd}
                setLogsCmd={setLogsCmd}
                isEditMode={isEditMode}
                handleCommand={handleCommand}
              />
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
              <BuildingLogsPanel
                logs={logs}
                buildingId={buildingId!}
                logsContainerRef={logsContainerRef}
              />
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
