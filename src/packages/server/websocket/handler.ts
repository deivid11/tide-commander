/**
 * WebSocket Handler
 * Real-time communication with clients
 */

import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Agent, ClientMessage, ServerMessage, PermissionRequest, DelegationDecision, Skill, CustomAgentClass, Subagent } from '../../shared/types.js';
import { agentService, runtimeService, supervisorService, permissionService, bossService, skillService, customClassService, bossMessageService, agentLifecycleService } from '../services/index.js';
import { loadAreas, saveAreas, loadBuildings, saveBuildings } from '../data/index.js';
import { parseContextOutput } from '../claude/backend.js';
import { logger, createLogger, formatToolActivity } from '../utils/index.js';
import { setNotificationBroadcast, setExecBroadcast } from '../routes/index.js';
import { validateWebSocketAuth, isAuthEnabled } from '../auth/index.js';
import type { HandlerContext } from './handlers/types.js';
import {
  handleSpawnAgent,
  handleKillAgent,
  handleStopAgent,
  handleClearContext,
  handleCollapseContext,
  handleRequestContextStats,
  handleMoveAgent,
  handleRemoveAgent,
  handleRenameAgent,
  handleUpdateAgentProperties,
  handleCreateDirectory,
  handleReattachAgent,
} from './handlers/agent-handler.js';
import {
  handleCreateSkill,
  handleUpdateSkill,
  handleDeleteSkill,
  handleAssignSkill,
  handleUnassignSkill,
  handleRequestAgentSkills,
} from './handlers/skill-handler.js';
import {
  handleSpawnBossAgent,
  handleAssignSubordinates,
  handleRemoveSubordinate,
  handleSendBossCommand,
  handleRequestDelegationHistory,
} from './handlers/boss-handler.js';
import {
  handleCreateCustomAgentClass,
  handleUpdateCustomAgentClass,
  handleDeleteCustomAgentClass,
} from './handlers/custom-class-handler.js';
import {
  handleBuildingCommand,
  handlePM2LogsStart,
  handlePM2LogsStop,
  handleDockerLogsStart,
  handleDockerLogsStop,
  handleDockerListContainers,
  handleBossBuildingCommand,
  handleAssignBuildings,
  handleBossBuildingLogsStart,
  handleBossBuildingLogsStop,
} from './handlers/building-handler.js';
import { buildingService } from '../services/index.js';
import { handleSendCommand } from './handlers/command-handler.js';
import { parseBossDelegation, parseBossSpawn, getBossForSubordinate, clearDelegation } from './handlers/boss-response-handler.js';
import {
  handleCreateSecret,
  handleUpdateSecret,
  handleDeleteSecret,
} from './handlers/secrets-handler.js';
import { secretsService } from '../services/secrets-service.js';
import {
  handleTestDatabaseConnection,
  handleListDatabases,
  handleListTables,
  handleGetTableSchema,
  handleExecuteQuery,
  handleRequestQueryHistory,
  handleToggleQueryFavorite,
  handleDeleteQueryHistory,
  handleClearQueryHistory,
} from './handlers/database-handler.js';

const log = logger.ws;
const supervisorLog = createLogger('Supervisor');

// Connected clients
const clients = new Set<WebSocket>();

// NOTE: Output deduplication removed - will be rebuilt from scratch

// ============================================================================
// Broadcasting
// ============================================================================

