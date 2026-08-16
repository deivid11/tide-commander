/**
 * WebSocket Handler
 * Real-time communication with clients
 */

import { Server as HttpServer, IncomingMessage } from 'http';
import type { Server as HttpsServer } from 'https';
import type { Duplex } from 'node:stream';
import { hostname } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/types.js';
import {
  agentService,
  bossMessageService,
  buildingService,
  customClassService,
  permissionService,
  runtimeService,
  skillService,
  triggerService,
  workflowService,
} from '../services/index.js';
import { loadAreas, loadBuildings } from '../data/index.js';
import { logger } from '../utils/index.js';
import { setNotificationBroadcast, setExecBroadcast, setTestsBroadcast, setHttpRequestsBroadcast, setFocusAgentBroadcast, setAgentsBroadcast, setTriggerBroadcast, setBuildingsBroadcast, setSkillsBroadcast } from '../routes/index.js';
import { validateWebSocketAuth, isAuthEnabled } from '../auth/index.js';
import { incrementWsSent, incrementWsReceived, setWsClientsCount } from '../routes/perf.js';
import type { HandlerContext, MessageHandler } from './handlers/types.js';
import {
  handleSpawnAgent,
  handleCloneAgent,
  handleForkAgent,
  handleKillAgent,
  handleStopAgent,
  handleClearContext,
  handleRestoreSession,
  handleRestoreSessionNewAgent,
  handleRequestSessionHistory,
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
import { handleGitWatch, handleGitRefresh } from './handlers/git-handler.js';
import { gitWatchService } from '../services/git-watch-service.js';
import { getAgentIdsWithBackgroundTasks, getBackgroundTasksForAgent } from '../services/background-tasks.js';
import {
  handleCreateSecret,
  handleUpdateSecret,
  handleDeleteSecret,
} from './handlers/secrets-handler.js';
import { secretsService } from '../services/secrets-service.js';
import {
  handleTestDatabaseConnection,
  handleTestDatabaseConnectionTransient,
  handleListDatabases,
  handleListTables,
  handleGetTableSchema,
  handleExecuteQuery,
  handleRequestQueryHistory,
  handleToggleQueryFavorite,
  handleDeleteQueryHistory,
  handleClearQueryHistory,
} from './handlers/database-handler.js';
import { handlePermissionResponse } from './handlers/permission-handler.js';
import { handleSendNotification } from './handlers/notification-handler.js';
import { handleSyncAreas, handleSyncBuildings } from './handlers/sync-handler.js';
import {
  handleCreateTrigger,
  handleUpdateTrigger,
  handleDeleteTrigger,
  handleFireTrigger,
} from './handlers/trigger-handler.js';
import {
  handleCreateWorkflowDef,
  handleUpdateWorkflowDef,
  handleDeleteWorkflowDef,
  handleStartWorkflow,
  handlePauseWorkflow,
  handleResumeWorkflow,
  handleCancelWorkflow,
  handleManualTransition,
} from './handlers/workflow-handler.js';
import { handleBrowserRegister, handleBrowserResult } from './handlers/browser-handler.js';
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

/**
 * JSON replacer that handles non-standard types (Error, Map, Set, Date, etc.)
 * Serialize once, reuse the string for all clients.
 */
function messageReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'function') {
    return `[Function: ${(value as Function).name || 'anonymous'}]`;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'object' && value !== null) {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) return Array.from(value.entries());
    if (value instanceof Set) return Array.from(value);
    if (typeof (value as any)[Symbol.iterator] === 'function' && !Array.isArray(value)) {
      try { return Array.from(value as Iterable<unknown>); } catch { /* not iterable */ }
    }
  }
  return value;
}

/** Serialize a message once, reuse for all send calls. */
function serializeMessage(message: ServerMessage): string {
  return JSON.stringify(message, messageReplacer);
}

// Notification-only clients (connected with /ws?mode=notify, e.g. the Android
// foreground service) subscribe exclusively to these types. Everything else —
// output streams, activity, state syncs — is skipped so a backgrounded phone's
// radio/CPU stay idle unless a real notification arrives.
const NOTIFY_ONLY_TYPES = new Set<string>(['agent_notification']);

type TaggedSocket = WebSocket & { __tcNotifyOnly?: boolean };

