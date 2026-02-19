import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ServerMessage, Subagent } from '../../../shared/types.js';
import { parseContextOutput } from '../../claude/backend.js';
import { agentService, runtimeService } from '../../services/index.js';
import { logger, formatToolActivity } from '../../utils/index.js';
import { parseBossDelegation, parseBossSpawn, getBossForSubordinate, clearDelegation } from '../handlers/boss-response-handler.js';

const log = logger.ws;
const MAX_SYNTHETIC_DIFF_FILE_BYTES = 256 * 1024;

interface InferredEditInput extends Record<string, unknown> {
  file_path: string;
  old_string: string;
  new_string: string;
  operation: 'append' | 'in_place_edit' | 'overwrite';
}

interface RuntimeListenerContext {
  broadcast: (message: ServerMessage) => void;
  sendActivity: (agentId: string, message: string) => void;
}

export function setupRuntimeListeners(ctx: RuntimeListenerContext): void {
  const pendingBashCommands = new Map<string, string>();

  runtimeService.on('event', (agentId, event) => {
    if (event.type === 'init') {
      ctx.sendActivity(agentId, `Session initialized (${event.model})`);
    } else if (event.type === 'tool_start') {
      const details = formatToolActivity(event.toolName, event.toolInput);
      ctx.sendActivity(agentId, details);

      if (event.toolName === 'Task' && event.toolUseId && event.subagentName) {
        const subagent = runtimeService.getActiveSubagentByToolUseId(event.toolUseId);
        if (subagent) {
          const parentAgent = agentService.getAgent(agentId);
          const parentPos = parentAgent?.position || { x: 0, y: 0, z: 0 };
          const activeSubagents = runtimeService.getActiveSubagentsForAgent(agentId);
          const angle = (activeSubagents.length - 1) * (Math.PI * 2 / Math.max(activeSubagents.length, 3));
          const radius = 3;

          const subagentPayload: Subagent = {
            id: subagent.id,
            parentAgentId: agentId,
            toolUseId: subagent.toolUseId,
            name: subagent.name,
            description: subagent.description,
            subagentType: subagent.subagentType,
            model: subagent.model,
            status: 'working',
            startedAt: subagent.startedAt,
            position: {
              x: parentPos.x + Math.cos(angle) * radius,
              y: parentPos.y,
              z: parentPos.z + Math.sin(angle) * radius,
            },
          };

          ctx.broadcast({
            type: 'subagent_started',
            payload: subagentPayload,
          } as any);

          ctx.sendActivity(agentId, `Spawned subagent: ${subagent.name} (${subagent.subagentType})`);
          log.log(`[Subagent] Broadcast subagent_started: ${subagent.name} (${subagent.id})`);
        }
      }
    } else if (event.type === 'tool_result' && event.toolName === 'Task' && event.toolUseId) {
      let cleanPreview: string | undefined;
      if (event.toolOutput) {
        try {
          const parsed = JSON.parse(event.toolOutput);
          if (Array.isArray(parsed)) {
            cleanPreview = parsed
              .filter((b: any) => b.type === 'text' && b.text)
              .map((b: any) => b.text)
              .join(' ');
          } else {
            cleanPreview = event.toolOutput;
          }
        } catch {
          cleanPreview = event.toolOutput;
        }
      }

      ctx.broadcast({
        type: 'subagent_completed',
        payload: {
          subagentId: event.toolUseId,
          parentAgentId: agentId,
          success: true,
          resultPreview: cleanPreview,
          subagentName: event.subagentName,
          // Completion stats from Task tool metadata
          durationMs: event.subagentStats?.durationMs,
          tokensUsed: event.subagentStats?.tokensUsed,
          toolUseCount: event.subagentStats?.toolUseCount,
        },
      } as any);

      log.log(`[Subagent] Broadcast subagent_completed for toolUseId=${event.toolUseId}, name=${event.subagentName || 'unknown'}, stats=${event.subagentStats ? `${event.subagentStats.durationMs}ms/${event.subagentStats.tokensUsed}tok/${event.subagentStats.toolUseCount}tools` : 'none'}`);
    }

    // Forward subagent internal tool activity to client (events with parentToolUseId)
    if (event.parentToolUseId && event.type === 'tool_start' && event.toolName !== 'Task') {
      const toolDesc = formatToolActivity(event.toolName, event.toolInput);
      ctx.broadcast({
        type: 'subagent_output',
        payload: {
          subagentId: event.parentToolUseId,
          parentAgentId: agentId,
          text: toolDesc,
          isStreaming: false,
          timestamp: Date.now(),
        },
      } as any);
    }

    if (event.type === 'error') {
      ctx.sendActivity(agentId, `Error: ${event.errorMessage}`);
    } else if (event.type === 'tool_result' && event.toolName === 'Bash') {
      const command = pendingBashCommands.get(agentId);
      pendingBashCommands.delete(agentId);
      if (!command) {
        return;
      }

      const agent = agentService.getAgent(agentId);
      const inferredEdits = inferEditInputsFromBash(command, agent?.cwd || process.cwd());
      for (const inferredEdit of inferredEdits) {
        const now = Date.now();
        ctx.broadcast({
          type: 'output',
          payload: {
            agentId,
            text: 'Using tool: Edit',
            isStreaming: false,
            timestamp: now,
            toolName: 'Edit',
            toolInput: inferredEdit,
          },
        } as ServerMessage);
        ctx.broadcast({
          type: 'output',
          payload: {
            agentId,
            text: `Tool input: ${JSON.stringify(inferredEdit)}`,
            isStreaming: false,
            timestamp: now + 1,
            toolName: 'Edit',
            toolInput: inferredEdit,
          },
        } as ServerMessage);
      }
    }

    if (event.type === 'step_complete' && event.resultText) {
      const agent = agentService.getAgent(agentId);
      if (agent?.isBoss || agent?.class === 'boss') {
        parseBossDelegation(agentId, agent.name, event.resultText, ctx.broadcast);
        parseBossSpawn(agentId, agent.name, event.resultText, ctx.broadcast, ctx.sendActivity);
      }
    }

    // Real-time context tracking: broadcast lightweight context_update on usage_snapshot and step_complete
    if ((event.type === 'usage_snapshot' && event.tokens) || event.type === 'step_complete') {
      const agent = agentService.getAgent(agentId);
      if (agent) {
        ctx.broadcast({
          type: 'context_update',
          payload: {
            agentId,
            contextUsed: agent.contextUsed,
            contextLimit: agent.contextLimit,
          },
        } as any);
      }
    }

    if (event.type === 'context_stats' && event.contextStatsRaw) {
      log.log(`[context_stats] Received for agent ${agentId}, raw length: ${event.contextStatsRaw.length}`);
      const stats = parseContextOutput(event.contextStatsRaw);
      if (stats) {
        log.log(`[context_stats] Parsed: ${stats.usedPercent}% used, ${stats.totalTokens}/${stats.contextWindow} tokens`);
        agentService.updateAgent(agentId, {
          contextStats: stats,
          contextUsed: stats.totalTokens,
          contextLimit: stats.contextWindow,
        }, false);

        ctx.broadcast({
          type: 'context_stats',
          payload: { agentId, stats },
        });
        // Also send lightweight context_update so the context bar updates immediately
        ctx.broadcast({
          type: 'context_update',
          payload: {
            agentId,
            contextUsed: stats.totalTokens,
            contextLimit: stats.contextWindow,
          },
        } as any);
      } else {
        log.log(`[context_stats] Failed to parse context output for agent ${agentId}`);
      }
    }

    ctx.broadcast({
      type: 'event',
      payload: { ...event, agentId } as any,
    });
  });

  runtimeService.on(
    'output',
    (
      agentId: string,
      text: string,
      isStreaming: boolean | undefined,
      subagentName: string | undefined,
      uuid: string | undefined,
      toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }
    ) => {
      const textPreview = text.slice(0, 80).replace(/\n/g, '\\n');
      log.log(`[OUTPUT] agent=${agentId.slice(0, 4)} streaming=${isStreaming} text="${textPreview}" uuid=${uuid || 'none'}`);

      const payload: Record<string, unknown> = {
        agentId,
        text,
        isStreaming: isStreaming || false,
        timestamp: Date.now(),
        ...(subagentName ? { subagentName } : {}),
        ...(uuid ? { uuid } : {}),
      };

      if (toolMeta?.toolName) {
        payload.toolName = toolMeta.toolName;
      }
      if (toolMeta?.toolInput) {
        payload.toolInput = toolMeta.toolInput;
      }

      if (text.startsWith('Using tool:') && !payload.toolName) {
        payload.toolName = text.replace('Using tool:', '').trim();
      } else if (text.startsWith('Tool input:')) {
        try {
          const jsonStr = text.replace('Tool input:', '').trim();
          payload.toolInput = JSON.parse(jsonStr);
        } catch {
          payload.toolInputRaw = text.replace('Tool input:', '').trim();
        }
      } else if (text.startsWith('Bash output:')) {
        payload.toolOutput = text.replace('Bash output:', '').trim();
      } else if (text.startsWith('Tool result:')) {
        payload.toolOutput = text.replace('Tool result:', '').trim();
      }

      ctx.broadcast({
        type: 'output',
        payload,
      } as ServerMessage);

      if (typeof payload.toolName === 'string' && payload.toolName === 'Bash') {
        const toolInput = payload.toolInput as Record<string, unknown> | undefined;
        const command = typeof toolInput?.command === 'string' ? toolInput.command : undefined;
        if (command && text.startsWith('Using tool:')) {
          pendingBashCommands.set(agentId, command);
        }
      }

      const delegation = getBossForSubordinate(agentId);
      if (delegation) {
        ctx.broadcast({
          type: 'agent_task_output',
          payload: {
            bossId: delegation.bossId,
            subordinateId: agentId,
            output: text.slice(0, 500),
          },
        } as any);
      }
    }
  );

  runtimeService.on('complete', (agentId, success) => {
    pendingBashCommands.delete(agentId);
    ctx.sendActivity(agentId, success ? 'Task completed' : 'Task failed');

    const delegation = getBossForSubordinate(agentId);
    log.log(`[COMPLETE] Agent ${agentId} completed (success=${success}), delegation=${delegation ? `bossId=${delegation.bossId}` : 'none'}`);
    if (delegation) {
      log.log(`[COMPLETE] Broadcasting agent_task_completed for subordinate ${agentId} to boss ${delegation.bossId}`);
      ctx.broadcast({
        type: 'agent_task_completed',
        payload: {
          bossId: delegation.bossId,
          subordinateId: agentId,
          success,
        },
      } as any);

      clearDelegation(agentId);
    }
  });

  runtimeService.on('error', (agentId, error) => {
    pendingBashCommands.delete(agentId);
    ctx.sendActivity(agentId, `Error: ${error}`);
  });

  runtimeService.setCommandStartedCallback((agentId, command) => {
    ctx.broadcast({
      type: 'command_started',
      payload: { agentId, command },
    });
  });

  runtimeService.setSessionUpdateCallback((agentId) => {
    ctx.broadcast({
      type: 'session_updated',
      payload: { agentId },
    });
  });
}

