#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type CliOptions = {
  port?: string;
  host?: string;
  listenAll?: boolean;
  help?: boolean;
};

function printHelp(): void {
  console.log(`Tide Commander

Usage:
  tide-commander [options]

Options:
  -p, --port <port>     Set server port (default: 5174)
  -H, --host <host>     Set server host (default: 127.0.0.1)
  -l, --listen-all      Listen on all network interfaces
  -h, --help            Show this help message
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

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
      case '-h':
      case '--help':
        options.help = true;
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
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
  const child = spawn(
    process.execPath,
    ['--experimental-specifier-resolution=node', serverEntry],
    {
      stdio: 'inherit',
      env: process.env
    }
  );

  child.on('exit', (code, signal) => {
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
