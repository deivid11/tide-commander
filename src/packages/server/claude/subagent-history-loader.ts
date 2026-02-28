/**
 * Subagent History Loader
 *
 * Loads persisted subagent JSONL files from disk for history replay.
 * Parses them into SubagentStreamEntry arrays and correlates each file
 * to the parent session's Task/Agent tool_use via agentId extraction.
 *
 * Disk layout (Claude Code):
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<subagentAgentId>.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { createLogger } from '../utils/logger.js';
import type { SubagentStreamEntry } from '../../shared/types.js';
import { getProjectDir } from './session-loader.js';

const log = createLogger('SubagentHistory');

// Key param extraction per tool name (mirrors subagent-jsonl-watcher.ts)
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

/** Payload for a single subagent's history attached to its parent tool_use */
export interface SubagentHistoryEntry {
  toolUseId: string;
  subagentAgentId?: string;
  name?: string;
  description?: string;
  subagentType?: string;
  model?: string;
  startedAt?: number;
  completedAt?: number;
  streamEntries: SubagentStreamEntry[];
}

/**
 * Parse a single JSONL line into SubagentStreamEntry items.
 * This mirrors the logic in subagent-jsonl-watcher.ts parseLine() but without
 * text truncation limits since history can afford richer content.
 */
function parseSubagentLine(line: string): SubagentStreamEntry[] {
  const entries: SubagentStreamEntry[] = [];

  try {
    const data = JSON.parse(line);
    const message = data.message;
    if (!message || !message.content) return entries;

    const timestamp = data.timestamp || new Date().toISOString();
    const contentArray = Array.isArray(message.content) ? message.content : [];

    // User messages: extract tool_result blocks only
    if (data.type === 'user' && message.role === 'user') {
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

    // Assistant messages: extract text and tool_use blocks
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

/**
 * Read and parse a single subagent JSONL file into stream entries.
 */
async function parseSubagentFile(filePath: string, entriesLimit: number): Promise<SubagentStreamEntry[]> {
  const entries: SubagentStreamEntry[] = [];

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const parsed = parseSubagentLine(line);
    entries.push(...parsed);
  }

  // Return last N entries (most recent activity) to limit payload size
  if (entries.length > entriesLimit) {
    return entries.slice(-entriesLimit);
  }
  return entries;
}

/**
 * Extract the subagent agent ID from a JSONL filename.
 * Pattern: agent-<subagentAgentId>.jsonl
 */
function extractSubagentIdFromFilename(filename: string): string | undefined {
  const match = filename.match(/^agent-(.+)\.jsonl$/);
  return match?.[1];
}

/**
 * Build a mapping from subagent agent IDs to parent tool_use IDs by scanning
 * the parent session's messages. Looks for Task/Agent tool_result messages
 * that contain `agentId: <id>` patterns in their content.
 */
export function buildToolUseIdToSubagentIdMap(
  messages: Array<{ type: string; content: string; toolName?: string; toolUseId?: string }>
): Map<string, string> {
  // Map: subagentAgentId -> parent toolUseId
  const subagentIdToToolUseId = new Map<string, string>();

  // Also track which toolUseIds belong to Task/Agent tool_use calls
  const taskToolUseIds = new Set<string>();

  for (const msg of messages) {
    if (msg.type === 'tool_use' && (msg.toolName === 'Task' || msg.toolName === 'Agent') && msg.toolUseId) {
      taskToolUseIds.add(msg.toolUseId);
    }

    // Look for tool_result messages that contain agentId references
    if (msg.type === 'tool_result' && msg.toolUseId && taskToolUseIds.has(msg.toolUseId)) {
      // Extract agentId from tool result content
      // Pattern: agentId: <id> or "agentId":"<id>" variations
      const agentIdMatch = msg.content.match(/agentId[:\s"]+([a-zA-Z0-9_-]+)/);
      if (agentIdMatch) {
        subagentIdToToolUseId.set(agentIdMatch[1], msg.toolUseId);
      }
    }
  }

  return subagentIdToToolUseId;
}

/**
 * Load subagent history for a given session.
 *
 * @param cwd - Working directory for the agent
 * @param sessionId - The Claude session ID
 * @param parentMessages - The parsed parent session messages (for correlation)
 * @param toolUseIdsInPage - Only return subagents whose toolUseId is in this set (page scoping)
 * @param entriesLimit - Max stream entries per subagent file
 * @returns Array of SubagentHistoryEntry, one per matched subagent file
 */
export async function loadSubagentHistory(
  cwd: string,
  sessionId: string,
  parentMessages: Array<{ type: string; content: string; toolName?: string; toolUseId?: string }>,
  toolUseIdsInPage: Set<string>,
  entriesLimit: number = 200
): Promise<SubagentHistoryEntry[]> {
  const projectDir = getProjectDir(cwd);
  const subagentsDir = path.join(projectDir, sessionId, 'subagents');

  if (!fs.existsSync(subagentsDir)) {
    return [];
  }

  let files: string[];
  try {
    files = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  if (files.length === 0) {
    return [];
  }

  // Build correlation map: subagentAgentId -> parent toolUseId
  const subagentIdToToolUseId = buildToolUseIdToSubagentIdMap(parentMessages);

  const results: SubagentHistoryEntry[] = [];

  for (const file of files) {
    const subagentAgentId = extractSubagentIdFromFilename(file);
    if (!subagentAgentId) continue;

    // Resolve to parent toolUseId
    const toolUseId = subagentIdToToolUseId.get(subagentAgentId);
    if (!toolUseId) {
      log.log(`[SubagentHistory] No toolUseId correlation for subagent file ${file}`);
      continue;
    }

    // Page scoping: only load subagents whose parent tool_use is in the current page
    if (!toolUseIdsInPage.has(toolUseId)) {
      continue;
    }

    const filePath = path.join(subagentsDir, file);
    try {
      const streamEntries = await parseSubagentFile(filePath, entriesLimit);
      if (streamEntries.length > 0) {
        results.push({
          toolUseId,
          subagentAgentId,
          streamEntries,
        });
      }
    } catch (err) {
      log.log(`[SubagentHistory] Failed to parse ${file}: ${err}`);
    }
  }

  log.log(`[SubagentHistory] Loaded ${results.length} subagent(s) for session ${sessionId}`);
  return results;
}
