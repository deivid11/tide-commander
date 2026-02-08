import type { DatabaseConfig } from './database-types';

// ============================================================================
// Building Types
// ============================================================================

// Building types - different kinds of buildings
export type BuildingType = 'server' | 'link' | 'database' | 'docker' | 'monitor' | 'folder' | 'boss';

export const BUILDING_TYPES: Record<BuildingType, { icon: string; color: string; description: string }> = {
  server: { icon: '🖥️', color: '#4aff9e', description: 'Service with start/stop commands and logs' },
  link: { icon: '🔗', color: '#4a9eff', description: 'Quick links to URLs' },
  database: { icon: '🗄️', color: '#ff9e4a', description: 'Database connection and queries' },
  docker: { icon: '🐳', color: '#4ac1ff', description: 'Docker container management' },
  monitor: { icon: '📊', color: '#ff4a9e', description: 'System metrics and monitoring' },
  folder: { icon: '📁', color: '#ffd700', description: 'Folder shortcut - opens file explorer on click' },
  boss: { icon: '👑', color: '#ffd700', description: 'Boss building - manages multiple buildings with unified controls' },
};

// Building status
export type BuildingStatus = 'running' | 'stopped' | 'error' | 'unknown' | 'starting' | 'stopping';

// Building visual styles
export type BuildingStyle = 'server-rack' | 'tower' | 'dome' | 'pyramid' | 'desktop' | 'filing-cabinet' | 'satellite' | 'crystal' | 'factory' | 'command-center';

export const BUILDING_STYLES: Record<BuildingStyle, { label: string; description: string }> = {
  'server-rack': { label: 'Server Rack', description: 'Classic server rack with blinking LEDs' },
  'tower': { label: 'Control Tower', description: 'Tall tower with rotating antenna' },
  'dome': { label: 'Data Dome', description: 'Futuristic dome with energy ring' },
  'pyramid': { label: 'Power Pyramid', description: 'Egyptian-style pyramid with glowing core' },
  'desktop': { label: 'Desktop PC', description: 'Retro computer with monitor and keyboard' },
  'filing-cabinet': { label: 'Filing Cabinet', description: 'Office cabinet with sliding drawers' },
  'satellite': { label: 'Satellite Dish', description: 'Communication dish with rotating receiver' },
  'crystal': { label: 'Data Crystal', description: 'Floating crystal with energy particles' },
  'factory': { label: 'Mini Factory', description: 'Industrial building with smoking chimney' },
  'command-center': { label: 'Command Center', description: 'Grand central hub for boss buildings with holographic rings' },
};

// ============================================================================
// PM2 Configuration
// ============================================================================

export interface PM2Config {
  enabled: boolean;           // Use PM2 vs custom commands
  name?: string;              // PM2 app name (defaults to sanitized building name + id)
  script: string;             // Script/command to run (e.g., "npm", "java", "./app.js")
  args?: string;              // Arguments (e.g., "run dev", "-jar app.jar")
  interpreter?: PM2Interpreter; // Interpreter to use
  interpreterArgs?: string;   // e.g., "-jar" for java
  env?: Record<string, string>; // Environment variables
  instances?: number;         // Cluster mode (default: 1)
  autorestart?: boolean;      // Auto-restart on crash (default: true)
  maxRestarts?: number;       // Max restart attempts (default: 10)
}

// PM2 interpreter options
export type PM2Interpreter = 'node' | 'bun' | 'python3' | 'python' | 'java' | 'php' | 'bash' | 'none' | '';

export const PM2_INTERPRETERS: Record<PM2Interpreter, { label: string; description: string }> = {
  '': { label: 'Auto-detect', description: 'Let PM2 detect the interpreter' },
  'node': { label: 'Node.js', description: 'JavaScript/TypeScript runtime' },
  'bun': { label: 'Bun', description: 'Bun JavaScript runtime' },
  'python3': { label: 'Python 3', description: 'Python 3 interpreter' },
  'python': { label: 'Python 2', description: 'Python 2 interpreter (legacy)' },
  'java': { label: 'Java', description: 'Java runtime (use with -jar args)' },
  'php': { label: 'PHP', description: 'PHP interpreter' },
  'bash': { label: 'Bash', description: 'Bash shell script' },
  'none': { label: 'None (Binary)', description: 'Direct execution (compiled binaries)' },
};

// PM2 runtime status (not persisted, updated via polling)
export interface PM2Status {
  pm2Id?: number;             // PM2 internal ID
  pid?: number;               // System PID
  cpu?: number;               // CPU usage %
  memory?: number;            // Memory in bytes
  uptime?: number;            // Process start timestamp
  restarts?: number;          // Restart count
  status?: string;            // PM2 status: 'online' | 'stopping' | 'stopped' | 'errored'
  ports?: number[];           // Auto-detected listening ports
}

// ============================================================================
// Docker Configuration
// ============================================================================

