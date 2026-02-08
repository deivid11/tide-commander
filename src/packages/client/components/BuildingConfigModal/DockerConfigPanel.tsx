import React from 'react';
import {
  DOCKER_RESTART_POLICIES,
  DOCKER_PULL_POLICIES,
  type Building,
  type DockerRestartPolicy,
  type DockerPullPolicy,
  type ExistingDockerContainer,
} from '../../../shared/types';
import { store } from '../../store';
import { HelpTooltip } from '../shared/Tooltip';
import { FolderInput } from '../shared/FolderInput';
import { formatBytes } from './utils';

interface DockerConfigPanelProps {
  dockerMode: 'container' | 'compose' | 'existing';
  setDockerMode: (v: 'container' | 'compose' | 'existing') => void;
  dockerImage: string;
  setDockerImage: (v: string) => void;
  dockerContainerName: string;
  setDockerContainerName: (v: string) => void;
  dockerCommand: string;
  setDockerCommand: (v: string) => void;
  dockerPorts: string[];
  setDockerPorts: (v: string[]) => void;
  dockerVolumes: string[];
  setDockerVolumes: (v: string[]) => void;
  dockerNetwork: string;
  setDockerNetwork: (v: string) => void;
  dockerRestart: DockerRestartPolicy;
  setDockerRestart: (v: DockerRestartPolicy) => void;
  dockerPull: DockerPullPolicy;
  setDockerPull: (v: DockerPullPolicy) => void;
  dockerEnv: string;
  setDockerEnv: (v: string) => void;
  dockerComposePath: string;
  setDockerComposePath: (v: string) => void;
  dockerComposeProject: string;
  setDockerComposeProject: (v: string) => void;
  dockerComposeServices: string;
  setDockerComposeServices: (v: string) => void;
  selectedExistingContainer: string;
  setSelectedExistingContainer: (v: string) => void;
  dockerContainersList: ExistingDockerContainer[];
  isEditMode: boolean;
  building: Building | null;
  handleCommand: (cmd: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs') => void;
}

export function DockerConfigPanel({
  dockerMode,
  setDockerMode,
  dockerImage,
  setDockerImage,
  dockerContainerName,
  setDockerContainerName,
  dockerCommand,
  setDockerCommand,
  dockerPorts,
  setDockerPorts,
  dockerVolumes,
  setDockerVolumes,
  dockerNetwork,
  setDockerNetwork,
  dockerRestart,
  setDockerRestart,
  dockerPull,
  setDockerPull,
  dockerEnv,
  setDockerEnv,
  dockerComposePath,
  setDockerComposePath,
  dockerComposeProject,
  setDockerComposeProject,
  dockerComposeServices,
  setDockerComposeServices,
  selectedExistingContainer,
  setSelectedExistingContainer,
  dockerContainersList,
  isEditMode,
  building,
  handleCommand,
}: DockerConfigPanelProps) {
  return (
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
  );
}