export function broadcast(message: ServerMessage): void {
  try {
    // SAFETY: Use a replacer to handle non-serializable objects
    const data = JSON.stringify(message, (key, value) => {
      // Handle non-serializable types gracefully
      if (value === undefined) return null;
      if (typeof value === 'function') {
        return `[Function: ${(value as Function).name || 'anonymous'}]`;
      }
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      // Handle circular references and iterables (Set, Map, etc)
      if (typeof value === 'object' && value !== null) {
        if (value instanceof Date) return value.toISOString();
        if (value instanceof Map) return Array.from(value.entries());
        if (value instanceof Set) return Array.from(value);
        if (typeof value[Symbol.iterator] === 'function' && !Array.isArray(value)) {
          try {
            return Array.from(value as Iterable<unknown>);
          } catch {
            // Not iterable, let default handling continue
          }
        }
      }
      return value;
    });

    // SAFETY: Verify the stringified data can be parsed back
    if (data.length === 0 || !data.startsWith('{')) {
      log.error(`[BROADCAST] Invalid JSON generated for ${message.type}:`, data.substring(0, 100));
      return;
    }

    // SAFETY: Verify it can be parsed back
    try {
      JSON.parse(data);
    } catch (parseErr) {
      log.error(`[BROADCAST] Generated invalid JSON for ${message.type}:`, parseErr);
      log.error(`[BROADCAST] Data preview:`, data.substring(0, 200));
      return;
    }

    let sentCount = 0;
    let errorCount = 0;

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
          sentCount++;
        } catch (err) {
          log.error(`Failed to send ${message.type} to client:`, err);
          errorCount++;
        }
      }
    }

    // PERF: Only log broadcasts when there are errors
    // High-frequency broadcast logging was causing CPU spikes
    // Note: Removed backpressure check (bufferedAmount > 1MB) that was silently dropping messages
    // WebSocket.send() already handles buffering internally - messages are queued, not dropped
    if (errorCount > 0) {
      log.log(`[BROADCAST] type=${message.type} sentTo=${sentCount}/${clients.size} errors=${errorCount}`);
    }
  } catch (err) {
    log.error(`[BROADCAST] Failed to serialize message of type ${message.type}:`, err);
    log.error(`[BROADCAST] Message type structure:`, typeof message, Object.keys(message || {}));
  }
}

function sendActivity(agentId: string, message: string): void {
  const agent = agentService.getAgent(agentId);
  broadcast({
    type: 'activity',
    payload: {
      agentId,
      agentName: agent?.name || 'Unknown',
      message,
      timestamp: Date.now(),
    },
  });
}

/**
 * Handle sync messages by saving data and broadcasting to other clients
 */
function handleSyncMessage<T>(
  ws: WebSocket,
  payload: T[],
  entityName: string,
  saveFn: (data: T[]) => void,
  updateType: string
): void {
  saveFn(payload);
  log.log(` Saved ${payload.length} ${entityName}`);
  // Broadcast to all other clients (exclude sender)
  for (const client of clients) {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: updateType, payload }));
    }
  }
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Create a handler context for the given WebSocket client
 */
function createHandlerContext(ws: WebSocket): HandlerContext {
  return {
    ws,
    broadcast,
    sendToClient: (message: ServerMessage) => {
      ws.send(JSON.stringify(message));
    },
    sendError: (message: string) => {
      ws.send(JSON.stringify({ type: 'error', payload: { message } }));
    },
    sendActivity,
  };
}

