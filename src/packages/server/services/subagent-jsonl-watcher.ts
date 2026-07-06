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
const IDLE_TIMEOUT_MS = 600_000;         // Stop after 10 minutes of no file changes (long thinking/tool gaps on xhigh effort)
const POLL_INTERVAL_MS = 2_000;          // Poll file every 2s (fallback if fs.watch misses events)
const MAX_WATCH_DURATION_MS = 3_600_000; // Hard limit: 60 minutes max per watcher (background agents routinely run 20-30 min)
const BIND_POLL_INTERVAL_MS = 1_000;     // Retry transcript binding every second until found
const BIND_GIVE_UP_MS = 120_000;         // Stop an unbound watcher after 2 minutes (no transcript ever appeared)
const FALLBACK_BIND_GRACE_MS = 15_000;   // Give meta.json time to appear before the newest-file fallback

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
  startedAt: number;
  // Skip content already in the file at bind time (re-armed watchers: avoids
  // re-broadcasting the subagent's whole history as duplicate entries).
  startAtEnd?: boolean;
  bindTimer?: ReturnType<typeof setInterval>;
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
  onToolResult?: ToolResultCallback;
  // Subagent-internal tool_use id -> tool name, so tool_result lines can be
  // attributed (the result line only carries the id).
  toolNames: Map<string, string>;
  stopped: boolean;
  lastReadTime: number;
}

type BroadcastCallback = (toolUseId: string, parentAgentId: string, entries: SubagentStreamEntry[]) => void;

/**
 * Full tool result parsed from the subagent's JSONL. The parent CLI stream
 * does NOT echo subagent tool_result events (only tool_use), so this is the
 * only source for resolving a subagent tool card's "running" state in the
 * terminal.
 */
export interface SubagentToolResult {
  /** Subagent-internal tool_use id (matches the tool_start event's uuid). */
  toolUseId: string;
  toolName: string;
  output: string;
  isError: boolean;
}

type ToolResultCallback = (toolUseId: string, parentAgentId: string, result: SubagentToolResult) => void;

// Cap forwarded tool outputs — JSONL lines can embed very large results.
const MAX_TOOL_RESULT_OUTPUT_CHARS = 100_000;

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
  onBroadcast: BroadcastCallback,
  onToolResult?: ToolResultCallback,
  options?: { startAtEnd?: boolean }
): void {
  if (activeWatchers.has(toolUseId)) {
    log.warn(`[Watcher] Already watching for toolUseId=${toolUseId}`);
    return;
  }

  const watcher: ActiveWatcher = {
    toolUseId,
    parentAgentId,
    subagentsDir,
    startedAt: Date.now(),
    startAtEnd: options?.startAtEnd === true,
    readPosition: 0,
    lineBuffer: '',
    pendingEntries: [],
    onBroadcast,
    onToolResult,
    toolNames: new Map(),
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

/** Whether a live watcher exists for this Task/Agent toolUseId. */
export function isWatching(toolUseId: string): boolean {
  return activeWatchers.has(toolUseId);
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
  clearBindTimer(watcher);
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
 * Bind this watcher to its subagent's transcript inside the shared
 * subagents/ directory, retrying until it appears.
 *
 * Exact binding: each subagent writes agent-<id>.meta.json containing the
 * parent Task/Agent toolUseId — match it against ours. The old "newest
 * .jsonl in the dir" heuristic mis-binds when several subagents run
 * concurrently: at tool_start time the newest file usually belongs to a
 * sibling (this subagent hasn't written anything yet), so this subagent's
 * tool_results never bridge and its Bash cards spin forever.
 */
function tryFindAndWatchFile(watcher: ActiveWatcher): void {
  if (tryBindTranscript(watcher)) return;

  // Retry on a timer — also covers the "session/subagents directory doesn't
  // exist yet" case (readdir fails → keep polling).
  watcher.bindTimer = setInterval(() => {
    if (watcher.stopped) {
      clearBindTimer(watcher);
      return;
    }
    if (tryBindTranscript(watcher)) {
      clearBindTimer(watcher);
      return;
    }
    if (Date.now() - watcher.startedAt > BIND_GIVE_UP_MS) {
      log.warn(`[Watcher] No transcript appeared for toolUseId=${watcher.toolUseId} after ${BIND_GIVE_UP_MS / 1000}s, giving up`);
      doStop(watcher);
    }
  }, BIND_POLL_INTERVAL_MS);

  // React faster than the poll when the directory already exists.
  try {
    watcher.dirWatcher = fs.watch(watcher.subagentsDir, () => {
      if (watcher.stopped || watcher.jsonlPath) return;
      if (tryBindTranscript(watcher)) {
        clearBindTimer(watcher);
      }
    });
    watcher.dirWatcher.on('error', () => {
      watcher.dirWatcher?.close();
      watcher.dirWatcher = undefined;
    });
  } catch { /* directory not created yet — the bind poll covers it */ }
}

function clearBindTimer(watcher: ActiveWatcher): void {
  if (watcher.bindTimer) {
    clearInterval(watcher.bindTimer);
    watcher.bindTimer = undefined;
  }
}

/**
 * One binding attempt. Returns true when a file watch was started.
 *
 * Fallback for CLI layouts that don't write meta files: after a grace
 * period, bind to the newest .jsonl that has no .meta.json sibling. Files
 * WITH a meta sibling are never eligible — a non-matching meta means the
 * file belongs to a different Task/Agent call.
 */
function tryBindTranscript(watcher: ActiveWatcher): boolean {
  const { subagentsDir } = watcher;
  let files: string[];
  try {
    files = fs.readdirSync(subagentsDir);
  } catch {
    return false; // directory doesn't exist yet
  }

  // Exact match via meta.json (agent-<id>.meta.json → agent-<id>.jsonl)
  for (const f of files) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, f), 'utf8'));
      if (meta?.toolUseId !== watcher.toolUseId) continue;
      const jsonl = f.replace(/\.meta\.json$/, '.jsonl');
      if (files.includes(jsonl)) {
        startFileWatch(watcher, path.join(subagentsDir, jsonl));
        return true;
      }
      return false; // our meta exists but the transcript doesn't yet — keep waiting
    } catch { /* unreadable/partially-written meta — skip */ }
  }

  // Fallback: newest orphan .jsonl (no meta sibling), after a grace period
  // that gives our meta.json time to appear.
  if (Date.now() - watcher.startedAt < FALLBACK_BIND_GRACE_MS) return false;
  const orphans = files.filter(
    (f) => f.endsWith('.jsonl') && !files.includes(f.replace(/\.jsonl$/, '.meta.json'))
  );
  if (orphans.length === 0) return false;

  let newest = orphans[0];
  let newestMtime = 0;
  for (const f of orphans) {
    try {
      const stat = fs.statSync(path.join(subagentsDir, f));
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newest = f;
      }
    } catch { /* skip */ }
  }
  startFileWatch(watcher, path.join(subagentsDir, newest));
  return true;
}

