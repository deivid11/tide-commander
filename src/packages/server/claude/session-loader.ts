/**
 * Claude Session Loader
 * Loads conversation history from Claude Code's session files
 *
 * Claude stores sessions in ~/.claude/projects/<project-path-encoded>/
 * Each session is a JSONL file with user and assistant messages
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Session');

// Claude's project directory
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// Message types from Claude session files
export interface SessionMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  timestamp: string;
  uuid: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string; // For linking tool_use with tool_result
}

export interface SessionInfo {
  sessionId: string;
  projectPath: string;
  lastModified: Date;
  messageCount: number;
}

export interface ConversationHistory {
  sessionId: string;
  messages: SessionMessage[];
  cwd: string;
  totalCount: number;
  hasMore: boolean;
}

export interface ToolExecution {
  agentId: string;
  agentName: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  timestamp: number;
}

export interface FileChange {
  agentId: string;
  agentName: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
  filePath: string;
  timestamp: number;
}

/**
 * Encode a path to Claude's project directory format
 * /home/user/project -> -home-user-project
 * /home/user/project/ -> -home-user-project (trailing slash removed)
 * /home/user/my_project -> -home-user-my-project (underscores replaced)
 */
export function encodeProjectPath(cwd: string): string {
  // Normalize: remove trailing slashes, then replace / and _ with -
  // Claude Code encodes both forward slashes and underscores as hyphens
  const normalized = cwd.replace(/\/+$/, '');
  return normalized.replace(/[/_]/g, '-');
}

/**
 * Get the Claude projects directory for a given working directory
 */
export function getProjectDir(cwd: string): string {
  const encoded = encodeProjectPath(cwd);
  return path.join(PROJECTS_DIR, encoded);
}

/**
 * List all sessions for a project directory
 */
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  const projectDir = getProjectDir(cwd);

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const files = fs.readdirSync(projectDir);
  const sessions: SessionInfo[] = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;

    const sessionId = file.replace('.jsonl', '');
    const filePath = path.join(projectDir, file);
    const stats = fs.statSync(filePath);

    // Quick count of messages (approximate)
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const messageCount = lines.filter(l => {
      try {
        const parsed = JSON.parse(l);
        return parsed.type === 'user' || parsed.type === 'assistant';
      } catch {
        return false;
      }
    }).length;

    sessions.push({
      sessionId,
      projectPath: cwd,
      lastModified: stats.mtime,
      messageCount,
    });
  }

  // Sort by last modified, newest first
  sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  return sessions;
}

/**
 * Wait for file to be stable (not actively being written)
 * Checks if file size remains constant over a small interval
 */
async function waitForFileStable(filePath: string, maxWaitMs: number = 500): Promise<void> {
  const checkInterval = 50;
  let lastSize = -1;
  let elapsed = 0;

  while (elapsed < maxWaitMs) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size === lastSize) {
        // File size hasn't changed, consider stable
        return;
      }
      lastSize = stats.size;
    } catch {
      // File might not exist yet
      return;
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    elapsed += checkInterval;
  }
}

/**
 * Load conversation history from a session file
 * @param cwd - Working directory
 * @param sessionId - Session ID
 * @param limit - Max messages to return
 * @param offset - Offset from the end (0 = most recent)
 */
