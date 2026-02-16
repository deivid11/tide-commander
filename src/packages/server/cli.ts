#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { checkNpmVersion } from '../shared/version.js';

type CliCommand = 'start' | 'stop' | 'status' | 'logs' | 'version';
type ServerLaunchConfig = {
  command: string;
  args: string[];
};

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
const META_FILE = path.join(PID_DIR, 'server-meta.json');
const LOG_FILE = path.join(process.cwd(), 'logs', 'server.log');
const PACKAGE_NAME = 'tide-commander';

type ServerMeta = {
  pid: number;
  host: string;
  port: string;
};

function findProjectRoot(startDir: string): string | null {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

function printHelp(): void {
  console.log(`Tide Commander

Usage:
  tide-commander [start] [options]
  tide-commander stop
  tide-commander status
  tide-commander logs [--lines <n>] [--follow]
  tide-commander version

Options:
  -p, --port <port>     Set server port (default: 6200)
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

function writeServerMeta(meta: ServerMeta): void {
  ensurePidDir();
  fs.writeFileSync(META_FILE, `${JSON.stringify(meta)}\n`, 'utf8');
}

function readServerMeta(): ServerMeta | null {
  try {
    const raw = fs.readFileSync(META_FILE, 'utf8').trim();
    const parsed = JSON.parse(raw) as Partial<ServerMeta>;
    if (
      typeof parsed.pid === 'number'
      && typeof parsed.host === 'string'
      && typeof parsed.port === 'string'
    ) {
      return parsed as ServerMeta;
    }
    return null;
  } catch {
    return null;
  }
}

function clearServerMeta(): void {
  try {
    fs.rmSync(META_FILE, { force: true });
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

async function waitForProcessExit(pid: number, timeoutMs = 8000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return !isRunning(pid);
}

async function waitForChildStartup(child: ReturnType<typeof spawn>, timeoutMs = 700): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(true);
    }, timeoutMs);

    child.once('exit', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    });

    child.once('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function resolveServerLaunch(cliDir: string): ServerLaunchConfig {
  const serverEntryJs = path.join(cliDir, 'index.js');
  if (fs.existsSync(serverEntryJs)) {
    return {
      command: process.execPath,
      args: ['--experimental-specifier-resolution=node', serverEntryJs],
    };
  }

  const serverEntryTs = path.join(cliDir, 'index.ts');
  if (fs.existsSync(serverEntryTs)) {
    return {
      command: process.execPath,
      args: ['--import', 'tsx', serverEntryTs],
    };
  }

  throw new Error(`Could not find server entrypoint in ${cliDir}`);
}

function stopCommand(): number {
  const pid = readPidFile();
  if (!pid) {
    clearServerMeta();
    console.log('Tide Commander is not running');
    return 0;
  }

  if (!isRunning(pid)) {
    clearPidFile();
    clearServerMeta();
    console.log('Removed stale PID file');
    return 0;
  }

  process.kill(pid, 'SIGTERM');
  console.log(`Sent SIGTERM to Tide Commander (PID: ${pid})`);
  return 0;
}

async function statusCommand(): Promise<number> {
  // ANSI color codes
  const cyan = '\x1b[36m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const bright = '\x1b[1m';
  const reset = '\x1b[0m';
  const blue = '\x1b[34m';

  const pid = readPidFile();
  if (!pid) {
    clearServerMeta();
    console.log(`\n${red}${bright}⨯ Tide Commander is stopped${reset}\n`);
    return 1;
  }

  if (!isRunning(pid)) {
    clearPidFile();
    clearServerMeta();
    console.log(`\n${red}${bright}⨯ Tide Commander is stopped${reset} (stale PID file removed)\n`);
    return 1;
  }

  const meta = readServerMeta();
  const port = meta?.port ?? process.env.PORT ?? '6200';
  const host = meta?.host ?? process.env.HOST ?? 'localhost';
  const url = `http://${host}:${port}`;
  const uptime = getProcessUptime(pid);
  const version = getPackageVersion();

  console.log(`\n${cyan}${bright}🌊 Tide Commander Status${reset}`);
  console.log(`${cyan}${'═'.repeat(60)}${reset}`);
  console.log(`${green}✓ Running${reset} (PID: ${pid})`);
  console.log(`${blue}${bright}🚀 Access: ${url}${reset}`);
  console.log(`   Version: ${version}`);
  const npmVersion = await checkNpmVersion(PACKAGE_NAME, version);
  if (npmVersion.relation === 'behind' && npmVersion.latestVersion) {
    printUpdateNotice(npmVersion.latestVersion);
  }
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

  const tail = spawn('tail', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');

  const formatLine = (line: string): string => {
    const colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
    };

    return line
      .replace(/\[Tide\]/g, `${colors.green}[Tide]${colors.reset}`)
      .replace(/\[(?!Tide\])([A-Za-z][A-Za-z0-9_-]{0,40})\]/g, `[${colors.yellow}$1${colors.reset}]`)
      .replace(/\s-\s(\d{2}\/\d{2}\/\d{4},\s\d{2}:\d{2}:\d{2}\s[AP]M)\s/g, ` - ${colors.dim}$1${colors.reset} `)
      .replace(/\bERROR\b/g, `${colors.red}${colors.bright}ERROR${colors.reset}`)
      .replace(/\bWARN\b/g, `${colors.yellow}${colors.bright}WARN${colors.reset}`)
      .replace(/\bLOG\b/g, `${colors.green}${colors.bright}LOG${colors.reset}`)
      .replace(/\bDEBUG\b/g, `${colors.cyan}${colors.bright}DEBUG${colors.reset}`)
    ;
  };

  let stdoutBuffer = '';
  tail.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += stdoutDecoder.write(chunk);
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      process.stdout.write(`${formatLine(line)}\n`);
    }
  });

  let stderrBuffer = '';
  tail.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += stderrDecoder.write(chunk);
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() ?? '';
    for (const line of lines) {
      process.stderr.write(`${line}\n`);
    }
  });

  return await new Promise<number>((resolve) => {
    tail.on('error', (error) => {
      console.error(`Failed to read logs: ${error.message}`);
      resolve(1);
    });
    tail.on('exit', (code) => {
      const remainingOut = stdoutBuffer + stdoutDecoder.end();
      if (remainingOut.trim().length > 0) {
        process.stdout.write(`${formatLine(remainingOut)}\n`);
      }

      const remainingErr = stderrBuffer + stderrDecoder.end();
      if (remainingErr.trim().length > 0) {
        process.stderr.write(`${remainingErr}\n`);
      }
      resolve(code ?? 0);
    });
  });
}