export interface DockerConfig {
  enabled: boolean;
  // Container management mode
  // - 'container': Create and manage a new container
  // - 'compose': Manage a docker-compose project
  // - 'existing': Attach to an existing container (monitor only, no create/delete)
  mode: 'container' | 'compose' | 'existing';

  // For container mode
  image?: string;                    // Docker image name
  containerName?: string;            // Custom container name (auto-generated if not set)
  ports?: string[];                  // Port mappings ["3000:3000", "8080:80"]
  volumes?: string[];                // Volume mounts ["/host/path:/container/path"]
  env?: Record<string, string>;      // Environment variables
  network?: string;                  // Docker network to join
  command?: string;                  // Override container command

  // For compose mode
  composePath?: string;              // Path to docker-compose.yml (relative to cwd)
  services?: string[];               // Specific services to manage (empty = all)
  composeProject?: string;           // Project name override

  // Common options
  restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  pull?: 'always' | 'missing' | 'never'; // Image pull policy
}

// Docker restart policy options
export type DockerRestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure';

export const DOCKER_RESTART_POLICIES: Record<DockerRestartPolicy, { label: string; description: string }> = {
  'no': { label: 'No', description: 'Do not automatically restart' },
  'always': { label: 'Always', description: 'Always restart when stopped' },
  'unless-stopped': { label: 'Unless Stopped', description: 'Restart unless manually stopped' },
  'on-failure': { label: 'On Failure', description: 'Restart only on failure' },
};

// Docker pull policy options
export type DockerPullPolicy = 'always' | 'missing' | 'never';

export const DOCKER_PULL_POLICIES: Record<DockerPullPolicy, { label: string; description: string }> = {
  'always': { label: 'Always', description: 'Always pull the image' },
  'missing': { label: 'If Missing', description: 'Pull only if image not present' },
  'never': { label: 'Never', description: 'Never pull, use local only' },
};

// Docker container status
export type DockerContainerStatus = 'running' | 'created' | 'exited' | 'paused' | 'restarting' | 'removing' | 'dead';

// Docker health status
export type DockerHealthStatus = 'healthy' | 'unhealthy' | 'starting' | 'none';

// Docker port mapping
export interface DockerPortMapping {
  host: number;
  container: number;
  protocol: 'tcp' | 'udp';
}

// Docker compose service status
export interface DockerComposeServiceStatus {
  name: string;
  status: DockerContainerStatus;
  health?: DockerHealthStatus;
  containerId?: string;
}

// Existing container info (for adoption)
export interface ExistingDockerContainer {
  id: string;
  name: string;
  image: string;
  status: DockerContainerStatus;
  ports: DockerPortMapping[];
  created: string;
  state: string;
}

// Existing compose project info (for adoption)
export interface ExistingComposeProject {
  name: string;
  status: string;
  configFiles: string;
}

// Docker runtime status (not persisted, updated via polling)
export interface DockerStatus {
  containerId?: string;              // Container ID (short)
  containerName?: string;            // Container name
  image?: string;                    // Running image
  status?: DockerContainerStatus;    // Container status
  health?: DockerHealthStatus;       // Health check status
  cpu?: number;                      // CPU usage %
  memory?: number;                   // Memory in bytes
  memoryLimit?: number;              // Memory limit in bytes
  ports?: DockerPortMapping[];       // Port mappings
  createdAt?: number;                // Container created timestamp
  startedAt?: number;                // Container started timestamp

  // Compose-specific
  services?: DockerComposeServiceStatus[];
}

// ============================================================================
// Building Interface
// ============================================================================

export interface Building {
  id: string;
  name: string;
  type: BuildingType;
  style: BuildingStyle;

  // Position on battlefield
  position: { x: number; z: number };

  // Status
  status: BuildingStatus;
  lastHealthCheck?: number;
  lastError?: string;

  // Commands (for server type) - used when PM2 is disabled
  commands?: {
    start?: string;
    stop?: string;
    restart?: string;
    healthCheck?: string;
    logs?: string;
  };

  // Working directory for commands
  cwd?: string;

  // PM2 configuration (optional - when enabled, replaces custom commands)
  pm2?: PM2Config;

  // PM2 runtime status (not persisted, populated at runtime)
  pm2Status?: PM2Status;

  // Docker configuration (for docker type buildings)
  docker?: DockerConfig;

  // Docker runtime status (not persisted, populated at runtime)
  dockerStatus?: DockerStatus;

  // Folder path (for folder type - opens file explorer when clicked)
  folderPath?: string;

  // Links (for link type, but can be used by any)
  urls?: { label: string; url: string }[];

  // Visual customization
  color?: string;
  scale?: number;  // Size multiplier (default: 1.0)

  // Boss building fields - for managing subordinate buildings
  subordinateBuildingIds?: string[];  // IDs of buildings managed by this boss building

  // Database configuration (for database type)
  database?: DatabaseConfig;

  // Timestamps
  createdAt: number;
  lastActivity?: number;
}