export async function loadSession(
  cwd: string,
  sessionId: string,
  limit: number = 50,
  offset: number = 0
): Promise<ConversationHistory | null> {
  const projectDir = getProjectDir(cwd);
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(sessionFile)) {
    log.log(` Session file not found: ${sessionFile}`);
    return null;
  }

  // Wait for file to be stable before reading (Claude might still be writing)
  await waitForFileStable(sessionFile);

  const messages: SessionMessage[] = [];
  // Track tool_use_id to tool_name mapping for linking tool_result
  const toolUseIdToName: Map<string, string> = new Map();

  // Read file line by line
  const fileStream = fs.createReadStream(sessionFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      if (entry.type === 'user' && entry.message?.content) {
        // Check if content is an array (tool results or text blocks)
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_result') {
              const content = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);
              // Look up actual tool name from the mapping
              const toolName = toolUseIdToName.get(block.tool_use_id) || 'unknown';
              // Never truncate - show full content
              messages.push({
                type: 'tool_result',
                content,
                timestamp: entry.timestamp,
                uuid: entry.uuid,
                toolName,
                toolUseId: block.tool_use_id,
              });
            } else if (block.type === 'text' && block.text) {
              // User message stored as text block (e.g., boss context messages)
              messages.push({
                type: 'user',
                content: block.text,
                timestamp: entry.timestamp,
                uuid: entry.uuid,
              });
            }
          }
        } else {
          // Regular user message (string content)
          messages.push({
            type: 'user',
            content: entry.message.content,
            timestamp: entry.timestamp,
            uuid: entry.uuid,
          });
        }
      } else if (entry.type === 'assistant' && entry.message?.content) {
        // Process all content blocks
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'text' && block.text) {
              messages.push({
                type: 'assistant',
                content: block.text,
                timestamp: entry.timestamp,
                uuid: entry.uuid,
              });
            } else if (block.type === 'tool_use' && block.name) {
              // Store tool_use_id to name mapping for later tool_result linking
              if (block.id) {
                toolUseIdToName.set(block.id, block.name);
              }
              messages.push({
                type: 'tool_use',
                content: JSON.stringify(block.input || {}, null, 2),
                timestamp: entry.timestamp,
                uuid: entry.uuid,
                toolName: block.name,
                toolInput: block.input,
                toolUseId: block.id,
              });
            }
            // Skip thinking blocks for display
          }
        } else if (typeof entry.message.content === 'string') {
          messages.push({
            type: 'assistant',
            content: entry.message.content,
            timestamp: entry.timestamp,
            uuid: entry.uuid,
          });
        }
      }
    } catch {
      // Skip invalid lines
    }
  }

  const totalCount = messages.length;

  // Calculate slice indices from the end
  // offset 0, limit 50 -> slice(-50) = last 50 messages
  // offset 50, limit 50 -> slice(-100, -50) = messages 50-100 from end
  const endIndex = totalCount - offset;
  const startIndex = Math.max(0, endIndex - limit);
  const limitedMessages = messages.slice(startIndex, endIndex > 0 ? endIndex : undefined);

  return {
    sessionId,
    messages: limitedMessages,
    cwd,
    totalCount,
    hasMore: startIndex > 0,
  };
}

/**
 * Search conversation history for matching messages
 * @param cwd - Working directory
 * @param sessionId - Session ID
 * @param query - Search query string
 * @param limit - Max results to return
 */
export async function searchSession(
  cwd: string,
  sessionId: string,
  query: string,
  limit: number = 50
): Promise<{ matches: SessionMessage[]; totalMatches: number } | null> {
  const projectDir = getProjectDir(cwd);
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(sessionFile)) {
    return null;
  }

  const queryLower = query.toLowerCase();
  const matches: SessionMessage[] = [];

  // Read file line by line
  const fileStream = fs.createReadStream(sessionFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      // Helper to check if content matches query
      const checkMatch = (content: string, type: SessionMessage['type'], toolName?: string) => {
        if (content.toLowerCase().includes(queryLower)) {
          // Never truncate - show full content
          matches.push({
            type,
            content,
            timestamp: entry.timestamp,
            uuid: entry.uuid,
            toolName,
          });
        }
      };

      if (entry.type === 'user' && entry.message?.content) {
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_result') {
              const content = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);
              checkMatch(content, 'tool_result', block.tool_use_id);
            }
          }
        } else if (typeof entry.message.content === 'string') {
          checkMatch(entry.message.content, 'user');
        }
      } else if (entry.type === 'assistant' && entry.message?.content) {
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'text' && block.text) {
              checkMatch(block.text, 'assistant');
            } else if (block.type === 'tool_use' && block.name) {
              const inputStr = JSON.stringify(block.input || {});
              if (block.name.toLowerCase().includes(queryLower) || inputStr.toLowerCase().includes(queryLower)) {
                // Never truncate - show full content
                matches.push({
                  type: 'tool_use',
                  content: inputStr,
                  timestamp: entry.timestamp,
                  uuid: entry.uuid,
                  toolName: block.name,
                });
              }
            }
          }
        } else if (typeof entry.message.content === 'string') {
          checkMatch(entry.message.content, 'assistant');
        }
      }
    } catch {
      // Skip invalid lines
    }
  }

  const totalMatches = matches.length;

  return {
    matches: matches.slice(-limit), // Return most recent matches
    totalMatches,
  };
}

/**
 * Extract text content from Claude's message content blocks
 */
function extractTextFromContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      }
    }

    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  return null;
}

/**
 * Find the most recent session for a project
 */
