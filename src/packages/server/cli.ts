#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type CliCommand = 'start' | 'stop' | 'status' | 'logs' | 'version';

type CliOptions = {
  command: CliCommand;
  port?: string;
  host?: string;
  listenAll?: boolean;
  foreground?: boolean;
  follow?: boolean;
  lines?: number;
  help?: boolean;
};

const PID_DIR = path.join(os.homedir(), '.local', 'share', 'tide-commander');
const PID_FILE = path.join(PID_DIR, 'server.pid');
const LOG_FILE = path.join(process.cwd(), 'logs', 'server.log');

function printHelp(): void {
  console.log(`Tide Commander

Usage:
  tide-commander [start] [options]
  tide-commander stop
  tide-commander status
  tide-commander logs [--lines <n>] [--follow]
  tide-commander version

Options:
  -p, --port <port>     Set server port (default: 5174)
  -H, --host <host>     Set server host (default: 127.0.0.1)
  -l, --listen-all      Listen on all network interfaces
  -f, --foreground      Run in foreground (default is background)
      --lines <n>       Number of log lines for logs command (default: 100)
      --follow          Follow logs stream (like tail -f)
  -h, --help            Show this help message
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { command: 'start' };
  let commandParsed = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith('-') && !commandParsed) {
      if (arg === 'start' || arg === 'stop' || arg === 'status' || arg === 'logs' || arg === 'version') {
        options.command = arg;
        commandParsed = true;
        continue;
      }
      throw new Error(`Unknown command: ${arg}`);
    }

    switch (arg) {
      case '-p':
      case '--port': {
        const value = argv[i + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(`Missing value for ${arg}`);
        }
        options.port = value;
        i += 1;
        break;
      }
      case '-H':
      case '--host': {
        const value = argv[i + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(`Missing value for ${arg}`);
        }
        options.host = value;
        i += 1;
        break;
      }
      case '-l':
      case '--listen-all':
        options.listenAll = true;
        break;
      case '-f':
      case '--foreground':
        if (options.command === 'logs') {
          options.follow = true;
        } else {
          options.foreground = true;
        }
        break;
      case '--follow':
        options.follow = true;
        break;
      case '--lines': {
        const value = argv[i + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(`Missing value for ${arg}`);
        }
        const lines = Number(value);
        if (!Number.isInteger(lines) || lines < 1) {
          throw new Error(`Invalid lines value: ${value}`);
        }
        options.lines = lines;
        i += 1;
        break;
      }
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.command = 'version';
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function validatePort(value: string): void {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
}

function ensurePidDir(): void {
  fs.mkdirSync(PID_DIR, { recursive: true });
}

function writePidFile(pid: number): void {
  ensurePidDir();
  fs.writeFileSync(PID_FILE, `${pid}\n`, 'utf8');
}

function clearPidFile(): void {
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    // no-op
  }
}

function readPidFile(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopCommand(): number {
  const pid = readPidFile();
  if (!pid) {
    console.log('Tide Commander is not running');
    return 0;
  }

  if (!isRunning(pid)) {
    clearPidFile();
    console.log('Removed stale PID file');
    return 0;
  }

  process.kill(pid, 'SIGTERM');
  console.log(`Sent SIGTERM to Tide Commander (PID: ${pid})`);
  return 0;
}

function statusCommand(): number {
  // ANSI color codes
  const cyan = '\x1b[36m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const bright = '\x1b[1m';
  const reset = '\x1b[0m';
  const blue = '\x1b[34m';

  const pid = readPidFile();
  if (!pid) {
    console.log(`\n${red}${bright}⨯ Tide Commander is stopped${reset}\n`);
    return 1;
  }

  if (!isRunning(pid)) {
    clearPidFile();
    console.log(`\n${red}${bright}⨯ Tide Commander is stopped${reset} (stale PID file removed)\n`);
    return 1;
  }

  const port = process.env.PORT || '5174';
  const host = process.env.HOST || 'localhost';
  const url = `http://${host}:${port}`;
  const uptime = getProcessUptime(pid);
  const version = getPackageVersion();

  console.log(`\n${cyan}${bright}🌊 Tide Commander Status${reset}`);
  console.log(`${cyan}${'═'.repeat(60)}${reset}`);
  console.log(`${green}✓ Running${reset} (PID: ${pid})`);
  console.log(`${blue}${bright}🚀 Access: ${url}${reset}`);
  console.log(`   Version: ${version}`);
  if (uptime) {
    console.log(`   Uptime: ${uptime}`);
  }
  console.log(`${cyan}${'═'.repeat(60)}${reset}\n`);
  return 0;
}

async function logsCommand(options: CliOptions): Promise<number> {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`Log file not found: ${LOG_FILE}`);
    return 1;
  }

  const lines = options.lines ?? 100;
  const args = ['-n', String(lines)];
  if (options.follow) {
    args.push('-f');
  }
  args.push(LOG_FILE);

  const tail = spawn('tail', args, { stdio: 'inherit' });
  return await new Promise<number>((resolve) => {
    tail.on('error', (error) => {
      console.error(`Failed to read logs: ${error.message}`);
      resolve(1);
    });
    tail.on('exit', (code) => {
      resolve(code ?? 0);
    });
  });
}

