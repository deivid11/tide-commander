/**
 * PM2 Service - Wrapper for PM2 CLI commands
 *
 * Provides process management via PM2 for buildings.
 * Uses CLI commands instead of programmatic API for simplicity and
 * to support users who have PM2 installed globally.
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import type { Building, PM2Status } from '../../shared/types.js';
import { createLogger } from '../utils/index.js';

// Track active log streams by building ID
const activeLogStreams = new Map<string, ChildProcess>();

// Track stream generation to prevent duplicate initial logs
// When a new stream starts, its generation is incremented and old streams' chunks are ignored
const streamGenerations = new Map<string, number>();

const execAsync = promisify(exec);
const log = createLogger('PM2Service');

/**
 * Get all child PIDs of a process (including the process itself)
 */
async function getProcessTree(pid: number): Promise<number[]> {
  if (!pid || pid <= 0) return [];

  try {
    // Get all descendant PIDs using pgrep
    const { stdout } = await execAsync(`pgrep -P ${pid} 2>/dev/null || true`, {
      timeout: 3000,
    });

    const childPids = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => parseInt(line.trim(), 10))
      .filter(p => !isNaN(p) && p > 0);

    // Recursively get children of children
    const allPids = [pid];
    for (const childPid of childPids) {
      const grandchildren = await getProcessTree(childPid);
      allPids.push(...grandchildren);
    }

    return allPids;
  } catch {
    return [pid];
  }
}

/**
 * Get listening ports for a process by PID
 * Uses `ss` command to find all TCP ports the process and its children are listening on
 */
export async function getProcessPorts(pid: number): Promise<number[]> {
  if (!pid || pid <= 0) return [];

  try {
    // Get all PIDs in the process tree (parent + children)
    const allPids = await getProcessTree(pid);

    // Use ss command to find listening ports for any PID in the tree
    // -t = TCP, -l = listening, -n = numeric, -p = show process
    const { stdout } = await execAsync(`ss -tlnp 2>/dev/null | grep -E "pid=(${allPids.join('|')})," || true`, {
      timeout: 5000,
    });

    if (!stdout.trim()) return [];

    const ports: Set<number> = new Set();

    // Parse ss output - format: LISTEN 0 128 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=12345,fd=19))
    // Or: LISTEN 0 128 [::]:3000 [::]:* users:(("node",pid=12345,fd=19))
    // Or: LISTEN 0 100 *:8084 *:* users:(("java",pid=1266484,fd=272))
    const lines = stdout.split('\n').filter(line => line.trim());

    for (const line of lines) {
      // Match IPv4: 0.0.0.0:PORT or 127.0.0.1:PORT or *:PORT
      // Match IPv6: [::]:PORT or [::1]:PORT or *:PORT (when not bracketed)
      const ipv4Match = line.match(/(?:\d+\.\d+\.\d+\.\d+|\*):(\d+)/);
      const ipv6Match = line.match(/\[::[\da-f:]*\]:(\d+)/i);

      if (ipv4Match) {
        const port = parseInt(ipv4Match[1], 10);
        if (port > 0 && port < 65536) ports.add(port);
      }
      if (ipv6Match) {
        const port = parseInt(ipv6Match[1], 10);
        if (port > 0 && port < 65536) ports.add(port);
      }
    }

    return Array.from(ports).sort((a, b) => a - b);
  } catch (error: any) {
    // Silently fail - port detection is optional
    log.log(`Port detection failed for PID ${pid}: ${error.message}`);
    return [];
  }
}

/**
 * Sanitize app name for PM2 (alphanumeric, dash, underscore only)
 * Prefixes with "tc-" to identify Tide Commander managed processes
 */
export function sanitizePM2Name(name: string, id: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 50);
  // Use the last 8 characters of the ID to ensure uniqueness
  // (the first 8 chars are always "building" which isn't unique)
  const idSuffix = id.slice(-8);
  return `tc-${sanitized}-${idSuffix}`;
}

/**
 * Get the PM2 app name for a building
 */
export function getPM2Name(building: Building): string {
  return building.pm2?.name || sanitizePM2Name(building.name, building.id);
}

/**
 * Check if PM2 is installed and available
 */
