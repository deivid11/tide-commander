/**
 * WebSocket Handler
 * Real-time communication with clients
 */

import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/types.js';
import {
  agentService,
  bossMessageService,
  customClassService,
  permissionService,
  runtimeService,
  skillService,
} from '../services/index.js';
import { loadAreas, loadBuildings } from '../data/index.js';
import { logger } from '../utils/index.js';
import { setNotificationBroadcast, setExecBroadcast, setFocusAgentBroadcast } from '../routes/index.js';
import { validateWebSocketAuth, isAuthEnabled } from '../auth/index.js';
import { incrementWsSent, incrementWsReceived, setWsClientsCount } from '../routes/perf.js';
import type { HandlerContext, MessageHandler } from './handlers/types.js';
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
import { handleSendCommand } from './handlers/command-handler.js';
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
import {
  handleSetSupervisorConfig,
  handleRequestSupervisorReport,
  handleRequestAgentSupervisorHistory,
  handleRequestGlobalUsage,
} from './handlers/supervisor-handler.js';
import { handlePermissionResponse } from './handlers/permission-handler.js';
import { handleSendNotification } from './handlers/notification-handler.js';
import { handleSyncAreas, handleSyncBuildings } from './handlers/sync-handler.js';
import { setupServiceListeners } from './listeners/index.js';

const log = logger.ws;

// Connected clients
const clients = new Set<WebSocket>();

type ClientMessageType = ClientMessage['type'];
type ClientMessageByType = {
  [K in ClientMessageType]: Extract<ClientMessage, { type: K }>;
};
type MessageHandlerMap = {
  [K in ClientMessageType]: MessageHandler<ClientMessageByType[K]['payload']>;
};

// ============================================================================
// Broadcasting
// ============================================================================

