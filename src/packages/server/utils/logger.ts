/**
 * NestJS-style colorized logger for Tide Commander
 * Includes caller file and line number
 * Supports file-based logging with rotation
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================
// File Logging Configuration
// ============================================

interface FileLogConfig {
  enabled: boolean;
  directory: string;
  filename: string;
  maxSizeBytes: number;  // Max file size before rotation (default 10MB)
  maxFiles: number;      // Number of rotated files to keep
}

const fileLogConfig: FileLogConfig = {
  enabled: true,
  directory: path.join(process.cwd(), 'logs'),
  filename: 'server.log',
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
};

// Current log file write stream
let logFileStream: fs.WriteStream | null = null;
let currentLogFilePath: string = '';
let isInitialized = false;

/**
 * Initialize the log directory and file stream
 */
function initFileLogging(): void {
  if (isInitialized || !fileLogConfig.enabled) return;

  try {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(fileLogConfig.directory)) {
      fs.mkdirSync(fileLogConfig.directory, { recursive: true });
    }

    currentLogFilePath = path.join(fileLogConfig.directory, fileLogConfig.filename);

    // Open write stream in append mode
    logFileStream = fs.createWriteStream(currentLogFilePath, { flags: 'a' });

    logFileStream.on('error', (err) => {
      console.error(`[Tide] File logging error: ${err.message}`);
      fileLogConfig.enabled = false;
    });

    isInitialized = true;

    // Write startup marker
    const startupMessage = `\n${'='.repeat(80)}\n[${new Date().toISOString()}] Server started - Log file initialized\n${'='.repeat(80)}\n`;
    logFileStream.write(startupMessage);
  } catch (err) {
    console.error(`[Tide] Failed to initialize file logging: ${err}`);
    fileLogConfig.enabled = false;
  }
}

/**
 * Check if log rotation is needed and perform rotation
 */
function checkAndRotateLogs(): void {
  if (!fileLogConfig.enabled || !currentLogFilePath) return;

  try {
    const stats = fs.statSync(currentLogFilePath);

    if (stats.size >= fileLogConfig.maxSizeBytes) {
      // Close current stream
      if (logFileStream) {
        logFileStream.end();
        logFileStream = null;
      }

      // Rotate existing log files
      for (let i = fileLogConfig.maxFiles - 1; i >= 1; i--) {
        const oldPath = `${currentLogFilePath}.${i}`;
        const newPath = `${currentLogFilePath}.${i + 1}`;

        if (fs.existsSync(oldPath)) {
          if (i === fileLogConfig.maxFiles - 1) {
            // Delete the oldest file
            fs.unlinkSync(oldPath);
          } else {
            fs.renameSync(oldPath, newPath);
          }
        }
      }

      // Rename current log to .1
      fs.renameSync(currentLogFilePath, `${currentLogFilePath}.1`);

      // Open new log file
      logFileStream = fs.createWriteStream(currentLogFilePath, { flags: 'a' });

      const rotationMessage = `[${new Date().toISOString()}] Log rotated - New log file started\n`;
      logFileStream.write(rotationMessage);
    }
  } catch {
    // Ignore rotation errors to not disrupt logging
  }
}

/**
 * Write a message to the log file (without ANSI colors)
 */
function writeToFile(message: string): void {
  if (!fileLogConfig.enabled) return;

  // Initialize on first write
  if (!isInitialized) {
    initFileLogging();
  }

  if (logFileStream && logFileStream.writable) {
    // Strip ANSI color codes for file output
    const cleanMessage = stripAnsiColors(message);
    logFileStream.write(cleanMessage + '\n');

    // Check for rotation periodically (every write is fine for simplicity)
    checkAndRotateLogs();
  }
}

/**
 * Strip ANSI color codes from a string
 */