export async function isPM2Available(): Promise<boolean> {
  try {
    await execAsync('pm2 --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a PM2 process for a building
 */
export async function startProcess(building: Building): Promise<{ success: boolean; error?: string }> {
  if (!building.pm2?.enabled || !building.pm2.script) {
    return { success: false, error: 'PM2 not configured for this building' };
  }

  const name = getPM2Name(building);
  const { script, args, interpreter, interpreterArgs, env } = building.pm2;
  const cwd = building.cwd;

  // Delete any existing process with this name to avoid duplicates
  try {
    await execAsync(`pm2 delete "${name}"`, { timeout: 10000 });
    log.log(`Deleted existing PM2 process: ${name}`);
  } catch {
    // Ignore - process might not exist
  }

  // Build PM2 start command
  const parts: string[] = ['pm2', 'start'];

  // Script to run
  parts.push(`"${script}"`);

  // App name
  parts.push('--name', `"${name}"`);

  // Working directory
  if (cwd) {
    parts.push('--cwd', `"${cwd}"`);
  }

  // Interpreter (only if specified and not empty/auto)
  if (interpreter && interpreter !== 'none') {
    parts.push('--interpreter', interpreter);
  } else if (interpreter === 'none') {
    parts.push('--interpreter', 'none');
  }

  // Interpreter args
  if (interpreterArgs) {
    parts.push('--interpreter-args', `"${interpreterArgs}"`);
  }

  // Script arguments (must come after --)
  if (args) {
    parts.push('--', args);
  }

  // Build environment prefix if any
  let envPrefix = '';
  if (env && Object.keys(env).length > 0) {
    envPrefix = Object.entries(env)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ') + ' ';
  }

  const cmd = envPrefix + parts.join(' ');

  try {
    log.log(`Starting PM2 process: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
    log.log(`PM2 start output: ${stdout}`);
    if (stderr) log.log(`PM2 start stderr: ${stderr}`);
    return { success: true };
  } catch (error: any) {
    log.error(`PM2 start failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Stop a PM2 process
 */
export async function stopProcess(building: Building): Promise<{ success: boolean; error?: string }> {
  const name = getPM2Name(building);

  try {
    log.log(`Stopping PM2 process: ${name}`);
    await execAsync(`pm2 stop "${name}"`, { timeout: 30000 });
    return { success: true };
  } catch (error: any) {
    // If process not found, consider it already stopped
    if (error.message.includes('not found') || error.message.includes('doesn\'t exist')) {
      return { success: true };
    }
    log.error(`PM2 stop failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Restart a PM2 process
 * Uses delete+start to ensure config changes (args, env, etc.) are applied
 */
export async function restartProcess(building: Building): Promise<{ success: boolean; error?: string }> {
  // Use startProcess which does delete+start to ensure config changes are applied
  // A simple `pm2 restart` doesn't pick up new args/config
  return startProcess(building);
}

/**
 * Delete a PM2 process (cleanup - removes from PM2 completely)
 */
export async function deleteProcess(building: Building): Promise<{ success: boolean; error?: string }> {
  const name = getPM2Name(building);

  try {
    log.log(`Deleting PM2 process: ${name}`);
    await execAsync(`pm2 delete "${name}"`, { timeout: 30000 });
    return { success: true };
  } catch (error: any) {
    // Ignore "not found" errors - process might not exist
    if (error.message.includes('not found') || error.message.includes('doesn\'t exist')) {
      return { success: true };
    }
    log.error(`PM2 delete failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Get logs from PM2 process
 */
export async function getLogs(building: Building, lines: number = 100): Promise<string> {
  const name = getPM2Name(building);

  try {
    log.log(`Fetching PM2 logs for: ${name} (${lines} lines)`);
    const { stdout } = await execAsync(`pm2 logs "${name}" --nostream --lines ${lines}`, {
      maxBuffer: 1024 * 1024 * 5, // 5MB
      timeout: 30000,
    });
    return stdout;
  } catch (error: any) {
    log.error(`PM2 logs failed: ${error.message}`);
    return `Error fetching logs: ${error.message}`;
  }
}

/**
 * Get status of all PM2 processes managed by Tide Commander
 * Returns a map of PM2 process name -> PM2Status
 * Includes auto-detected listening ports for each process
 */
export async function getAllStatus(): Promise<Map<string, PM2Status>> {
  const statusMap = new Map<string, PM2Status>();

  try {
    const { stdout } = await execAsync('pm2 jlist', { timeout: 10000 });
    const processes = JSON.parse(stdout);

    // First, collect all TC processes
    const tcProcesses: Array<{ name: string; proc: any }> = [];
    for (const proc of processes) {
      // Only process Tide Commander managed apps (start with "tc-")
      if (proc.name.startsWith('tc-')) {
        tcProcesses.push({ name: proc.name, proc });
      }
    }

    // Fetch ports for all online processes in parallel
    const portPromises = tcProcesses.map(async ({ name, proc }) => {
      let ports: number[] = [];
      if (proc.pm2_env?.status === 'online' && proc.pid) {
        ports = await getProcessPorts(proc.pid);
      }
      return { name, ports };
    });

    const portResults = await Promise.all(portPromises);
    const portMap = new Map(portResults.map(r => [r.name, r.ports]));

    // Build the status map with ports
    for (const { name, proc } of tcProcesses) {
      statusMap.set(name, {
        pm2Id: proc.pm_id,
        pid: proc.pid,
        cpu: proc.monit?.cpu,
        memory: proc.monit?.memory,
        uptime: proc.pm2_env?.pm_uptime,
        restarts: proc.pm2_env?.restart_time,
        status: proc.pm2_env?.status,
        ports: portMap.get(name) || [],
      });
    }
  } catch (error: any) {
    // PM2 might not be running or no processes
    if (!error.message.includes('ENOENT')) {
      log.error(`PM2 status fetch failed: ${error.message}`);
    }
  }

  return statusMap;
}

/**
 * Get status of a single PM2 process by building
 * Includes auto-detected listening ports
 */
export async function getStatus(building: Building): Promise<PM2Status | null> {
  const name = getPM2Name(building);

  try {
    const { stdout } = await execAsync('pm2 jlist', { timeout: 10000 });
    const processes = JSON.parse(stdout);
    const proc = processes.find((p: any) => p.name === name);

    if (proc) {
      // Detect ports if process is online
      let ports: number[] = [];
      if (proc.pm2_env?.status === 'online' && proc.pid) {
        ports = await getProcessPorts(proc.pid);
      }

      return {
        pm2Id: proc.pm_id,
        pid: proc.pid,
        cpu: proc.monit?.cpu,
        memory: proc.monit?.memory,
        uptime: proc.pm2_env?.pm_uptime,
        restarts: proc.pm2_env?.restart_time,
        status: proc.pm2_env?.status,
        ports,
      };
    }
  } catch (error: any) {
    log.error(`PM2 status check failed: ${error.message}`);
  }

  return null;
}

/**
 * Flush logs for a PM2 process
 */
export async function flushLogs(building: Building): Promise<{ success: boolean; error?: string }> {
  const name = getPM2Name(building);

  try {
    await execAsync(`pm2 flush "${name}"`, { timeout: 10000 });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Real-time Log Streaming
// ============================================================================

export interface LogStreamCallbacks {
  onChunk: (chunk: string, isError: boolean) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

/**
 * Start streaming logs for a PM2 process in real-time
 * Returns a function to stop the stream
 */
export function startLogStream(
  building: Building,
  callbacks: LogStreamCallbacks,
  initialLines: number = 100
): { success: boolean; error?: string; stop: () => void } {
  const name = getPM2Name(building);
  const buildingId = building.id;

  // Stop any existing stream for this building
  stopLogStream(buildingId);

  // Increment stream generation to invalidate any in-flight chunks from previous stream
  const currentGeneration = (streamGenerations.get(buildingId) || 0) + 1;
  streamGenerations.set(buildingId, currentGeneration);

  try {
    log.log(`Starting log stream for: ${name} (initial ${initialLines} lines, gen ${currentGeneration})`);

    // Use pm2 logs without --nostream for real-time streaming
    const child = spawn('pm2', ['logs', name, '--lines', String(initialLines)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeLogStreams.set(buildingId, child);

    // Handle stdout (normal logs)
    child.stdout?.on('data', (data: Buffer) => {
      // Check if this stream is still the current generation
      if (streamGenerations.get(buildingId) !== currentGeneration) {
        return; // Discard chunks from old streams
      }
      const chunk = data.toString();
      callbacks.onChunk(chunk, false);
    });

    // Handle stderr (error logs)
    child.stderr?.on('data', (data: Buffer) => {
      // Check if this stream is still the current generation
      if (streamGenerations.get(buildingId) !== currentGeneration) {
        return; // Discard chunks from old streams
      }
      const chunk = data.toString();
      callbacks.onChunk(chunk, true);
    });

    // Handle process exit
    child.on('close', (code) => {
      log.log(`Log stream ended for ${name} with code ${code}`);
      activeLogStreams.delete(buildingId);
      // Only call onEnd if this is still the current generation
      if (streamGenerations.get(buildingId) === currentGeneration) {
        callbacks.onEnd();
      }
    });

    // Handle errors
    child.on('error', (error) => {
      log.error(`Log stream error for ${name}: ${error.message}`);
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
    log.error(`Failed to start log stream for ${name}: ${error.message}`);
    return { success: false, error: error.message, stop: () => {} };
  }
}

/**
 * Stop streaming logs for a building
 */
export function stopLogStream(buildingId: string): boolean {
  const child = activeLogStreams.get(buildingId);
  if (child) {
    log.log(`Stopping log stream for building ${buildingId}`);
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