function inferEditInputsFromBash(command: string, cwd: string): InferredEditInput[] {
  const shell = extractShellCommand(command);
  const candidates = new Map<string, InferredEditInput['operation']>();

  for (const regex of [
    /\b(?:printf|echo)\s+(['"])([\s\S]*?)\1\s*>>\s*([^\s;|&]+)/g,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(shell)) !== null) {
      const filePath = normalizeCandidatePath(match[3]);
      if (!filePath) continue;
      candidates.set(filePath, 'append');
    }
  }

  for (const segment of shell.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean)) {
    if ((/\bsed\s+-i\b/.test(segment) || /\bperl\s+-pi\b/.test(segment))) {
      const filePath = extractLastLikelyFilePath(segment);
      if (filePath) {
        candidates.set(filePath, 'in_place_edit');
      }
    }
  }

  const overwriteRegex = /(?<![0-9>])>(?!>)\s*([^\s;|&]+)/g;
  let overwriteMatch: RegExpExecArray | null;
  while ((overwriteMatch = overwriteRegex.exec(shell)) !== null) {
    const filePath = normalizeCandidatePath(overwriteMatch[1]);
    if (!filePath || filePath === '/dev/null') continue;
    if (!candidates.has(filePath)) {
      candidates.set(filePath, 'overwrite');
    }
  }

  const edits: InferredEditInput[] = [];
  for (const [filePath, operation] of candidates.entries()) {
    const snapshot = buildFileSnapshot(filePath, cwd);
    if (!snapshot) continue;
    if (snapshot.old_string === snapshot.new_string) continue;
    edits.push({
      file_path: normalizePathForUi(filePath),
      old_string: snapshot.old_string,
      new_string: snapshot.new_string,
      operation,
    });
  }

  return edits;
}

function extractShellCommand(command: string): string {
  const doubleQuoted = command.match(/-lc\s+"([\s\S]*)"$/);
  if (doubleQuoted) {
    return doubleQuoted[1]
      .replace(/\\"/g, '"')
      .replace(/\\`/g, '`')
      .replace(/\\\$/g, '$')
      .replace(/\\\\/g, '\\');
  }
  const singleQuoted = command.match(/-lc\s+'([\s\S]*)'$/);
  if (singleQuoted) {
    return singleQuoted[1];
  }
  return command;
}

function normalizeCandidatePath(value: string): string | undefined {
  const candidate = value.trim().replace(/^['"]|['"]$/g, '');
  if (!candidate) return undefined;
  if (candidate === '/') return undefined;
  if (candidate.startsWith('&') || candidate.startsWith('(')) return undefined;
  if (candidate.startsWith('-')) return undefined;
  if (/^[><|&]+$/.test(candidate)) return undefined;
  if (/^\d+$/.test(candidate)) return undefined;
  if (!/[/.~]/.test(candidate) && !/^[A-Z][A-Za-z0-9_-]*$/.test(candidate)) return undefined;
  if (/^(one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(candidate)) return undefined;
  return candidate;
}

function extractLastLikelyFilePath(segment: string): string | undefined {
  const tokens = segment.match(/'[^']*'|"[^"]*"|\S+/g) || [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const candidate = normalizeCandidatePath(tokens[i]);
    if (candidate) return candidate;
  }
  return undefined;
}

function normalizePathForUi(filePath: string): string {
  if (filePath.startsWith('/') || filePath.startsWith('./') || filePath.startsWith('../') || filePath.startsWith('~')) {
    return filePath;
  }
  return `./${filePath}`;
}

function buildFileSnapshot(filePath: string, cwd: string): { old_string: string; new_string: string } | null {
  const absolutePath = resolveAbsolutePath(filePath, cwd);
  if (!absolutePath) return null;

  const newContent = readTextFileIfSmall(absolutePath);
  if (newContent === null) return null;

  const gitRoot = findGitRoot(path.dirname(absolutePath));
  if (!gitRoot) {
    return { old_string: '', new_string: newContent };
  }

  const relativePath = path.relative(gitRoot, absolutePath);
  if (!relativePath || relativePath.startsWith('..')) {
    return null;
  }

  const oldContent = readHeadFileIfSmall(gitRoot, relativePath);
  if (oldContent === null) return null;

  return { old_string: oldContent, new_string: newContent };
}

function resolveAbsolutePath(filePath: string, cwd: string): string | null {
  if (!filePath) return null;
  if (filePath.startsWith('~')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) return null;
    return path.resolve(homeDir, filePath.slice(1));
  }
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}

function readTextFileIfSmall(absolutePath: string): string | null {
  if (!fs.existsSync(absolutePath)) return '';

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_SYNTHETIC_DIFF_FILE_BYTES) return null;

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch {
    return null;
  }
  if (buffer.includes(0x00)) return null;
  return buffer.toString('utf8');
}

function findGitRoot(startDir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function readHeadFileIfSmall(gitRoot: string, relativePath: string): string | null {
  const gitPath = relativePath.split(path.sep).join(path.posix.sep);
  try {
    const output = execFileSync('git', ['show', `HEAD:${gitPath}`], {
      cwd: gitRoot,
      encoding: 'utf8',
      maxBuffer: MAX_SYNTHETIC_DIFF_FILE_BYTES + 4096,
    });
    if (Buffer.byteLength(output, 'utf8') > MAX_SYNTHETIC_DIFF_FILE_BYTES) {
      return null;
    }
    return output;
  } catch {
    return '';
  }
}