function handleClientMessage(ws: WebSocket, message: ClientMessage): void {

  const ctx = createHandlerContext(ws);

  switch (message.type) {
    case 'spawn_agent':
      handleSpawnAgent(ctx, message.payload);
      break;

    case 'send_command':
      handleSendCommand(ctx, message.payload, bossMessageService.buildBossMessage);
      break;

    case 'move_agent':
      handleMoveAgent(ctx, message.payload);
      break;

    case 'kill_agent':
      handleKillAgent(ctx, message.payload);
      break;

    case 'stop_agent':
      handleStopAgent(ctx, message.payload);
      break;

    case 'clear_context':
      handleClearContext(ctx, message.payload);
      break;

    case 'collapse_context':
      handleCollapseContext(ctx, message.payload);
      break;

    case 'request_context_stats':
      handleRequestContextStats(ctx, message.payload);
      break;

    case 'remove_agent':
      handleRemoveAgent(ctx, message.payload);
      break;

    case 'rename_agent':
      handleRenameAgent(ctx, message.payload);
      break;

    case 'update_agent_properties':
      handleUpdateAgentProperties(ctx, message.payload);
      break;

    case 'create_directory':
      handleCreateDirectory(ctx, message.payload);
      break;

    case 'reattach_agent':
      handleReattachAgent(ctx, message.payload);
      break;

    case 'set_supervisor_config':
      supervisorService.setConfig(message.payload);
      break;

    case 'request_supervisor_report':
      supervisorLog.log('Report requested by frontend');
      supervisorService
        .generateReport()
        .then((report) => {
          ws.send(
            JSON.stringify({
              type: 'supervisor_report',
              payload: report,
            })
          );
        })
        .catch((err) => {
          log.error(' Supervisor report failed:', err);
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Supervisor report failed: ${err.message}` },
            })
          );
        });
      break;

    case 'request_agent_supervisor_history':
      {
        const history = supervisorService.getAgentSupervisorHistory(message.payload.agentId);
        ws.send(
          JSON.stringify({
            type: 'agent_supervisor_history',
            payload: history,
          })
        );
      }
      break;

    case 'request_global_usage':
      {
        // First, send current cached usage if available
        const cachedUsage = supervisorService.getGlobalUsage();
        if (cachedUsage) {
          ws.send(
            JSON.stringify({
              type: 'global_usage',
              payload: cachedUsage,
            })
          );
        }

        // Then request a refresh from an idle agent
        supervisorService.requestUsageRefresh().then((agentId) => {
          if (!agentId && !cachedUsage) {
            ws.send(
              JSON.stringify({
                type: 'global_usage',
                payload: null, // No data available
              })
            );
          }
          // If refresh was requested, the response will come through the event system
        });
      }
      break;

    case 'sync_areas':
      handleSyncMessage(ws, message.payload, 'areas', saveAreas, 'areas_update');
      break;

    case 'sync_buildings':
      // Handle PM2 process renames before saving
      buildingService.handleBuildingSync(message.payload, broadcast).then(() => {
        handleSyncMessage(ws, message.payload, 'buildings', saveBuildings, 'buildings_update');
      });
      break;

    case 'building_command':
      handleBuildingCommand(ctx, message.payload);
      break;

    case 'pm2_logs_start':
      handlePM2LogsStart(ctx, message.payload);
      break;

    case 'pm2_logs_stop':
      handlePM2LogsStop(ctx, message.payload);
      break;

    case 'docker_logs_start':
      handleDockerLogsStart(ctx, message.payload);
      break;

    case 'docker_logs_stop':
      handleDockerLogsStop(ctx, message.payload);
      break;

    case 'docker_list_containers':
      handleDockerListContainers(ctx);
      break;

    // ========================================================================
    // Boss Building Messages
    // ========================================================================

    case 'boss_building_command':
      handleBossBuildingCommand(ctx, message.payload);
      break;

    case 'assign_buildings':
      handleAssignBuildings(ctx, message.payload);
      break;

    case 'boss_building_logs_start':
      handleBossBuildingLogsStart(ctx, message.payload);
      break;

    case 'boss_building_logs_stop':
      handleBossBuildingLogsStop(ctx, message.payload);
      break;

    case 'permission_response':
      {
        const { requestId, approved, reason, remember } = message.payload;
        log.log(` Permission response: ${requestId} -> ${approved ? 'approved' : 'denied'}${remember ? ' (remember)' : ''}`);
        const handled = permissionService.respondToPermissionRequest({
          requestId,
          approved,
          reason,
          remember,
        });
        if (handled) {
          // Broadcast that the permission was resolved
          broadcast({
            type: 'permission_resolved',
            payload: { requestId, approved },
          });
        } else {
          log.log(` No pending request found for ${requestId}`);
        }
      }
      break;

    // ========================================================================
    // Boss Agent Messages
    // ========================================================================

    case 'spawn_boss_agent':
      handleSpawnBossAgent(ctx, message.payload);
      break;

    case 'assign_subordinates':
      handleAssignSubordinates(ctx, message.payload);
      break;

    case 'remove_subordinate':
      handleRemoveSubordinate(ctx, message.payload);
      break;

    case 'send_boss_command':
      handleSendBossCommand(ctx, message.payload);
      break;

    case 'request_delegation_history':
      handleRequestDelegationHistory(ctx, message.payload);
      break;

    // ========================================================================
    // Skill Messages
    // ========================================================================

    case 'create_skill':
      handleCreateSkill(ctx, message.payload);
      break;

    case 'update_skill':
      handleUpdateSkill(ctx, message.payload);
      break;

    case 'delete_skill':
      handleDeleteSkill(ctx, message.payload);
      break;

    case 'assign_skill':
      handleAssignSkill(ctx, message.payload);
      break;

    case 'unassign_skill':
      handleUnassignSkill(ctx, message.payload);
      break;

    case 'request_agent_skills':
      handleRequestAgentSkills(ctx, message.payload);
      break;

    // ========================================================================
    // Custom Agent Class Messages
    // ========================================================================

    case 'create_custom_agent_class':
      handleCreateCustomAgentClass(ctx, message.payload);
      break;

    case 'update_custom_agent_class':
      handleUpdateCustomAgentClass(ctx, message.payload);
      break;

    case 'delete_custom_agent_class':
      handleDeleteCustomAgentClass(ctx, message.payload);
      break;

    // ========================================================================
    // Notification Messages
    // ========================================================================

    case 'send_notification':
      {
        const { agentId, title, message: notifMessage } = message.payload;
        const agent = agentService.getAgent(agentId);
        if (agent) {
          const notification = {
            id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            agentId,
            agentName: agent.name,
            agentClass: agent.class,
            title,
            message: notifMessage,
            timestamp: Date.now(),
          };
          log.log(`[Notification] Agent ${agent.name} sent notification: "${title}"`);
          broadcast({
            type: 'agent_notification',
            payload: notification,
          });
        } else {
          log.error(`[Notification] Agent not found: ${agentId}`);
        }
      }
      break;

    // ========================================================================
    // Secrets Messages
    // ========================================================================

    case 'create_secret':
      handleCreateSecret(ctx, message.payload);
      break;

    case 'update_secret':
      handleUpdateSecret(ctx, message.payload);
      break;

    case 'delete_secret':
      handleDeleteSecret(ctx, message.payload);
      break;

    // ========================================================================
    // Database Messages
    // ========================================================================

    case 'test_database_connection':
      handleTestDatabaseConnection(ctx, message.payload);
      break;

    case 'list_databases':
      handleListDatabases(ctx, message.payload);
      break;

    case 'list_tables':
      handleListTables(ctx, message.payload);
      break;

    case 'get_table_schema':
      handleGetTableSchema(ctx, message.payload);
      break;

    case 'execute_query':
      handleExecuteQuery(ctx, message.payload);
      break;

    case 'request_query_history':
      handleRequestQueryHistory(ctx, message.payload);
      break;

    case 'toggle_query_favorite':
      handleToggleQueryFavorite(ctx, message.payload);
      break;

    case 'delete_query_history':
      handleDeleteQueryHistory(ctx, message.payload);
      break;

    case 'clear_query_history':
      handleClearQueryHistory(ctx, message.payload);
      break;
  }
}


// ============================================================================
// Service Event Handlers
// ============================================================================

function setupServiceListeners(): void {
  // Agent events
  agentService.subscribe((event, data) => {
    switch (event) {
      case 'created':
        // Already handled in handleClientMessage
        break;
      case 'updated':
        broadcast({
          type: 'agent_updated',
          payload: data as Agent,
        });
        break;
      case 'deleted':
        broadcast({
          type: 'agent_deleted',
          payload: { id: data as string },
        });
        sendActivity(data as string, 'Agent terminated');
        break;
    }
  });

  // Claude events
  runtimeService.on('event', (agentId, event) => {
    // Send activity for important events
    if (event.type === 'init') {
      sendActivity(agentId, `Session initialized (${event.model})`);
    } else if (event.type === 'tool_start') {
      const details = formatToolActivity(event.toolName, event.toolInput);
      sendActivity(agentId, details);

      // Detect Task tool subagent spawning
      if (event.toolName === 'Task' && event.toolUseId && event.subagentName) {
        const subagent = runtimeService.getActiveSubagentByToolUseId(event.toolUseId);
        if (subagent) {
          // Calculate position near parent agent
          const parentAgent = agentService.getAgent(agentId);
          const parentPos = parentAgent?.position || { x: 0, y: 0, z: 0 };
          // Offset subagents in a circle around parent
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
          broadcast({
            type: 'subagent_started',
            payload: subagentPayload,
          } as any);
          sendActivity(agentId, `Spawned subagent: ${subagent.name} (${subagent.subagentType})`);
          log.log(`[Subagent] Broadcast subagent_started: ${subagent.name} (${subagent.id})`);
        }
      }
    } else if (event.type === 'tool_result' && event.toolName === 'Task' && event.toolUseId) {
      // Check if this is a subagent completion
      // subagentName is attached by claude-service before cleanup
      // Extract clean text from result (may be JSON array of content blocks)
      let cleanPreview: string | undefined;
      if (event.toolOutput) {
        try {
          const parsed = JSON.parse(event.toolOutput);
          if (Array.isArray(parsed)) {
            // Claude API format: [{"type":"text","text":"..."}]
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
      broadcast({
        type: 'subagent_completed',
        payload: {
          subagentId: event.toolUseId, // Client uses toolUseId to find the subagent
          parentAgentId: agentId,
          success: true,
          resultPreview: cleanPreview,
          subagentName: event.subagentName, // From claude-service, attached before cleanup
        },
      } as any);
      log.log(`[Subagent] Broadcast subagent_completed for toolUseId=${event.toolUseId}, name=${event.subagentName || 'unknown'}`);
    } else if (event.type === 'error') {
      sendActivity(agentId, `Error: ${event.errorMessage}`);
    }

    // For boss agents, parse delegation and spawn blocks from step_complete result text
    if (event.type === 'step_complete' && event.resultText) {
      const agent = agentService.getAgent(agentId);
      if (agent?.isBoss || agent?.class === 'boss') {
        parseBossDelegation(agentId, agent.name, event.resultText, broadcast);
        parseBossSpawn(agentId, agent.name, event.resultText, broadcast, sendActivity);
      }
    }

    // Parse and broadcast context stats from /context command
    if (event.type === 'context_stats' && event.contextStatsRaw) {
      log.log(`[context_stats] Received for agent ${agentId}, raw length: ${event.contextStatsRaw.length}`);
      const stats = parseContextOutput(event.contextStatsRaw);
      if (stats) {
        log.log(`[context_stats] Parsed: ${stats.usedPercent}% used, ${stats.totalTokens}/${stats.contextWindow} tokens`);
        // Update agent with full context info
        agentService.updateAgent(agentId, {
          contextStats: stats,
          contextUsed: stats.totalTokens,
          contextLimit: stats.contextWindow,
        }, false);
        // Broadcast to all clients
        broadcast({
          type: 'context_stats',
          payload: { agentId, stats },
        });
      } else {
        log.log(`[context_stats] Failed to parse context output for agent ${agentId}`);
      }
    }

    // Broadcast raw event
    broadcast({
      type: 'event',
      payload: { ...event, agentId } as any,
    });
  });

  runtimeService.on('output', (agentId: string, text: string, isStreaming: boolean | undefined, subagentName: string | undefined, uuid: string | undefined, toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }) => {
    const textPreview = text.slice(0, 80).replace(/\n/g, '\\n');
    log.log(`[OUTPUT] agent=${agentId.slice(0,4)} streaming=${isStreaming} text="${textPreview}" uuid=${uuid || 'none'}`);

    // Extract tool information from text for better debugger display
    const payload: Record<string, unknown> = {
      agentId,
      text,
      isStreaming: isStreaming || false,
      timestamp: Date.now(),
      ...(subagentName ? { subagentName } : {}),
      ...(uuid ? { uuid } : {}),
    };

    // Use toolMeta from runner if available (attached to "Using tool:" messages)
    if (toolMeta?.toolName) {
      payload.toolName = toolMeta.toolName;
    }
    if (toolMeta?.toolInput) {
      payload.toolInput = toolMeta.toolInput;
    }

    // Parse tool information from text messages for better debugger integration
    if (text.startsWith('Using tool:') && !payload.toolName) {
      payload.toolName = text.replace('Using tool:', '').trim();
    } else if (text.startsWith('Tool input:')) {
      try {
        const jsonStr = text.replace('Tool input:', '').trim();
        payload.toolInput = JSON.parse(jsonStr);
      } catch (e) {
        // If JSON parsing fails, store raw input text
        payload.toolInputRaw = text.replace('Tool input:', '').trim();
      }
    } else if (text.startsWith('Bash output:')) {
      payload.toolOutput = text.replace('Bash output:', '').trim();
    } else if (text.startsWith('Tool result:')) {
      payload.toolOutput = text.replace('Tool result:', '').trim();
    }

    broadcast({
      type: 'output',
      payload,
    } as ServerMessage);

    // If this subordinate is working on a delegated task, forward output to boss
    const delegation = getBossForSubordinate(agentId);
    if (delegation) {
      // Only forward non-streaming (final) output chunks to avoid flooding
      // Or forward streaming updates at intervals for real-time progress
      broadcast({
        type: 'agent_task_output',
        payload: {
          bossId: delegation.bossId,
          subordinateId: agentId,
          output: text.slice(0, 500), // Truncate to avoid large payloads
        },
      } as any);
    }
  });

  runtimeService.on('complete', (agentId, success) => {
    sendActivity(agentId, success ? 'Task completed' : 'Task failed');

    // If this subordinate was working on a delegated task, notify boss
    const delegation = getBossForSubordinate(agentId);
    log.log(`[COMPLETE] Agent ${agentId} completed (success=${success}), delegation=${delegation ? `bossId=${delegation.bossId}` : 'none'}`);
    if (delegation) {
      log.log(`[COMPLETE] Broadcasting agent_task_completed for subordinate ${agentId} to boss ${delegation.bossId}`);
      broadcast({
        type: 'agent_task_completed',
        payload: {
          bossId: delegation.bossId,
          subordinateId: agentId,
          success,
        },
      } as any);

      // Clear the delegation tracking
      clearDelegation(agentId);
    }
  });

  runtimeService.on('error', (agentId, error) => {
    sendActivity(agentId, `Error: ${error}`);
  });

  // Set up command started callback
  runtimeService.setCommandStartedCallback((agentId, command) => {
    broadcast({
      type: 'command_started',
      payload: { agentId, command },
    });
  });

  // Set up session update callback for orphaned agents
  // When an orphaned agent's session file is updated, notify clients to refresh history
  runtimeService.setSessionUpdateCallback((agentId) => {
    broadcast({
      type: 'session_updated',
      payload: { agentId },
    });
  });

  // Permission events
  permissionService.subscribe((request: PermissionRequest) => {
    log.log(` Broadcasting permission_request: ${request.id} for tool ${request.tool}`);
    broadcast({
      type: 'permission_request',
      payload: request,
    });
    // Also update agent status to 'waiting' while waiting for permission
    const agent = agentService.getAgent(request.agentId);
    if (agent) {
      agentService.updateAgent(request.agentId, {
        status: 'waiting',
        currentTask: `Waiting for permission: ${request.tool}`,
      });
    }
  });

  // Supervisor events
  supervisorService.subscribe((event, data) => {
    switch (event) {
      case 'report':
        broadcast({
          type: 'supervisor_report',
          payload: data,
        } as ServerMessage);
        break;
      case 'agent_analysis':
        // Single agent analysis update
        broadcast({
          type: 'agent_analysis',
          payload: data,
        } as ServerMessage);
        break;
      case 'narrative':
        broadcast({
          type: 'narrative_update',
          payload: data,
        } as ServerMessage);
        break;
      case 'config_changed':
        broadcast({
          type: 'supervisor_status',
          payload: supervisorService.getStatus(),
        } as ServerMessage);
        break;
      case 'global_usage':
        broadcast({
          type: 'global_usage',
          payload: data,
        } as ServerMessage);
        break;
    }
  });

  // Boss service events
  bossService.subscribe((event, data) => {
    switch (event) {
      case 'delegation_decision':
        broadcast({
          type: 'delegation_decision',
          payload: data as DelegationDecision,
        });
        break;
      case 'subordinates_updated':
        const { bossId, subordinateIds } = data as { bossId: string; subordinateIds: string[] };
        broadcast({
          type: 'boss_subordinates_updated',
          payload: { bossId, subordinateIds },
        });
        break;
    }
  });

  // Skill service events
  skillService.subscribe((event, data) => {
    switch (event) {
      case 'created':
        broadcast({
          type: 'skill_created',
          payload: data as Skill,
        });
        break;
      case 'updated':
        broadcast({
          type: 'skill_updated',
          payload: data as Skill,
        });
        // Auto-restart agents using this skill so they get the updated content
        agentLifecycleService.restartAgentsWithSkill(data as Skill, sendActivity);
        break;
      case 'deleted':
        broadcast({
          type: 'skill_deleted',
          payload: { id: data as string },
        });
        break;
      case 'assigned':
        // Assignment changes (adding/removing agents) - broadcast but don't restart
        // This fixes the bug where assigning a skill to a new agent would restart
        // all other agents that already had the skill
        broadcast({
          type: 'skill_updated',
          payload: data as Skill,
        });
        break;
    }
  });

  // Custom agent class service events
  customClassService.customClassEvents.on('created', (customClass: CustomAgentClass) => {
    broadcast({
      type: 'custom_agent_class_created',
      payload: customClass,
    });
  });

  customClassService.customClassEvents.on('updated', (customClass: CustomAgentClass) => {
    broadcast({
      type: 'custom_agent_class_updated',
      payload: customClass,
    });

    // Auto-restart agents when their class instructions are updated
    // This ensures running agents get the new instructions
    agentLifecycleService.restartAgentsWithClass(customClass.id, sendActivity);
  });

  customClassService.customClassEvents.on('deleted', (id: string) => {
    broadcast({
      type: 'custom_agent_class_deleted',
      payload: { id },
    });
  });
}

// ============================================================================
// Initialization
// ============================================================================

export function init(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    // Custom verification for authentication
    verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }, callback) => {
      if (!isAuthEnabled()) {
        callback(true);
        return;
      }

      const isValid = validateWebSocketAuth(info.req);
      if (!isValid) {
        log.log('[WS] Connection rejected: invalid or missing auth token');
        callback(false, 401, 'Unauthorized');
        return;
      }
      callback(true);
    },
  });

  wss.on('connection', async (ws) => {
    clients.add(ws);
    log.log(`🔗 Client connected (total: ${clients.size})`);

    // Sync agent status with actual process state before sending to client
    // This only corrects 'working' -> 'idle' if the process is dead
    await runtimeService.syncAllAgentStatus();

    // Send custom agent classes FIRST - agents need these for custom model loading
    const customClasses = customClassService.getAllCustomClasses();
    ws.send(JSON.stringify({ type: 'custom_agent_classes_update', payload: customClasses }));

    // Send agents AFTER custom classes so models can be resolved correctly
    const agents = agentService.getAllAgents();
    ws.send(JSON.stringify({ type: 'agents_update', payload: agents }));

    // Send current areas
    const areas = loadAreas();
    ws.send(JSON.stringify({ type: 'areas_update', payload: areas }));

    // Send current buildings
    const buildings = loadBuildings();
    ws.send(JSON.stringify({ type: 'buildings_update', payload: buildings }));

    // Send current skills
    const skills = skillService.getAllSkills();
    ws.send(JSON.stringify({ type: 'skills_update', payload: skills }));

    // Send current secrets
    const secrets = secretsService.getAllSecrets();
    ws.send(JSON.stringify({ type: 'secrets_update', payload: secrets }));

    // Send pending permission requests
    const pendingPermissions = permissionService.getPendingRequests();
    if (pendingPermissions.length > 0) {
      log.log(` Sending ${pendingPermissions.length} pending permission requests`);
      for (const request of pendingPermissions) {
        ws.send(
          JSON.stringify({
            type: 'permission_request',
            payload: request,
          })
        );
      }
    }

    ws.on('message', (data) => {
      const dataStr = data.toString();
      try {
        const message = JSON.parse(dataStr) as ClientMessage;
        handleClientMessage(ws, message);
      } catch (err) {
        log.error('Invalid message:', err, dataStr.substring(0, 100));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      log.log(`🔴 Client disconnected (remaining: ${clients.size})`);
    });
  });

  // Set up service event listeners
  setupServiceListeners();

  // Wire up broadcast function for HTTP notification endpoint
  setNotificationBroadcast(broadcast);

  // Wire up broadcast function for HTTP exec endpoint
  setExecBroadcast(broadcast);

  log.log(' Handler initialized');
  return wss;
}
 