function getPackageVersion(): string {
  try {
    const cliDir = path.dirname(fileURLToPath(import.meta.url));
    const packagePath = path.join(cliDir, '..', '..', '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.version;
  } catch {
    return 'unknown';
  }
}

function getProcessUptime(pid: number): string | null {
  try {
    // Try to get process start time from /proc/[pid]/stat (Linux)
    if (fs.existsSync(`/proc/${pid}/stat`)) {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
      const starttime = Number(stat[21]); // starttime in jiffies
      const uptimeFile = fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0];
      const systemUptimeJiffies = Number(uptimeFile) * 100; // convert to jiffies (assuming 100 Hz)
      const processUptimeJiffies = systemUptimeJiffies - starttime;
      const processUptimeSeconds = Math.floor(processUptimeJiffies / 100);

      const hours = Math.floor(processUptimeSeconds / 3600);
      const minutes = Math.floor((processUptimeSeconds % 3600) / 60);
      const seconds = processUptimeSeconds % 60;

      if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
      } else {
        return `${seconds}s`;
      }
    }
  } catch {
    // Uptime not available (not on Linux or /proc not available)
  }
  return null;
}

function versionCommand(): void {
  try {
    const version = getPackageVersion();
    console.log(`Tide Commander v${version}`);
  } catch {
    console.error('Failed to read version information');
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.command === 'version') {
    versionCommand();
    return;
  }

  if (options.command === 'stop') {
    process.exit(stopCommand());
  }

  if (options.command === 'status') {
    process.exit(statusCommand());
  }

  if (options.command === 'logs') {
    process.exit(await logsCommand(options));
  }

  if (options.port) {
    validatePort(options.port);
    process.env.PORT = options.port;
  }

  if (options.host) {
    process.env.HOST = options.host;
  } else if (options.listenAll) {
    process.env.HOST = '0.0.0.0';
    process.env.LISTEN_ALL_INTERFACES = '1';
  }

  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const serverEntry = path.join(cliDir, 'index.js');
  const runInForeground = options.foreground === true || process.env.TIDE_COMMANDER_FOREGROUND === '1';
  const existingPid = readPidFile();

  if (existingPid && isRunning(existingPid)) {
    const port = process.env.PORT || '5174';
    const host = process.env.HOST || 'localhost';
    const url = `http://${host}:${port}`;
    console.log(`\n🌊 Tide Commander is already running (PID: ${existingPid})`);
    console.log(`🚀 Open: ${url}\n`);
    return;
  }
  clearPidFile();

  const child = spawn(
    process.execPath,
    ['--experimental-specifier-resolution=node', serverEntry],
    {
      stdio: runInForeground ? 'inherit' : 'ignore',
      detached: !runInForeground,
      env: process.env
    }
  );

  child.on('error', (error) => {
    console.error(`Failed to start Tide Commander: ${error.message}`);
    process.exit(1);
  });

  if (!runInForeground) {
    if (child.pid) {
      writePidFile(child.pid);
    }
    child.unref();
    const port = process.env.PORT || '5174';
    const host = process.env.HOST || 'localhost';
    const url = `http://${host}:${port}`;

    // ANSI color codes for beautiful output
    const cyan = '\x1b[36m';
    const green = '\x1b[32m';
    const bright = '\x1b[1m';
    const reset = '\x1b[0m';
    const blue = '\x1b[34m';

    console.log(`\n${cyan}${bright}🌊 Tide Commander${reset}`);
    console.log(`${cyan}${'═'.repeat(60)}${reset}`);
    console.log(`${green}✓${reset} Started in background (PID: ${child.pid ?? 'unknown'})`);
    console.log(`${blue}${bright}🚀 Open: ${url}${reset}`);
    console.log(`   Version: ${getPackageVersion()}`);
    console.log(`${green}📝 Logs${reset}: tail -f logs/server.log`);
    console.log(`${cyan}${'═'.repeat(60)}${reset}\n`);
    return;
  }

  if (child.pid) {
    writePidFile(child.pid);
  }

  child.on('exit', (code, signal) => {
    clearPidFile();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(`Failed to start Tide Commander: ${(error as Error).message}`);
  process.exit(1);
});
