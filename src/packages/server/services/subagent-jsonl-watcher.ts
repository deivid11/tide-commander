/**
 * Subagent JSONL File Watcher
 *
 * Watches Claude Code's subagent JSONL files for real-time activity streaming.
 * Files are located at: ~/.claude/projects/<encoded-project>/<sessionId>/subagents/agent-<id>.jsonl
 *
 * Each JSONL line contains a message entry (user prompt, assistant text, tool_use, tool_result).
 * We parse these and broadcast them to the UI for real-time subagent visibility.
 *
 * Lifecycle: The watcher starts when a Task tool spawns a subagent. For team agents,
 * the Task tool returns immediately but the subagent process keeps running and writing
 * to the JSONL file. The watcher uses idle-based auto-stop: it keeps running as long as
 * the file is growing, and stops after IDLE_TIMEOUT_MS of no new content.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../utils/logger.js';
import type { SubagentStreamEntry } from '../../shared/types.js';
import { encodeProjectPath } from '../claude/session-loader.js';

const log = createLogger('SubagentJSONL');

const MAX_ENTRIES_PER_BROADCAST = 20;
const IDLE_TIMEOUT_MS = 180_000;       // Stop after 3 minutes of no file changes (subagents can run long builds)
const POLL_INTERVAL_MS = 2_000;        // Poll file every 2s (fallback if fs.watch misses events)
const MAX_WATCH_DURATION_MS = 900_000; // Hard limit: 15 minutes max per watcher

// Key param extraction per tool name
const TOOL_KEY_PARAMS: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebSearch: 'query',
  WebFetch: 'url',
  Task: 'description',
  NotebookEdit: 'notebook_path',
};

interface ActiveWatcher {
  toolUseId: string;
  parentAgentId: string;
  subagentsDir: string;
  dirWatcher?: fs.FSWatcher;
  fileWatcher?: fs.FSWatcher;
  jsonlPath?: string;
  readPosition: number;
  lineBuffer: string;
  broadcastTimer?: ReturnType<typeof setTimeout>;
  pollTimer?: ReturnType<typeof setInterval>;
  idleTimer?: ReturnType<typeof setTimeout>;
  maxTimer?: ReturnType<typeof setTimeout>;
  pendingEntries: SubagentStreamEntry[];
  onBroadcast: BroadcastCallback;
  stopped: boolean;
  lastReadTime: number;
}

type BroadcastCallback = (toolUseId: string, parentAgentId: string, entries: SubagentStreamEntry[]) => void;

const activeWatchers = new Map<string, ActiveWatcher>();

/**
 * Get the subagents directory for a given agent's session
 */
export function getSubagentsDir(cwd: string, sessionId: string): string {
  const encoded = encodeProjectPath(cwd);
  return path.join(os.homedir(), '.claude', 'projects', encoded, sessionId, 'subagents');
}

/**
 * Start watching for a subagent's JSONL file
 */
export function startWatching(
  toolUseId: string,
  parentAgentId: string,
  subagentsDir: string,
  onBroadcast: BroadcastCallback
): void {
  if (activeWatchers.has(toolUseId)) {
    log.warn(`[Watcher] Already watching for toolUseId=${toolUseId}`);
    return;
  }

  const watcher: ActiveWatcher = {
    toolUseId,
    parentAgentId,
    subagentsDir,
    readPosition: 0,
    lineBuffer: '',
    pendingEntries: [],
    onBroadcast,
    stopped: false,
    lastReadTime: Date.now(),
  };

  activeWatchers.set(toolUseId, watcher);
  log.log(`[Watcher] Starting watch for toolUseId=${toolUseId}, dir=${subagentsDir}`);

  // Set a hard max duration to prevent leaks
  watcher.maxTimer = setTimeout(() => {
    log.log(`[Watcher] Max duration reached for toolUseId=${toolUseId}, stopping`);
    doStop(watcher);
  }, MAX_WATCH_DURATION_MS);

  // Try to find existing files first, then watch for new ones
  tryFindAndWatchFile(watcher);
}

/**
 * Signal that the subagent's Task tool has completed.
 * For team agents, the Task returns immediately but the subagent keeps running.
 * We don't stop the watcher - it will auto-stop when the file goes idle.
 */
export function stopWatching(toolUseId: string): void {
  const watcher = activeWatchers.get(toolUseId);
  if (!watcher) return;

  // Just do a read to catch any pending content, but DON'T stop.
  // The idle timeout will handle actual cleanup.
  if (watcher.jsonlPath) {
    readNewLines(watcher);
  }
  log.log(`[Watcher] Task completed for toolUseId=${toolUseId}, watcher continues (idle-based stop)`);
}