function getPackageVersion(): string {
  try {
    const cliDir = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = findProjectRoot(cliDir);
    if (!projectRoot) {
      return 'unknown';
    }
    const packagePath = path.join(projectRoot, 'package.json');
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

function printUpdateNotice(latestVersion: string): void {
  const yellow = '\x1b[33m';
  const bright = '\x1b[1m';
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  console.log(`${yellow}${bright}⬆  Update available: v${latestVersion}${reset} ${dim}(run: bunx tide-commander@latest)${reset}`);
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
    process.exit(await statusCommand());
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
  const serverLaunch = resolveServerLaunch(cliDir);
  const runInForeground = options.foreground === true || process.env.TIDE_COMMANDER_FOREGROUND === '1';
  const existingPid = readPidFile();
  const hasStartupOverrides = options.port !== undefined
    || options.host !== undefined
    || options.listenAll === true
    || options.foreground === true;

  if (existingPid && isRunning(existingPid)) {
    if (hasStartupOverrides) {
      try {
        process.kill(existingPid, 'SIGTERM');
      } catch (error) {
        console.error(`Failed to restart Tide Commander: ${(error as Error).message}`);
        process.exit(1);
      }

      const stopped = await waitForProcessExit(existingPid);
      if (!stopped) {
        console.error(`Failed to restart Tide Commander: process ${existingPid} did not stop in time`);
        process.exit(1);
      }

      clearPidFile();
      clearServerMeta();
    } else {
    const meta = readServerMeta();
    const port = meta?.port ?? process.env.PORT ?? '6200';
    const host = meta?.host ?? process.env.HOST ?? 'localhost';
    const url = `http://${host}:${port}`;
    const dim = '\x1b[2m';
    const yellow = '\x1b[33m';
    const cyan = '\x1b[36m';
    const bright = '\x1b[1m';
    const reset = '\x1b[0m';
    const blue = '\x1b[34m';
    const _green = '\x1b[32m';

    const currentVer = getPackageVersion();
    console.log(`\n${cyan}${bright}🌊 Tide Commander${reset} ${dim}(already running, PID: ${existingPid})${reset}`);
    console.log(`${cyan}${'═'.repeat(60)}${reset}`);
    console.log(`${blue}${bright}🚀 Open: ${url}${reset}`);
    console.log(`   Version: ${currentVer}`);
    const npmVersion = await checkNpmVersion(PACKAGE_NAME, currentVer);
    if (npmVersion.relation === 'behind' && npmVersion.latestVersion) {
      printUpdateNotice(npmVersion.latestVersion);
    }
    console.log(`${cyan}${'─'.repeat(60)}${reset}`);
    console.log(`${dim}Commands:${reset}`);
    console.log(`  ${yellow}tide-commander status${reset}    ${dim}Show server status & uptime${reset}`);
    console.log(`  ${yellow}tide-commander stop${reset}      ${dim}Stop the server${reset}`);
    console.log(`  ${yellow}tide-commander logs -f${reset}   ${dim}Follow live server logs${reset}`);
    console.log(`  ${yellow}tide-commander --help${reset}    ${dim}Show all options${reset}`);
    console.log(`${cyan}${'═'.repeat(60)}${reset}\n`);
    return;
    }
  }
  clearPidFile();
  clearServerMeta();

  const child = spawn(
    serverLaunch.command,
    serverLaunch.args,
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
    const started = await waitForChildStartup(child);
    if (!started) {
      clearPidFile();
      clearServerMeta();
      console.error('Failed to start Tide Commander: process exited immediately');
      process.exit(1);
    }
    if (child.pid) {
      writePidFile(child.pid);
      writeServerMeta({
        pid: child.pid,
        host: process.env.HOST || 'localhost',
        port: process.env.PORT || '6200',
      });
    }
    child.unref();
    const port = process.env.PORT || '6200';
    const host = process.env.HOST || 'localhost';
    const url = `http://${host}:${port}`;

    // ANSI color codes for beautiful output
    const cyan = '\x1b[36m';
    const green = '\x1b[32m';
    const bright = '\x1b[1m';
    const reset = '\x1b[0m';
    const blue = '\x1b[34m';

    const dim = '\x1b[2m';
    const yellow = '\x1b[33m';

    console.log(`\n${cyan}${bright}🌊 Tide Commander${reset}`);
    console.log(`${cyan}${'═'.repeat(60)}${reset}`);
    const currentVersion = getPackageVersion();
    console.log(`${green}✓${reset} Started in background (PID: ${child.pid ?? 'unknown'})`);
    console.log(`${blue}${bright}🚀 Open: ${url}${reset}`);
    console.log(`   Version: ${currentVersion}`);
    const npmVersion = await checkNpmVersion(PACKAGE_NAME, currentVersion);
    if (npmVersion.relation === 'behind' && npmVersion.latestVersion) {
      printUpdateNotice(npmVersion.latestVersion);
    }
    console.log(`${cyan}${'─'.repeat(60)}${reset}`);
    console.log(`${dim}Commands:${reset}`);
    console.log(`  ${yellow}tide-commander status${reset}    ${dim}Show server status & uptime${reset}`);
    console.log(`  ${yellow}tide-commander stop${reset}      ${dim}Stop the server${reset}`);
    console.log(`  ${yellow}tide-commander logs -f${reset}   ${dim}Follow live server logs${reset}`);
    console.log(`  ${yellow}tide-commander --help${reset}    ${dim}Show all options${reset}`);
    console.log(`${cyan}${'═'.repeat(60)}${reset}\n`);
    return;
  }

  if (child.pid) {
    writePidFile(child.pid);
    writeServerMeta({
      pid: child.pid,
      host: process.env.HOST || 'localhost',
      port: process.env.PORT || '6200',
    });
  }

  child.on('exit', (code, signal) => {
    clearPidFile();
    clearServerMeta();
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
