/**
 * Docker Service - Wrapper for Docker CLI commands
 *
 * Provides container and compose management for buildings.
 * Uses CLI commands instead of Docker API for simplicity and
 * to support users who have Docker installed via various methods.
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import type {
  Building,
  DockerStatus,
  DockerContainerStatus,
  DockerHealthStatus,
  DockerPortMapping,
  DockerComposeServiceStatus,
  ExistingDockerContainer,
  ExistingComposeProject,
} from '../../shared/types.js';
import { createLogger } from '../utils/index.js';

// Track active log streams by building ID
const activeLogStreams = new Map<string, ChildProcess>();

// Track stream generation to prevent duplicate initial logs
// When a new stream starts, its generation is incremented and old streams' chunks are ignored
const streamGenerations = new Map<string, number>();

const execAsync = promisify(exec);
const log = createLogger('DockerService');

/**
 * Sanitize container name for Docker (alphanumeric, dash, underscore only)
 * Prefixes with "tc-" to identify Tide Commander managed containers
 */
export function sanitizeContainerName(name: string, id: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').substring(0, 50);
  // Use the last 8 characters of the ID to ensure uniqueness
  const idSuffix = id.slice(-8);
  return `tc-${sanitized}-${idSuffix}`;
}

/**
 * Get the Docker container name for a building
 */
export function getContainerName(building: Building): string {
  return building.docker?.containerName || sanitizeContainerName(building.name, building.id);
}

/**
 * Get the Docker compose project name for a building
 */
export function getComposeProjectName(building: Building): string {
  return building.docker?.composeProject || sanitizeContainerName(building.name, building.id);
}

/**
 * Check if Docker is installed and available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Docker Compose is available
 */
