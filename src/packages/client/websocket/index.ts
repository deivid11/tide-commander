import type { Agent, ServerMessage, ClientMessage, PermissionRequest, DelegationDecision, CustomAgentClass } from '../../shared/types';
import { store } from '../store';
import { perf } from '../utils/profiling';

let ws: WebSocket | null = null;
let connectionPromise: Promise<void> | null = null;
let isConnecting = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectTimeout: NodeJS.Timeout | null = null;
let onToast: ((type: 'error' | 'success' | 'warning' | 'info', title: string, message: string) => void) | null = null;
let onAgentCreated: ((agent: Agent) => void) | null = null;
let onAgentUpdated: ((agent: Agent, positionChanged: boolean) => void) | null = null;
let onAgentDeleted: ((agentId: string) => void) | null = null;
let onAgentsSync: ((agents: Agent[]) => void) | null = null;
let onSpawnError: (() => void) | null = null;
let onSpawnSuccess: (() => void) | null = null;
let onToolUse: ((agentId: string, toolName: string, toolInput?: Record<string, unknown>) => void) | null = null;
let onDirectoryNotFound: ((path: string) => void) | null = null;
let onDelegation: ((bossId: string, subordinateId: string) => void) | null = null;
let onCustomClassesSync: ((classes: Map<string, CustomAgentClass>) => void) | null = null;

export function setCallbacks(callbacks: {
  onToast?: typeof onToast;
  onAgentCreated?: typeof onAgentCreated;
  onAgentUpdated?: typeof onAgentUpdated;
  onAgentDeleted?: typeof onAgentDeleted;
  onAgentsSync?: typeof onAgentsSync;
  onSpawnError?: typeof onSpawnError;
  onSpawnSuccess?: typeof onSpawnSuccess;
  onToolUse?: typeof onToolUse;
  onDirectoryNotFound?: typeof onDirectoryNotFound;
  onDelegation?: typeof onDelegation;
  onCustomClassesSync?: typeof onCustomClassesSync;
}): void {
  if (callbacks.onToast) onToast = callbacks.onToast;
  if (callbacks.onAgentCreated) onAgentCreated = callbacks.onAgentCreated;
  if (callbacks.onAgentUpdated) onAgentUpdated = callbacks.onAgentUpdated;
  if (callbacks.onAgentDeleted) onAgentDeleted = callbacks.onAgentDeleted;
  if (callbacks.onAgentsSync) onAgentsSync = callbacks.onAgentsSync;
  if (callbacks.onSpawnError) onSpawnError = callbacks.onSpawnError;
  if (callbacks.onSpawnSuccess) onSpawnSuccess = callbacks.onSpawnSuccess;
  if (callbacks.onToolUse) onToolUse = callbacks.onToolUse;
  if (callbacks.onDirectoryNotFound) onDirectoryNotFound = callbacks.onDirectoryNotFound;
  if (callbacks.onDelegation) onDelegation = callbacks.onDelegation;
  if (callbacks.onCustomClassesSync) onCustomClassesSync = callbacks.onCustomClassesSync;
}