function wantsMessage(client: WebSocket, messageType: string): boolean {
  return !(client as TaggedSocket).__tcNotifyOnly || NOTIFY_ONLY_TYPES.has(messageType);
}

export function broadcast(message: ServerMessage): void {
  try {
    const data = serializeMessage(message);

    let sentCount = 0;
    let errorCount = 0;

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN && wantsMessage(client, message.type)) {
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
  }
}

function broadcastToOthers(sender: WebSocket, message: ServerMessage): void {
  const data = serializeMessage(message);
  for (const client of clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN && wantsMessage(client, message.type)) {
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
      ws.send(serializeMessage(message));
    },
    sendError: (message: string) => {
      ws.send(serializeMessage({ type: 'error', payload: { message } } as ServerMessage));
    },
    sendActivity,
  };
}

const noopHandler: MessageHandler = () => {};

const messageHandlers = {
  // Liveness probe: reply only to the pinging socket so mobile clients can
  // detect zombie connections (dead TCP still reporting readyState OPEN).
  ping: (ctx, payload) => {
    ctx.sendToClient({ type: 'pong', payload: { ts: payload?.ts ?? Date.now() } });
  },
  spawn_agent: handleSpawnAgent,
  clone_agent: handleCloneAgent,
  fork_agent: handleForkAgent,
  send_command: (ctx, payload) => handleSendCommand(ctx, payload, bossMessageService.buildBossMessage),
  reattach_agent: handleReattachAgent,
  move_agent: handleMoveAgent,
  kill_agent: handleKillAgent,
  stop_agent: handleStopAgent,
  clear_context: handleClearContext,
  browser_register: handleBrowserRegister,
  browser_result: handleBrowserResult,
  restore_session: handleRestoreSession,
  restore_session_new_agent: handleRestoreSessionNewAgent,
  request_session_history: handleRequestSessionHistory,
  collapse_context: handleCollapseContext,
  create_directory: handleCreateDirectory,
  remove_agent: handleRemoveAgent,
  rename_agent: handleRenameAgent,
  update_agent_properties: handleUpdateAgentProperties,
  sync_areas: handleSyncAreas,
  sync_buildings: handleSyncBuildings,
  building_command: handleBuildingCommand,
  pm2_logs_start: handlePM2LogsStart,
  pm2_logs_stop: handlePM2LogsStop,
  git_watch: handleGitWatch,
  git_refresh: handleGitRefresh,
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
  send_notification: handleSendNotification,
  create_secret: handleCreateSecret,
  update_secret: handleUpdateSecret,
  delete_secret: handleDeleteSecret,
  boss_building_command: handleBossBuildingCommand,
  assign_buildings: handleAssignBuildings,
  boss_building_logs_start: handleBossBuildingLogsStart,
  boss_building_logs_stop: handleBossBuildingLogsStop,
  test_database_connection: handleTestDatabaseConnection,
  test_database_connection_transient: handleTestDatabaseConnectionTransient,
  list_databases: handleListDatabases,
  execute_query: handleExecuteQuery,
  request_query_history: handleRequestQueryHistory,
  toggle_query_favorite: handleToggleQueryFavorite,
  delete_query_history: handleDeleteQueryHistory,
  clear_query_history: handleClearQueryHistory,
  get_table_schema: handleGetTableSchema,
  list_tables: handleListTables,
  create_trigger: handleCreateTrigger,
  update_trigger: handleUpdateTrigger,
  delete_trigger: handleDeleteTrigger,
  fire_trigger: handleFireTrigger,
  create_workflow_def: handleCreateWorkflowDef,
  update_workflow_def: handleUpdateWorkflowDef,
  delete_workflow_def: handleDeleteWorkflowDef,
  start_workflow: handleStartWorkflow,
  pause_workflow: handlePauseWorkflow,
  resume_workflow: handleResumeWorkflow,
  cancel_workflow: handleCancelWorkflow,
  manual_transition: handleManualTransition,
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

/**
 * Route /ws upgrades from `server` into `wss`.
 *
 * Split out of init() so that when the server listens on both HTTP and HTTPS,
 * the second listener shares the SAME WebSocketServer — and therefore the same
 * client set and broadcast path. Standing up a second WebSocketServer would
 * silently split clients into two groups, and broadcasts would only reach one.
 */
export function attachServer(server: HttpServer | HttpsServer, wss: WebSocketServer): void {
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = request.url?.split('?')[0];
    if (pathname === '/ws') {
      // Auth check (verifyClient is not used in noServer mode)
      if (isAuthEnabled() && !validateWebSocketAuth(request)) {
        log.log('[WS] Connection rejected: invalid or missing auth token');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Other paths (like /api/terminal/*/ws) are handled by the terminal proxy
  });
}

export function init(server: HttpServer | HttpsServer): WebSocketServer {
  // Use noServer mode so we can manually route upgrade events.
  // This allows the terminal proxy to handle /api/terminal/*/ws upgrades
  // without the main WSS intercepting and rejecting them.
  const wss = new WebSocketServer({ noServer: true });

  attachServer(server, wss);

  wss.on('connection', (ws, request) => {
    clients.add(ws);
    setWsClientsCount(clients.size);
    // Record who opened this socket so the browser bridge can identify the connected
    // extension client: remote IP, browser User-Agent, and Origin (chrome-extension://
    // <id> for the extension). A loopback peer IS this host, so its machine name is the
    // server's own hostname (browsers don't expose the client OS hostname otherwise).
    try {
      const fwd = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ip = fwd || request.socket.remoteAddress || '';
      const local = ip === '' || /^(::1$|::ffff:127\.|127\.|localhost)/i.test(ip);
      (ws as WebSocket & { __tcClient?: unknown }).__tcClient = {
        ip,
        userAgent: String(request.headers['user-agent'] || ''),
        origin: String(request.headers['origin'] || ''),
        host: local ? hostname() : undefined,
        local,
        connectedAt: Date.now(),
      };
    } catch {
      /* best-effort — client info is diagnostic only */
    }
    // Notification-only subscribers (the Android foreground service) get no
    // broadcast firehose and no initial state — just agent_notification.
    const notifyOnly = (request.url || '').includes('mode=notify');
    if (notifyOnly) {
      (ws as TaggedSocket).__tcNotifyOnly = true;
    }

    log.log(`${notifyOnly ? 'Notification-only client' : 'Client'} connected (total: ${clients.size})`);

    if (!notifyOnly) {
      // Send initial state immediately – status sync runs in background
      // server_time goes FIRST: clients use it to align their clock with the
      // server before any output arrives, so optimistic client-stamped items
      // sort correctly against server-stamped outputs even on devices with a
      // skewed clock (mobile).
      ws.send(JSON.stringify({ type: 'server_time', payload: { timestamp: Date.now() } }));

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

      const triggers = triggerService.getAllTriggers();
      ws.send(JSON.stringify({ type: 'triggers_update', payload: triggers }));

      const workflowDefs = workflowService.listDefinitions();
      ws.send(JSON.stringify({ type: 'workflow_definitions_update', payload: workflowDefs }));

      // Agents with live background tasks (backgrounded Bash / async subagents)
      // — sent per agent so a reload doesn't lose the running-task indicators.
      for (const bgAgentId of getAgentIdsWithBackgroundTasks()) {
        ws.send(JSON.stringify({
          type: 'background_tasks_update',
          payload: { agentId: bgAgentId, tasks: getBackgroundTasksForAgent(bgAgentId) },
        }));
      }

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
      gitWatchService.removeSocket(ws);
      log.log(`Client disconnected (remaining: ${clients.size})`);
    });

    // Background sync – refreshes agent status after initial data is sent
    if (!notifyOnly) {
      runtimeService.syncAllAgentStatus().then(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'agents_update', payload: agentService.getAllAgents() }));
        }
      }).catch(() => {});

      // PM2 polling pauses while no clients are connected — run one poll now
      // so building status badges are fresh for this client.
      buildingService.triggerPM2StatusPoll();
    }
  });

  setupServiceListeners({
    broadcast,
    sendActivity,
  });

  setNotificationBroadcast(broadcast);
  setExecBroadcast(broadcast);
  setTestsBroadcast(broadcast);
  setHttpRequestsBroadcast(broadcast);
  setFocusAgentBroadcast(broadcast);
  setAgentsBroadcast(broadcast);
  setTriggerBroadcast(broadcast);
  setBuildingsBroadcast(broadcast);
  setSkillsBroadcast(broadcast);

  log.log('Handler initialized');
  return wss;
}