export async function findLatestSession(cwd: string): Promise<string | null> {
  const sessions = await listSessions(cwd);

  if (sessions.length === 0) {
    return null;
  }

  // Return the most recently modified session
  return sessions[0].sessionId;
}

/**
 * Load history from a session, returning formatted messages for display
 */
export async function loadSessionHistory(
  cwd: string,
  sessionId: string,
  limit: number = 20
): Promise<{ role: 'user' | 'assistant' | 'tool_use' | 'tool_result'; content: string; timestamp: string; toolName?: string }[]> {
  const history = await loadSession(cwd, sessionId, limit);

  if (!history) {
    return [];
  }

  return history.messages.map(msg => ({
    role: msg.type,
    content: msg.content,
    timestamp: msg.timestamp,
    toolName: msg.toolName,
  }));
}

/**
 * Get session info summary
 */
export function getSessionSummary(sessions: SessionInfo[]): string {
  if (sessions.length === 0) {
    return 'No previous sessions found';
  }

  const latest = sessions[0];
  const age = Date.now() - latest.lastModified.getTime();
  const ageStr = age < 60000 ? 'just now'
    : age < 3600000 ? `${Math.floor(age / 60000)}m ago`
    : age < 86400000 ? `${Math.floor(age / 3600000)}h ago`
    : `${Math.floor(age / 86400000)}d ago`;

  return `${sessions.length} session(s), latest: ${ageStr} (${latest.messageCount} messages)`;
}

/**
 * Load tool history from a session file
 * Returns tool executions and file changes
 */
/**
 * Session activity status for determining if an agent is working
 */
export interface SessionActivityStatus {
  isActive: boolean;           // Recently modified AND waiting for response
  hasPendingWork: boolean;     // Last message indicates Claude should respond (regardless of time)
  lastModified: Date;
  lastMessageType: 'user' | 'assistant' | 'tool_use' | 'tool_result' | null;
  lastMessageTimestamp: Date | null;
  secondsSinceLastActivity: number;
}

/**
 * Check if a session is currently active (being worked on)
 * This checks the session file modification time and last message
 * to determine if Claude is actively processing
 *
 * @param cwd - Working directory
 * @param sessionId - Session ID
 * @param activeThresholdSeconds - Consider active if modified within this many seconds (default 60)
 */
export async function getSessionActivityStatus(
  cwd: string,
  sessionId: string,
  activeThresholdSeconds: number = 60
): Promise<SessionActivityStatus | null> {
  const projectDir = getProjectDir(cwd);
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(sessionFile)) {
    return null;
  }

  const stats = fs.statSync(sessionFile);
  const lastModified = stats.mtime;
  const now = new Date();
  const secondsSinceModified = (now.getTime() - lastModified.getTime()) / 1000;

  // Read the last few lines of the file to get the last message
  let lastMessageType: SessionActivityStatus['lastMessageType'] = null;
  let lastMessageTimestamp: Date | null = null;

  try {
    const content = fs.readFileSync(sessionFile, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    // Check last few lines for the most recent message
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.timestamp) {
          lastMessageTimestamp = new Date(entry.timestamp);
        }

        if (entry.type === 'user') {
          // Check if it's a tool result or a user message
          if (Array.isArray(entry.message?.content)) {
            const hasToolResult = entry.message.content.some((b: any) => b.type === 'tool_result');
            if (hasToolResult) {
              lastMessageType = 'tool_result';
            } else {
              lastMessageType = 'user';
            }
          } else {
            lastMessageType = 'user';
          }
          break;
        } else if (entry.type === 'assistant') {
          // Check if it contains tool_use
          if (Array.isArray(entry.message?.content)) {
            const hasToolUse = entry.message.content.some((b: any) => b.type === 'tool_use');
            lastMessageType = hasToolUse ? 'tool_use' : 'assistant';
          } else {
            lastMessageType = 'assistant';
          }
          break;
        }
      } catch {
        // Skip invalid lines
      }
    }
  } catch (err) {
    log.error(` Error reading session file for activity check:`, err);
  }

  // Determine if work is pending based on last message type:
  // - Last message was from user (Claude should be processing) OR
  // - Last message was tool_use (Claude is waiting for tool result) OR
  // - Last message was tool_result (Claude should be processing the result)
  const waitingForResponse = lastMessageType === 'user' ||
                             lastMessageType === 'tool_use' ||
                             lastMessageType === 'tool_result';

  // isActive = recently modified AND waiting (for real-time status)
  // hasPendingWork = just waiting for response (for server restart detection)
  const recentlyModified = secondsSinceModified < activeThresholdSeconds;
  const isActive = recentlyModified && waitingForResponse;

  return {
    isActive,
    hasPendingWork: waitingForResponse,
    lastModified,
    lastMessageType,
    lastMessageTimestamp,
    secondsSinceLastActivity: secondsSinceModified,
  };
}