export function connect(): void {
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Prevent duplicate connection attempts
  if (isConnecting || (ws && ws.readyState === WebSocket.CONNECTING)) {
    console.log('[WebSocket] Connection already in progress, skipping');
    console.log('[WebSocket] Current state:', ws?.readyState, '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[WebSocket] Already connected, skipping');
    return;
  }

  reconnectAttempts++;
  isConnecting = true;

  // Try different URLs based on environment
  const wsUrl = `ws://${window.location.host}/ws`;
  const altUrl = `ws://localhost:5174/ws`;
  const url127 = `ws://127.0.0.1:5174/ws`;

  console.log(`[WebSocket] Connection attempt #${reconnectAttempts}`);
  console.log('[WebSocket] Primary URL:', wsUrl);
  console.log('[WebSocket] Alternative URL:', altUrl);
  console.log('[WebSocket] Fallback URL:', url127);
  console.log('[WebSocket] Window location:', window.location.hostname);

  try {
    ws = new WebSocket(wsUrl);
    console.log('[WebSocket] WebSocket object created, waiting for connection...');
  } catch (error) {
    console.error('[WebSocket] Failed to create WebSocket:', error);
    isConnecting = false;

    // Try alternative URL
    if (wsUrl !== altUrl) {
      console.log('[WebSocket] Trying alternative URL:', altUrl);
      try {
        ws = new WebSocket(altUrl);
      } catch (err2) {
        console.error('[WebSocket] Alternative URL also failed:', err2);
        handleReconnect();
        return;
      }
    } else {
      handleReconnect();
      return;
    }
  }

  // At this point, ws is guaranteed to be non-null since we return early in failure cases
  const socket = ws;

  socket.onopen = () => {
    console.log('[WebSocket] ✅ Connected successfully!');
    console.log('[WebSocket] ReadyState:', ws?.readyState);
    isConnecting = false;
    reconnectAttempts = 0; // Reset on successful connection
    store.setConnected(true);
    // Start status polling as fallback for missed WebSocket updates
    store.startStatusPolling();
    onToast?.('success', 'Connected', 'Connected to Tide Commander server');
  };

  socket.onmessage = (event) => {
    console.log('[WebSocket] Received message from server:', event.data.substring(0, 200));
    try {
      const message = JSON.parse(event.data) as ServerMessage;
      console.log('[WebSocket] Parsed message type:', message.type);
      handleServerMessage(message);
    } catch (err) {
      console.error('[Tide] Failed to parse message:', err, 'Raw data:', event.data);
    }
  };

  socket.onclose = (event) => {
    console.log('[WebSocket] Connection closed:', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean
    });
    isConnecting = false;
    ws = null;
    store.setConnected(false);
    store.stopStatusPolling();

    if (reconnectAttempts < maxReconnectAttempts) {
      onToast?.('warning', 'Disconnected', `Connection lost. Reconnecting... (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
      handleReconnect();
    } else {
      onToast?.('error', 'Connection Failed', 'Could not connect to server. Please check if the backend is running on port 5174.');
    }
  };

  socket.onerror = (event) => {
    console.error('[WebSocket] ❌ Error occurred:', event);
    console.error('[WebSocket] Error details:', {
      type: event.type,
      target: event.target,
      currentTarget: event.currentTarget,
      // @ts-ignore
      message: event.message || 'Unknown error'
    });

    // Common issues on Mac
    console.log('[WebSocket] Troubleshooting tips:');
    console.log('  1. Check if backend is running: npm run dev:server');
    console.log('  2. Check if port 5174 is available: lsof -i :5174');
    console.log('  3. Check firewall settings');
    console.log('  4. Try: curl http://localhost:5174/api/status');

    isConnecting = false;
  };

  // Set up store to use this connection
  store.setSendMessage(sendMessage);
}

function handleServerMessage(message: ServerMessage): void {
  perf.start(`ws:${message.type}`);

  switch (message.type) {
    case 'agents_update': {
      const agentList = message.payload as Agent[];
      console.log(`[Tide] Received ${agentList.length} agents:`, agentList.map(a => ({ name: a.name, sessionId: a.sessionId })));
      store.setAgents(agentList);
      onAgentsSync?.(agentList);
      // Load tool history after agents are synced
      store.loadToolHistory();
      break;
    }

    case 'agent_created': {
      const newAgent = message.payload as Agent;
      console.log('[WebSocket] Agent created:', newAgent);
      store.addAgent(newAgent);
      store.selectAgent(newAgent.id);
      onAgentCreated?.(newAgent);
      onSpawnSuccess?.();

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalSuccess) {
        console.log('[WebSocket] Calling __spawnModalSuccess');
        (window as any).__spawnModalSuccess();
      }

      onToast?.('success', 'Agent Deployed', `${newAgent.name} is ready for commands`);
      break;
    }

    case 'agent_updated': {
      const updatedAgent = message.payload as Agent;
      const state = store.getState();
      const previousAgent = state.agents.get(updatedAgent.id);

      console.log(`[Tide] Agent updated: ${updatedAgent.id} status=${updatedAgent.status} (was ${previousAgent?.status})`);

      const positionChanged = previousAgent
        ? previousAgent.position.x !== updatedAgent.position.x ||
          previousAgent.position.z !== updatedAgent.position.z
        : false;

      store.updateAgent(updatedAgent);
      onAgentUpdated?.(updatedAgent, positionChanged);
      break;
    }

    case 'agent_deleted': {
      const { id } = message.payload as { id: string };
      store.removeAgent(id);
      onAgentDeleted?.(id);
      break;
    }

    case 'activity': {
      const activity = message.payload as {
        agentId: string;
        agentName: string;
        message: string;
        timestamp: number;
      };
      store.addActivity(activity);
      break;
    }

    case 'event': {
      // Claude event - trigger visual effects and track tools
      const event = message.payload as {
        agentId: string;
        type: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
      };
      if (event.type === 'tool_start' && event.toolName) {
        onToolUse?.(event.agentId, event.toolName, event.toolInput);
        // Track tool execution with input
        store.addToolExecution(event.agentId, event.toolName, event.toolInput);
        // Track file changes from file-related tools
        if (event.toolInput) {
          const filePath = (event.toolInput.file_path || event.toolInput.path) as string | undefined;
          if (filePath) {
            if (event.toolName === 'Write') {
              store.addFileChange(event.agentId, 'created', filePath);
            } else if (event.toolName === 'Edit') {
              store.addFileChange(event.agentId, 'modified', filePath);
            } else if (event.toolName === 'Read') {
              store.addFileChange(event.agentId, 'read', filePath);
            }
          }
        }
      }
      break;
    }

    case 'output': {
      // Streaming output from Claude - goes to dedicated output store
      const output = message.payload as {
        agentId: string;
        text: string;
        isStreaming: boolean;
        timestamp: number;
        isDelegation?: boolean;
      };
      const receiveTime = Date.now();
      const latency = receiveTime - output.timestamp;
      console.log(`📥 [WS OUTPUT] Received output for agent ${output.agentId}, isStreaming=${output.isStreaming}, isDelegation=${output.isDelegation}, textLen=${output.text.length}, serverTs=${output.timestamp}, latency=${latency}ms`);
      console.log(`📥 [WS OUTPUT] Text preview: "${output.text.substring(0, 100)}..."`);
      store.addOutput(output.agentId, {
        text: output.text,
        isStreaming: output.isStreaming,
        timestamp: output.timestamp,
        isDelegation: output.isDelegation,
      });
      console.log(`📥 [WS OUTPUT] store.addOutput completed at ${Date.now()}, total processing time=${Date.now() - receiveTime}ms`);
      break;
    }

    case 'context_stats': {
      // Context stats from /context command
      const { agentId, stats } = message.payload as {
        agentId: string;
        stats: import('../../shared/types').ContextStats;
      };
      console.log(`[Tide] Received context stats for agent ${agentId}: ${stats.usedPercent}% used`);
      store.updateAgentContextStats(agentId, stats);
      break;
    }

    case 'error': {
      const errorPayload = message.payload as { message: string };
      console.error('[WebSocket] Error from server:', errorPayload.message);
      onToast?.('error', 'Error', errorPayload.message);
      onSpawnError?.();

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalError) {
        console.log('[WebSocket] Calling __spawnModalError');
        (window as any).__spawnModalError();
      }
      break;
    }

    case 'directory_not_found': {
      const { path } = message.payload as { path: string };
      console.log('[WebSocket] Directory not found:', path);
      onDirectoryNotFound?.(path);

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalDirNotFound) {
        console.log('[WebSocket] Calling __spawnModalDirNotFound');
        (window as any).__spawnModalDirNotFound(path);
      }
      break;
    }

    case 'command_started': {
      const { agentId, command } = message.payload as {
        agentId: string;
        command: string;
      };
      // Skip adding utility slash commands to output (they're handled specially)
      const trimmedCommand = command.trim();
      if (trimmedCommand === '/context' || trimmedCommand === '/cost' || trimmedCommand === '/compact') {
        break;
      }
      // Add user prompt to output when command actually starts executing
      store.addUserPromptToOutput(agentId, command);
      break;
    }

    case 'supervisor_report': {
      const report = message.payload as import('../../shared/types').SupervisorReport;
      store.setSupervisorReport(report);
      break;
    }

    case 'narrative_update': {
      const { agentId, narrative } = message.payload as {
        agentId: string;
        narrative: import('../../shared/types').ActivityNarrative;
      };
      store.addNarrative(agentId, narrative);
      break;
    }

    case 'supervisor_status': {
      const status = message.payload as {
        enabled: boolean;
        lastReportTime: number | null;
        nextReportTime: number | null;
      };
      store.setSupervisorStatus(status);
      break;
    }

    case 'agent_supervisor_history': {
      const history = message.payload as import('../../shared/types').AgentSupervisorHistory;
      store.setAgentSupervisorHistory(history);
      break;
    }

    case 'agent_analysis': {
      const { agentId, analysis } = message.payload as {
        agentId: string;
        analysis: import('../../shared/types').AgentAnalysis;
      };
      store.addAgentAnalysis(agentId, analysis);
      break;
    }

    case 'areas_update': {
      const areasArray = message.payload as import('../../shared/types').DrawingArea[];
      store.setAreasFromServer(areasArray);
      break;
    }

    case 'buildings_update': {
      const buildingsArray = message.payload as import('../../shared/types').Building[];
      store.setBuildingsFromServer(buildingsArray);
      break;
    }

    case 'building_created': {
      const building = message.payload as import('../../shared/types').Building;
      store.addBuilding(building);
      break;
    }

    case 'building_updated': {
      const building = message.payload as import('../../shared/types').Building;
      store.updateBuildingFromServer(building);
      break;
    }

    case 'building_deleted': {
      const { id } = message.payload as { id: string };
      store.removeBuildingFromServer(id);
      break;
    }

    case 'building_logs': {
      const { buildingId, logs } = message.payload as {
        buildingId: string;
        logs: string;
        timestamp: number;
      };
      store.addBuildingLogs(buildingId, logs);
      break;
    }

    case 'permission_request': {
      const request = message.payload as PermissionRequest;
      store.addPermissionRequest(request);
      break;
    }

    case 'permission_resolved': {
      const { requestId, approved } = message.payload as {
        requestId: string;
        approved: boolean;
      };
      store.resolvePermissionRequest(requestId, approved);
      break;
    }

    // ========================================================================
    // Boss Agent Messages
    // ========================================================================

    case 'delegation_decision': {
      const decision = message.payload as DelegationDecision;
      console.log(`[WS] Received delegation_decision:`, decision);
      store.handleDelegationDecision(decision);
      // Show toast for the delegation
      if (decision.status === 'sent') {
        onToast?.('info', 'Task Delegated', `Delegated to ${decision.selectedAgentName}: ${decision.reasoning.slice(0, 80)}...`);

        // Trigger delegation animation (paper flying from boss to subordinate)
        if (decision.bossId && decision.selectedAgentId) {
          onDelegation?.(decision.bossId, decision.selectedAgentId);
        }

        // NOTE: Auto-forward is now handled by the backend to prevent duplicate commands
        // when multiple clients are connected
      }
      break;
    }

    case 'boss_subordinates_updated': {
      const { bossId, subordinateIds } = message.payload as {
        bossId: string;
        subordinateIds: string[];
      };
      store.updateBossSubordinates(bossId, subordinateIds);
      break;
    }

    case 'delegation_history': {
      const { bossId, decisions } = message.payload as {
        bossId: string;
        decisions: DelegationDecision[];
      };
      store.setDelegationHistory(bossId, decisions);
      break;
    }

    case 'boss_spawned_agent': {
      // Boss spawned a subordinate agent - do NOT auto-select, walk to boss position
      const { agent, bossPosition } = message.payload as {
        agent: Agent;
        bossId: string;
        bossPosition: { x: number; y: number; z: number };
      };
      console.log('[WebSocket] Boss spawned agent:', agent.name, '- walking to boss at', bossPosition);

      // Add agent without selecting it
      store.addAgent(agent);
      onAgentCreated?.(agent);

      // Issue move command to walk toward boss position
      sendMessage({
        type: 'move_agent',
        payload: {
          agentId: agent.id,
          position: bossPosition,
        },
      });

      onToast?.('success', 'Agent Deployed', `${agent.name} spawned by boss, walking to position`);
      break;
    }

    // ========================================================================
    // Skill Messages
    // ========================================================================

    case 'skills_update': {
      const skillsArray = message.payload as import('../../shared/types').Skill[];
      store.setSkillsFromServer(skillsArray);
      console.log(`[WebSocket] Received ${skillsArray.length} skills`);
      break;
    }

    case 'skill_created': {
      const skill = message.payload as import('../../shared/types').Skill;
      store.addSkillFromServer(skill);
      console.log(`[WebSocket] Skill created: ${skill.name}`);
      break;
    }

    case 'skill_updated': {
      const skill = message.payload as import('../../shared/types').Skill;
      store.updateSkillFromServer(skill);
      console.log(`[WebSocket] Skill updated: ${skill.name}`);
      break;
    }

    case 'skill_deleted': {
      const { id } = message.payload as { id: string };
      store.removeSkillFromServer(id);
      console.log(`[WebSocket] Skill deleted: ${id}`);
      break;
    }

    case 'agent_skills': {
      // Response to request_agent_skills - currently just logged, could be used for validation
      const { agentId, skills } = message.payload as {
        agentId: string;
        skills: import('../../shared/types').Skill[];
      };
      console.log(`[WebSocket] Agent ${agentId} has ${skills.length} skills`);
      break;
    }

    // ========================================================================
    // Custom Agent Class Messages
    // ========================================================================

    case 'custom_agent_classes_update': {
      const classesArray = message.payload as import('../../shared/types').CustomAgentClass[];
      store.setCustomAgentClassesFromServer(classesArray);
      console.log(`[WebSocket] Received ${classesArray.length} custom agent classes`);
      // Notify scene to update custom classes for model lookups
      const classesMap = new Map<string, CustomAgentClass>();
      for (const c of classesArray) {
        classesMap.set(c.id, c);
      }
      onCustomClassesSync?.(classesMap);
      break;
    }

    case 'custom_agent_class_created': {
      const customClass = message.payload as import('../../shared/types').CustomAgentClass;
      store.addCustomAgentClassFromServer(customClass);
      console.log(`[WebSocket] Custom agent class created: ${customClass.name}`);
      // Update scene with new custom classes
      onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }

    case 'custom_agent_class_updated': {
      const customClass = message.payload as import('../../shared/types').CustomAgentClass;
      store.updateCustomAgentClassFromServer(customClass);
      console.log(`[WebSocket] Custom agent class updated: ${customClass.name}`);
      // Update scene with updated custom classes
      onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }

    case 'custom_agent_class_deleted': {
      const { id } = message.payload as { id: string };
      store.removeCustomAgentClassFromServer(id);
      console.log(`[WebSocket] Custom agent class deleted: ${id}`);
      // Update scene with remaining custom classes
      onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }
  }

  perf.end(`ws:${message.type}`);
}

// Helper function to handle reconnection
function handleReconnect(): void {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000); // Exponential backoff, max 30s
  console.log(`[WebSocket] Will retry in ${delay}ms...`);
  reconnectTimeout = setTimeout(connect, delay);
}

export function sendMessage(message: ClientMessage): void {
  console.log('[WebSocket] sendMessage called with:', message);

  if (!ws) {
    console.error('[WebSocket] WebSocket is null - not connected!');
    console.log('[WebSocket] Attempting to reconnect...');
    connect(); // Try to connect
    onToast?.('error', 'Not Connected', 'Connecting to server... Please try again in a moment.');
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const stateName = stateNames[ws.readyState] || 'UNKNOWN';
    console.error('[WebSocket] WebSocket state is not OPEN, state:', ws.readyState, `(${stateName})`);

    if (ws.readyState === WebSocket.CONNECTING) {
      onToast?.('warning', 'Connecting...', 'WebSocket is still connecting. Please wait a moment and try again.');
    } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      console.log('[WebSocket] Attempting to reconnect...');
      connect();
      onToast?.('warning', 'Reconnecting...', 'Connection lost. Reconnecting to server...');
    }
    return;
  }

  try {
    const messageStr = JSON.stringify(message);
    console.log('[WebSocket] Sending message to server:', messageStr);
    ws.send(messageStr);
    console.log('[WebSocket] Message sent successfully');
  } catch (error) {
    console.error('[WebSocket] Failed to send message:', error);
    onToast?.('error', 'Send Failed', `Failed to send message: ${error}`);
  }
}

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function getSocket(): WebSocket | null {
  return ws;
}