/**
 * Actually stop and cleanup a watcher
 */
function doStop(watcher: ActiveWatcher): void {
  if (watcher.stopped) return;
  watcher.stopped = true;

  // Final read
  if (watcher.jsonlPath) {
    readNewLines(watcher);
  }
  flushEntries(watcher);

  // Cleanup all timers and watchers
  watcher.dirWatcher?.close();
  watcher.fileWatcher?.close();
  if (watcher.broadcastTimer) clearTimeout(watcher.broadcastTimer);
  if (watcher.pollTimer) clearInterval(watcher.pollTimer);
  if (watcher.idleTimer) clearTimeout(watcher.idleTimer);
  if (watcher.maxTimer) clearTimeout(watcher.maxTimer);
  activeWatchers.delete(watcher.toolUseId);

  log.log(`[Watcher] Stopped watching toolUseId=${watcher.toolUseId}`);
}

/**
 * Stop all watchers (server shutdown)
 */
export function stopAll(): void {
  for (const watcher of activeWatchers.values()) {
    doStop(watcher);
  }
}

/**
 * Reset the idle timer - called whenever new content is read
 */
function resetIdleTimer(watcher: ActiveWatcher): void {
  if (watcher.idleTimer) clearTimeout(watcher.idleTimer);
  watcher.idleTimer = setTimeout(() => {
    log.log(`[Watcher] Idle timeout for toolUseId=${watcher.toolUseId}, stopping`);
    doStop(watcher);
  }, IDLE_TIMEOUT_MS);
}

/**
 * Try to find an existing JSONL file or watch the directory for new ones
 */
function tryFindAndWatchFile(watcher: ActiveWatcher): void {
  const { subagentsDir } = watcher;

  // Check if directory exists yet
  if (!fs.existsSync(subagentsDir)) {
    // Directory doesn't exist yet - watch parent for it to appear
    const parentDir = path.dirname(subagentsDir);
    if (!fs.existsSync(parentDir)) {
      // Session directory doesn't exist either - retry periodically
      const retryInterval = setInterval(() => {
        if (watcher.stopped) {
          clearInterval(retryInterval);
          return;
        }
        if (fs.existsSync(subagentsDir)) {
          clearInterval(retryInterval);
          watchDirectory(watcher);
        }
      }, 500);
      // Give up after 30 seconds
      setTimeout(() => clearInterval(retryInterval), 30000);
      return;
    }

    // Watch parent directory for subagents/ to appear
    try {
      const parentWatcher = fs.watch(parentDir, (eventType, filename) => {
        if (watcher.stopped) return;
        if (filename === 'subagents' && fs.existsSync(subagentsDir)) {
          parentWatcher.close();
          watchDirectory(watcher);
        }
      });
      parentWatcher.on('error', () => parentWatcher.close());
    } catch {
      log.warn(`[Watcher] Failed to watch parent dir: ${parentDir}`);
    }
    return;
  }

  // Directory exists - look for existing files or watch for new ones
  watchDirectory(watcher);
}

/**
 * Watch the subagents directory for JSONL files
 */
function watchDirectory(watcher: ActiveWatcher): void {
  if (watcher.stopped) return;

  const { subagentsDir } = watcher;

  // Check for existing .jsonl files
  try {
    const files = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
    if (files.length > 0) {
      // Pick the most recently modified file
      let newest = files[0];
      let newestMtime = 0;
      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(subagentsDir, f));
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newest = f;
          }
        } catch { /* skip */ }
      }
      startFileWatch(watcher, path.join(subagentsDir, newest));
      return;
    }
  } catch { /* directory may have been removed */ }

  // No files yet - watch for new ones
  try {
    watcher.dirWatcher = fs.watch(subagentsDir, (eventType, filename) => {
      if (watcher.stopped) return;
      if (filename && filename.endsWith('.jsonl') && !watcher.jsonlPath) {
        const filePath = path.join(subagentsDir, filename);
        if (fs.existsSync(filePath)) {
          watcher.dirWatcher?.close();
          watcher.dirWatcher = undefined;
          startFileWatch(watcher, filePath);
        }
      }
    });
    watcher.dirWatcher.on('error', () => {
      watcher.dirWatcher?.close();
      watcher.dirWatcher = undefined;
    });
  } catch {
    log.warn(`[Watcher] Failed to watch directory: ${subagentsDir}`);
  }
}

/**
 * Start watching a specific JSONL file for new content
 */