/**
 * Start watching a specific JSONL file for new content
 */
function startFileWatch(watcher: ActiveWatcher, filePath: string): void {
  if (watcher.stopped) return;

  // Binding done — the directory watcher is no longer needed.
  watcher.dirWatcher?.close();
  watcher.dirWatcher = undefined;

  watcher.jsonlPath = filePath;
  log.log(`[Watcher] Found JSONL file: ${filePath} for toolUseId=${watcher.toolUseId}${watcher.startAtEnd ? ' (tail from EOF)' : ''}`);

  if (watcher.startAtEnd) {
    try {
      watcher.readPosition = fs.statSync(filePath).size;
    } catch { /* file vanished — readNewLines will retry from 0 */ }
  }

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

      const { entries, toolResults } = parseLine(trimmed, watcher.toolNames);
      if (entries.length > 0) {
        watcher.pendingEntries.push(...entries);
      }
      // Forward full tool results immediately (not debounced) — the terminal
      // uses them to resolve a subagent tool card's "running" spinner.
      if (watcher.onToolResult) {
        for (const result of toolResults) {
          watcher.onToolResult(watcher.toolUseId, watcher.parentAgentId, result);
        }
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
 * Parse a single JSONL line into SubagentStreamEntry items plus any full
 * tool results (used to resolve subagent tool cards in the terminal).
 * `toolNames` accumulates the subagent's tool_use id -> name mapping across
 * lines so results can be attributed to their tool.
 */
function parseLine(
  line: string,
  toolNames: Map<string, string>
): { entries: SubagentStreamEntry[]; toolResults: SubagentToolResult[] } {
  const entries: SubagentStreamEntry[] = [];
  const toolResults: SubagentToolResult[] = [];

  try {
    const data = JSON.parse(line);
    const message = data.message;
    if (!message || !message.content) return { entries, toolResults };

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
            if (block.tool_use_id) {
              toolResults.push({
                toolUseId: block.tool_use_id,
                toolName: toolNames.get(block.tool_use_id) || 'unknown',
                output: resultText.slice(0, MAX_TOOL_RESULT_OUTPUT_CHARS),
                isError: block.is_error === true,
              });
            }
          }
        }
      }
      return { entries, toolResults };
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

          if (block.id) {
            toolNames.set(block.id, toolName);
          }

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

  return { entries, toolResults };
}