function stripAnsiColors(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Gracefully close the log file stream
 */
export function closeFileLogging(): void {
  if (logFileStream) {
    const closeMessage = `[${new Date().toISOString()}] Server shutting down - Log file closed\n${'='.repeat(80)}\n`;
    logFileStream.write(closeMessage);
    logFileStream.end();
    logFileStream = null;
    isInitialized = false;
  }
}

/**
 * Get the current log file path
 */
export function getLogFilePath(): string {
  return currentLogFilePath || path.join(fileLogConfig.directory, fileLogConfig.filename);
}

/**
 * Enable or disable file logging
 */
export function setFileLoggingEnabled(enabled: boolean): void {
  fileLogConfig.enabled = enabled;
  if (enabled && !isInitialized) {
    initFileLogging();
  }
}

// ============================================
// ANSI Colors for Console Output
// ============================================

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

const levelConfig: Record<LogLevel, { label: string; color: string }> = {
  log: { label: 'LOG', color: colors.green },
  error: { label: 'ERROR', color: colors.red },
  warn: { label: 'WARN', color: colors.yellow },
  debug: { label: 'DEBUG', color: colors.magenta },
  verbose: { label: 'VERBOSE', color: colors.cyan },
};

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

interface CallerInfo {
  file: string;
  line: number;
  column: number;
}

function getCallerInfo(): CallerInfo | null {
  const err = new Error();
  const stack = err.stack?.split('\n');

  if (!stack || stack.length < 5) return null;

  // Stack trace format: "    at functionName (file:line:column)"
  // We need to skip: Error, formatMessage, log/error/warn method, and get the actual caller
  // Index 0: "Error"
  // Index 1: getCallerInfo
  // Index 2: formatMessage
  // Index 3: log/error/warn
  // Index 4: actual caller
  const callerLine = stack[4];

  if (!callerLine) return null;

  // Match patterns like:
  // "    at functionName (/path/to/file.ts:123:45)"
  // "    at /path/to/file.ts:123:45"
  const match = callerLine.match(/at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?$/);

  if (!match) return null;

  let filePath = match[1];

  // Clean up the path - show only the relevant part
  // Remove everything before src/packages/server
  const serverIndex = filePath.indexOf('src/packages/server');
  if (serverIndex !== -1) {
    filePath = filePath.slice(serverIndex + 'src/packages/server/'.length);
  } else {
    // Fallback: just show filename
    filePath = filePath.split('/').pop() || filePath;
  }

  return {
    file: filePath,
    line: parseInt(match[2], 10),
    column: parseInt(match[3], 10),
  };
}

function formatMessage(level: LogLevel, context: string, message: string, ...args: unknown[]): string {
  const { label, color } = levelConfig[level];
  const timestamp = formatTimestamp();
  const pid = process.pid;
  const caller = getCallerInfo();

  const appName = `${colors.green}[Tide]${colors.reset}`;
  const pidStr = `${colors.dim}${pid}${colors.reset}`;
  const timestampStr = `${colors.dim}${timestamp}${colors.reset}`;
  const levelStr = `${color}${colors.bright}${label.padStart(7)}${colors.reset}`;
  const contextStr = `${colors.yellow}[${context}]${colors.reset}`;

  // Format caller info
  const callerStr = caller
    ? `${colors.dim}${caller.file}:${caller.line}${colors.reset}`
    : '';

  let formattedMessage = message;
  if (args.length > 0) {
    const argsStr = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    formattedMessage = `${message} ${colors.cyan}${argsStr}${colors.reset}`;
  }

  return `${appName} ${pidStr}  - ${timestampStr}  ${levelStr} ${contextStr} ${callerStr} ${formattedMessage}`;
}

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  log(message: string, ...args: unknown[]): void {
    const formatted = formatMessage('log', this.context, message, ...args);
    console.log(formatted);
    writeToFile(formatted);
  }

  error(message: string, ...args: unknown[]): void {
    const formatted = formatMessage('error', this.context, message, ...args);
    console.error(formatted);
    writeToFile(formatted);
  }

  warn(message: string, ...args: unknown[]): void {
    const formatted = formatMessage('warn', this.context, message, ...args);
    console.warn(formatted);
    writeToFile(formatted);
  }

  debug(message: string, ...args: unknown[]): void {
    if (process.env.DEBUG) {
      const formatted = formatMessage('debug', this.context, message, ...args);
      console.debug(formatted);
      writeToFile(formatted);
    }
  }

  verbose(message: string, ...args: unknown[]): void {
    if (process.env.VERBOSE) {
      const formatted = formatMessage('verbose', this.context, message, ...args);
      console.log(formatted);
      writeToFile(formatted);
    }
  }
}

// Factory function to create loggers
export function createLogger(context: string): Logger {
  return new Logger(context);
}

// Pre-configured loggers for common contexts
export const logger = {
  server: createLogger('Server'),
  http: createLogger('HTTP'),
  ws: createLogger('WebSocket'),
  claude: createLogger('Claude'),
  agent: createLogger('Agent'),
  files: createLogger('Files'),
  supervisor: createLogger('Supervisor'),
  boss: createLogger('Boss'),
};

export { Logger };
