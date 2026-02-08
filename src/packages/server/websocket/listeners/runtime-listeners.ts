import type { ServerMessage, Subagent } from '../../../shared/types.js';
import { parseContextOutput } from '../../claude/backend.js';
import { agentService, runtimeService } from '../../services/index.js';
import { logger, formatToolActivity } from '../../utils/index.js';
import { parseBossDelegation, parseBossSpawn, getBossForSubordinate, clearDelegation } from '../handlers/boss-response-handler.js';

const log = logger.ws;

interface RuntimeListenerContext {
  broadcast: (message: ServerMessage) => void;
  sendActivity: (agentId: string, message: string) => void;
}

export function setupRuntimeListeners(ctx: RuntimeListenerContext): void {
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
              .join(' ')
              .slice(0, 200);
          } else {
            cleanPreview = event.toolOutput.slice(0, 200);
          }
        } catch {
          cleanPreview = event.toolOutput.slice(0, 200);
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
        },
      } as any);

      log.log(`[Subagent] Broadcast subagent_completed for toolUseId=${event.toolUseId}, name=${event.subagentName || 'unknown'}`);
    } else if (event.type === 'error') {
      ctx.sendActivity(agentId, `Error: ${event.errorMessage}`);
    }

    if (event.type === 'step_complete' && event.resultText) {
      const agent = agentService.getAgent(agentId);
      if (agent?.isBoss || agent?.class === 'boss') {
        parseBossDelegation(agentId, agent.name, event.resultText, ctx.broadcast);
        parseBossSpawn(agentId, agent.name, event.resultText, ctx.broadcast, ctx.sendActivity);
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