function startFileWatch(watcher: ActiveWatcher, filePath: string): void {
  if (watcher.stopped) return;

  watcher.jsonlPath = filePath;
  log.log(`[Watcher] Found JSONL file: ${filePath} for toolUseId=${watcher.toolUseId}`);

  // Read existing content
  readNewLines(watcher);

  // Start idle timer
  resetIdleTimer(watcher);

  // Watch for changes via fs.watch
  try {
    watcher.fileWatcher = fs.watch(filePath, (eventType) => {
      if (watcher.stopped) return;
      if (eventType === 'change') {
        readNewLines(watcher);
      }
    });
    watcher.fileWatcher.on('error', () => {
      watcher.fileWatcher?.close();
      watcher.fileWatcher = undefined;
    });
  } catch {
    log.warn(`[Watcher] Failed to watch file: ${filePath}`);
  }

  // Also poll periodically as fallback (fs.watch can miss events on some systems)
  watcher.pollTimer = setInterval(() => {
    if (watcher.stopped) return;
    readNewLines(watcher);
  }, POLL_INTERVAL_MS);
}

/**
 * Read new lines from the JSONL file since last read position
 */
function readNewLines(watcher: ActiveWatcher): void {
  if (!watcher.jsonlPath) return;

  let fd: number | undefined;
  try {
    fd = fs.openSync(watcher.jsonlPath, 'r');
    const stat = fs.fstatSync(fd);

    if (stat.size <= watcher.readPosition) {
      fs.closeSync(fd);
      return;
    }

    const bytesToRead = stat.size - watcher.readPosition;
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, watcher.readPosition);
    fs.closeSync(fd);
    fd = undefined;

    watcher.readPosition = stat.size;
    watcher.lastReadTime = Date.now();

    // Reset idle timer since we got new content
    resetIdleTimer(watcher);

    // Split into lines, handling partial lines
    const text = watcher.lineBuffer + buffer.toString('utf8');
    const lines = text.split('\n');

    // Last element may be incomplete - save as buffer
    watcher.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const entries = parseLine(trimmed);
      if (entries.length > 0) {
        watcher.pendingEntries.push(...entries);
      }
    }

    // Debounce broadcast
    scheduleBroadcast(watcher);
  } catch {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    // File may have been removed or not ready
  }
}

/**
 * Schedule a debounced broadcast of pending entries
 */
function scheduleBroadcast(watcher: ActiveWatcher): void {
  if (watcher.broadcastTimer) return; // Already scheduled

  watcher.broadcastTimer = setTimeout(() => {
    watcher.broadcastTimer = undefined;
    flushEntries(watcher);
  }, 300);
}

/**
 * Flush pending entries to the broadcast callback
 */
function flushEntries(watcher: ActiveWatcher): void {
  if (watcher.pendingEntries.length === 0) return;

  const entries = watcher.pendingEntries.splice(0, MAX_ENTRIES_PER_BROADCAST);
  // If there are still more, keep the rest for next flush
  if (watcher.pendingEntries.length > 0) {
    scheduleBroadcast(watcher);
  }

  watcher.onBroadcast(watcher.toolUseId, watcher.parentAgentId, entries);
}

/**
 * Parse a single JSONL line into SubagentStreamEntry items
 */
function parseLine(line: string): SubagentStreamEntry[] {
  const entries: SubagentStreamEntry[] = [];

  try {
    const data = JSON.parse(line);
    const message = data.message;
    if (!message || !message.content) return entries;

    const timestamp = data.timestamp || new Date().toISOString();
    const contentArray = Array.isArray(message.content) ? message.content : [];

    // Skip initial user prompts (the task delegation message)
    if (data.type === 'user' && message.role === 'user') {
      // Check if this is a tool_result
      for (const block of contentArray) {
        if (block.type === 'tool_result') {
          const resultText = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
              : '';

          if (resultText) {
            entries.push({
              type: 'tool_result',
              timestamp,
              resultPreview: resultText.slice(0, 200),
              isError: block.is_error === true,
              toolUseId: block.tool_use_id,
            });
          }
        }
      }
      return entries;
    }

    // Parse assistant messages
    if (data.type === 'assistant' && message.role === 'assistant') {
      for (const block of contentArray) {
        if (block.type === 'text' && block.text) {
          const text = block.text.trim();
          if (text) {
            entries.push({
              type: 'text',
              timestamp,
              text: text.slice(0, 200),
            });
          }
        } else if (block.type === 'tool_use') {
          const toolName = block.name || 'Unknown';
          const input = block.input || {};
          const keyParamName = TOOL_KEY_PARAMS[toolName];
          const keyParam = keyParamName && input[keyParamName]
            ? String(input[keyParamName]).slice(0, 120)
            : undefined;

          entries.push({
            type: 'tool_use',
            timestamp,
            toolName,
            toolKeyParam: keyParam,
            toolUseId: block.id,
          });
        }
      }
    }
  } catch {
    // Invalid JSON line - skip
  }

  return entries;
}