export async function isComposeAvailable(): Promise<boolean> {
  try {
    // Try new compose plugin first
    await execAsync('docker compose version');
    return true;
  } catch {
    try {
      // Fall back to standalone docker-compose
      await execAsync('docker-compose --version');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get the compose command (docker compose or docker-compose)
 */
async function getComposeCommand(): Promise<string> {
  try {
    await execAsync('docker compose version');
    return 'docker compose';
  } catch {
    return 'docker-compose';
  }
}

/**
 * Parse Docker container status string to our type
 */
function parseContainerStatus(status: string): DockerContainerStatus {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('running')) return 'running';
  if (statusLower.includes('created')) return 'created';
  if (statusLower.includes('exited')) return 'exited';
  if (statusLower.includes('paused')) return 'paused';
  if (statusLower.includes('restarting')) return 'restarting';
  if (statusLower.includes('removing')) return 'removing';
  if (statusLower.includes('dead')) return 'dead';
  return 'exited';
}

/**
 * Parse Docker health status
 */
function parseHealthStatus(health: string | undefined): DockerHealthStatus {
  if (!health) return 'none';
  const healthLower = health.toLowerCase();
  if (healthLower.includes('healthy')) return 'healthy';
  if (healthLower.includes('unhealthy')) return 'unhealthy';
  if (healthLower.includes('starting')) return 'starting';
  return 'none';
}

/**
 * Parse port mapping string (e.g., "0.0.0.0:8080->80/tcp") to DockerPortMapping
 */
function _parsePortMapping(portStr: string): DockerPortMapping | null {
  // Format: 0.0.0.0:8080->80/tcp or :::8080->80/tcp or 8080->80/tcp
  const match = portStr.match(/(?:[\d.]+:|:::)?(\d+)->(\d+)\/(tcp|udp)/);
  if (match) {
    return {
      host: parseInt(match[1], 10),
      container: parseInt(match[2], 10),
      protocol: match[3] as 'tcp' | 'udp',
    };
  }
  return null;
}

/**
 * Start a Docker container for a building
 * For "existing" mode, just starts the already-existing container
 */
export async function startContainer(building: Building): Promise<{ success: boolean; error?: string }> {
  if (!building.docker?.enabled || (building.docker.mode !== 'container' && building.docker.mode !== 'existing')) {
    return { success: false, error: 'Docker container mode not configured for this building' };
  }

  // For existing containers, just start them (don't recreate)
  if (building.docker.mode === 'existing') {
    const containerName = getContainerName(building);
    try {
      log.log(`Starting existing container: ${containerName}`);
      await execAsync(`docker start "${containerName}"`, { timeout: 30000 });
      return { success: true };
    } catch (error: any) {
      log.error(`Failed to start existing container: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  const { image, ports, volumes, env, network, command, restart, pull } = building.docker;
  const containerName = getContainerName(building);
  const cwd = building.cwd || process.cwd();

  if (!image) {
    return { success: false, error: 'Docker image not specified' };
  }

  // Remove any existing container with this name
  try {
    await execAsync(`docker rm -f "${containerName}"`, { timeout: 30000 });
    log.log(`Removed existing container: ${containerName}`);
  } catch {
    // Ignore - container might not exist
  }

  // Pull image if needed
  if (pull === 'always') {
    try {
      log.log(`Pulling image: ${image}`);
      await execAsync(`docker pull "${image}"`, { timeout: 300000 }); // 5 min timeout
    } catch (error: any) {
      log.error(`Failed to pull image: ${error.message}`);
      // Continue anyway - image might be available locally
    }
  }

  // Build docker run command
  const parts: string[] = ['docker', 'run', '-d'];

  // Container name
  parts.push('--name', `"${containerName}"`);

  // Restart policy
  if (restart && restart !== 'no') {
    parts.push('--restart', restart);
  }

  // Port mappings
  if (ports && ports.length > 0) {
    for (const port of ports) {
      parts.push('-p', port);
    }
  }

  // Volume mounts
  if (volumes && volumes.length > 0) {
    for (const volume of volumes) {
      // Handle relative paths by resolving against cwd
      let volumeMapping = volume;
      if (volume.includes(':')) {
        const [hostPath, ...rest] = volume.split(':');
        if (hostPath && !hostPath.startsWith('/') && !hostPath.startsWith('~')) {
          // Relative path - resolve against cwd
          const resolvedPath = `${cwd}/${hostPath}`;
          volumeMapping = `${resolvedPath}:${rest.join(':')}`;
        }
      }
      parts.push('-v', `"${volumeMapping}"`);
    }
  }

  // Environment variables
  if (env && Object.keys(env).length > 0) {
    for (const [key, value] of Object.entries(env)) {
      parts.push('-e', `"${key}=${value}"`);
    }
  }

  // Network
  if (network) {
    parts.push('--network', network);
  }

  // Image
  parts.push(`"${image}"`);

  // Command override
  if (command) {
    parts.push(command);
  }

  const cmd = parts.join(' ');

  try {
    log.log(`Starting Docker container: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd, { timeout: 60000, cwd });
    log.log(`Docker run output: ${stdout.trim()}`);
    if (stderr) log.log(`Docker run stderr: ${stderr}`);
    return { success: true };
  } catch (error: any) {
    log.error(`Docker run failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Stop a Docker container
 * Works for both managed and existing containers
 */
export async function stopContainer(building: Building): Promise<{ success: boolean; error?: string }> {
  const containerName = getContainerName(building);

  try {
    log.log(`Stopping Docker container: ${containerName}`);
    await execAsync(`docker stop "${containerName}"`, { timeout: 30000 });
    return { success: true };
  } catch (error: any) {
    // If container not found, consider it already stopped
    if (error.message.includes('No such container') || error.message.includes('not found')) {
      return { success: true };
    }
    log.error(`Docker stop failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Restart a Docker container
 * For existing containers, uses docker restart instead of recreating
 */
export async function restartContainer(building: Building): Promise<{ success: boolean; error?: string }> {
  // For existing containers, just restart (don't recreate)
  if (building.docker?.mode === 'existing') {
    const containerName = getContainerName(building);
    try {
      log.log(`Restarting existing container: ${containerName}`);
      await execAsync(`docker restart "${containerName}"`, { timeout: 60000 });
      return { success: true };
    } catch (error: any) {
      log.error(`Failed to restart existing container: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // For managed containers, use remove+start to ensure config changes are applied
  return startContainer(building);
}

/**
 * Remove a Docker container (cleanup)
 * For "existing" containers, we don't remove them - just detach from monitoring
 */
export async function removeContainer(building: Building): Promise<{ success: boolean; error?: string }> {
  // For existing containers, don't actually remove them
  if (building.docker?.mode === 'existing') {
    log.log(`Detaching from existing container (not removing): ${getContainerName(building)}`);
    return { success: true };
  }

  const containerName = getContainerName(building);

  try {
    log.log(`Removing Docker container: ${containerName}`);
    await execAsync(`docker rm -f "${containerName}"`, { timeout: 30000 });
    return { success: true };
  } catch (error: any) {
    // Ignore "not found" errors
    if (error.message.includes('No such container') || error.message.includes('not found')) {
      return { success: true };
    }
    log.error(`Docker remove failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Docker Compose Operations
// ============================================================================

/**
 * Start services with docker compose
 */
export async function composeUp(building: Building): Promise<{ success: boolean; error?: string }> {
  if (!building.docker?.enabled || building.docker.mode !== 'compose') {
    return { success: false, error: 'Docker compose mode not configured for this building' };
  }

  const { composePath, services, pull } = building.docker;
  const cwd = building.cwd || process.cwd();
  const projectName = getComposeProjectName(building);
  const composeCmd = await getComposeCommand();

  const composeFile = composePath || 'docker-compose.yml';

  // Build command
  const parts: string[] = [composeCmd, '-p', `"${projectName}"`, '-f', `"${composeFile}"`];

  // Pull if needed
  if (pull === 'always') {
    try {
      log.log(`Pulling compose images for project: ${projectName}`);
      await execAsync(`${parts.join(' ')} pull`, { timeout: 300000, cwd });
    } catch (error: any) {
      log.error(`Failed to pull compose images: ${error.message}`);
    }
  }

  // Add up command
  parts.push('up', '-d');

  // Specific services if specified
  if (services && services.length > 0) {
    parts.push(...services);
  }

  const cmd = parts.join(' ');

  try {
    log.log(`Starting Docker Compose: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000, cwd });
    log.log(`Compose up output: ${stdout}`);
    if (stderr) log.log(`Compose up stderr: ${stderr}`);
    return { success: true };
  } catch (error: any) {
    log.error(`Compose up failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Stop services with docker compose
 */
export async function composeDown(building: Building): Promise<{ success: boolean; error?: string }> {
  if (!building.docker?.enabled || building.docker.mode !== 'compose') {
    return { success: false, error: 'Docker compose mode not configured for this building' };
  }

  const { composePath, services } = building.docker;
  const cwd = building.cwd || process.cwd();
  const projectName = getComposeProjectName(building);
  const composeCmd = await getComposeCommand();

  const composeFile = composePath || 'docker-compose.yml';

  // Build command
  const parts: string[] = [composeCmd, '-p', `"${projectName}"`, '-f', `"${composeFile}"`];

  // If specific services, use stop instead of down
  if (services && services.length > 0) {
    parts.push('stop', ...services);
  } else {
    parts.push('down');
  }

  const cmd = parts.join(' ');

  try {
    log.log(`Stopping Docker Compose: ${cmd}`);
    await execAsync(cmd, { timeout: 60000, cwd });
    return { success: true };
  } catch (error: any) {
    log.error(`Compose down failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Restart services with docker compose
 */
export async function composeRestart(building: Building): Promise<{ success: boolean; error?: string }> {
  // Use down+up to ensure config changes are applied
  const downResult = await composeDown(building);
  if (!downResult.success) {
    // Try to continue with up anyway
    log.log(`Compose down failed, attempting up anyway: ${downResult.error}`);
  }
  return composeUp(building);
}

// ============================================================================
// Status and Monitoring
// ============================================================================

/**
 * Get status of a single Docker container
 */
export async function getContainerStatus(building: Building): Promise<DockerStatus | null> {
  const containerName = getContainerName(building);

  try {
    // Get container info in JSON format
    const { stdout } = await execAsync(
      `docker inspect "${containerName}" --format '{{json .}}'`,
      { timeout: 10000 }
    );

    const info = JSON.parse(stdout);

    // Parse ports
    const ports: DockerPortMapping[] = [];
    const portBindings = info.NetworkSettings?.Ports || {};
    for (const [containerPort, bindings] of Object.entries(portBindings)) {
      if (bindings && Array.isArray(bindings)) {
        for (const binding of bindings as any[]) {
          const [port, protocol] = containerPort.split('/');
          ports.push({
            host: parseInt(binding.HostPort, 10),
            container: parseInt(port, 10),
            protocol: (protocol || 'tcp') as 'tcp' | 'udp',
          });
        }
      }
    }

    // Get stats for CPU and memory
    let cpu = 0;
    let memory = 0;
    let memoryLimit = 0;

    try {
      const { stdout: statsOutput } = await execAsync(
        `docker stats "${containerName}" --no-stream --format "{{.CPUPerc}},{{.MemUsage}}"`,
        { timeout: 10000 }
      );

      const statsLine = statsOutput.trim();
      if (statsLine) {
        const [cpuStr, memStr] = statsLine.split(',');
        cpu = parseFloat(cpuStr.replace('%', '')) || 0;

        // Parse memory like "128MiB / 1GiB"
        const memMatch = memStr?.match(/([\d.]+)(\w+)\s*\/\s*([\d.]+)(\w+)/);
        if (memMatch) {
          const usedVal = parseFloat(memMatch[1]);
          const usedUnit = memMatch[2].toLowerCase();
          const limitVal = parseFloat(memMatch[3]);
          const limitUnit = memMatch[4].toLowerCase();

          const unitMultiplier = (unit: string) => {
            if (unit.includes('gib') || unit.includes('gb')) return 1024 * 1024 * 1024;
            if (unit.includes('mib') || unit.includes('mb')) return 1024 * 1024;
            if (unit.includes('kib') || unit.includes('kb')) return 1024;
            return 1;
          };

          memory = usedVal * unitMultiplier(usedUnit);
          memoryLimit = limitVal * unitMultiplier(limitUnit);
        }
      }
    } catch {
      // Stats might fail if container is not running
    }

    return {
      containerId: info.Id?.substring(0, 12),
      containerName: info.Name?.replace(/^\//, ''),
      image: info.Config?.Image,
      status: parseContainerStatus(info.State?.Status || 'unknown'),
      health: parseHealthStatus(info.State?.Health?.Status),
      cpu,
      memory,
      memoryLimit,
      ports,
      createdAt: info.Created ? new Date(info.Created).getTime() : undefined,
      startedAt: info.State?.StartedAt ? new Date(info.State.StartedAt).getTime() : undefined,
    };
  } catch (error: any) {
    // Container might not exist
    if (!error.message.includes('No such object') && !error.message.includes('not found')) {
      log.error(`Docker inspect failed: ${error.message}`);
    }
    return null;
  }
}

/**
 * Get status of all Docker Compose services for a building
 */
export async function getComposeStatus(building: Building): Promise<DockerStatus | null> {
  if (!building.docker?.enabled || building.docker.mode !== 'compose') {
    return null;
  }

  const { composePath } = building.docker;
  const cwd = building.cwd || process.cwd();
  const projectName = getComposeProjectName(building);
  const composeCmd = await getComposeCommand();

  const composeFile = composePath || 'docker-compose.yml';

  try {
    // Get compose services status
    const { stdout } = await execAsync(
      `${composeCmd} -p "${projectName}" -f "${composeFile}" ps --format json`,
      { timeout: 10000, cwd }
    );

    const services: DockerComposeServiceStatus[] = [];
    let overallStatus: DockerContainerStatus = 'exited';
    let hasRunning = false;
    let hasError = false;

    // Parse JSON output (one JSON object per line)
    const lines = stdout.trim().split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const svc = JSON.parse(line);
        const status = parseContainerStatus(svc.State || svc.Status || 'unknown');
        const health = parseHealthStatus(svc.Health);

        services.push({
          name: svc.Service || svc.Name,
          status,
          health,
          containerId: svc.ID?.substring(0, 12),
        });

        if (status === 'running') hasRunning = true;
        if (status === 'dead' || health === 'unhealthy') hasError = true;
      } catch {
        // Skip invalid JSON lines
      }
    }

    // Determine overall status
    if (hasError) overallStatus = 'dead';
    else if (hasRunning) overallStatus = 'running';
    else if (services.length > 0) overallStatus = 'exited';

    return {
      status: overallStatus,
      services,
    };
  } catch (error: any) {
    log.error(`Compose ps failed: ${error.message}`);
    return null;
  }
}

/**
 * Get status for a building (dispatches to container or compose based on mode)
 */
export async function getStatus(building: Building): Promise<DockerStatus | null> {
  if (!building.docker?.enabled) return null;

  if (building.docker.mode === 'compose') {
    return getComposeStatus(building);
  }
  return getContainerStatus(building);
}

// ============================================================================
// Container Discovery
// ============================================================================

// Use the shared type for consistency
// ExistingDockerContainer is imported from shared/types.ts

/**
 * List all Docker containers on the system (both running and stopped)
 * Used to allow users to adopt existing containers into Tide Commander
 */
export async function listAllContainers(): Promise<ExistingDockerContainer[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --format '{{json .}}'`,
      { timeout: 10000 }
    );

    const containers: ExistingDockerContainer[] = [];
    const lines = stdout.trim().split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const info = JSON.parse(line);

        // Parse ports from the Ports field (e.g., "0.0.0.0:8080->80/tcp, 443/tcp")
        const ports: DockerPortMapping[] = [];
        if (info.Ports) {
          const portMatches = info.Ports.matchAll(/(?:[\d.]+:|:::)?(\d+)->(\d+)\/(tcp|udp)/g);
          for (const match of portMatches) {
            ports.push({
              host: parseInt(match[1], 10),
              container: parseInt(match[2], 10),
              protocol: match[3] as 'tcp' | 'udp',
            });
          }
        }

        containers.push({
          id: info.ID,
          name: info.Names.replace(/^\//, ''),
          image: info.Image,
          status: parseContainerStatus(info.State || info.Status),
          ports,
          created: info.CreatedAt || info.Created,
          state: info.State || '',
        });
      } catch {
        // Skip invalid JSON lines
      }
    }

    return containers;
  } catch (error: any) {
    log.error(`Failed to list containers: ${error.message}`);
    return [];
  }
}

/**
 * List all Docker Compose projects on the system
 */
export async function listComposeProjects(): Promise<ExistingComposeProject[]> {
  const composeCmd = await getComposeCommand();

  try {
    const { stdout } = await execAsync(
      `${composeCmd} ls --format json`,
      { timeout: 10000 }
    );

    const projects: ExistingComposeProject[] = [];

    // docker compose ls returns a JSON array
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        for (const proj of parsed) {
          projects.push({
            name: proj.Name,
            status: proj.Status,
            configFiles: proj.ConfigFiles,
          });
        }
      }
    } catch {
      // Fallback: parse line by line if not valid JSON array
      const lines = stdout.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const proj = JSON.parse(line);
          projects.push({
            name: proj.Name,
            status: proj.Status,
            configFiles: proj.ConfigFiles,
          });
        } catch {
          // Skip invalid lines
        }
      }
    }

    return projects;
  } catch (error: any) {
    log.error(`Failed to list compose projects: ${error.message}`);
    return [];
  }
}

/**
 * Get status of all TC-managed Docker containers
 * Returns a map of container name -> DockerStatus
 */
export async function getAllContainerStatus(): Promise<Map<string, DockerStatus>> {
  const statusMap = new Map<string, DockerStatus>();

  try {
    // List all containers with tc- prefix
    const { stdout } = await execAsync(
      `docker ps -a --filter "name=^tc-" --format "{{.Names}}"`,
      { timeout: 10000 }
    );

    const containerNames = stdout.trim().split('\n').filter(n => n.trim());

    // Get status for each container in parallel
    const statusPromises = containerNames.map(async (name) => {
      try {
        const { stdout: inspectOutput } = await execAsync(
          `docker inspect "${name}" --format '{{json .}}'`,
          { timeout: 10000 }
        );

        const info = JSON.parse(inspectOutput);

        // Parse ports
        const ports: DockerPortMapping[] = [];
        const portBindings = info.NetworkSettings?.Ports || {};
        for (const [containerPort, bindings] of Object.entries(portBindings)) {
          if (bindings && Array.isArray(bindings)) {
            for (const binding of bindings as any[]) {
              const [port, protocol] = containerPort.split('/');
              ports.push({
                host: parseInt(binding.HostPort, 10),
                container: parseInt(port, 10),
                protocol: (protocol || 'tcp') as 'tcp' | 'udp',
              });
            }
          }
        }

        return {
          name,
          status: {
            containerId: info.Id?.substring(0, 12),
            containerName: info.Name?.replace(/^\//, ''),
            image: info.Config?.Image,
            status: parseContainerStatus(info.State?.Status || 'unknown'),
            health: parseHealthStatus(info.State?.Health?.Status),
            ports,
            createdAt: info.Created ? new Date(info.Created).getTime() : undefined,
            startedAt: info.State?.StartedAt ? new Date(info.State.StartedAt).getTime() : undefined,
          } as DockerStatus,
        };
      } catch {
        return { name, status: null };
      }
    });

    const results = await Promise.all(statusPromises);
    for (const { name, status } of results) {
      if (status) {
        statusMap.set(name, status);
      }
    }
  } catch (error: any) {
    if (!error.message.includes('ENOENT')) {
      log.error(`Docker status fetch failed: ${error.message}`);
    }
  }

  return statusMap;
}

// ============================================================================
// Logs
// ============================================================================

/**
 * Get logs from a Docker container
 */
export async function getLogs(building: Building, lines: number = 100, service?: string): Promise<string> {
  if (!building.docker?.enabled) {
    return 'Docker not configured for this building';
  }

  try {
    let cmd: string;

    if (building.docker.mode === 'compose') {
      const { composePath } = building.docker;
      const cwd = building.cwd || process.cwd();
      const projectName = getComposeProjectName(building);
      const composeCmd = await getComposeCommand();
      const composeFile = composePath || 'docker-compose.yml';

      cmd = `cd "${cwd}" && ${composeCmd} -p "${projectName}" -f "${composeFile}" logs --tail ${lines}`;
      if (service) {
        cmd += ` ${service}`;
      }
    } else {
      const containerName = getContainerName(building);
      cmd = `docker logs "${containerName}" --tail ${lines}`;
    }

    log.log(`Fetching Docker logs: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd, {
      maxBuffer: 1024 * 1024 * 5, // 5MB
      timeout: 30000,
    });

    // Docker logs outputs to stderr for actual log content
    return stderr || stdout;
  } catch (error: any) {
    log.error(`Docker logs failed: ${error.message}`);
    return `Error fetching logs: ${error.message}`;
  }
}

// ============================================================================
// Real-time Log Streaming
// ============================================================================

export interface LogStreamCallbacks {
  onChunk: (chunk: string, isError: boolean, service?: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

/**
 * Start streaming logs for a Docker container/compose in real-time
 * Returns a function to stop the stream
 */
export async function startLogStream(
  building: Building,
  callbacks: LogStreamCallbacks,
  initialLines: number = 100,
  service?: string
): Promise<{ success: boolean; error?: string; stop: () => void }> {
  const buildingId = building.id;

  if (!building.docker?.enabled) {
    return { success: false, error: 'Docker not configured', stop: () => {} };
  }

  // Stop any existing stream for this building
  stopLogStream(buildingId);

  // Increment stream generation to invalidate any in-flight chunks from previous stream
  const currentGeneration = (streamGenerations.get(buildingId) || 0) + 1;
  streamGenerations.set(buildingId, currentGeneration);

  try {
    let child: ChildProcess;

    if (building.docker.mode === 'compose') {
      const { composePath } = building.docker;
      const cwd = building.cwd || process.cwd();
      const projectName = getComposeProjectName(building);
      const composeCmd = await getComposeCommand();
      const composeFile = composePath || 'docker-compose.yml';

      log.log(`Starting compose log stream for project: ${projectName} (gen ${currentGeneration})`);

      const args = [
        ...composeCmd.split(' ').slice(1), // Handle 'docker compose' vs 'docker-compose'
        '-p', projectName,
        '-f', composeFile,
        'logs',
        '-f',
        '--tail', String(initialLines),
      ];

      if (service) {
        args.push(service);
      }

      const cmd = composeCmd.split(' ')[0];
      child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd,
      });
    } else {
      const containerName = getContainerName(building);
      log.log(`Starting Docker log stream for: ${containerName} (gen ${currentGeneration})`);

      child = spawn('docker', ['logs', '-f', '--tail', String(initialLines), containerName], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    activeLogStreams.set(buildingId, child);

    // Handle stdout
    child.stdout?.on('data', (data: Buffer) => {
      // Check if this stream is still the current generation
      if (streamGenerations.get(buildingId) !== currentGeneration) {
        return; // Discard chunks from old streams
      }
      const chunk = data.toString();
      callbacks.onChunk(chunk, false, service);
    });

    // Handle stderr (Docker logs outputs to stderr)
    child.stderr?.on('data', (data: Buffer) => {
      // Check if this stream is still the current generation
      if (streamGenerations.get(buildingId) !== currentGeneration) {
        return; // Discard chunks from old streams
      }
      const chunk = data.toString();
      callbacks.onChunk(chunk, true, service);
    });

    // Handle process exit
    child.on('close', (code) => {
      log.log(`Docker log stream ended for ${buildingId} with code ${code}`);
      activeLogStreams.delete(buildingId);
      // Only call onEnd if this is still the current generation
      if (streamGenerations.get(buildingId) === currentGeneration) {
        callbacks.onEnd();
      }
    });

    // Handle errors
    child.on('error', (error) => {
      log.error(`Docker log stream error for ${buildingId}: ${error.message}`);
      activeLogStreams.delete(buildingId);
      // Only call onError if this is still the current generation
      if (streamGenerations.get(buildingId) === currentGeneration) {
        callbacks.onError(error.message);
      }
    });

    const stop = () => {
      stopLogStream(buildingId);
    };

    return { success: true, stop };
  } catch (error: any) {
    log.error(`Failed to start Docker log stream: ${error.message}`);
    return { success: false, error: error.message, stop: () => {} };
  }
}

/**
 * Stop streaming logs for a building
 */
export function stopLogStream(buildingId: string): boolean {
  const child = activeLogStreams.get(buildingId);
  if (child) {
    log.log(`Stopping Docker log stream for building ${buildingId}`);
    child.kill('SIGTERM');
    activeLogStreams.delete(buildingId);
    return true;
  }
  return false;
}

/**
 * Check if a log stream is active for a building
 */
export function isLogStreamActive(buildingId: string): boolean {
  return activeLogStreams.has(buildingId);
}

/**
 * Get all active log stream building IDs
 */
export function getActiveLogStreams(): string[] {
  return Array.from(activeLogStreams.keys());
}