export function broadcast(message: ServerMessage): void {
  try {
    const data = JSON.stringify(message, (key, value) => {
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

    if (data.length === 0 || !data.startsWith('{')) {
      log.error(`[BROADCAST] Invalid JSON generated for ${message.type}:`, data.substring(0, 100));
      return;
    }

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

    incrementWsSent();

    if (errorCount > 0) {
      log.log(`[BROADCAST] type=${message.type} sentTo=${sentCount}/${clients.size} errors=${errorCount}`);
    }
  } catch (err) {
    log.error(`[BROADCAST] Failed to serialize message of type ${message.type}:`, err);
    log.error(`[BROADCAST] Message type structure:`, typeof message, Object.keys(message || {}));
  }
}

function broadcastToOthers(sender: WebSocket, message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
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

// ============================================================================
// Message Handling
// ============================================================================

function createHandlerContext(ws: WebSocket): HandlerContext {
  return {
    ws,
    broadcast,
    broadcastToOthers: (message: ServerMessage) => {
      broadcastToOthers(ws, message);
    },
    sendToClient: (message: ServerMessage) => {
      ws.send(JSON.stringify(message));
    },
    sendError: (message: string) => {
      ws.send(JSON.stringify({ type: 'error', payload: { message } }));
    },
    sendActivity,
  };
}

const noopHandler: MessageHandler = () => {};

const messageHandlers = {
  spawn_agent: handleSpawnAgent,
  send_command: (ctx, payload) => handleSendCommand(ctx, payload, bossMessageService.buildBossMessage),
  reattach_agent: handleReattachAgent,
  move_agent: handleMoveAgent,
  kill_agent: handleKillAgent,
  stop_agent: handleStopAgent,
  clear_context: handleClearContext,
  collapse_context: handleCollapseContext,
  create_directory: handleCreateDirectory,
  remove_agent: handleRemoveAgent,
  rename_agent: handleRenameAgent,
  update_agent_properties: handleUpdateAgentProperties,
  set_supervisor_config: handleSetSupervisorConfig,
  request_supervisor_report: handleRequestSupervisorReport,
  request_agent_supervisor_history: handleRequestAgentSupervisorHistory,
  sync_areas: handleSyncAreas,
  sync_buildings: handleSyncBuildings,
  create_building: noopHandler,
  update_building: noopHandler,
  delete_building: noopHandler,
  building_command: handleBuildingCommand,
  pm2_logs_start: handlePM2LogsStart,
  pm2_logs_stop: handlePM2LogsStop,
  docker_logs_start: handleDockerLogsStart,
  docker_logs_stop: handleDockerLogsStop,
  docker_list_containers: (ctx) => handleDockerListContainers(ctx),
  permission_response: handlePermissionResponse,
  spawn_boss_agent: handleSpawnBossAgent,
  assign_subordinates: handleAssignSubordinates,
  remove_subordinate: handleRemoveSubordinate,
  send_boss_command: handleSendBossCommand,
  request_delegation_history: handleRequestDelegationHistory,
  create_skill: handleCreateSkill,
  update_skill: handleUpdateSkill,
  delete_skill: handleDeleteSkill,
  assign_skill: handleAssignSkill,
  unassign_skill: handleUnassignSkill,
  request_agent_skills: handleRequestAgentSkills,
  create_custom_agent_class: handleCreateCustomAgentClass,
  update_custom_agent_class: handleUpdateCustomAgentClass,
  delete_custom_agent_class: handleDeleteCustomAgentClass,
  request_context_stats: handleRequestContextStats,
  approve_work_plan: noopHandler,
  execute_work_plan: noopHandler,
  pause_work_plan: noopHandler,
  cancel_work_plan: noopHandler,
  request_work_plans: noopHandler,
  request_global_usage: handleRequestGlobalUsage,
  send_notification: handleSendNotification,
  create_secret: handleCreateSecret,
  update_secret: handleUpdateSecret,
  delete_secret: handleDeleteSecret,
  boss_building_command: handleBossBuildingCommand,
  assign_buildings: handleAssignBuildings,
  boss_building_logs_start: handleBossBuildingLogsStart,
  boss_building_logs_stop: handleBossBuildingLogsStop,
  test_database_connection: handleTestDatabaseConnection,
  list_databases: handleListDatabases,
  execute_query: handleExecuteQuery,
  request_query_history: handleRequestQueryHistory,
  toggle_query_favorite: handleToggleQueryFavorite,
  delete_query_history: handleDeleteQueryHistory,
  clear_query_history: handleClearQueryHistory,
  get_table_schema: handleGetTableSchema,
  list_tables: handleListTables,
  request_snapshots: noopHandler,
  request_snapshot_details: noopHandler,
  create_snapshot: noopHandler,
  delete_snapshot: noopHandler,
  restore_snapshot: noopHandler,
} satisfies MessageHandlerMap;

function handleClientMessage(ws: WebSocket, message: ClientMessage): void {
  incrementWsReceived();
  const ctx = createHandlerContext(ws);
  const handler = messageHandlers[message.type] as MessageHandler<typeof message.payload>;

  void Promise.resolve(handler(ctx, message.payload)).catch((err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : 'Unknown message handling error';
    log.error(`[WS] Failed to handle message type ${message.type}:`, err);
    ctx.sendError(errorMessage);
  });
}

// ============================================================================
// Initialization
// ============================================================================

export function init(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
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
    setWsClientsCount(clients.size);
    log.log(`Client connected (total: ${clients.size})`);

    await runtimeService.syncAllAgentStatus();

    const customClasses = customClassService.getAllCustomClasses();
    ws.send(JSON.stringify({ type: 'custom_agent_classes_update', payload: customClasses }));

    const agents = agentService.getAllAgents();
    ws.send(JSON.stringify({ type: 'agents_update', payload: agents }));

    const areas = loadAreas();
    ws.send(JSON.stringify({ type: 'areas_update', payload: areas }));

    const buildings = loadBuildings();
    ws.send(JSON.stringify({ type: 'buildings_update', payload: buildings }));

    const skills = skillService.getAllSkills();
    ws.send(JSON.stringify({ type: 'skills_update', payload: skills }));

    const secrets = secretsService.getAllSecrets();
    ws.send(JSON.stringify({ type: 'secrets_update', payload: secrets }));

    const pendingPermissions = permissionService.getPendingRequests();
    if (pendingPermissions.length > 0) {
      log.log(`Sending ${pendingPermissions.length} pending permission requests`);
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
      setWsClientsCount(clients.size);
      log.log(`Client disconnected (remaining: ${clients.size})`);
    });
  });

  setupServiceListeners({
    broadcast,
    sendActivity,
  });

  setNotificationBroadcast(broadcast);
  setExecBroadcast(broadcast);
  setFocusAgentBroadcast(broadcast);

  log.log('Handler initialized');
  return wss;
}