/**
 * Check if there's a Claude process running in a specific directory
 * This uses OS-level process inspection to detect Claude processes
 * that survived a server restart
 */
export async function isClaudeProcessRunningInCwd(cwd: string): Promise<boolean> {
  // Only works on Linux/Unix/macOS
  if (process.platform === 'win32') {
    return false;
  }

  try {
    const { execSync } = await import('child_process');

    // Get all claude process PIDs
    const psOutput = execSync('ps aux | grep -E "^[^ ]+ +[0-9]+ .* claude" | grep -v grep | awk \'{print $2}\'', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!psOutput) return false;

    const pids = psOutput.split('\n').filter(p => p.trim());

    // Normalize the target cwd (remove trailing slash)
    const normalizedCwd = cwd.replace(/\/+$/, '');

    // Check each PID's working directory
    for (const pid of pids) {
      try {
        let processCwd: string;

        if (process.platform === 'darwin') {
          // macOS: use lsof to get the current working directory
          // lsof -a -d cwd filters for only the cwd file descriptor
          // -Fn outputs just the name field with 'n' prefix
          const lsofOutput = execSync(`lsof -a -d cwd -p ${pid} -Fn 2>/dev/null | grep '^n'`, {
            encoding: 'utf-8',
            timeout: 2000,
            shell: '/bin/bash',
          }).trim();

          // lsof output format: "n/path/to/directory"
          if (!lsofOutput || !lsofOutput.startsWith('n')) continue;
          processCwd = lsofOutput.substring(1); // Remove the 'n' prefix
        } else {
          // Linux: use /proc filesystem
          processCwd = execSync(`readlink /proc/${pid}/cwd`, {
            encoding: 'utf-8',
            timeout: 1000,
          }).trim();
        }

        // Normalize and compare
        const normalizedProcessCwd = processCwd.replace(/\/+$/, '');
        if (normalizedProcessCwd === normalizedCwd) {
          log.log(` Found Claude process ${pid} running in ${cwd}`);
          return true;
        }
      } catch {
        // Process may have exited, skip
      }
    }

    return false;
  } catch (err) {
    log.error(' Error checking for Claude processes:', err);
    return false;
  }
}

export async function loadToolHistory(
  cwd: string,
  sessionId: string,
  agentId: string,
  agentName: string,
  limit: number = 100
): Promise<{ toolExecutions: ToolExecution[]; fileChanges: FileChange[] }> {
  const projectDir = getProjectDir(cwd);
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);

  const toolExecutions: ToolExecution[] = [];
  const fileChanges: FileChange[] = [];

  if (!fs.existsSync(sessionFile)) {
    return { toolExecutions, fileChanges };
  }

  // Read file line by line
  const fileStream = fs.createReadStream(sessionFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      // Look for tool_use in assistant messages
      if (entry.type === 'assistant' && entry.message?.content) {
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_use' && block.name) {
              const timestamp = new Date(entry.timestamp).getTime();
              const toolInput = block.input as Record<string, unknown> | undefined;

              // Add tool execution
              toolExecutions.push({
                agentId,
                agentName,
                toolName: block.name,
                toolInput,
                timestamp,
              });

              // Check for file operations
              if (toolInput) {
                const filePath = (toolInput.file_path || toolInput.path) as string | undefined;
                if (filePath) {
                  let action: FileChange['action'] | null = null;
                  if (block.name === 'Write') {
                    action = 'created';
                  } else if (block.name === 'Edit') {
                    action = 'modified';
                  } else if (block.name === 'Read') {
                    action = 'read';
                  }
                  if (action) {
                    fileChanges.push({
                      agentId,
                      agentName,
                      action,
                      filePath,
                      timestamp,
                    });
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Skip invalid lines
    }
  }

  // Return most recent items (reversed so newest first)
  return {
    toolExecutions: toolExecutions.slice(-limit).reverse(),
    fileChanges: fileChanges.slice(-limit).reverse(),
  };
}
